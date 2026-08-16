/**
 * Inverse-CDF selection: turning one uniform draw into one token index.
 *
 * The accumulation order is fixed (index 0 upward) and the arithmetic is pure,
 * so the same probabilities and the same u always give the same index. That is
 * what lets a run be replayed from its seed rather than recorded.
 *
 * Allocates nothing; the `?? 0` on the index read is the noUncheckedIndexedAccess
 * tax, not a real branch.
 */

/**
 * Picks an index from `probs[0..n)` given a uniform draw `u` in [0, 1).
 *
 * Walks the cumulative distribution and returns the first candidate whose slice
 * contains `u`. The comparison is strict (`u < cumulative`), so a `u` landing
 * exactly on a boundary belongs to the candidate above it -- which is what makes
 * the slice widths add up to the probabilities they came from.
 */
export function sampleIndex(probs: Float64Array, n: number, u: number): number {
  let cumulative = 0;
  // Tracked so an out-of-range u cannot fall onto an excluded candidate.
  let lastNonZero = -1;

  for (let i = 0; i < n; i += 1) {
    const p = probs[i] ?? 0;
    // Candidates outside the nucleus are exactly 0 and own a slice of zero
    // width. Skipping them makes that explicit and keeps the fallback below
    // pointing at a candidate the sampler is actually allowed to choose --
    // putting an excluded token on screen would contradict the bars.
    if (p > 0) {
      lastNonZero = i;
      cumulative += p;
      if (u < cumulative) {
        return i;
      }
    }
  }

  // Reached when u sits at or past the top of the interval: u = 1 exactly, or a
  // CDF that float64 summation left a hair under 1. The last candidate with real
  // mass absorbs the remainder rather than the loop running off the end. The
  // final 0 is for a degenerate all-zero input, where no choice is defensible
  // and index 0 is at least in range.
  return lastNonZero >= 0 ? lastNonZero : 0;
}
