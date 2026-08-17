/**
 * The authored half of a replay fixture.
 *
 * A spec is prose plus intent: the spine text broken into GPT-style tokens, the
 * alternatives a real model would have had at each step, and a target entropy
 * per region. It carries no probabilities at all. Every number in the shipped
 * JSON is solved for by `build.ts` from these targets, which is what keeps the
 * shapes internally consistent instead of hand-waved.
 *
 * Nothing here is imported by the app. Specs are build-time input; the app only
 * ever sees the generated JSON.
 */

/**
 * What kind of token a step is, which is the only thing that decides how much
 * probability its head should carry.
 *
 *   func    determiners, prepositions, auxiliaries, conjunctions.
 *   punct   commas, full stops, quotes.
 *   content nouns, verbs, adjectives: the choices that carry meaning, and the
 *           only ones with a cluster of real near-synonyms behind them.
 *   bound   a content word or identifier the context has already decided --
 *           "Mars" after "Champ de", "el" after " Eiff", `n` inside a body
 *           whose signature says `n`. Peaked like a determiner despite being a
 *           noun, which is exactly why factual recall reads as confident.
 *   sub     a word-piece continuation: "el" after " Eiff", "house" after
 *           " light". Peaked, and its rivals are other word-pieces rather than
 *           words -- the detail a reader who knows BPE will look for first.
 *   syntax  code keywords, operators, brackets, newlines, indentation.
 *   ident   code identifiers and literal values: the genuinely free choices.
 */
export type TokenCategory = 'func' | 'punct' | 'content' | 'bound' | 'sub' | 'syntax' | 'ident';

/**
 * Where a branch resumes once its bridge runs out.
 *
 *   a number   this many spine steps past the one the alternative replaced, so
 *              `1` is the drop-in case: swap one token, carry on.
 *   'clause'   the next step flagged `clause`, i.e. the start of the next
 *              clause or sentence. Bridges that end in punctuation use this.
 *   'end'      stop at the eos node.
 */
export type Rejoin = number | 'clause' | 'end';

/** One off-spine candidate, and the short continuation it opens up. */
export interface AltSpec {
  /** Token text, leading space included. */
  readonly text: string;
  /** 0 tokens for a drop-in swap, otherwise 2-5 tokens of alternative text. */
  readonly bridge: readonly string[];
  readonly rejoin: Rejoin;
}

/** One token of the main line. */
export interface StepSpec {
  readonly text: string;
  readonly cat: TokenCategory;
  /** Up to K-1 authored alternatives, best first. Short lists are topped up. */
  readonly alts: readonly AltSpec[];
  /** True if this step opens a clause, making it a landing point for bridges. */
  readonly clause: boolean;
  /**
   * Which rank the spine token occupies. 0 -- the usual case -- means the main
   * line took the model's top choice; 1 means the recorded line took the second
   * candidate, which is what sampling at a real temperature actually looks like.
   */
  readonly rank: number;
  /** Overrides the region's entropy target for this one step. */
  readonly h: number | null;
}

/**
 * A stretch of the spine that shares a subject, and therefore shares both an
 * entropy level and a pool of plausible distractors.
 */
export interface RegionSpec {
  readonly label: string;
  /** First spine index in the region. Regions run to the next one's `from`. */
  readonly from: number;
  /** Base entropy in bits, before the per-category offset and seeded wiggle. */
  readonly target: number;
  /**
   * Tokens used to top up short alternative lists, and to furnish the
   * alternatives shown at bridge nodes. Themed per region so that even a
   * rank-nine distractor is something the model could plausibly have weighed.
   */
  readonly pools: Partial<Record<TokenCategory, readonly string[]>>;
  /**
   * How a topped-up content alternative gets out of the sentence it just
   * derailed: a full stop, usually, after which the branch rejoins at the next
   * clause. Authored bridges are longer; this one only has to be grammatical
   * after any noun in the pool.
   */
  readonly escape: readonly string[];
}

export interface FixtureSpec {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly prompt: string;
  /** Seeds every per-node jitter stream. Changing it reshapes the whole file. */
  readonly seed: number;
  /** The exact text the spine must reproduce when its tokens are concatenated. */
  readonly text: string;
  /** Declared entropy band in bits; every node in the file must land inside it. */
  readonly band: readonly [number, number];
  /** Which vocabulary the bridge-token classifier should use. */
  readonly classifier: 'prose' | 'code';
  readonly headBands: Partial<Record<TokenCategory, readonly [number, number]>>;
  readonly entropyOffsets: Partial<Record<TokenCategory, number>>;
  /** Amplitude in bits of the seeded per-node wobble around the target. */
  readonly wiggle: number;
  readonly regions: readonly RegionSpec[];
  readonly steps: readonly StepSpec[];
}

// ------------------------------------------------------------------ authoring

/** A drop-in alternative: swap this token for the spine's and carry straight on. */
export function d(text: string): AltSpec {
  return { text, bridge: [], rejoin: 1 };
}

/** A bridge that runs to the end of the clause and rejoins at the next one. */
export function br(text: string, ...bridge: readonly string[]): AltSpec {
  return { text, bridge, rejoin: 'clause' };
}

/** A bridge that rejoins a fixed number of spine steps along. */
export function at(rejoin: number, text: string, ...bridge: readonly string[]): AltSpec {
  return { text, bridge, rejoin };
}

/** A bridge that finishes the generation instead of rejoining. */
export function fin(text: string, ...bridge: readonly string[]): AltSpec {
  return { text, bridge, rejoin: 'end' };
}

/** One spine step. Bare strings in `alts` are drop-in alternatives. */
export function s(
  text: string,
  cat: TokenCategory,
  alts: readonly (string | AltSpec)[],
  opts?: { readonly clause?: boolean; readonly rank?: number; readonly h?: number },
): StepSpec {
  return {
    text,
    cat,
    alts: alts.map((a) => (typeof a === 'string' ? d(a) : a)),
    clause: opts?.clause ?? false,
    rank: opts?.rank ?? 0,
    h: opts?.h ?? null,
  };
}

// ------------------------------------------------------------------- defaults

/**
 * Head-probability bands by category, as observed in real top-k logprobs: the
 * grammar tokens are nearly forced, the meaning-bearing ones are a contest.
 * Fixtures override these where the physics demands it -- see creative.spec.ts,
 * where a genuinely flat narrative cannot afford a 0.9 determiner.
 */
export const DEFAULT_HEAD_BANDS: Record<TokenCategory, readonly [number, number]> = {
  func: [0.7, 0.96],
  punct: [0.74, 0.97],
  content: [0.2, 0.55],
  bound: [0.8, 0.96],
  sub: [0.82, 0.96],
  syntax: [0.9, 0.97],
  ident: [0.2, 0.55],
};

/** Bits added to a region's target for each category, before the wiggle. */
export const DEFAULT_ENTROPY_OFFSETS: Record<TokenCategory, number> = {
  func: -0.06,
  punct: -0.33,
  content: 0.65,
  bound: -0.06,
  sub: -0.1,
  syntax: -1.13,
  ident: 1.05,
};
