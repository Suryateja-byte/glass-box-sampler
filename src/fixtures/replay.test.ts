/**
 * The gate on the replay fixtures.
 *
 * Two things are being checked here and they are different in kind. The first
 * is that the committed JSON is a well-formed lattice: every edge resolves,
 * every walk terminates, every distribution is a distribution. The second is
 * that the committed JSON is *the* output of the generator -- regenerating from
 * the same specs and the same seed must reproduce the bytes on disk. A fixture
 * that passes the first set but fails the second is a file somebody edited by
 * hand, which is precisely the failure mode that makes a replay demo drift away
 * from what its spec says it is.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { K } from '../engine/types';
import type { FixtureFile, FixtureNode } from '../engine/types';
import { SPECS, buildFixture, serialize } from './build';
import type { FixtureSpec } from './spec/types';

/** Sum of exp(logprob) over the top k. Strictly below 1: the rest is the tail. */
const MASS_MIN = 0.85;
const MASS_MAX = 0.999;

/** No walk through any of these fixtures should come close to this. */
const WALK_LIMIT = 400;

function loadJson(id: string): string {
  return readFileSync(new URL(`./${id}.json`, import.meta.url), 'utf8');
}

function entropyBits(node: FixtureNode): number {
  let total = 0;
  for (const [, logprob] of node.c) total += Math.exp(logprob);
  let h = 0;
  for (const [, logprob] of node.c) {
    const p = Math.exp(logprob) / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

interface Loaded {
  readonly spec: FixtureSpec;
  readonly text: string;
  readonly file: FixtureFile;
}

const FIXTURES: readonly Loaded[] = SPECS.map((spec) => {
  const text = loadJson(spec.id);
  return { spec, text, file: JSON.parse(text) as FixtureFile };
});

describe('fixtures exist and match their specs', () => {
  it('covers factual, creative and code', () => {
    expect(FIXTURES.map((f) => f.spec.id)).toEqual(['factual', 'creative', 'code']);
  });
});

describe.each(FIXTURES)('$spec.id fixture', ({ spec, text, file }) => {
  const nodes = Object.entries(file.nodes);
  const ids = new Set(Object.keys(file.nodes));

  it('declares the schema the app compiles against', () => {
    expect(file.version).toBe(1);
    expect(file.id).toBe(spec.id);
    expect(file.k).toBe(K);
    expect(file.prompt).toBe(spec.prompt);
    expect(file.label.length).toBeGreaterThan(0);
    expect(file.description.length).toBeGreaterThan(0);
    expect(ids.has(file.entry)).toBe(true);
  });

  it('gives every node either exactly k candidates or an eos flag', () => {
    for (const [id, node] of nodes) {
      if (node.eos === true) {
        expect(node.c, `${id} is eos and must carry no candidates`).toHaveLength(0);
      } else {
        expect(node.c, `${id} must offer exactly ${K} candidates`).toHaveLength(K);
      }
    }
    expect(nodes.some(([, node]) => node.eos === true)).toBe(true);
  });

  it('resolves every next id to a node that exists', () => {
    for (const [id, node] of nodes) {
      for (const [tokenText, , next] of node.c) {
        expect(ids.has(next), `${id} -> ${JSON.stringify(tokenText)} -> ${next}`).toBe(true);
      }
    }
  });

  it('sorts candidates by strictly descending logprob', () => {
    for (const [id, node] of nodes) {
      for (let i = 1; i < node.c.length; i += 1) {
        const previous = node.c[i - 1]?.[1] ?? 0;
        const current = node.c[i]?.[1] ?? 0;
        expect(current, `${id} candidate ${i}`).toBeLessThan(previous);
      }
    }
  });

  it('offers no duplicate candidate text within a node', () => {
    for (const [id, node] of nodes) {
      const seen = new Set(node.c.map(([tokenText]) => tokenText));
      expect(seen.size, `${id} repeats a candidate`).toBe(node.c.length);
    }
  });

  it(`leaves real tail mass: sum of exp(logprob) inside [${MASS_MIN}, ${MASS_MAX}]`, () => {
    for (const [id, node] of nodes) {
      if (node.eos === true) continue;
      let mass = 0;
      for (const [, logprob] of node.c) mass += Math.exp(logprob);
      expect(mass, `${id} top-${K} mass`).toBeGreaterThanOrEqual(MASS_MIN);
      expect(mass, `${id} top-${K} mass`).toBeLessThanOrEqual(MASS_MAX);
    }
  });

  it('keeps every step inside the entropy band the spec declares', () => {
    const [lo, hi] = spec.band;
    for (const [id, node] of nodes) {
      if (node.eos === true) continue;
      const h = entropyBits(node);
      expect(h, `${id} entropy`).toBeGreaterThanOrEqual(lo);
      expect(h, `${id} entropy`).toBeLessThanOrEqual(hi);
    }
  });

  it('reproduces the intended spine text exactly when the tokens are joined', () => {
    // Walk the spine the way the app does: follow the candidate whose text is
    // the spec's token for that step, and collect what the walk emits.
    let id = file.entry;
    const emitted: string[] = [];
    for (const step of spec.steps) {
      const node = file.nodes[id];
      expect(node, `spine walk fell off at ${id}`).toBeDefined();
      const candidate = node?.c.find(([tokenText]) => tokenText === step.text);
      expect(candidate, `${id} does not offer ${JSON.stringify(step.text)}`).toBeDefined();
      if (candidate === undefined) return;
      emitted.push(candidate[0]);
      id = candidate[2];
    }
    expect(emitted.join('')).toBe(spec.text);
    expect(file.nodes[id]?.eos).toBe(true);
  });

  it('places the spine token at the rank its spec asked for', () => {
    let id = file.entry;
    for (const step of spec.steps) {
      const node = file.nodes[id];
      if (node === undefined) break;
      const index = node.c.findIndex(([tokenText]) => tokenText === step.text);
      expect(index, `${id} rank of ${JSON.stringify(step.text)}`).toBe(step.rank);
      id = node.c[index]?.[2] ?? id;
    }
  });

  it('leaves no node unreachable from the entry', () => {
    const seen = new Set<string>([file.entry]);
    const queue = [file.entry];
    while (queue.length > 0) {
      const current = queue.pop();
      if (current === undefined) break;
      for (const [, , next] of file.nodes[current]?.c ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    const orphans = [...ids].filter((id) => !seen.has(id));
    expect(orphans).toEqual([]);
  });

  it('terminates at an eos node from every node, whichever candidate is taken', () => {
    // The strong version of "no dead ends": rather than sampling a few paths,
    // compute the longest walk from every node by memoised depth-first search.
    // A cycle would make that unbounded, so the same pass proves acyclicity.
    const longest = new Map<string, number>();
    const onStack = new Set<string>();

    const walk = (id: string): number => {
      const cached = longest.get(id);
      if (cached !== undefined) return cached;
      expect(onStack.has(id), `cycle through ${id}`).toBe(false);
      const node = file.nodes[id];
      expect(node, `missing node ${id}`).toBeDefined();
      if (node === undefined) return 0;
      if (node.eos === true) {
        longest.set(id, 0);
        return 0;
      }
      onStack.add(id);
      let worst = 0;
      for (const [, , next] of node.c) {
        worst = Math.max(worst, 1 + walk(next));
      }
      onStack.delete(id);
      longest.set(id, worst);
      return worst;
    };

    for (const id of ids) {
      const steps = walk(id);
      expect(steps, `walk from ${id}`).toBeLessThan(WALK_LIMIT);
    }
    // Every walk that terminates, terminates at the eos node: any node with no
    // candidates and no eos flag would have been caught by the shape test, and
    // the traversal above only stops at an eos node.
    expect(longest.get(file.entry)).toBeGreaterThan(spec.steps.length);
  });

  it('keeps its leading spaces: prose tokens are space-prefixed, not trimmed', () => {
    if (spec.classifier !== 'prose') return;
    const spineWords = spec.steps.filter((step) => /^[ ][A-Za-z]/.test(step.text));
    expect(spineWords.length).toBeGreaterThan(spec.steps.length / 2);
    // And at least one word arrives in pieces, which is what a BPE vocabulary
    // does and what a viewer who knows one will look for.
    expect(spec.steps.some((step) => /^[A-Za-z]/.test(step.text))).toBe(true);
  });

  it('regenerates byte-identically from the spec and seed', () => {
    const rebuilt = serialize(buildFixture(spec).file);
    expect(rebuilt).toBe(text);
  });

  it('is deterministic across independent builds', () => {
    const first = serialize(buildFixture(spec).file);
    const second = serialize(buildFixture(spec).file);
    expect(second).toBe(first);
  });

  it('round-trips through JSON without changing', () => {
    expect(serialize(JSON.parse(text) as FixtureFile)).toBe(text);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.includes('\r')).toBe(false);
  });
});

describe('code fixture tokenisation', () => {
  const code = FIXTURES.find((f) => f.spec.id === 'code');

  it('tokenises newlines and two-space indents separately', () => {
    expect(code).toBeDefined();
    if (code === undefined) return;
    const texts = code.spec.steps.map((step) => step.text);
    expect(texts.filter((t) => t === '\n').length).toBeGreaterThanOrEqual(4);
    expect(texts.filter((t) => t === '  ').length).toBeGreaterThanOrEqual(4);
    // Four-space indentation is two indent tokens, never one wide one.
    expect(texts).not.toContain('    ');
  });
});

describe('spine lengths the demo depends on', () => {
  it('gives the frame-rate gate more than 60 factual tokens to stream', () => {
    const factual = FIXTURES.find((f) => f.spec.id === 'factual');
    expect(factual?.spec.steps.length ?? 0).toBeGreaterThanOrEqual(60);
  });

  it('keeps the creative and code fixtures around 45 tokens', () => {
    for (const id of ['creative', 'code']) {
      const length = FIXTURES.find((f) => f.spec.id === id)?.spec.steps.length ?? 0;
      expect(length).toBeGreaterThanOrEqual(40);
      expect(length).toBeLessThanOrEqual(55);
    }
  });
});
