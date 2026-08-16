/**
 * THE TEST CONTRACT.
 *
 * This file is written before any application code and is the single agreed
 * surface between the app and the verification harness. The harness is coded
 * against these declarations; the app must satisfy them.
 *
 * Two principles govern what may live here:
 *
 * 1. HOOKS OBSERVE, USERS ACT. Anything the harness is trying to prove about
 *    the *interface* must be driven with real mouse and keyboard events. The
 *    mutating hooks below exist only for the determinism schedule, where the
 *    two runs must receive byte-identical parameters and a pixel drag cannot
 *    guarantee that. Every other gate drives the real UI.
 *
 * 2. THE MEASURED PARTY DOES NOT OWN THE INSTRUMENT. There is deliberately no
 *    frame-timing hook here. The harness injects its own probe (see
 *    harness/lib/frame-probe.js), so the app cannot report its own smoothness.
 *    The app's optional `?hud=1` overlay is a development aid and is never
 *    accepted as evidence.
 */

/** A single candidate token as the app displays it. */
export interface SerializedCandidate {
  readonly tokenText: string;
  /** Probability actually driving the bar, after temperature and top-p. */
  readonly pDisplayed: number;
  /** False when top-p has excluded this candidate. */
  readonly inNucleus: boolean;
}

/** One emitted token and the distribution it was drawn from. */
export interface SerializedStep {
  readonly index: number;
  readonly branchId: string;
  readonly chosenIndex: number;
  readonly chosenTokenText: string;
  readonly temperature: number;
  readonly topP: number;
  readonly entropyBits: number;
  readonly surprisalBits: number;
  readonly origin: 'sampled' | 'observed' | 'forced';
  readonly candidates: readonly SerializedCandidate[];
}

/**
 * The determinism oracle. Two runs following the same schedule must serialise
 * to byte-identical JSON. Probabilities are full float64 precision: rounding
 * here would hide exactly the drift the gate exists to catch.
 */
export interface RunRecord {
  readonly fixtureId: string;
  readonly seed: number;
  readonly engineVersion: string;
  readonly steps: readonly SerializedStep[];
  readonly branches: readonly {
    readonly id: string;
    readonly parentId: string | null;
    readonly forkStep: number;
  }[];
  readonly activeBranchId: string;
  readonly finalText: string;
}

export interface EffectiveMotion {
  /** Whether the app believes reduced motion is in force. */
  readonly reduced: boolean;
  /** Longest transition the app will play, in ms. Must be 0 when reduced. */
  readonly maxTransitionMs: number;
  /** Longest animation the app will play, in ms. Must be 0 when reduced. */
  readonly maxAnimationMs: number;
}

export interface GlassboxHooks {
  /** Bumped only on a breaking change to this contract. */
  readonly version: 1;
  /** True when the page was loaded with ?deterministic=1. */
  readonly deterministic: boolean;
  /** Resolves once fixtures are loaded and the UI is interactive. */
  readonly ready: Promise<void>;

  getState(): {
    readonly status: 'idle' | 'streaming' | 'paused' | 'done' | 'error';
    readonly stepCount: number;
    readonly activeBranchId: string;
    readonly temperature: number;
    readonly topP: number;
  };

  /** Determinism schedule only -- every other gate drags the real slider. */
  setParams(params: { temperature?: number; topP?: number }): void;

  /** Stream until `n` tokens exist on the active branch, then pause. */
  advanceToStep(n: number): Promise<void>;

  /** Stream to end-of-sequence. */
  runToEnd(): Promise<void>;

  /** Determinism schedule only -- capture specs click the real bar. */
  fork(stepIndex: number, altRank: number): Promise<void>;

  /** Runs the scripted showcase; resolves when it finishes. */
  startDemo(): Promise<void>;

  /** The determinism oracle. See RunRecord. */
  serializeRun(): RunRecord;

  /** Self-report, cross-checked by the harness against computed styles. */
  getEffectiveMotion(): EffectiveMotion;
}

declare global {
  interface Window {
    __glassbox?: GlassboxHooks;
  }
}
