/**
 * The shared vocabulary. Everything else in the app compiles against this file.
 *
 * The layering it implies is strict and one-directional:
 *
 *     core/  <-  engine/  <-  sources/ , ui/  <-  main.ts
 *
 * `core/` is pure mathematics and imports nothing at all, which is what lets the
 * sampling-math gate test it without a DOM in scope. `engine/` owns all mutable
 * state. Sources push steps in; the UI subscribes to events out; neither ever
 * writes state directly.
 */

/** The two controls, and the only knobs that reshape a distribution. */
export interface SamplerSettings {
  /** 0 to 2. Below 0.01 the sampler collapses to argmax. */
  readonly temperature: number;
  /** 0 to 1. Always keeps at least one candidate. */
  readonly topP: number;
}

/** One candidate token as the source reported it. */
export interface TokenCandidate {
  /**
   * The exact token text, leading space included. Concatenating the chosen
   * tokens must reproduce the visible output exactly -- the display shows a
   * middle dot for leading spaces, but that is decoration, never data.
   */
  readonly text: string;
  /** Natural log of the probability at temperature 1, as the source gave it. */
  readonly logprob: number;
}

/** The candidate set at one generation step, sorted by descending logprob. */
export interface StepDistribution {
  readonly candidates: readonly TokenCandidate[];
  /**
   * Probability mass outside the top k. Real APIs return only the top few
   * candidates, so this is never zero; the UI shows it rather than implying
   * that ten tokens are the whole vocabulary.
   */
  readonly tailMass: number;
  /** Replay only: the fixture node this step came from. */
  readonly nodeId?: string;
}

/**
 * A distribution after the sliders have been applied. Recomputed every frame
 * into preallocated buffers and never stored, because it is a function of the
 * current settings rather than a fact about the generation.
 */
export interface DisplayDistribution {
  /** After temperature, before top-p. Length k. */
  readonly probs: Float64Array;
  /** After top-p, renormalised. Exactly zero outside the nucleus. */
  readonly nucleusProbs: Float64Array;
  /** How many candidates survived top-p. */
  readonly nucleusSize: number;
  /** Entropy of `nucleusProbs`, in bits. */
  readonly entropyBits: number;
  readonly count: number;
}

/** Where a committed token came from. */
export type TokenOrigin =
  /** Replay: drawn by our sampler from the reshaped distribution. */
  | 'sampled'
  /** Live: the remote model chose it; we are recording, not sampling. */
  | 'observed'
  /** The user clicked an alternative and forced it. */
  | 'forced';

/**
 * A committed token.
 *
 * The statistics here are frozen at the moment of sampling and never
 * recomputed. Moving a slider afterwards must not rewrite history: the
 * transcript records what the sampler actually faced, while the bar panel shows
 * the live, reshapeable view of one chosen step.
 */
export interface TokenRecord {
  readonly step: number;
  readonly chosenIndex: number;
  readonly distribution: StepDistribution;
  readonly settings: SamplerSettings;
  readonly chosenProb: number;
  readonly surprisalBits: number;
  readonly entropyBits: number;
  readonly origin: TokenOrigin;
}

/**
 * A line of generation. `tokens` holds only this branch's own suffix; the full
 * text is assembled by walking `parentId` to the root. Storing suffixes keeps a
 * fork O(1) instead of copying the whole prefix.
 */
export interface Branch {
  /** "root", or "root/12.3" meaning: forked at step 12 taking candidate 3. */
  readonly id: string;
  readonly parentId: string | null;
  /** Index in the parent where this branch diverges. */
  readonly forkStep: number;
  readonly tokens: TokenRecord[];
}

export type GenerationStatus = 'idle' | 'streaming' | 'paused' | 'done' | 'error';

export interface GenerationState {
  status: GenerationStatus;
  mode: 'replay' | 'live';
  prompt: string;
  seed: number;
  /** Live slider values. Affect the display now and future steps when sampling. */
  settings: SamplerSettings;
  /** Insertion-ordered, so iteration is deterministic. */
  readonly branches: Map<string, Branch>;
  activeBranchId: string;
  /** Which step the bar panel shows. Null means "follow the newest". */
  selectedStep: { branchId: string; step: number } | null;
  error: string | null;
}

