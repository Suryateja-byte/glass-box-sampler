/**
 * Replay-fixture generator.  Run it with:  npx tsx src/fixtures/build.ts
 *
 * These fixtures are synthesised, not recorded. There is no API key anywhere in
 * this repo and no network call in this file; what follows is a model of what
 * top-k logprobs look like, built to be honest about being one.
 *
 * Two ideas do all the work.
 *
 * 1. A lattice, not a transcript. The sliders genuinely change which token the
 *    sampler draws and the user can click any of the ten alternatives, so
 *    playback leaves a recorded line on the first step. Every candidate
 *    therefore carries a `next` edge. Authoring stays finite because off-spine
 *    candidates run through a short bridge -- two to five tokens of plausible
 *    alternative text -- and then rejoin the spine at the next clause boundary,
 *    or stop at the eos node.
 *
 * 2. Solved shapes, not sprinkled numbers. Each node is given a head
 *    probability drawn from a band that depends on what kind of token it is,
 *    and a target entropy that depends on where in the text it sits. A tail
 *    flatness parameter is then bisected until the realised entropy of the
 *    top-ten distribution matches that target. Nothing is eyeballed, so the
 *    distributions are mutually consistent rather than merely plausible one at
 *    a time.
 *
 * Determinism is a hard gate: every random draw comes from a seeded stream keyed
 * by node id, never Math.random and never a clock, so the same specs and seed
 * produce byte-identical JSON. `main` regenerates each file twice and refuses to
 * write if the two runs disagree.
 *
 * Console output is deliberate here and only here: this is a build tool, not
 * shipped code. Nothing under src/ that the app loads writes to the console.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { K } from '../engine/types';
import type { FixtureFile, FixtureNode } from '../engine/types';
import { CODE_SPEC } from './spec/code.spec';
import { CREATIVE_SPEC } from './spec/creative.spec';
import { FACTUAL_SPEC } from './spec/factual.spec';
import {
  DEFAULT_ENTROPY_OFFSETS,
  DEFAULT_HEAD_BANDS,
  type AltSpec,
  type FixtureSpec,
  type RegionSpec,
  type TokenCategory,
} from './spec/types';

// ----------------------------------------------------------------- constants

/** The eos node every line eventually reaches. Shared, so the graph stays small. */
const EOS_ID = 'end';

/**
 * The tail law: logprob_i = logprob_1 - a*ln(i) - b*i + jitter, for i >= 2.
 *
 * Two decay terms, doing different jobs: the log term is the heavy Zipf body,
 * the linear one makes the last few candidates fall away faster than a pure
 * power law would, which is what real top-k tails do. Flatness interpolates
 * between the steep pair and the shallow one.
 *
 * Both ends are deliberately moderate. The signature of a real top-k list is a
 * large gap between rank one and rank two followed by a *gentle* slide down the
 * remaining nine -- roughly 0.2 to 1.0 nats per rank. A steeper family can hit
 * any entropy you like by collapsing the tail onto rank two, but it produces
 * rank-ten logprobs around -12 sitting under a rank-two of -3, which is not a
 * shape any model emits. Restricting the family and solving the head instead is
 * what keeps the emitted numbers looking like a recording.
 */
const TAIL_LOG_STEEP = 1.6;
const TAIL_LOG_SHALLOW = 0.35;
const TAIL_LINEAR_STEEP = 0.35;
const TAIL_LINEAR_SHALLOW = 0.06;

/** The flatness a node prefers before its head band gets a say. */
const FLATNESS_MIN = 0.22;
const FLATNESS_MAX = 0.9;

/** Seeded wobble applied to every tail logprob, in nats. */
const TAIL_JITTER_NATS = 0.16;

/**
 * Minimum spacing between adjacent logprobs, in nats. Without it two jittered
 * neighbours can round to the same value at six decimal places and the "sorted
 * by descending logprob" invariant becomes a tie.
 */
const MIN_LOG_GAP_NATS = 0.0015;

/**
 * Top-k mass as a function of entropy. A near-forced token has almost nothing
 * outside its top ten; a flat one has a long tail the API never shows us. The
 * app displays the residual rather than pretending ten tokens are a vocabulary.
 */
