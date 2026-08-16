/**
 * A Server-Sent Events parser: string chunks in, complete data payloads out.
 *
 * This file is deliberately pure and synchronous -- no fetch, no DOM, no
 * timers -- because it is the one part of live mode that can be tested
 * exhaustively without a network. Everything that can go wrong with a live
 * stream that is *our* fault goes wrong here, so it is separated from the
 * transport that cannot be tested offline at all.
 *
 * The parser follows the WHATWG event-stream tokenizer rather than a
 * split-on-"\n\n" shortcut. A naive splitter looks fine against a single
 * well-formed capture and then loses events the moment a server uses CRLF,
 * sends a heartbeat comment, or -- most commonly -- flushes a chunk that ends
 * mid-line.
 */

/**
 * One dispatched event.
 *
 * `done` is reported separately rather than as data `"[DONE]"` so callers never
 * hand the sentinel to JSON.parse and mistake the resulting failure for a
 * corrupt stream.
 */
export type SseEvent =
  | { readonly kind: 'data'; readonly data: string }
  | { readonly kind: 'done' };

/** The sentinel OpenAI-compatible endpoints send to close a completion stream. */
export const SSE_DONE_PAYLOAD = '[DONE]';

export class SseParser {
  /** Text received but not yet terminated by a line break. */
  private buffer = '';

  /** `data:` values of the event currently being assembled. */
  private readonly dataLines: string[] = [];

  /**
   * A CR ended the previous chunk. CR is a line terminator on its own, so the
   * line was already dispatched; if the next chunk opens with the LF of a split
   * CRLF pair, that LF must be swallowed rather than read as a blank line.
   */
  private pendingLf = false;

  /**
   * Consumes one chunk and returns every event it completed -- often none, and
   * occasionally several.
   *
   * Chunk boundaries are arbitrary: a payload can be split mid-JSON, mid-line,
   * between the CR and LF of one separator, or between the two halves of a
   * surrogate pair. All of those work out because a chunk is only ever appended
   * to the buffer, and nothing is consumed until its terminator has actually
   * been seen.
   */
  push(chunk: string): SseEvent[] {
    const events: SseEvent[] = [];
    if (chunk.length === 0) return events;

    this.buffer += chunk;

    let cursor = 0;
    if (this.pendingLf) {
      this.pendingLf = false;
      // The buffer is always empty when this flag is set, so index 0 is the
      // first character of the chunk that just arrived.
      if (this.buffer.charAt(0) === '\n') cursor = 1;
    }

    let lineStart = cursor;
    while (cursor < this.buffer.length) {
      // charAt rather than indexing: it is typed `string`, so the scan does not
      // have to talk itself out of an `undefined` that cannot occur here.
      const ch = this.buffer.charAt(cursor);
      if (ch === '\n') {
        this.takeLine(this.buffer.slice(lineStart, cursor), events);
        cursor += 1;
        lineStart = cursor;
      } else if (ch === '\r') {
        this.takeLine(this.buffer.slice(lineStart, cursor), events);
        if (cursor + 1 < this.buffer.length) {
          cursor += this.buffer.charAt(cursor + 1) === '\n' ? 2 : 1;
        } else {
          // Last character we hold. Dispatching now is correct -- CR terminates
          // a line by itself -- but a following LF would belong to this same
          // separator, so remember to ignore one if it opens the next chunk.
          cursor += 1;
          this.pendingLf = true;
        }
        lineStart = cursor;
      } else {
        cursor += 1;
      }
    }

    // Anything after the last terminator is an incomplete line. It stays
    // buffered and is never reported, so a stream that dies mid-event emits
    // nothing for that event rather than half of one.
    this.buffer = lineStart === 0 ? this.buffer : this.buffer.slice(lineStart);
    return events;
  }

  /** True while an unterminated line or an undispatched event is held back. */
  get pending(): boolean {
    return this.buffer.length > 0 || this.dataLines.length > 0;
  }

  /** Drops all buffered state so one instance can serve a second stream. */
  reset(): void {
    this.buffer = '';
    this.dataLines.length = 0;
    this.pendingLf = false;
  }

  private takeLine(line: string, out: SseEvent[]): void {
    if (line === '') {
      this.dispatch(out);
      return;
    }
    // A line starting with ':' is a comment. Servers send these as keep-alives
    // through idle proxies, so they arrive on real streams, not just in specs.
    if (line.charAt(0) === ':') return;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    // `event:`, `id:`, `retry:` and anything unknown carry nothing this app
    // needs; a chat completion stream is entirely in the data field.
    if (field !== 'data') return;

    let value = colon === -1 ? '' : line.slice(colon + 1);
    // Exactly one space after the colon is separator, not payload: "data:  x"
    // really does carry a leading space.
    if (value.charAt(0) === ' ') value = value.slice(1);
    this.dataLines.push(value);
  }

  private dispatch(out: SseEvent[]): void {
    // A blank line with no data field dispatches nothing. That is what keeps
    // heartbeat comments and id-only events from surfacing as empty payloads.
    if (this.dataLines.length === 0) return;

    const data = this.dataLines.join('\n');
    this.dataLines.length = 0;
    out.push(data.trim() === SSE_DONE_PAYLOAD ? { kind: 'done' } : { kind: 'data', data });
  }
}
