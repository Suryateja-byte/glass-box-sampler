/**
 * Temperature softmax and nucleus (top-p) truncation: the whole of the
 * reshaping the two sliders perform.
 *
 * Every convention here is pinned by tools/gen-reference-values.py and checked
 * against values that generator computed in 40-digit decimal -- max-subtraction,
 * the T < 0.01 argmax cutoff, and top-p including the token that crosses the
 * threshold. None of it may be "tidied" into disagreement with that generator.
 *
 * Both functions run every animation frame for every visible bar, so both write
 * into a caller-owned buffer and allocate nothing: no temporaries, no sort, no
 * closures. Reads are written `probs[i] ?? 0` rather than cast, because
 * noUncheckedIndexedAccess types an index read as `number | undefined`; the
 * fallback is reachable only if a caller passes an `n` past the end of the
 * array, and 0 is the neutral element of every sum below.
 */

/**
 * Temperatures below this collapse to argmax instead of being divided by.
 *
 * The mathematical limit as T -> 0 is exactly a one-hot on the highest logit,
 * but the formula divides by T, so it has to stop somewhere short of zero. At
 * T = 0.01 the softmax is already one-hot to well past float64 resolution for
 * any realistic logit gap, so the cutoff changes no visible answer -- it only
 * removes the division by zero and the Infinity/Infinity NaN behind it.
 */
const ARGMAX_TEMPERATURE = 0.01;

/**
 * Slack on the top-p comparison, in probability mass.
 *
 * The nucleus boundary is a floating-point equality in disguise: at p = 0.9 with
 * probabilities 0.5 and 0.4 the cumulative sum lands on 0.9 only if the additions
 * happen to round that way, and a distribution that came out of softmax carries
 * a few ulps of noise regardless. Without slack, a boundary case would keep two
 * candidates or three depending on summation order -- a visible flicker in the
 * bars from an invisible cause. 1e-9 is far larger than any accumulated rounding
 * over a handful of terms and far smaller than any p a slider can express.
 */
const BOUNDARY_EPSILON = 1e-9;

/**
 * Temperature softmax over `logits[0..n)`, written into `out[0..n)`.
 *
 * `out[n..]` is left untouched, and `logits` is never written. Passing the same
 * array as both `logits` and `out` is safe: the maximum is taken before any
 * write, and every later pass reads index i before writing it.
 */
export function softmaxTemperature(
  logits: Float64Array,
  n: number,
  temperature: number,
  out: Float64Array,
): void {
  if (n <= 0) {
    return;
  }

  if (temperature < ARGMAX_TEMPERATURE) {
    // Also the only path a zero or negative temperature can reach, so the
    // division below never sees one.
    let top = 0;
    let best = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const logit = logits[i] ?? 0;
      // Strictly greater, so a tie stays with the lowest index -- the same rule
      // the reference generator uses.
      if (logit > best) {
        best = logit;
        top = i;
      }
    }
    for (let i = 0; i < n; i += 1) {
      out[i] = i === top ? 1 : 0;
    }
    return;
  }

  // Max-subtraction. exp(800) is Infinity in float64 and the ratio of two
  // Infinities is NaN, so the largest scaled logit is pinned at exp(0) = 1 and
  // everything else falls below it. Softmax is shift-invariant, so this changes
  // nothing mathematically -- it only keeps the intermediate values in range.
  // Subtracting before dividing, rather than after, also keeps a large logit
  // over a small temperature from overflowing on the way in.
  let maxLogit = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const logit = logits[i] ?? 0;
    if (logit > maxLogit) {
      maxLogit = logit;
    }
  }

  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const weight = Math.exp(((logits[i] ?? 0) - maxLogit) / temperature);
    out[i] = weight;
    sum += weight;
  }

  // sum >= 1 always: the maximum element contributes exactly exp(0).
  for (let i = 0; i < n; i += 1) {
    out[i] = (out[i] ?? 0) / sum;
  }
}

/**
 * Nucleus (top-p) truncation of `probs[0..n)` into `out[0..n)`.
 *
 * `probs` must already be sorted by descending probability -- the candidate
 * lists in this app arrive that way from the source, and sorting here would
 * allocate. Keeps the smallest prefix whose cumulative mass reaches `topP`,
 * including the candidate that crosses the threshold, renormalises that prefix
 * to sum to 1, writes exactly 0 across the rest of `out[0..n)`, and returns how
 * many were kept.
 *
 * The zeros are load-bearing: the bars and the sampler both read this array to
 * decide what has been excluded, so an excluded candidate must be exactly 0
 * rather than merely small.
 */
export function applyNucleus(
  probs: Float64Array,
  n: number,
  topP: number,
  out: Float64Array,
): number {
  if (n <= 0) {
    return 0;
  }

  const threshold = topP - BOUNDARY_EPSILON;
  // If the loop never crosses the threshold -- p above the total mass, or p = 1
  // against a sum a hair under 1 -- the whole array is the nucleus. Starting
  // here also guarantees the "at least one candidate" rule at p = 0, where the
  // first iteration crosses immediately.
  let kept = n;
  let mass = 0;
  for (let i = 0; i < n; i += 1) {
    mass += probs[i] ?? 0;
    if (mass >= threshold) {
      kept = i + 1;
      break;
    }
  }

  if (!(mass > 0)) {
    // No mass to divide by (an all-zero or NaN input). Emit a one-hot on the
    // head rather than NaN, which would propagate into the bars and let the
    // sampler face a distribution with no valid candidate at all.
    out[0] = 1;
    for (let i = 1; i < n; i += 1) {
      out[i] = 0;
    }
    return 1;
  }

  for (let i = 0; i < kept; i += 1) {
    out[i] = (probs[i] ?? 0) / mass;
  }
  for (let i = kept; i < n; i += 1) {
    out[i] = 0;
  }
  return kept;
}
