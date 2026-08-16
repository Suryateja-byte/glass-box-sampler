/**
 * Live mode: an OpenAI-compatible `/chat/completions` stream mapped onto the
 * same `SamplerSource` contract the replay fixtures implement, so the engine
 * and the UI cannot tell the two apart.
 *
 * One rule governs this file: nothing here invents a number. Every candidate
 * and every logprob that reaches the screen in live mode came off the wire. If
 * the endpoint is unreachable, unauthorised, or returns a completion without
 * logprobs, the run ends through `sink.onError` with a message the user can act
 * on -- never with a plausible-looking distribution no model produced. The same
 * rule is why an unreadable step aborts the stream instead of being skipped:
 * a silently dropped token would leave the transcript describing text that is
 * not the text on screen.
 *
 * Note also what this file does NOT do: it never writes to the console. Errors
 * travel through the sink so the UI can show them; nothing is left in a devtools
 * log where an API key or a prompt could be read out of it later.
 */

import type {
  SamplerSource,
  SourceRequest,
  SourceSink,
  StepDistribution,
  TokenCandidate,
  TokenRecord,
} from '../engine/types';
import { K } from '../engine/types';
import { SseParser } from './sse';

// ---------------------------------------------------------------- key handling

/**
 * Injected by Vite's `define`. It is the empty string in any production build
 * (see vite.config.ts), so a key can only ever come from a dev server run with
 * OPENAI_API_KEY set.
 */
declare const __DEV_OPENAI_KEY__: string;

/**
 * The key lives here and nowhere else: not in localStorage, not in
 * sessionStorage, not in a cookie, not in IndexedDB, not in the URL, not in a
 * log line. A module-private binding dies with the page, which is the strongest
 * guarantee available to a client-side app and the reason live mode asks for
 * the key again on every reload.
 */
let apiKey = readDevKey();

function readDevKey(): string {
  // Guard the read: outside a Vite build (unit tests, any other bundler) the
  // define does not exist and touching the identifier would throw at import.
  return typeof __DEV_OPENAI_KEY__ === 'string' ? __DEV_OPENAI_KEY__.trim() : '';
}

/** Sets the key for this page only. Whitespace is trimmed: a pasted key that
 *  carries a trailing newline otherwise fails as an unexplained HTTP 401. */
export function setApiKey(key: string): void {
  apiKey = key.trim();
}

export function clearApiKey(): void {
  apiKey = '';
}

/** Lets the UI enable live mode without ever holding the key itself. */
export function hasApiKey(): boolean {
  return apiKey !== '';
}

/**
 * The key must not outlive the page. `pagehide` fires in the cases `unload`
 * misses -- bfcache entry, tab discard, an app switch on mobile -- and there is
 * nothing to persist on the way out because the key was never written anywhere.
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => {
    clearApiKey();
  });
}

// ---------------------------------------------------------------- the source

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_TOKENS = 128;

export interface LiveSourceOptions {
  /** API root, no trailing `/chat/completions`. Default: OpenAI's. */
  readonly baseUrl?: string | undefined;
  readonly model?: string | undefined;
  readonly maxTokens?: number | undefined;
  /** Seam for tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch | undefined;
}

/** Everything one in-flight generation needs to be ended exactly once. */
interface Run {
  readonly controller: AbortController;
  readonly sink: SourceSink;
  settled: boolean;
}

/** Mutable tally for one stream, used to diagnose a failure after the fact. */
interface Progress {
  sawJson: boolean;
  sawLogprobs: boolean;
  sawContent: boolean;
  malformed: number;
  steps: number;
  finishReason: 'eos' | 'length' | null;
  stop: 'done' | 'halt' | 'fatal' | null;
  fatalMessage: string;
}

export class LiveSource implements SamplerSource {
  readonly kind = 'live' as const;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly fetchImpl: typeof fetch | undefined;
  private current: Run | null = null;

  constructor(options: LiveSourceOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.fetchImpl = options.fetchImpl;
  }

