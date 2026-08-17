import type {
  FixtureFile,
  SamplerSource,
  SourceRequest,
  SourceSink,
  StepDistribution,
} from '../engine/types';

/**
 * Walks a fixture lattice, delivering one step per cadence tick.
 *
 * The walker never decides anything. It hands the engine a distribution, the
 * engine samples from it under the current sliders, and the returned index
 * selects which edge to follow. That is what makes temperature genuinely
 * change the generated text in replay mode while every step stays reproducible.
 *
 * Cadence affects presentation only. The randomness is keyed by step index
 * rather than drawn from a stream, so playing back fast, slow, or paused
 * produces exactly the same tokens.
 */
export class ReplaySource implements SamplerSource {
  readonly kind = 'replay' as const;

  /**
   * Distributions are built once per node when the fixture loads, not per
   * step. Steps arrive several times a second while the frame budget is 16.7ms,
   * so allocating a fresh candidate array on each one is avoidable garbage.
   */
  private readonly distributions = new Map<string, StepDistribution>();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly fixture: FixtureFile,
    private readonly cadenceMs: number,
  ) {
    for (const [nodeId, node] of Object.entries(fixture.nodes)) {
      if (node.eos || node.c.length === 0) continue;
      let mass = 0;
      const candidates = node.c.map(([text, logprob]) => {
        mass += Math.exp(logprob);
        return { text, logprob };
      });
      this.distributions.set(nodeId, {
        candidates,
        // Real APIs return only the top few candidates, so some probability
        // always sits outside them. The app shows this rather than implying
        // ten tokens are the whole vocabulary.
        tailMass: Math.max(0, 1 - mass),
        nodeId,
      });
    }
  }

  get promptText(): string {
    return this.fixture.prompt;
  }

  start(request: SourceRequest, sink: SourceSink): void {
    this.stop();
    this.running = true;

    let nodeId = this.resumePoint(request);

    const tick = (): void => {
      if (!this.running) return;

      const node = this.fixture.nodes[nodeId];
      if (!node || node.eos || node.c.length === 0) {
        this.running = false;
        sink.onDone('eos');
        return;
      }

      const distribution = this.distributions.get(nodeId);
      if (!distribution) {
        this.running = false;
        sink.onError(`Fixture ${this.fixture.id} has no distribution for node ${nodeId}.`);
        return;
      }

      const chosen = sink.onStep(distribution);
      if (chosen === 'halt') {
        this.running = false;
        return;
      }

      const edge = node.c[chosen];
      if (!edge) {
        this.running = false;
        sink.onError(`Fixture ${this.fixture.id} node ${nodeId} has no candidate ${chosen}.`);
        return;
      }

      nodeId = edge[2];
      this.schedule(tick);
    };

    this.schedule(tick);
  }

  /**
   * A cadence of zero means "as fast as possible", used by tests and by the
   * capture hooks that jump to a given step. It still yields between steps: the
   * engine settles status and resolves waiters between commits, and running the
   * whole generation inside the start() call would complete it before the
   * caller had a chance to await anything.
   */
  private schedule(tick: () => void): void {
    if (this.cadenceMs <= 0) queueMicrotask(tick);
    else this.timer = setTimeout(tick, this.cadenceMs);
  }

  /**
   * Re-derives a path from the entry node under a caller-supplied rule.
   *
   * Synchronous and allocation-light: ten exponentials and a comparison per
   * step, over a few dozen steps. That is what lets the whole completion be
   * redrawn inside a slider's input handler rather than merely relabelled.
   */
  walk(
    maxSteps: number,
    decide: (distribution: StepDistribution, step: number) => number,
  ): { distributions: StepDistribution[]; chosen: number[] } {
    const distributions: StepDistribution[] = [];
    const chosen: number[] = [];
    let nodeId = this.fixture.entry;

    for (let step = 0; step < maxSteps; step += 1) {
      const node = this.fixture.nodes[nodeId];
      if (!node || node.eos || node.c.length === 0) break;
      const distribution = this.distributions.get(nodeId);
      if (!distribution) break;

      const index = decide(distribution, step);
      const edge = node.c[index];
      if (!edge) break;

      distributions.push(distribution);
      chosen.push(index);
      nodeId = edge[2];
    }

    return { distributions, chosen };
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Where to resume. The last committed token records the node it came from and
   * the candidate taken, so following that edge lands on the next node. A fork
   * therefore needs no special handling here -- it is an ordinary restart with
   * a different prefix.
   */
  private resumePoint(request: SourceRequest): string {
    const last = request.prefix[request.prefix.length - 1];
    if (!last?.distribution.nodeId) return this.fixture.entry;
    const node = this.fixture.nodes[last.distribution.nodeId];
    const edge = node?.c[last.chosenIndex];
    return edge ? edge[2] : this.fixture.entry;
  }
}
