import { describe, expect, it } from 'vitest';
import { entropyBits, surprisalBits } from './entropy';
import { ENTROPY_CASES, SURPRISAL_CASES } from './reference-values.generated';

/** The gate as stated: within 1e-6 of the independently derived reference. */
const TOLERANCE = 1e-6;

function f64(values: readonly number[]): Float64Array {
  return Float64Array.from(values);
}

describe('entropyBits', () => {
  for (const testCase of ENTROPY_CASES) {
    it(`${testCase.name}: ${testCase.note}`, () => {
      const probs = f64(testCase.input);
      expect(Math.abs(entropyBits(probs, probs.length) - testCase.expected)).toBeLessThan(
        TOLERANCE,
      );
    });
  }

  it('returns exactly log2(n) for a uniform distribution', () => {
    for (const n of [2, 4, 8, 10, 16]) {
      const probs = new Float64Array(n).fill(1 / n);
      expect(entropyBits(probs, n)).toBeCloseTo(Math.log2(n), 12);
    }
  });

  it('is maximal for the uniform distribution over the same support', () => {
    const uniform = entropyBits(new Float64Array(4).fill(0.25), 4);
    for (const skewed of [
      [0.4, 0.3, 0.2, 0.1],
      [0.7, 0.1, 0.1, 0.1],
      [0.97, 0.01, 0.01, 0.01],
    ]) {
      expect(entropyBits(f64(skewed), 4)).toBeLessThan(uniform);
    }
  });

  it('is never negative, even for a certain outcome', () => {
    // -0 would slip past a `>= 0` check while printing as "-0.00 bits".
    const h = entropyBits(f64([1, 0, 0]), 3);
    expect(Math.abs(h)).toBeLessThan(1e-12);
    expect(Object.is(h, -0)).toBe(false);
  });

  it('handles zero-probability entries without producing NaN', () => {
    const h = entropyBits(f64([0.5, 0.5, 0, 0, 0]), 5);
    expect(Number.isNaN(h)).toBe(false);
    expect(h).toBeCloseTo(1, 12);
  });

  it('respects the n argument', () => {
    // Only the first 4 entries participate; the rest are outside the nucleus.
    expect(entropyBits(f64([0.25, 0.25, 0.25, 0.25, 99, 99]), 4)).toBeCloseTo(2, 12);
  });
});

describe('surprisalBits', () => {
  for (const testCase of SURPRISAL_CASES) {
    it(`${testCase.name}: ${testCase.note}`, () => {
      expect(Math.abs(surprisalBits(testCase.input[0]!) - testCase.expected)).toBeLessThan(
        TOLERANCE,
      );
    });
  }

  it('falls as probability rises', () => {
    let previous = Infinity;
    for (const p of [0.01, 0.1, 0.25, 0.5, 0.9, 1]) {
      const s = surprisalBits(p);
      expect(s).toBeLessThan(previous);
      previous = s;
    }
  });

  it('is exactly 0 bits for a certain token', () => {
    expect(surprisalBits(1)).toBe(0);
  });

  it('agrees with entropy on a fair coin', () => {
    // H = sum p * surprisal(p); for [0.5, 0.5] both sides are 1 bit.
    expect(0.5 * surprisalBits(0.5) + 0.5 * surprisalBits(0.5)).toBeCloseTo(
      entropyBits(f64([0.5, 0.5]), 2),
      12,
    );
  });
});