const SUM_AT_ZERO_BITS = 0.9955;
const SUM_PER_BIT = 0.0345;
const SUM_JITTER = 0.016;
const SUM_MIN = 0.862;
const SUM_MAX = 0.9965;

/** How close the solved entropy must be to its target, in bits. */
const ENTROPY_TOLERANCE = 0.01;

/** Decimal places kept in the emitted logprobs. */
const LOGPROB_DECIMALS = 6;

// ---------------------------------------------------------------------- rng

/** FNV-1a over UTF-16 code units. Only used to seed streams, never for output. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, and exactly reproducible across engines. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A stream per node, keyed by node id rather than drawn from one global
 * sequence. Order of construction then cannot affect any node's numbers, so
 * adding a bridge in the middle of a spec does not reshuffle the whole file.
 */
function streamFor(seed: number, key: string): () => number {
  return mulberry32((fnv1a(key) ^ Math.imul(seed >>> 0, 0x9e3779b1)) >>> 0);
}

// ------------------------------------------------------------------- shapes

/** Shannon entropy in bits of a probability vector, renormalised if needed. */
function entropyBits(probs: readonly number[]): number {
  let total = 0;
  for (const p of probs) total += p;
  let h = 0;
  for (const p of probs) {
    const q = p / total;
    if (q > 0) h -= q * Math.log2(q);
  }
  return h;
}

/**
 * The candidate shape for one node, normalised to sum to 1 and sorted
 * descending.
 *
 * `head` fixes rank one. Ranks two upward follow the Zipf-ish law with the
 * seeded jitter baked in, so the entropy solve below sees the same numbers that
 * will be written to disk -- solving on a clean curve and jittering afterwards
 * would leave the realised entropy off target by more than the tolerance.
 */
function shape(head: number, flatness: number, jitter: readonly number[]): number[] {
  const a = TAIL_LOG_STEEP + (TAIL_LOG_SHALLOW - TAIL_LOG_STEEP) * flatness;
  const b = TAIL_LINEAR_STEEP + (TAIL_LINEAR_SHALLOW - TAIL_LINEAR_STEEP) * flatness;

  const weights: number[] = [];
  let weightSum = 0;
  for (let rank = 2; rank <= K; rank += 1) {
    const w = Math.exp(-a * Math.log(rank) - b * rank + (jitter[rank - 2] ?? 0));
    weights.push(w);
    weightSum += w;
  }

  const probs: number[] = [head];
  for (const w of weights) probs.push(((1 - head) * w) / weightSum);
  probs.sort((x, y) => y - x);

  // Keep every neighbour a hair apart so the descending order survives rounding.
  const cap = Math.exp(-MIN_LOG_GAP_NATS);
  for (let i = 1; i < probs.length; i += 1) {
    const ceiling = (probs[i - 1] ?? 0) * cap;
    if ((probs[i] ?? 0) > ceiling) probs[i] = ceiling;
  }

  let total = 0;
  for (const p of probs) total += p;
  return probs.map((p) => p / total);
}

/**
 * Bisects the head probability until the realised entropy hits `target`, with
 * the tail shape held fixed.
 *
 * Entropy falls monotonically as the head takes more of the mass, so the
 * bisection is exact and needs no derivative. Solving this way round -- shape
 * first, head second -- is the whole trick: the tail keeps a believable slope
 * and the head moves to whatever the entropy demands, rather than the tail
 * being crushed to compensate for a head that was fixed too early.
 *
 * Returns null when the target lies outside what this tail shape can reach.
 */
function solveHead(
  flatness: number,
  jitter: readonly number[],
  target: number,
): { readonly head: number; readonly probs: number[]; readonly entropy: number } | null {
  const lowest = 0.05;
  const highest = 0.995;
  if (entropyBits(shape(lowest, flatness, jitter)) < target) return null;
  if (entropyBits(shape(highest, flatness, jitter)) > target) return null;

  let lo = lowest;
  let hi = highest;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (entropyBits(shape(mid, flatness, jitter)) > target) lo = mid;
    else hi = mid;
  }
  const head = (lo + hi) / 2;
  const probs = shape(head, flatness, jitter);
  const entropy = entropyBits(probs);
  if (Math.abs(entropy - target) > ENTROPY_TOLERANCE) return null;
  return { head, probs, entropy };
}

