import { entropyBits, surprisalBits } from '../core/entropy';
import { rand01 } from '../core/rng';
import { sampleIndex } from '../core/sample';
import { applyNucleus, softmaxTemperature } from '../core/transform';
import { Emitter } from './events';
import { K } from './types';
import type {
  Branch,
  DisplayDistribution,
  EngineListener,
  GenerationState,
  GenerationStatus,
  SamplerSettings,
  SamplerSource,
  SourceSink,
  StepDistribution,
  TokenRecord,
} from './types';

export const ENGINE_VERSION = '1';

/**
 * The single owner of generation state.
 *
 * Streaming, bar animation and forking are one coupled cluster: each depends on
 * the others' ordering, so all three are driven from here rather than split
 * across independent components. Sources push steps in, the UI subscribes to
 * events out, and nothing else writes state.
 *
 * WHAT THE SLIDERS MEAN
 *
 * Temperature and top-p do two jobs at once, and the distinction matters.
 *
 * As a VIEW TRANSFORM they reshape the bars every frame, computed fresh from the
 * stored log-probabilities. Nothing is mutated; the raw source data survives
 * untouched no matter how far the sliders travel.
 *
 * As a GENERATIVE control in replay mode they change which token actually gets
 * drawn. This is the honest choice. A visualiser whose temperature slider only
 * redrew bars would teach that temperature is a display setting, when the whole
 * point is that it changes outcomes.
 *
 * Determinism survives that because the randomness is KEYED rather than
 * sequential: the draw at a given step is rand01(seed, branchId, step), a pure
 * function of position in the tree. Exploring a fork cannot shift the draws on
 * any other path, and re-running with the same settings reproduces the same
 * text exactly.
 *
 * In live mode the remote model does the sampling, so the sliders reshape the
 * display and apply to the next request. Pretending we could retroactively
 * resample a completion already streaming would be a lie the UI says plainly.
 */
export class Engine {
  private readonly emitter = new Emitter();
  private source: SamplerSource | null = null;

  private readonly state: GenerationState;

  /** Preallocated scratch. The display pipeline runs every frame and must not
   *  allocate; see the frame-time gate. */
  private readonly logits = new Float64Array(K);
  private readonly probs = new Float64Array(K);
  private readonly nucleus = new Float64Array(K);
  private readonly display: {
    probs: Float64Array;
    nucleusProbs: Float64Array;
    nucleusSize: number;
    entropyBits: number;
    count: number;
  };

  /** Resolvers for advanceToStep/runToEnd, checked after every commit. */
  private waiters: { target: number | 'end'; resolve: () => void }[] = [];

  constructor(options: { seed: number; settings: SamplerSettings; prompt: string }) {
    this.state = {
      status: 'idle',
      mode: 'replay',
      prompt: options.prompt,
      seed: options.seed,
      settings: { ...options.settings },
      branches: new Map([
        ['root', { id: 'root', parentId: null, forkStep: 0, tokens: [] }],
      ]),
      activeBranchId: 'root',
      selectedStep: null,
      error: null,
    };
    this.display = {
      probs: this.probs,
      nucleusProbs: this.nucleus,
      nucleusSize: 0,
      entropyBits: 0,
      count: 0,
    };
  }

  on(listener: EngineListener): () => void {
    return this.emitter.on(listener);
  }

  getState(): Readonly<GenerationState> {
    return this.state;
  }

  // ------------------------------------------------------------- derived data

  /** Full token chain for a branch: ancestors' prefixes plus its own suffix. */
  chainTokens(branchId: string = this.state.activeBranchId): TokenRecord[] {
    const branch = this.state.branches.get(branchId);
    if (!branch) return [];
    if (branch.parentId === null) return branch.tokens.slice();
    const prefix = this.chainTokens(branch.parentId).slice(0, branch.forkStep);
    prefix.push(...branch.tokens);
    return prefix;
  }

  chainLength(branchId: string = this.state.activeBranchId): number {
    const branch = this.state.branches.get(branchId);
    if (!branch) return 0;
    return branch.forkStep + branch.tokens.length;
  }

  text(branchId: string = this.state.activeBranchId): string {
    let out = '';
    for (const record of this.chainTokens(branchId)) {
      out += record.distribution.candidates[record.chosenIndex]?.text ?? '';
    }
    return out;
  }