  start(request: SourceRequest, sink: SourceSink): void {
    // Starting while a stream is open would leave two readers pushing into an
    // engine that has already moved on. End the old run first.
    if (this.current !== null) this.stop();

    // Read the key once, here: a `clearApiKey()` mid-flight must not be able to
    // send a half-authenticated retry, and nothing downstream needs it again.
    const key = apiKey;
    if (key === '') {
      sink.onError(
        'No API key is set, so live mode cannot call the model. Paste a key into the key field, or run the dev server with OPENAI_API_KEY set. Replay mode needs no key.',
      );
      return;
    }

    const run: Run = { controller: new AbortController(), sink, settled: false };
    this.current = run;
    // `start` is synchronous by contract; everything past this point reports
    // through the sink, so the promise is deliberately not surfaced.
    void this.stream(request, run, key);
  }

  /** Idempotent, and safe when nothing is running. */
  stop(): void {
    const run = this.current;
    if (run === null) return;
    run.controller.abort();
    this.finish(run, 'aborted');
  }

  private async stream(request: SourceRequest, run: Run, key: string): Promise<void> {
    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    if (!isHttpUrl(endpoint)) {
      this.fail(
        run,
        `The base URL "${this.baseUrl}" is not an absolute http(s) URL, so there is nothing to call. Use a full API root such as https://api.openai.com/v1.`,
      );
      return;
    }

    const body = JSON.stringify({
      model: this.model,
      messages: buildMessages(request),
      stream: true,
      logprobs: true,
      // The API caps top_logprobs at 20; K is 10, which is what the bar panel
      // draws and what tailMass is computed against.
      top_logprobs: K,
      temperature: request.settings.temperature,
      top_p: request.settings.topP,
      max_tokens: this.maxTokens,
    });

    // Bound explicitly: an unbound `globalThis.fetch` throws "Illegal
    // invocation" in Chromium.
    const doFetch = this.fetchImpl ?? globalThis.fetch.bind(globalThis);

    let response: Response;
    try {
      response = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body,
        signal: run.controller.signal,
      });
    } catch (cause) {
      if (run.settled || run.controller.signal.aborted) return;
      this.fail(run, describeTransportFailure(cause, endpoint));
      return;
    }

    if (!response.ok) {
      const message = await describeHttpFailure(response);
      this.fail(run, message);
      return;
    }
    if (response.body === null) {
      this.fail(
        run,
        `The endpoint answered ${statusLine(response)} but sent no body to stream. Check that the request was not rewritten by a proxy that strips streaming responses.`,
      );
      return;
    }

    let reader: ReadableStreamDefaultReader<string>;
    try {
      reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    } catch (cause) {
      this.fail(run, `The response could not be opened as a text stream. ${messageOf(cause)}`.trim());
      return;
    }

    const parser = new SseParser();
    const progress: Progress = {
      sawJson: false,
      sawLogprobs: false,
      sawContent: false,
      malformed: 0,
      steps: 0,
      finishReason: null,
      stop: null,
      fatalMessage: '',
    };

    // Which half of the loop threw. A bug raised by the engine while recording
    // a step must not be reported to the user as a network failure.
    let phase: 'read' | 'record' = 'read';

    try {
      while (progress.stop === null) {
        phase = 'read';
        const { done, value } = await reader.read();
        if (done) break;
        if (value === undefined) continue;

        phase = 'record';
        for (const event of parser.push(value)) {
          if (event.kind === 'done') {
            progress.stop = 'done';
            break;
          }
          this.consumeEvent(event.data, run, progress);
          if (progress.stop !== null) break;
        }
      }
    } catch (cause) {
      if (run.settled || run.controller.signal.aborted) return;
      this.fail(
        run,
        phase === 'read'
          ? describeTransportFailure(cause, endpoint)
          : `Live mode failed while recording a step, after ${progress.steps} token(s). ${messageOf(cause)}`.trim(),
      );
      return;
    } finally {
      // Release the socket whether we finished, halted, or threw. The stream is
      // being discarded either way, so a rejection here has nothing to report.
      try {
        await reader.cancel();
      } catch {
        /* nothing left to release */
      }
    }

    // stop() may have landed while we were awaiting a read.
    if (run.settled) return;

    if (progress.stop === 'fatal') {
      this.fail(run, progress.fatalMessage);
      return;
    }
    if (progress.stop === 'halt') {
      // The engine stopped committing tokens, so the rest of the completion is
      // of no use to anyone. Tear the request down rather than draining it.
      run.controller.abort();
      this.finish(run, 'aborted');
      return;
    }
    if (!progress.sawLogprobs) {
      this.fail(run, describeMissingLogprobs(progress));
      return;
    }
    if (progress.finishReason !== null) {
      this.finish(run, progress.finishReason);
      return;
    }
    if (progress.stop === 'done') {
      this.finish(run, 'eos');
      return;
    }
    // No finish_reason and no [DONE]: the body simply ended. Reporting 'eos'
    // here would dress a truncated connection up as a completed sentence.
    this.fail(
      run,
      `The connection closed mid-completion after ${progress.steps} token(s), with no finish reason. The tokens already shown are real; the ending is missing.`,
    );
  }

  /** Folds one SSE data payload into `progress`, emitting any steps it carries. */
  private consumeEvent(payload: string, run: Run, progress: Progress): void {
    const trimmed = payload.trim();
    // Some gateways emit bare `data:` heartbeats. Empty is not a parse failure.
    if (trimmed === '') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // One unreadable event does not sink the stream -- proxies do inject junk
      // between real chunks -- but the count is reported if nothing valid ever
      // shows up, so a wholly corrupt stream is never mistaken for an empty one.
      progress.malformed += 1;
      return;
    }

    const root = asRecord(parsed);
    if (root === null) {
      progress.malformed += 1;
      return;
    }
    progress.sawJson = true;

    // Several providers report a mid-flight failure as a data event rather than
    // an HTTP status, which would otherwise look like a stream that just ended.
    const inlineError = asRecord(root['error']);
    if (inlineError !== null) {
      progress.stop = 'fatal';
      const detail = asString(inlineError['message']);
      progress.fatalMessage = `The endpoint reported an error mid-stream: ${
        detail === null || detail.trim() === '' ? 'no detail was given' : clip(detail)
      }.`;
      return;
    }

    const choices = asArray(root['choices']);
    // A usage-only trailer carries `choices: []`. That is normal, not malformed.
    if (choices === null || choices.length === 0) return;
    const choice = asRecord(choices[0]);
    if (choice === null) {
      progress.malformed += 1;
      return;
    }

    // delta.content is not used to build steps -- the tokens come from the
    // logprobs entries, which are authoritative -- but seeing text arrive with
    // no logprobs beside it is exactly how a provider that ignores the
    // logprobs flag announces itself.
    const delta = asRecord(choice['delta']);
    const content = delta === null ? null : asString(delta['content']);
    if (content !== null && content !== '') progress.sawContent = true;

    const logprobs = asRecord(choice['logprobs']);
    const entries = logprobs === null ? null : asArray(logprobs['content']);
    if (entries !== null) {
      for (const raw of entries) {
        const step = mapLogprobEntry(raw);
        if (step === null) {
          // A step we cannot measure cannot be recorded, and skipping it would
          // silently desynchronise the transcript from the visible text.
          progress.stop = 'fatal';
          progress.fatalMessage =
            'The endpoint returned a logprobs entry without a usable token and logprob, so that step could not be recorded honestly. Nothing after it is trustworthy, so the stream was stopped.';
          return;
        }
        if (progress.steps === 0 && step.distribution.candidates.length < 2) {
          // A single-candidate "distribution" is not one. Catching this on the
          // first token stops a half-generated run that could never be read.
          progress.stop = 'fatal';
          progress.fatalMessage =
            'The endpoint returned a logprob for the chosen token but no alternatives, so there is no distribution to show. The model or gateway is ignoring top_logprobs; try another model or provider.';
          return;
        }
        progress.sawLogprobs = true;
        progress.steps += 1;
        // Live mode records rather than samples, so the engine's return value
        // only matters as a stop signal.
        if (run.sink.onStep(step.distribution, step.observedIndex) === 'halt') {
          progress.stop = 'halt';
          return;
        }
      }
    }

    const reason = asString(choice['finish_reason']);
    if (reason !== null) {
      // 'stop', 'content_filter' and 'tool_calls' all mean the model stopped
      // producing text; only hitting the token cap is a different story.
      progress.finishReason = reason === 'length' ? 'length' : 'eos';
    }
  }

  private finish(run: Run, reason: 'eos' | 'length' | 'aborted'): void {
    if (run.settled) return;
    run.settled = true;
    if (this.current === run) this.current = null;
    run.sink.onDone(reason);
  }

  /** Terminal: `onError` ends the run, so no `onDone` follows it. */
  private fail(run: Run, message: string): void {
    if (run.settled) return;
    run.settled = true;
    if (this.current === run) this.current = null;
    run.sink.onError(message);
  }
}