// ------------------------------------------------------------------- solving

interface Solved {
  readonly probs: readonly number[];
  readonly logprobs: readonly number[];
  readonly entropy: number;
  readonly head: number;
  readonly sum: number;
  readonly category: TokenCategory;
  /** True when the spec asked for an entropy this category's head cannot reach. */
  readonly clamped: boolean;
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Picks a head probability and a tail shape for one node.
 *
 * The head band belongs to the token's category and is honoured absolutely: a
 * determiner never ends up looking like an open choice. The entropy target
 * bends instead, but only inside the fixture's declared band -- if it would have
 * to leave that band to fit the head, the spec is wrong and the build stops.
 */
function solveNode(
  spec: FixtureSpec,
  key: string,
  category: TokenCategory,
  regionTarget: number,
  override: number | null,
): Solved {
  const rng = streamFor(spec.seed, key);

  const jitter: number[] = [];
  for (let i = 0; i < K - 1; i += 1) jitter.push((rng() - 0.5) * 2 * TAIL_JITTER_NATS);

  const offset = spec.entropyOffsets[category] ?? DEFAULT_ENTROPY_OFFSETS[category];
  const wiggle = (rng() - 0.5) * 2 * spec.wiggle;
  const desired = override ?? regionTarget + offset + wiggle;

  const band = spec.headBands[category] ?? DEFAULT_HEAD_BANDS[category];
  const [bandLo, bandHi] = band;
  const preferred = FLATNESS_MIN + rng() * (FLATNESS_MAX - FLATNESS_MIN);

  // What this band can reach at all, given the jitter this node happens to
  // have. Entropy falls with the head and rises with flatness, so the corners
  // of the (head, flatness) rectangle searched below are the extremes.
  const reachLo = entropyBits(shape(bandHi, FLATNESS_GRID_LO, jitter));
  const reachHi = entropyBits(shape(bandLo, FLATNESS_GRID_HI, jitter));

  const [declaredLo, declaredHi] = spec.band;
  const floor = Math.max(reachLo, declaredLo) + 1e-4;
  const ceiling = Math.min(reachHi, declaredHi) - 1e-4;
  if (floor > ceiling) {
    throw new Error(
      `${spec.id}/${key}: a ${category} head in [${bandLo}, ${bandHi}] spans ` +
        `${reachLo.toFixed(3)}-${reachHi.toFixed(3)} bits, which never meets the ` +
        `declared band ${declaredLo}-${declaredHi}. Widen the band or recategorise.`,
    );
  }
  const target = clamp(desired, floor, ceiling);

  // Nearest workable tail shape to the one this node would have preferred.
  const flatnesses: number[] = [];
  for (let f = FLATNESS_GRID_LO; f <= FLATNESS_GRID_HI; f += 0.01) flatnesses.push(f);
  flatnesses.sort((x, y) => Math.abs(x - preferred) - Math.abs(y - preferred));

  for (const flatness of flatnesses) {
    const solved = solveHead(flatness, jitter, target);
    if (solved === null) continue;
    const realisedHead = solved.probs[0] ?? 0;
    if (realisedHead < bandLo - 1e-6 || realisedHead > bandHi + 1e-6) continue;

    const sum = clamp(
      SUM_AT_ZERO_BITS - SUM_PER_BIT * solved.entropy + (rng() - 0.5) * 2 * SUM_JITTER,
      SUM_MIN,
      SUM_MAX,
    );
    const logprobs = solved.probs.map((p) => round(Math.log(p * sum), LOGPROB_DECIMALS));
    return {
      probs: solved.probs,
      logprobs,
      entropy: solved.entropy,
      head: realisedHead,
      sum,
      category,
      clamped: Math.abs(target - desired) > 1e-4,
    };
  }

  throw new Error(
    `${spec.id}/${key}: no tail shape puts a ${category} head inside ` +
      `[${bandLo}, ${bandHi}] at ${target.toFixed(3)} bits.`,
  );
}

// --------------------------------------------------------------- classifying

/**
 * Function words for the prose fixtures. Bridge tokens are authored as plain
 * strings, so their category is inferred rather than declared; getting "the"
 * into the peaked band and "harbour" into the flat one is the whole point.
 */
const PROSE_FUNCTION_WORDS = new Set([
  'a', 'about', 'above', 'across', 'after', 'again', 'against', 'all', 'almost', 'along',
  'already', 'also', 'although', 'always', 'am', 'among', 'an', 'and', 'another', 'any',
  'are', 'around', 'as', 'at', 'back', 'be', 'because', 'been', 'before', 'behind',
  'being', 'below', 'beneath', 'beside', 'between', 'beyond', 'both', 'but', 'by', 'can',
  'could', 'did', 'do', 'does', 'down', 'during', 'each', 'either', 'enough', 'even',
  'ever', 'every', 'few', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'here',
  'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'inside', 'into', 'is', 'it', 'its',
  'just', 'least', 'less', 'like', 'many', 'may', 'me', 'might', 'more', 'most', 'much',
  'must', 'my', 'near', 'nearly', 'neither', 'never', 'no', 'none', 'nor', 'not', 'now',
  'of', 'off', 'on', 'once', 'one', 'only', 'onto', 'or', 'other', 'our', 'out', 'over',
  'own', 'past', 'per', 'quite', 'rather', 'same', 'several', 'shall', 'she', 'should',
  'since', 'so', 'some', 'still', 'such', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'those', 'though', 'three', 'through', 'to', 'too',
  'toward', 'towards', 'two', 'under', 'until', 'up', 'upon', 'us', 'very', 'was', 'we',
  'were', 'what', 'when', 'where', 'whether', 'which', 'while', 'who', 'whose', 'why',
  'will', 'with', 'within', 'without', 'would', 'yet', 'you', 'your', "'s", "'t", "'re",
]);

/** Python keywords and builtins: the tokens a code model is nearly sure about. */
const CODE_KEYWORDS = new Set([
  'and', 'as', 'assert', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
  'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
  'none', 'not', 'or', 'pass', 'raise', 'return', 'true', 'false', 'try', 'while',
  'with', 'yield', 'range', 'len', 'int', 'float', 'str', 'list', 'dict', 'enumerate',
  'print', 'sum', 'max', 'min', 'abs', 'self',
]);

function classify(text: string, kind: 'prose' | 'code'): TokenCategory {
  const bare = text.trim();
  if (kind === 'code') {
    if (bare === '') return 'syntax';
    if (!/[A-Za-z0-9_]/.test(bare)) return 'syntax';
    if (CODE_KEYWORDS.has(bare.replace(/[^A-Za-z_]/g, '').toLowerCase())) return 'syntax';
    return 'ident';
  }
  if (bare === '' || !/[A-Za-z0-9]/.test(bare)) return 'punct';
  // Prose word tokens carry their leading space. One that does not is a
  // word-piece glued to what came before, and its rivals are other pieces.
  if (/^[A-Za-z0-9]/.test(text)) return 'sub';
  const word = bare.replace(/[^A-Za-z']/g, '').toLowerCase();
  return PROSE_FUNCTION_WORDS.has(word) ? 'func' : 'content';
}

// -------------------------------------------------------------- construction

export interface CategoryStats {
  count: number;
  headLo: number;
  headHi: number;
  headSum: number;
  entropyLo: number;
  entropyHi: number;
  entropySum: number;
  /** rank1 - rank2, in nats: how far clear of the field the top choice is. */
  gapSum: number;
  /** rank2 - rank5, in nats: how tightly the near-synonyms cluster. */
  spreadSum: number;
  /** (rank2 - rank10) / 8, in nats: the slope of the tail. */
  slopeSum: number;
}

export interface BuildStats {
  readonly id: string;
  readonly spineTokens: number;
  readonly nodes: number;
  readonly bridgeNodes: number;
  readonly bridges: number;
  readonly candidates: number;
  entropyLo: number;
  entropyHi: number;
  entropySum: number;
  sumLo: number;
  sumHi: number;
  clusterSum: number;
  clusterWithin: number;
  clamped: number;
  readonly byCategory: Map<TokenCategory, CategoryStats>;
}

function noteCategory(stats: BuildStats, solved: Solved): void {
  const existing = stats.byCategory.get(solved.category);
  const entry: CategoryStats = existing ?? {
    count: 0,
    headLo: Infinity,
    headHi: -Infinity,
    headSum: 0,
    entropyLo: Infinity,
    entropyHi: -Infinity,
    entropySum: 0,
    gapSum: 0,
    spreadSum: 0,
    slopeSum: 0,
  };
  const lp = solved.logprobs;
  entry.count += 1;
  entry.headLo = Math.min(entry.headLo, solved.head);
  entry.headHi = Math.max(entry.headHi, solved.head);
  entry.headSum += solved.head;
  entry.entropyLo = Math.min(entry.entropyLo, solved.entropy);
  entry.entropyHi = Math.max(entry.entropyHi, solved.entropy);
  entry.entropySum += solved.entropy;
  entry.gapSum += (lp[0] ?? 0) - (lp[1] ?? 0);
  entry.spreadSum += (lp[1] ?? 0) - (lp[4] ?? 0);
  entry.slopeSum += ((lp[1] ?? 0) - (lp[K - 1] ?? 0)) / (K - 2);
  stats.byCategory.set(solved.category, entry);
}

/**
 * Builds one fixture from one spec. Pure: no clock, no filesystem, no global
 * state, so calling it twice with the same spec returns the same object graph.
 */
export function buildFixture(spec: FixtureSpec): { file: FixtureFile; stats: BuildStats } {
  const steps = spec.steps;
  const joined = steps.map((step) => step.text).join('');
  if (joined !== spec.text) {
    throw new Error(
      `${spec.id}: spine tokens do not reproduce the intended text.\n` +
        `  tokens: ${JSON.stringify(joined)}\n  intent: ${JSON.stringify(spec.text)}`,
    );
  }

  const stats: BuildStats = {
    id: spec.id,
    spineTokens: steps.length,
    nodes: 0,
    bridgeNodes: 0,
    bridges: 0,
    candidates: 0,
    entropyLo: Infinity,
    entropyHi: -Infinity,
    entropySum: 0,
    sumLo: Infinity,
    sumHi: -Infinity,
    clusterSum: 0,
    clusterWithin: 0,
    clamped: 0,
    byCategory: new Map(),
  };

  const nodes = new Map<string, FixtureNode>();
  const bridgeCache = new Map<string, string>();
  const placeholder: FixtureNode = { c: [] };

  const spineId = (index: number): string => (index >= steps.length ? EOS_ID : `s${index}`);

  const regionAt = (index: number): RegionSpec => {
    let found = spec.regions[0];
    for (const region of spec.regions) {
      if (region.from <= index) found = region;
    }
    if (found === undefined) throw new Error(`${spec.id}: no region covers step ${index}`);
    return found;
  };

  const nextClause = (index: number): string => {
    for (let j = index + 1; j < steps.length; j += 1) {
      if (steps[j]?.clause === true) return `s${j}`;
    }
    return EOS_ID;
  };

  const resolveRejoin = (alt: AltSpec, index: number): string => {
    if (alt.rejoin === 'end') return EOS_ID;
    if (alt.rejoin === 'clause') return nextClause(index);
    return spineId(index + alt.rejoin);
  };

  const poolFor = (region: RegionSpec, category: TokenCategory, where: string): readonly string[] => {
    const pool = region.pools[category];
    if (pool === undefined || pool.length < K) {
      throw new Error(
        `${spec.id}/${where}: region "${region.label}" needs a pool of at least ${K} ` +
          `${category} tokens (has ${pool?.length ?? 0}).`,
      );
    }
    return pool;
  };

  /**
   * Fills a candidate list out to K distinct texts, walking the region pool from
   * a per-node offset so that neighbouring nodes do not all show the same tail.
   */
  const drawFromPool = (
    pool: readonly string[],
    used: Set<string>,
    want: number,
    key: string,
  ): string[] => {
    const drawn: string[] = [];
    const start = fnv1a(key) % pool.length;
    for (let i = 0; i < pool.length && drawn.length < want; i += 1) {
      const text = pool[(start + i) % pool.length];
      if (text === undefined || used.has(text)) continue;
      used.add(text);
      drawn.push(text);
    }
    if (drawn.length < want) {
      throw new Error(`${spec.id}/${key}: pool exhausted, needed ${want} more distinct tokens.`);
    }
    return drawn;
  };

  /**
   * How tight the near-synonym cluster behind the head is: the rank-1 to rank-4
   * spread in nats, and how many candidates sit within 1.5 nats of the head.
   */
  const noteCluster = (solved: Solved): void => {
    const first = solved.logprobs[0] ?? 0;
    stats.clusterSum += first - (solved.logprobs[3] ?? 0);
    let within = 0;
    for (const logprob of solved.logprobs) {
      if (first - logprob <= 1.5) within += 1;
    }
    stats.clusterWithin += within;
    if (solved.clamped) stats.clamped += 1;
  };

  const finish = (id: string, solved: Solved, texts: readonly string[], nexts: readonly string[]): void => {
    const candidates: (readonly [string, number, string])[] = [];
    for (let i = 0; i < K; i += 1) {
      candidates.push([texts[i] ?? '', solved.logprobs[i] ?? 0, nexts[i] ?? EOS_ID]);
    }
    nodes.set(id, { c: candidates });
    stats.candidates += K;
    stats.entropyLo = Math.min(stats.entropyLo, solved.entropy);
    stats.entropyHi = Math.max(stats.entropyHi, solved.entropy);
    stats.entropySum += solved.entropy;
    stats.sumLo = Math.min(stats.sumLo, solved.sum);
    stats.sumHi = Math.max(stats.sumHi, solved.sum);
    noteCategory(stats, solved);
    noteCluster(solved);
  };

  /**
   * Lays down the chain of nodes for one bridge and returns its first node id.
   *
   * Inside a bridge every alternative is a drop-in: it changes one word and the
   * branch carries on to the same place. That is what stops the lattice from
   * fanning out forever, and it is also true to how a short paraphrase behaves
   * -- the choice that mattered was made at the spine.
   */
  const buildBridge = (
    tokens: readonly string[],
    exit: string,
    region: RegionSpec,
    idBase: string,
  ): string => {
    // Two branches that say the same words on the way to the same place are the
    // same branch. Sharing matters most for the one-token escape a topped-up
    // distractor takes, which every content step in a region would otherwise
    // duplicate; the fixture stays a lattice either way.
    const cacheKey = `${region.label} ${exit} ${tokens.join(' ')}`;
    const cached = bridgeCache.get(cacheKey);
    if (cached !== undefined) return cached;

    stats.bridges += 1;
    const ids = tokens.map((_, j) => `${idBase}_${j}`);
    bridgeCache.set(cacheKey, ids[0] ?? exit);
    for (let j = 0; j < tokens.length; j += 1) {
      const id = ids[j] ?? '';
      nodes.set(id, placeholder);
    }
    for (let j = 0; j < tokens.length; j += 1) {
      const id = ids[j] ?? '';
      const text = tokens[j] ?? '';
      const onward = j + 1 < tokens.length ? (ids[j + 1] ?? EOS_ID) : exit;
      const category = classify(text, spec.classifier);
      const solved = solveNode(spec, id, category, region.target, null);
      const used = new Set<string>([text]);
      const others = drawFromPool(poolFor(region, category, id), used, K - 1, id);
      const texts = [text, ...others];
      finish(id, solved, texts, texts.map(() => onward));
      stats.bridgeNodes += 1;
    }
    return ids[0] ?? exit;
  };

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step === undefined) continue;
    const id = `s${i}`;
    nodes.set(id, placeholder);

    const region = regionAt(i);
    const used = new Set<string>([step.text, ...step.alts.map((alt) => alt.text)]);
    if (used.size !== 1 + step.alts.length) {
      throw new Error(`${spec.id}/${id}: duplicate candidate text in the authored alternatives.`);
    }
    if (step.alts.length > K - 1) {
      throw new Error(`${spec.id}/${id}: ${step.alts.length} alternatives, at most ${K - 1} fit.`);
    }

    // Authored alternatives first, then pool fillers for whatever is left. A
    // filler that could derail the sentence takes the region's escape out of it.
    const alts: AltSpec[] = [...step.alts];
    const wanted = K - 1 - alts.length;
    if (wanted > 0) {
      // A swapped noun can derail the sentence it lands in, so a topped-up one
      // takes the region's escape out of it. A swapped determiner or bracket
      // cannot, so it stays a drop-in.
      const escapes = step.cat === 'content' || step.cat === 'bound' || step.cat === 'ident';
      for (const text of drawFromPool(poolFor(region, step.cat, id), used, wanted, id)) {
        alts.push(
          escapes
            ? { text, bridge: region.escape, rejoin: 'clause' }
            : { text, bridge: [], rejoin: 1 },
        );
      }
    }

    const rank = clamp(step.rank, 0, K - 1);
    const texts: string[] = new Array<string>(K).fill('');
    const nexts: string[] = new Array<string>(K).fill(EOS_ID);
    texts[rank] = step.text;
    nexts[rank] = spineId(i + 1);

    let slot = 0;
    for (let a = 0; a < alts.length; a += 1) {
      if (slot === rank) slot += 1;
      const alt = alts[a];
      if (alt === undefined) continue;
      const exit = resolveRejoin(alt, i);
      texts[slot] = alt.text;
      nexts[slot] =
        alt.bridge.length === 0 ? exit : buildBridge(alt.bridge, exit, region, `b${i}_${a}`);
      slot += 1;
    }

    const solved = solveNode(spec, id, step.cat, region.target, step.h);
    finish(id, solved, texts, nexts);
  }

  nodes.set(EOS_ID, { c: [], eos: true });
  stats.nodes = nodes.size;

  const file: FixtureFile = {
    version: 1,
    id: spec.id,
    label: spec.label,
    description: spec.description,
    prompt: spec.prompt,
    k: K,
    entry: spineId(0),
    nodes: Object.fromEntries(nodes),
  };

  validate(spec, file);
  return { file, stats };
}

// -------------------------------------------------------------- verification

/**
 * Checks the invariants the app and its tests depend on, at build time, so a
 * broken fixture never reaches the repository in the first place.
 */
function validate(spec: FixtureSpec, file: FixtureFile): void {
  const fail = (message: string): never => {
    throw new Error(`${spec.id}: ${message}`);
  };
  const [bandLo, bandHi] = spec.band;

  for (const [id, node] of Object.entries(file.nodes)) {
    if (node.eos === true) {
      if (node.c.length !== 0) fail(`${id}: an eos node must carry no candidates`);
      continue;
    }
    if (node.c.length !== K) fail(`${id}: ${node.c.length} candidates, expected ${K}`);

    let sum = 0;
    let previous = Infinity;
    const seen = new Set<string>();
    for (const [text, logprob, next] of node.c) {
      if (!(logprob < previous)) fail(`${id}: candidates are not strictly descending`);
      previous = logprob;
      sum += Math.exp(logprob);
      if (seen.has(text)) fail(`${id}: duplicate candidate text ${JSON.stringify(text)}`);
      seen.add(text);
      if (file.nodes[next] === undefined) fail(`${id}: dangling next id ${JSON.stringify(next)}`);
    }
    if (sum < 0.85 || sum > 0.999) fail(`${id}: top-${K} mass ${sum.toFixed(4)} outside [0.85, 0.999]`);

    const h = entropyBits(node.c.map(([, logprob]) => Math.exp(logprob)));
    if (h < bandLo || h > bandHi) {
      fail(`${id}: entropy ${h.toFixed(3)} bits outside the declared band ${bandLo}-${bandHi}`);
    }
  }

  // Every node reachable, every walk terminating. The lattice is a DAG by
  // construction -- bridges only ever rejoin further along the spine -- but
  // construction is exactly the thing this is meant to double-check.
  const seen = new Set<string>([file.entry]);
  const stack = [file.entry];
  while (stack.length > 0) {
    const id = stack.pop() ?? '';
    const node = file.nodes[id];
    if (node === undefined) {
      throw new Error(`${spec.id}: walk hit missing node ${id}`);
    }
    for (const [, , next] of node.c) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  for (const id of Object.keys(file.nodes)) {
    if (!seen.has(id)) fail(`${id} is unreachable from ${file.entry}`);
  }
}

// -------------------------------------------------------------- serialisation

/**
 * One line per node: small enough to diff, structured enough to read. Key order
 * is fixed by this function rather than by object iteration, and the trailing
 * newline plus LF endings match .gitattributes so checkouts cannot drift.
 */
export function serialize(file: FixtureFile): string {
  const out: string[] = [];
  out.push('{');
  out.push(`  "version": ${file.version},`);
  out.push(`  "id": ${JSON.stringify(file.id)},`);
  out.push(`  "label": ${JSON.stringify(file.label)},`);
  out.push(`  "description": ${JSON.stringify(file.description)},`);
  out.push(`  "prompt": ${JSON.stringify(file.prompt)},`);
  out.push(`  "k": ${file.k},`);
  out.push(`  "entry": ${JSON.stringify(file.entry)},`);
  out.push('  "nodes": {');
  const ids = Object.keys(file.nodes);
  ids.forEach((id, index) => {
    const node = file.nodes[id];
    const candidates = (node?.c ?? [])
      .map(([text, logprob, next]) => `[${JSON.stringify(text)},${logprob},${JSON.stringify(next)}]`)
      .join(',');
    const eos = node?.eos === true ? ',"eos":true' : '';
    const comma = index === ids.length - 1 ? '' : ',';
    out.push(`    ${JSON.stringify(id)}: {"c":[${candidates}]${eos}}${comma}`);
  });
  out.push('  }');
  out.push('}');
  return `${out.join('\n')}\n`;
}

// ------------------------------------------------------------------ the specs

export const SPECS: readonly FixtureSpec[] = [FACTUAL_SPEC, CREATIVE_SPEC, CODE_SPEC];

// -------------------------------------------------------------------- report

function report(stats: BuildStats, bytes: number): string[] {
  const mean = stats.entropySum / (stats.nodes - 1);
  const lines = [
    `  ${stats.id}: ${stats.spineTokens} spine tokens, ${stats.nodes} nodes ` +
      `(${stats.bridgeNodes} in ${stats.bridges} bridges), ${stats.candidates} candidates, ` +
      `${(bytes / 1024).toFixed(1)} KiB`,
    `    entropy ${stats.entropyLo.toFixed(2)}-${stats.entropyHi.toFixed(2)} bits ` +
      `(mean ${mean.toFixed(2)}), top-${K} mass ${stats.sumLo.toFixed(3)}-${stats.sumHi.toFixed(3)}`,
    `    rank1-rank4 spread ${(stats.clusterSum / (stats.nodes - 1)).toFixed(2)} nats mean, ` +
      `${(stats.clusterWithin / (stats.nodes - 1)).toFixed(1)} candidates within 1.5 nats of the head, ` +
      `${stats.clamped} target(s) clamped`,
  ];
  for (const [category, entry] of [...stats.byCategory].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(
      `    ${category.padEnd(8)} n=${String(entry.count).padStart(4)}  ` +
        `head ${entry.headLo.toFixed(3)}-${entry.headHi.toFixed(3)} ` +
        `(mean ${(entry.headSum / entry.count).toFixed(3)})  ` +
        `H ${entry.entropyLo.toFixed(2)}-${entry.entropyHi.toFixed(2)} bits  ` +
        `gap ${(entry.gapSum / entry.count).toFixed(2)}  ` +
        `rank2-5 spread ${(entry.spreadSum / entry.count).toFixed(2)}  ` +
        `tail ${(entry.slopeSum / entry.count).toFixed(2)} nats/rank`,
    );
  }
  return lines;
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const lines: string[] = ['glass-box fixtures'];

  for (const spec of SPECS) {
    const first = buildFixture(spec);
    const json = serialize(first.file);

    // Determinism is the property the whole replay mode rests on, so it is
    // checked here rather than assumed: a second independent build of the same
    // spec must produce the same bytes.
    const second = serialize(buildFixture(spec).file);
    if (json !== second) {
      throw new Error(`${spec.id}: two builds of the same spec disagreed -- the generator is not deterministic`);
    }

    // And the emitted text must parse back to the object it came from.
    const reparsed = JSON.parse(json) as FixtureFile;
    if (serialize(reparsed) !== json) {
      throw new Error(`${spec.id}: JSON round-trip changed the file`);
    }

    writeFileSync(join(here, `${spec.id}.json`), json, 'utf8');
    lines.push(...report(first.stats, Buffer.byteLength(json, 'utf8')));
  }

  // eslint-disable-next-line no-console -- build tool, not shipped code.
  console.log(lines.join('\n'));
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /build\.ts$/.test(process.argv[1].replace(/\\/g, '/'));

if (invokedDirectly) main();
