/**
 * Information-theoretic readouts, in bits.
 *
 * Bits rather than nats because the whole point is to be legible on screen: one
 * bit is one coin flip's worth of uncertainty, and log2(k) is the entropy of a
 * flat choice among k tokens, so the number on the panel can be read against the
 * number of bars.
 *
 * Conventions (0 * log2(0) = 0, surprisal = -log2 p) are pinned by
 * tools/gen-reference-values.py. `entropyBits` runs every frame and allocates
 * nothing; the `?? 0` on the index read is the noUncheckedIndexedAccess tax, not
 * a real branch.
 */

/**
 * Shannon entropy of `probs[0..n)` in bits: H = -sum p * log2(p).
 *
 * Entries of exactly 0 -- everything outside the nucleus -- contribute nothing,
 * following the standard 0 * log2(0) = 0 convention. Taken literally the product
 * is 0 * -Infinity = NaN, so the zero terms are skipped rather than computed.
 */
export function entropyBits(probs: Float64Array, n: number): number {
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const p = probs[i] ?? 0;
    if (p > 0) {
      total -= p * Math.log2(p);
    }
  }

  // Entropy is non-negative for any distribution, but two things can land the
  // sum a hair on the wrong side of zero: a p of exactly 1 gives the term -0,
  // and inputs that renormalise to a shade over 1 give a term of around -1e-16.
  // Both would render as "-0.00 bits" and both would defeat an Object.is check
  // against 0, so they collapse to +0. Anything more negative -- or NaN -- is
  // returned untouched, because that is a real error and hiding it helps nobody.
  if (total <= 0 && total > -1e-12) {
    return 0;
  }
  return total;
}

/**
 * Surprisal of a single outcome, in bits: -log2(p).
 *
 * How many bits the choice of this token carried. A coin flip is 1 bit; a token
 * the model was certain of is 0.
 */
export function surprisalBits(p: number): number {
  // -Math.log2(1) is -0, which prints as "-0.00 bits" and fails an Object.is
  // comparison against 0. A certain token carries exactly zero bits.
  const bits = -Math.log2(p);
  return bits === 0 ? 0 : bits;
}