// ---------------------------------------------------------------- mapping

interface MappedStep {
  readonly distribution: StepDistribution;
  readonly observedIndex: number;
}

/**
 * Turns one `logprobs.content[i]` entry into a distribution plus the index of
 * the token the model actually emitted.
 *
 * Returns null when the entry carries no honest reading -- no token text, or a
 * chosen token with no logprob anywhere. Padding or guessing here would put
 * numbers on screen that no model produced.
 */
function mapLogprobEntry(raw: unknown): MappedStep | null {
  const entry = asRecord(raw);
  if (entry === null) return null;
  const token = asString(entry['token']);
  if (token === null) return null;

  const candidates: TokenCandidate[] = [];
  for (const item of asArray(entry['top_logprobs']) ?? []) {
    const top = asRecord(item);
    if (top === null) continue;
    const text = asString(top['token']);
    const logprob = asFiniteNumber(top['logprob']);
    if (text === null || logprob === null) continue;
    candidates.push({ text, logprob });
  }

  // Providers usually pre-sort, but both the bar order and observedIndex depend
  // on descending order, so sort rather than trust. Array.sort is stable, so
  // ties keep the order the provider sent them in.
  candidates.sort((a, b) => b.logprob - a.logprob);

  // First match wins: after sorting that is the highest-probability entry with
  // this text, which is the one the model can be said to have chosen.
  let observedIndex = candidates.findIndex((candidate) => candidate.text === token);

  if (observedIndex === -1) {
    // Some providers omit the chosen token from top_logprobs, or return a
    // top-k list that has been deduplicated or truncated around it. The chosen
    // token still has to appear, because observedIndex points into this array
    // and the transcript's text is built from it.
    const chosenLogprob = asFiniteNumber(entry['logprob']);
    if (chosenLogprob === null) return null;

    observedIndex = candidates.findIndex((candidate) => candidate.logprob < chosenLogprob);
    if (observedIndex === -1) observedIndex = candidates.length;
    candidates.splice(observedIndex, 0, { text: token, logprob: chosenLogprob });

    if (candidates.length > K) {
      // Trim back to K by dropping the least likely candidate -- but never the
      // one we just inserted. If the chosen token sorted to the very bottom,
      // the next-to-last goes instead; removing any single element leaves the
      // rest correctly ordered.
      const dropIndex =
        observedIndex === candidates.length - 1 ? candidates.length - 2 : candidates.length - 1;
      candidates.splice(dropIndex, 1);
      if (dropIndex < observedIndex) observedIndex -= 1;
    }
  }
  // A short list is carried as-is. Padding it would claim the model considered
  // candidates it never reported; tailMass already says how much is missing.

  let mass = 0;
  for (const candidate of candidates) mass += Math.exp(candidate.logprob);

  return {
    distribution: { candidates, tailMass: Math.max(0, 1 - mass) },
    observedIndex,
  };
}

interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/**
 * A fork resumes from a prefix that is no longer the tail of any open stream,
 * so the committed text is replayed as an assistant turn and the model
 * continues it. The chat API offers no "resume from these tokens" primitive;
 * this is the continuation mechanism, and it is why a forked live branch is a
 * fresh request rather than a rewind.
 */
function buildMessages(request: SourceRequest): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'user', content: request.prompt }];
  const prefix = prefixText(request.prefix);
  if (prefix !== '') messages.push({ role: 'assistant', content: prefix });
  return messages;
}

function prefixText(prefix: readonly TokenRecord[]): string {
  let text = '';
  for (const record of prefix) {
    text += record.distribution.candidates[record.chosenIndex]?.text ?? '';
  }
  return text;
}

// ---------------------------------------------------------------- diagnosis

/**
 * A fetch that rejects without producing a response never reached the
 * application layer, so there is no status to report -- and almost no detail
 * either, because browsers deliberately flatten every cross-origin refusal to a
 * bare "Failed to fetch" so a page cannot probe what it may not see.
 *
 * In practice it is CORS, a host that is down or misaddressed, or mixed content
 * on an https page. It is specifically NOT a bad key: that comes back as HTTP
 * 401, which means the request plainly did arrive.
 *
 * Browser-direct calls do work against api.openai.com, OpenRouter, Groq, and a
 * locally run llama.cpp or vLLM server -- all of them send
 * Access-Control-Allow-Origin. Many enterprise gateways and self-hosted proxies
 * do not, and no client-side change can fix that; it needs a proxy in front.
 */
