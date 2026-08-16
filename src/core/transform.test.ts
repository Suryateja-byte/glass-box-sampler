import { describe, expect, it } from 'vitest';
import { applyNucleus, softmaxTemperature } from './transform';
import {
  P5_SELF_CONSISTENCY,
  SOFTMAX_CASES,
  TOP_P_CASES,
} from './reference-values.generated';

/**
 * The sampling-math gate. Every expectation here comes from
 * reference-values.generated.ts, computed by Python's decimal module at 40
 * digits -- never from this implementation. See tools/gen-reference-values.py.
 *
 * The gate tolerance is 1e-6. Observed agreement is ~1e-16, so a failure here
 * means a real algorithmic error, not float noise.
 */

const TOLERANCE = 1e-6;

function f64(values: readonly number[]): Float64Array {
  return Float64Array.from(values);
}

function toArray(buf: Float64Array, n: number): number[] {
  return Array.from(buf.subarray(0, n));
}

describe('softmaxTemperature', () => {
  for (const testCase of SOFTMAX_CASES) {
    it(`${testCase.name}: ${testCase.note}`, () => {
      const logits = f64(testCase.logits);
      const out = new Float64Array(logits.length);
      softmaxTemperature(logits, logits.length, testCase.temperature, out);

      expect(out.length).toBe(testCase.expected.length);
      for (let i = 0; i < testCase.expected.length; i += 1) {
        // The gate is stated as 1e-6, so it is asserted as 1e-6 rather than as
        // a decimal-places count that happens to be near it.
        expect(Math.abs(out[i]! - testCase.expected[i]!)).toBeLessThan(TOLERANCE);
      }
    });
  }

  it('never mutates its input', () => {
    const logits = f64([2, 1, 0]);
    const copy = Float64Array.from(logits);
    softmaxTemperature(logits, 3, 0.7, new Float64Array(3));
    expect(Array.from(logits)).toEqual(Array.from(copy));
  });

  it('sums to 1 across the whole temperature range', () => {
    const logits = f64([3.2, 1.1, 0.4, -0.9, -2.5]);
    const out = new Float64Array(5);
    for (let t = 0.01; t <= 2.0001; t += 0.01) {
      softmaxTemperature(logits, 5, t, out);
      const total = out.reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it('produces no NaN or Infinity at extreme logits', () => {
    const logits = f64([800, 799, 798, -800]);
    const out = new Float64Array(4);
    for (const t of [0.01, 0.5, 1, 2]) {
      softmaxTemperature(logits, 4, t, out);
      for (const value of out) {
        expect(Number.isFinite(value)).toBe(true);
        expect(Number.isNaN(value)).toBe(false);
      }
    }
  });

  it('sharpens as temperature falls and flattens as it rises', () => {
    const logits = f64([2, 1, 0]);
    const cold = new Float64Array(3);
    const warm = new Float64Array(3);
    const hot = new Float64Array(3);
    softmaxTemperature(logits, 3, 0.5, cold);
    softmaxTemperature(logits, 3, 1.0, warm);
    softmaxTemperature(logits, 3, 2.0, hot);
    expect(cold[0]!).toBeGreaterThan(warm[0]!);
    expect(warm[0]!).toBeGreaterThan(hot[0]!);
  });

  it('is shift invariant: adding a constant to every logit changes nothing', () => {
    const base = new Float64Array(3);
    const shifted = new Float64Array(3);
    softmaxTemperature(f64([2, 1, 0]), 3, 1, base);
    softmaxTemperature(f64([102, 101, 100]), 3, 1, shifted);
    for (let i = 0; i < 3; i += 1) {
      expect(shifted[i]!).toBeCloseTo(base[i]!, 12);
    }
  });

  it('respects the n argument and leaves the tail of out untouched', () => {
    const logits = f64([2, 1, 0, 99, 99]);
    const out = new Float64Array(5).fill(-1);
    softmaxTemperature(logits, 3, 1, out);
    expect(out[0]! + out[1]! + out[2]!).toBeCloseTo(1, 12);
    expect(out[3]).toBe(-1);
    expect(out[4]).toBe(-1);
  });
});

describe('applyNucleus (top-p truncation and renormalisation)', () => {
  for (const testCase of TOP_P_CASES) {
    it(`${testCase.name}: ${testCase.note}`, () => {
      const probs = f64(testCase.probs);
      const out = new Float64Array(probs.length);
      const kept = applyNucleus(probs, probs.length, testCase.topP, out);

      expect(kept).toBe(testCase.expectedKept);
      for (let i = 0; i < testCase.expected.length; i += 1) {
        expect(Math.abs(out[i]! - testCase.expected[i]!)).toBeLessThan(TOLERANCE);
      }
      // Everything outside the nucleus must be exactly zero, not merely small:
      // the bars read this array directly to decide what is excluded.
      for (let i = kept; i < probs.length; i += 1) {
        expect(out[i]).toBe(0);
      }
    });
  }

  it('never mutates its input', () => {
    const probs = f64([0.5, 0.3, 0.15, 0.05]);
    const copy = Float64Array.from(probs);
    applyNucleus(probs, 4, 0.8, new Float64Array(4));
    expect(Array.from(probs)).toEqual(Array.from(copy));
  });

  it('always keeps at least one candidate, for any p', () => {
    const probs = f64([0.6, 0.3, 0.1]);
    const out = new Float64Array(3);
    for (const p of [0, 1e-12, 0.001, 0.5, 0.9999, 1]) {
      expect(applyNucleus(probs, 3, p, out)).toBeGreaterThanOrEqual(1);
    }
  });

  it('renormalises to 1 whatever the cut', () => {
    const probs = f64([0.4, 0.25, 0.2, 0.1, 0.05]);
    const out = new Float64Array(5);
    for (let p = 0.05; p <= 1.0001; p += 0.05) {
      const kept = applyNucleus(probs, 5, p, out);
      const total = toArray(out, kept).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it('keeps more candidates as p rises, never fewer', () => {
    const probs = f64([0.4, 0.25, 0.2, 0.1, 0.05]);
    const out = new Float64Array(5);
    let previous = 0;
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const kept = applyNucleus(probs, 5, p, out);
      expect(kept).toBeGreaterThanOrEqual(previous);
      previous = kept;
    }
  });

  it('includes the token that crosses the threshold, not just those below it', () => {
    // cum = 0.5, 0.9 exactly. The nucleus is the smallest prefix reaching p,
    // so the second token is in. An implementation using `>` keeps three.
    const out = new Float64Array(3);
    expect(applyNucleus(f64([0.5, 0.4, 0.1]), 3, 0.9, out)).toBe(2);
  });
});

describe('the softmax/nucleus pipeline', () => {
  it('P5: truncating then renormalising equals softmax over the survivors', () => {
    // Dropping a candidate and renormalising IS softmax over the remaining
    // logits. This ties both functions together: an error in either breaks it.
    const logits = f64(P5_SELF_CONSISTENCY.logits);
    const probs = new Float64Array(4);
    const nucleus = new Float64Array(4);

    softmaxTemperature(logits, 4, 1, probs);
    const kept = applyNucleus(probs, 4, P5_SELF_CONSISTENCY.topP, nucleus);

    expect(kept).toBe(P5_SELF_CONSISTENCY.expectedKept);
    for (let i = 0; i < kept; i += 1) {
      expect(nucleus[i]).toBeCloseTo(P5_SELF_CONSISTENCY.expected[i]!, 6);
    }

    // ...and the survivors match a direct softmax over just those logits.
    const direct = new Float64Array(3);
    softmaxTemperature(f64([2, 1, 0]), 3, 1, direct);
    for (let i = 0; i < 3; i += 1) {
      expect(nucleus[i]).toBeCloseTo(direct[i]!, 12);
    }
  });

  it('accepts log-probabilities as readily as logits', () => {
    // API log-probs are logits minus a constant (log-sum-exp), and softmax is
    // shift invariant, so temperature-scaling log-probs is legitimate. This is
    // the assumption the whole app rests on.
    const logits = [2, 1, 0, -1];
    const z = Math.log(logits.reduce((a, b) => a + Math.exp(b), 0));
    const fromLogits = new Float64Array(4);
    const fromLogprobs = new Float64Array(4);
    softmaxTemperature(f64(logits), 4, 0.8, fromLogits);
    softmaxTemperature(f64(logits.map((l) => l - z)), 4, 0.8, fromLogprobs);
    for (let i = 0; i < 4; i += 1) {
      expect(fromLogprobs[i]!).toBeCloseTo(fromLogits[i]!, 12);
    }
  });
});