  /** The step whose distribution the bar panel shows. */
  selectedRecord(): TokenRecord | null {
    const selection = this.state.selectedStep;
    const chain = this.chainTokens(selection?.branchId ?? this.state.activeBranchId);
    if (chain.length === 0) return null;
    if (!selection) return chain[chain.length - 1] ?? null;
    return chain[selection.step] ?? null;
  }

  /**
   * Recomputes the displayed distribution from stored log-probabilities under
   * the live settings. Pure, allocation-free, and the only thing a slider move
   * has to run before the next paint.
   */
  computeDisplay(distribution: StepDistribution, settings: SamplerSettings): DisplayDistribution {
    const count = Math.min(distribution.candidates.length, K);
    for (let i = 0; i < count; i += 1) {
      this.logits[i] = distribution.candidates[i]!.logprob;
    }
    softmaxTemperature(this.logits, count, settings.temperature, this.probs);
    const nucleusSize = applyNucleus(this.probs, count, settings.topP, this.nucleus);

    this.display.nucleusSize = nucleusSize;
    this.display.entropyBits = entropyBits(this.nucleus, nucleusSize);
    this.display.count = count;
    return this.display;
  }

  // ------------------------------------------------------------- intents

  setSettings(next: Partial<SamplerSettings>): void {
    const settings: SamplerSettings = {
      temperature: next.temperature ?? this.state.settings.temperature,
      topP: next.topP ?? this.state.settings.topP,
    };
    this.state.settings = settings;
    this.emitter.emit({ type: 'settings', settings });
  }

  select(selection: GenerationState['selectedStep']): void {
    this.state.selectedStep = selection;
    this.emitter.emit({ type: 'select', selection });
  }

  start(source: SamplerSource): void {
    this.source = source;
    this.state.mode = source.kind;
    this.state.error = null;
    this.setStatus('streaming');
    source.start(
      {
        prompt: this.state.prompt,
        prefix: this.chainTokens(),
        settings: { ...this.state.settings },
      },
      this.sink,
    );
  }

  pause(): void {
    if (this.state.status !== 'streaming') return;
    this.source?.stop();
    this.setStatus('paused');
  }

  resume(source: SamplerSource): void {
    if (this.state.status === 'streaming' || this.state.status === 'done') return;
    this.start(source);
  }

  /** Returns to a branch opened earlier, leaving every branch intact. */
  switchBranch(branchId: string): void {
    if (!this.state.branches.has(branchId)) return;
    this.source?.stop();
    this.state.activeBranchId = branchId;
    this.state.selectedStep = null;
    this.setStatus('paused');
    this.emitter.emit({ type: 'select', selection: null });
  }

  reset(prompt?: string): void {
    this.source?.stop();
    if (typeof prompt === 'string') this.state.prompt = prompt;
    this.state.branches.clear();
    this.state.branches.set('root', { id: 'root', parentId: null, forkStep: 0, tokens: [] });
    this.state.activeBranchId = 'root';
    this.state.selectedStep = null;
    this.state.error = null;
    this.settleWaiters(true);
    this.setStatus('idle');
    this.emitter.emit({ type: 'reset' });
  }

  /**
   * Branches by forcing a different candidate at an existing step.
   *
   * A fork is not a special mode: it is the ordinary commit path with the
   * choice overridden. That falls out of the lattice fixtures, where all ten
   * candidates carry a real continuation, so any of them can be taken.
   */
  fork(branchId: string, step: number, candidateIndex: number, source: SamplerSource): Branch {
    this.source?.stop();

    const chain = this.chainTokens(branchId);
    const original = chain[step];
    if (!original) throw new Error(`cannot fork at step ${step}: no such token`);

    const id = `${branchId}/${step}.${candidateIndex}`;
    const settings = { ...this.state.settings };
    const display = this.computeDisplay(original.distribution, settings);
    const chosenProb = this.probabilityOf(display, candidateIndex);

    const forced: TokenRecord = {
      step,
      chosenIndex: candidateIndex,
      distribution: original.distribution,
      settings,
      chosenProb,
      surprisalBits: surprisalBits(chosenProb),
      entropyBits: display.entropyBits,
      origin: 'forced',
    };

    const branch: Branch = { id, parentId: branchId, forkStep: step, tokens: [forced] };
    this.state.branches.set(id, branch);
    this.state.activeBranchId = id;
    this.state.selectedStep = null;

    this.emitter.emit({ type: 'fork', branch });
    this.emitter.emit({ type: 'token', branchId: id, record: forced });

    this.start(source);
    return branch;
  }