function describeTransportFailure(cause: unknown, endpoint: string): string {
  const detail = messageOf(cause);
  const parts = [
    `Could not reach ${safeOrigin(endpoint)}: the request failed before any response arrived.`,
    'That almost always means CORS -- the endpoint sent no Access-Control-Allow-Origin header for this page -- or a host that is down, blocked, or at the wrong address. An invalid key would have returned HTTP 401 instead, so this is not the key.',
    'Use a provider that allows browser-direct calls (api.openai.com, OpenRouter, Groq, or a local llama.cpp / vLLM server), or put a small local proxy in front of the gateway to add the CORS headers.',
  ];
  if (detail !== '') parts.push(`The browser reported: ${detail}.`);
  return parts.join(' ');
}

async function describeHttpFailure(response: Response): Promise<string> {
  let detail = '';
  try {
    detail = summariseBody(await response.text());
  } catch {
    // A body that will not read tells us nothing the status has not already.
  }
  const tail = detail === '' ? '' : ` The endpoint said: ${detail}`;
  const status = response.status;

  if (status === 401 || status === 403) {
    return `${statusLine(response)}: the endpoint rejected the API key. Check that it is current, not revoked, and issued by this provider -- an OpenAI key will not authenticate against OpenRouter or Groq.${tail}`;
  }
  if (status === 404) {
    return `${statusLine(response)}: nothing is serving chat completions at this address. The base URL should stop at the API root, with no trailing /chat/completions -- for example https://api.openai.com/v1.${tail}`;
  }
  if (status === 429) {
    return `${statusLine(response)}: rate limited or out of quota. Wait a moment and retry, or use a key with more headroom.${tail}`;
  }
  if (status === 400 || status === 422) {
    return `${statusLine(response)}: the request was rejected as invalid. The usual cause is a model that does not accept logprobs or top_logprobs; try a different model.${tail}`;
  }
  if (status >= 500) {
    return `${statusLine(response)}: the provider failed on its own side. This is usually transient -- retry shortly.${tail}`;
  }
  return `${statusLine(response)}: the request was refused.${tail}`;
}

function describeMissingLogprobs(progress: Progress): string {
  if (!progress.sawJson) {
    return progress.malformed > 0
      ? `The endpoint streamed ${progress.malformed} event(s) and not one of them was valid JSON. That usually means a proxy is rewriting the response, or the address is serving something that is not an OpenAI-compatible API.`
      : 'The endpoint accepted the request but closed the stream without sending any data. Check the model name, and that this deployment supports streaming.';
  }
  if (progress.sawContent) {
    return 'The endpoint streamed text but no logprobs. Glass-Box shows the distribution behind every token, so it needs a model and provider that honour logprobs: true together with top_logprobs -- several gateways silently drop both. Try another model or provider, or use replay mode.';
  }
  return 'The endpoint returned a completion with neither tokens nor logprobs. Glass-Box requires logprobs for every token; check that this model supports them.';
}

// ---------------------------------------------------------------- small helpers

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Origin only: a configured base URL may carry a token in its query string. */
function safeOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return 'the configured endpoint';
  }
}

function statusLine(response: Response): string {
  return response.statusText === ''
    ? `HTTP ${response.status}`
    : `HTTP ${response.status} ${response.statusText}`;
}

function summariseBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed === '') return '';
  if (trimmed.startsWith('<')) {
    return 'an HTML page rather than a JSON error, which usually means a proxy or captive portal answered instead of the API';
  }
  try {
    const root = asRecord(JSON.parse(trimmed));
    if (root !== null) {
      const nested = asRecord(root['error']);
      const message =
        (nested === null ? null : asString(nested['message'])) ??
        asString(root['message']) ??
        asString(root['error']);
      if (message !== null && message.trim() !== '') return clip(message);
    }
  } catch {
    // Not JSON. The raw text is still the best hint available.
  }
  return clip(trimmed);
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return clip(cause.message);
  if (typeof cause === 'string') return clip(cause);
  return '';
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? (value as unknown[]) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