// ---------------------------------------------------------------- sources

export interface SourceRequest {
  readonly prompt: string;
  /**
   * Committed tokens of the active branch chain, root first.
   *
   * A replay source resumes from here without needing to be told where it is:
   * the last record carries the fixture node it came from and the candidate
   * that was taken, and following that candidate's edge gives the next node.
   * So forking needs no special channel -- it is just a restart with a
   * different prefix.
   */
  readonly prefix: readonly TokenRecord[];
  readonly settings: SamplerSettings;
}

export interface SourceSink {
  /**
   * Delivers the next step.
   *
   * Live sources pass `observedIndex`, the candidate the model actually chose.
   * Replay sources omit it and let the engine sample, which is what makes the
   * temperature and top-p sliders genuinely change the path rather than merely
   * redraw it.
   *
   * Returns the index the engine committed, so a replay walker can follow that
   * candidate's edge through the fixture -- or 'halt' if generation stopped.
   */
  onStep(distribution: StepDistribution, observedIndex?: number): number | 'halt';
  onDone(reason: 'eos' | 'length' | 'aborted'): void;
  /** Errors are surfaced in the UI. Nothing in this app writes to console. */
  onError(message: string): void;
}

export interface SamplerSource {
  readonly kind: 'replay' | 'live';
  start(request: SourceRequest, sink: SourceSink): void;
  /** Idempotent; safe to call when not running. */
  stop(): void;
}

/**
 * A source whose whole path can be re-derived on demand.
 *
 * This is what makes the sliders honest. Without it, moving temperature after a
 * token was committed leaves that token in place, and the panel ends up drawing
 * a state that cannot exist: a committed token sitting outside the nucleus it
 * was supposedly drawn from, at a probability the same panel prints as zero.
 *
 * A lattice can be re-walked because every candidate carries a continuation and
 * the randomness is keyed by position rather than drawn from a stream, so the
 * same settings always produce the same path. A live endpoint cannot -- those
 * tokens are the model's, drawn under the settings the request carried -- which
 * is why this is a capability some sources have rather than part of the base
 * interface.
 */
export interface ResamplableSource extends SamplerSource {
  /**
   * Re-walks from the beginning, asking `decide` which candidate to take at
   * each step, and stops after `maxSteps` or at end-of-sequence.
   */
  walk(
    maxSteps: number,
    decide: (distribution: StepDistribution, step: number) => number,
  ): { distributions: StepDistribution[]; chosen: number[] };
}

export function isResamplable(source: SamplerSource): source is ResamplableSource {
  return typeof (source as Partial<ResamplableSource>).walk === 'function';
}

// ---------------------------------------------------------------- events

export type EngineEvent =
  | { readonly type: 'status'; readonly status: GenerationStatus }
  | { readonly type: 'token'; readonly branchId: string; readonly record: TokenRecord }
  | { readonly type: 'settings'; readonly settings: SamplerSettings }
  | { readonly type: 'fork'; readonly branch: Branch }
  | { readonly type: 'select'; readonly selection: GenerationState['selectedStep'] }
  | { readonly type: 'reset' }
  | { readonly type: 'error'; readonly message: string };

export type EngineListener = (event: EngineEvent) => void;

// ---------------------------------------------------------------- fixtures

/**
 * Replay fixtures are a token lattice, not a recording.
 *
 * A linear transcript cannot work here: the sliders change which token gets
 * drawn, and a fork deliberately takes a different one, so playback leaves any
 * single recorded line almost immediately. Instead every candidate carries a
 * `next` edge, so all ten are real continuations and any of them can be
 * followed. Off-spine branches rejoin the main line at the next clause boundary
 * to keep authoring finite.
 */
export interface FixtureFile {
  readonly version: 1;
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly prompt: string;
  readonly k: number;
  readonly entry: string;
  readonly nodes: Readonly<Record<string, FixtureNode>>;
}

export interface FixtureNode {
  /** [text, logprob, nextNodeId]; sorted by descending logprob; length k. */
  readonly c: readonly (readonly [string, number, string])[];
  /** Terminal node: generation stops here. */
  readonly eos?: boolean;
}

export const K = 10;
