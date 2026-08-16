import { describe, expect, it } from 'vitest';
import { rand01 } from './rng';
import { sampleIndex } from './sample';

function f64(values: readonly number[]): Float64Array {
  return Float64Array.from(values);
}

describe('sampleIndex (inverse-CDF selection)', () => {
  const probs = f64([0.5, 0.3, 0.2]);

  it('maps u to the candidate owning that slice of the CDF', () => {
    expect(sampleIndex(probs, 3, 0)).toBe(0);
    expect(sampleIndex(probs, 3, 0.49)).toBe(0);
    expect(sampleIndex(probs, 3, 0.5)).toBe(1);
    expect(sampleIndex(probs, 3, 0.79)).toBe(1);
    expect(sampleIndex(probs, 3, 0.8)).toBe(2);
    expect(sampleIndex(probs, 3, 0.999999)).toBe(2);
  });

  it('never selects a zero-probability candidate', () => {
    // Candidates outside the nucleus have probability exactly 0. Picking one
    // would put a token on screen that the sampler had supposedly excluded.
    const withZeros = f64([0.6, 0, 0.4, 0, 0]);
    for (let u = 0; u < 1; u += 0.0001) {
      const picked = sampleIndex(withZeros, 5, u);
      expect(withZeros[picked]).toBeGreaterThan(0);
    }
  });

  it('stays in range for u at and beyond the top of the interval', () => {
    // Float64 summation can leave the CDF a hair under 1; the last candidate
    // absorbs the remainder rather than running off the end of the array.
    for (const u of [0.9999999999, 1, 1.0000001]) {
      const picked = sampleIndex(probs, 3, u);
      expect(picked).toBeGreaterThanOrEqual(0);
      expect(picked).toBeLessThan(3);
    }
  });

  it('always returns the only candidate of a one-hot distribution', () => {
    const oneHot = f64([1, 0, 0]);
    for (let u = 0; u < 1; u += 0.01) {
      expect(sampleIndex(oneHot, 3, u)).toBe(0);
    }
  });

  it('reproduces the distribution it was given', () => {
    // 100k evenly spaced draws must land in each bucket in proportion to its
    // probability; this catches an off-by-one in the cumulative comparison.
    const counts = [0, 0, 0];
    const draws = 100_000;
    for (let i = 0; i < draws; i += 1) {
      counts[sampleIndex(probs, 3, (i + 0.5) / draws)] += 1;
    }
    expect(counts[0]! / draws).toBeCloseTo(0.5, 3);
    expect(counts[1]! / draws).toBeCloseTo(0.3, 3);
    expect(counts[2]! / draws).toBeCloseTo(0.2, 3);
  });

  it('respects the n argument', () => {
    const padded = f64([0.5, 0.5, 99, 99]);
    for (let u = 0; u < 1; u += 0.01) {
      expect(sampleIndex(padded, 2, u)).toBeLessThan(2);
    }
  });
});

describe('rand01 (keyed, position-independent RNG)', () => {
  it('is a pure function of its key', () => {
    expect(rand01(42, 'root', 7)).toBe(rand01(42, 'root', 7));
    expect(rand01(42, 'root', 7)).toBe(rand01(42, 'root', 7));
  });

  it('returns values in [0, 1)', () => {
    for (let step = 0; step < 5000; step += 1) {
      const u = rand01(42, 'root', step);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it('gives independent draws per step, per branch, and per seed', () => {
    // Position independence is what makes replay deterministic: a draw depends
    // only on where it sits in the tree, never on how many draws preceded it.
    // So exploring a fork cannot shift the numbers on any other path.
    expect(rand01(42, 'root', 7)).not.toBe(rand01(42, 'root', 8));
    expect(rand01(42, 'root', 7)).not.toBe(rand01(42, 'root/7.2', 7));
    expect(rand01(42, 'root', 7)).not.toBe(rand01(43, 'root', 7));
  });

  it('is roughly uniform over many draws', () => {
    const buckets = new Array(10).fill(0);
    const draws = 50_000;
    for (let i = 0; i < draws; i += 1) {
      buckets[Math.floor(rand01(1234, 'root', i) * 10)] += 1;
    }
    for (const count of buckets) {
      // Each bucket should hold ~10%; allow a generous band.
      expect(count / draws).toBeGreaterThan(0.085);
      expect(count / draws).toBeLessThan(0.115);
    }
  });

  it('decorrelates adjacent steps', () => {
    // A weak hash can make consecutive draws drift upward together, which would
    // bias every token in one direction.
    let sum = 0;
    const draws = 20_000;
    for (let i = 0; i < draws; i += 1) {
      sum += (rand01(7, 'root', i) - 0.5) * (rand01(7, 'root', i + 1) - 0.5);
    }
    expect(Math.abs(sum / draws)).toBeLessThan(0.005);
  });

  it('separates sibling branches that fork at the same step', () => {
    const a = rand01(42, 'root/12.1', 13);
    const b = rand01(42, 'root/12.2', 13);
    const c = rand01(42, 'root/12.3', 13);
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
