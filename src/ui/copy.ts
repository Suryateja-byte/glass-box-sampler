/**
 * Every user-visible string in the app.
 *
 * Nothing here imports anything: copy is a leaf, so it can be read by any layer
 * and diffed as prose rather than as code. The voice is technical-peer --
 * declarative, short sentences, no persuasion. The reader knows what a softmax
 * is; what they do not have is a view of the distribution, so the explanations
 * name the mechanism and then stop.
 *
 * Number formatting uses `toFixed`, not `Intl.NumberFormat`: it is
 * locale-independent, so the same run renders the same pixels on every machine,
 * which is what the determinism gate compares. The template functions below are
 * pure and allocate a single string each -- several run per frame.
 */

const percent = (p: number): string => (p < 0.001 ? '<0.1%' : `${(p * 100).toFixed(1)}%`);
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * Whitespace tokens have no spoken form, so name them. Defined here rather than
 * on COPY because several announcements below use it, and a property that
 * referenced COPY from inside COPY's own initialiser would defeat inference.
 */
const spokenToken = (text: string): string =>
  text === '\n'
    ? 'newline'
    : text === ' '
      ? 'space'
      : text.startsWith(' ')
        ? `space, ${text.slice(1)}`
        : text;

export const COPY = {
  app: {
    title: 'Glass-Box Sampler',
    subtitle:
      'The candidate distribution behind every token a language model writes, and what temperature and top-p do to it.',
  },

  /** Sits under the Completion heading, where selecting is the action. */
  completionHint:
    'Select any token to see the distribution it was drawn from, by clicking it or by focusing the completion and using the arrow keys. Then click a candidate to fork from that step.',

  sections: {
    prompt: 'Prompt',
    controls: 'Sampling',
    candidates: 'Candidates',
    completion: 'Completion',
    branches: 'Branches',
    source: 'Source',
    readout: 'This step',
  },

  // ------------------------------------------------------------------ controls

  temperature: {
    label: 'Temperature',
    explain:
      'Divides every logit by T before the softmax. Below 1 sharpens the distribution toward the leading candidate; above 1 flattens it toward uniform. At 0 the sampler stops sampling and always takes the argmax.',
    /** Shown next to the slider when it is at rest. */
    atOne: 'T = 1 is the distribution the model actually produced.',
  },

  topP: {
    label: 'Top-p',
    aka: 'nucleus sampling',
    explain:
      'Keeps the shortest list of candidates whose probabilities sum to p, drops the rest, and renormalises what is left. The list is never empty: the leading candidate always survives, even when it alone exceeds p.',
    cutoffLabel: 'top-p cutoff',
    cutoffExplain: 'Candidates below this line were discarded at this step and cannot be drawn.',
  },

  entropy: {
    label: 'Entropy',
    explain:
      'How spread out the distribution is, in bits, measured after temperature and top-p on the renormalised nucleus. Near 0 the next token is effectively decided. 3 bits is roughly the uncertainty of eight equally likely candidates.',
  },

  surprisal: {
    label: 'Surprisal',
    explain:
      'Negative log2 of the probability the sampler gave the token it drew. 1 bit is a coin flip the model called; 8 bits is a 1-in-256 shot. The high-surprisal tokens are where a rerun would most likely diverge.',
    legendLow: 'expected',
    legendHigh: 'surprising',
    /** The colour ramp is redundant with underline weight; say so where it is explained. */
    encoding: 'Tint and underline weight both encode surprisal. Neither carries it alone.',
  },

  candidates: {
    heading: 'Candidates',
    explain: (k: number): string =>
      `The ${k} highest-probability tokens at this step, after temperature and top-p. Bar length is probability. The accent bar is the token that was committed.`,
    /** The honest caveat about seeing only the head of the distribution. */
    headOnly:
      'These are the top candidates, not the vocabulary. The model chooses from tens of thousands of tokens at every step, and the endpoint returns only the head.',
    tailLabel: 'Top-10 coverage',
    /**
     * States what the ten candidates covered, rather than printing the residual
     * as though it were an eleventh bar.
     *
     * The bars renormalise over these ten, so they sum to 100% by construction.
     * An "everything else: 2.5%" line beside them made the panel add up to
     * 102.5% and contradicted the top-p explanation two panels away. The
     * coverage figure carries the same information and reconciles.
     */
    tailExplain: (mass: number): string =>
      `The ten candidates above held ${percent(1 - mass)} of the probability mass at T = 1; the remaining ${percent(mass)} was spread over the rest of the vocabulary, which the endpoint does not itemise. Bar lengths renormalise over these ten, so they sum to 100%.`,
    /** Shown when top-p has cut the list, where two normalisations are on screen. */
    nucleusExplain:
      'Faint bars are the distribution before the cut. Solid bars are what survives, renormalised to sum to 100% — the gap between the two is the renormalisation.',
    /**
     * States the cut as arithmetic the reader can check against the Σp column.
     *
     * Top-p is a rule about a running total, so the running total is on screen
     * and this sentence names the row where it crossed. A hairline between two
     * rows says only that a cut happened; this says why it happened there.
     */
    cutExplain: (
      topP: number,
      kept: number,
      reached: number,
      total: number,
    ): string =>
      `Σp first reaches top-p = ${topP.toFixed(2)} at rank ${kept} (${percent(reached)}), so ranks ${kept + 1}–${total} are dropped and the survivors are renormalised. Faint bars are the distribution before that cut; the gap to the solid bar is the mass redistributed to it.`,
    empty: 'Nothing sampled yet. Press Run, and the distribution behind each token appears here as it is drawn.',
  },

  fork: {
    label: 'Fork',
    explain:
      'Commit a different candidate at this step and carry on from there. The line you were on is kept, so the two continuations can be read side by side.',
    hint: 'Click any candidate to fork from it.',
  },

  branches: {
    label: 'Branches',
    explain:
      'Every line you have opened. A fork is named for the step it left its parent at and the candidate it took, so root/12.3 is: diverged at step 12, took candidate 3.',
    root: 'root',
    empty: 'One line so far. Fork a token to open another.',
  },

  // -------------------------------------------------------------------- state

  status: {
    idle: 'Idle',
    streaming: 'Streaming',
    paused: 'Paused',
    done: 'Done',
    error: 'Error',
  },

  idle: {
    title: 'Nothing sampled yet.',
    body: 'Run the sampler. Each token that gets committed joins the completion; select one to see the distribution it was drawn from and what the sliders would have done to it.',
  },

  streaming: {
    detail: (tokens: number): string =>
      `${tokens} ${plural(tokens, 'token', 'tokens')} committed`,
  },

  done: {
    detail: (tokens: number): string =>
      `${tokens} ${plural(tokens, 'token', 'tokens')}. Move a slider to resample from any step.`,
    /** Keyed by the source's stop reason. */
    reason: {
      eos: 'Stopped at the end-of-sequence token.',
      length: 'Stopped at the length limit.',
      aborted: 'Stopped before the model was finished.',
    },
  },

  /** Where a committed token came from. Reads as a suffix after the token. */
  origin: {
    sampled: 'drawn here from the reshaped distribution',
    observed: 'chosen by the model, recorded here',
    forced: 'forced by you',
  },

  // ------------------------------------------------------------------ buttons

  buttons: {
    run: 'Run',
    pause: 'Pause',
    resume: 'Resume',
    reset: 'Reset',
    fork: 'Fork',
    demo: 'Run demo',
    copy: 'Copy completion',
  },

  // ------------------------------------------------------------------- source

  source: {
    heading: 'Source',
    replay: {
      label: 'Replay',
      summary: 'Recorded distributions, sampled here in the browser.',
      explain:
        'Every candidate in the fixture carries a real continuation, so temperature, top-p and forks change which tokens come out — not just how the chart looks. The draw is seeded: same seed, same settings, same completion, every time.',
    },
    live: {
      label: 'Live',
      summary: 'A model endpoint streams tokens and their logprobs.',
      explain:
        'The endpoint does the sampling. This app records what the model chose and draws the candidates it reported alongside it.',
    },
    /**
     * The one claim it would be easy to fudge. Say it plainly instead: live mode
     * cannot honour a slider you move mid-completion, and replay can.
     */
    liveHonesty:
      'Slider values apply to the next request. A completion already streaming cannot be resampled retroactively — those tokens are the model’s, drawn under the settings the request was sent with, so the sliders reshape the chart here without changing the text. Replay is the exact mode: move a slider there and the completion is redrawn from the first token.',
    replayExactness: 'Replay runs offline from local fixtures. No request leaves the page.',
  },

  // ------------------------------------------------------------------- errors

  errors: {
    noLogprobs:
      'The endpoint returned text but no logprobs. This app needs the candidate probabilities at each step; a completion on its own has nothing to show. Enable logprobs and top_logprobs on the request, or switch to replay.',
    invalidKey:
      'The endpoint rejected the credentials (401). Check the key and the base URL, then send the request again.',
    blocked:
      'The browser blocked the request before it reached the endpoint. This is almost always CORS: the endpoint has to return an Access-Control-Allow-Origin header for this origin. A proxy you control fixes it; a browser flag does not.',
    rateLimited:
      'The endpoint is rate limiting (429). Wait and retry, or use replay, which runs entirely from local fixtures.',
    unknown: (detail: string): string => `The request failed: ${detail}`,
    dismiss: 'Dismiss',
    retry: 'Retry',
  },

  // --------------------------------------------------------------- formatting

  format: {
    entropyValue: (bits: number): string => `${bits.toFixed(2)} bits`,
    surprisalValue: (bits: number): string => `${bits.toFixed(2)} bits`,
    probability: (p: number): string => percent(p),
    temperatureValue: (t: number): string => t.toFixed(2),
    topPValue: (p: number): string => p.toFixed(2),
    /** "3 of 10 candidates kept" — the visible effect of top-p. */
    nucleusSize: (kept: number, total: number): string =>
      `${kept} of ${total} ${plural(total, 'candidate', 'candidates')} kept`,
    stepLabel: (step: number): string => `Step ${step}`,
    /** A leading space is real data; the glyph is not. */
    leadingSpace: '·',
    newline: '↵',
  },

  // ---------------------------------------------------------------- a11y
  //
  // Sliders get aria-valuetext because the raw number is not the point: a
  // screen-reader user should hear what 0.70 does, not just that it is 0.70.

  a11y: {
    temperatureLabel: 'Temperature',
    temperatureValueText: (t: number): string =>
      t <= 0.01
        ? '0, always takes the most likely token'
        : `${t.toFixed(2)}, ${
            t < 1 ? 'sharper than' : t > 1 ? 'flatter than' : 'the same as'
          } the distribution the model produced`,

    topPLabel: 'Top-p, nucleus sampling',
    topPValueText: (p: number): string =>
      p >= 0.999
        ? '1.00, keeps every candidate'
        : `${p.toFixed(2)}, keeps the leading candidates that sum to ${Math.round(p * 100)} percent`,

    /** One bar row, spoken. Rank first, because the list is sorted by it. */
    barRow: (rank: number, token: string, prob: number, inNucleus: boolean): string =>
      `Rank ${rank}, ${spokenToken(token)}, ${percent(prob)}${
        inNucleus ? '' : ', excluded by top-p'
      }`,

    /**
     * Announced on aria-live="polite" as each token commits. Deliberately terse:
     * at streaming cadence a long announcement queues faster than it is read.
     */
    committedToken: (token: string, prob: number, surprisalBits: number): string =>
      `${spokenToken(token)}, ${percent(prob)}, ${surprisalBits.toFixed(1)} bits`,

    spokenToken,

    candidatesRegion: 'Candidate distribution for the selected step',
    completionRegion: 'Generated completion',
    branchesRegion: 'Branch trail',
    forkButton: (token: string): string => `Fork here, taking ${spokenToken(token)}`,
    selectStep: (step: number, token: string): string =>
      `Step ${step}, ${spokenToken(token)}. Show this distribution.`,
  },
} as const;