  // ------------------------------------------------------------- streaming

  /** Resolves once the active chain holds `target` tokens, then pauses. */
  advanceToStep(target: number, source: SamplerSource): Promise<void> {
    if (this.chainLength() >= target) {
      this.pause();
      return Promise.resolve();
    }
    if (this.state.status !== 'streaming') this.start(source);
    return new Promise<void>((resolve) => {
      this.waiters.push({ target, resolve });
    });
  }

  runToEnd(source: SamplerSource): Promise<void> {
    if (this.state.status === 'done') return Promise.resolve();
    if (this.state.status !== 'streaming') this.start(source);
    return new Promise<void>((resolve) => {
      this.waiters.push({ target: 'end', resolve });
    });
  }

  private readonly sink: SourceSink = {
    onStep: (distribution, observedIndex) => {
      if (this.state.status !== 'streaming') return 'halt';

      const branch = this.state.branches.get(this.state.activeBranchId);
      if (!branch) return 'halt';

      const step = this.chainLength();
      const settings = { ...this.state.settings };
      const display = this.computeDisplay(distribution, settings);

      let chosenIndex: number;
      let origin: TokenRecord['origin'];
      if (typeof observedIndex === 'number') {
        // Live: the model already chose. We record what happened rather than
        // re-deciding it, which is why live mode says the sliders apply to the
        // next request.
        chosenIndex = observedIndex;
        origin = 'observed';
      } else {
        chosenIndex = sampleIndex(
          this.nucleus,
          display.count,
          rand01(this.state.seed, branch.id, step),
        );
        origin = 'sampled';
      }

      const chosenProb = this.probabilityOf(display, chosenIndex);
      const record: TokenRecord = {
        step,
        chosenIndex,
        distribution,
        settings,
        chosenProb,
        surprisalBits: surprisalBits(chosenProb),
        entropyBits: display.entropyBits,
        origin,
      };

      branch.tokens.push(record);
      this.emitter.emit({ type: 'token', branchId: branch.id, record });
      this.checkWaiters();

      return this.state.status === 'streaming' ? chosenIndex : 'halt';
    },

    onDone: (reason) => {
      this.setStatus(reason === 'aborted' ? 'paused' : 'done');
      this.settleWaiters(true);
    },

    onError: (message) => {
      this.state.error = message;
      this.setStatus('error');
      this.emitter.emit({ type: 'error', message });
      this.settleWaiters(true);
    },
  };

  /**
   * The chosen candidate's probability as the bars show it.
   *
   * Falls back to the pre-nucleus value when the choice sits outside the
   * nucleus, which live mode can produce: the model picks a token, then the
   * viewer drags top-p below it. Reading zero there would report an infinite
   * surprisal for a token that demonstrably occurred.
   */
  private probabilityOf(display: DisplayDistribution, index: number): number {
    const inNucleus = display.nucleusProbs[index] ?? 0;
    if (inNucleus > 0) return inNucleus;
    return display.probs[index] ?? 0;
  }

  private setStatus(status: GenerationStatus): void {
    if (this.state.status === status) return;
    this.state.status = status;
    this.emitter.emit({ type: 'status', status });
  }

  private checkWaiters(): void {
    if (this.waiters.length === 0) return;
    const length = this.chainLength();
    const remaining: typeof this.waiters = [];
    let shouldPause = false;
    for (const waiter of this.waiters) {
      if (waiter.target !== 'end' && length >= waiter.target) {
        shouldPause = true;
        waiter.resolve();
      } else {
        remaining.push(waiter);
      }
    }
    this.waiters = remaining;
    if (shouldPause) this.pause();
  }

  private settleWaiters(resolveAll: boolean): void {
    if (!resolveAll) return;
    for (const waiter of this.waiters) waiter.resolve();
    this.waiters = [];
  }
}
