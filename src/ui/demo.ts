/**
 * The scripted showcase, bound to the "d" key.
 *
 * It drives the same intents a person would: start the stream, sweep the
 * temperature, pick a step, fork it, run the branch out. Nothing here reaches
 * past the public surface, so the recording is evidence of the real app rather
 * than of a special demo path.
 *
 * Under reduced motion the continuous sweep becomes a few discrete settings.
 * The point of the sweep is to show the distribution reshaping, and that reads
 * perfectly well as three steps -- while a two-second animated slide is exactly
 * what a reduced-motion preference is asking us not to do.
 */

export interface DemoDependencies {
  start: () => void;
  pause: () => void;
  reset: () => void;
  setTemperature: (value: number) => void;
  setTopP: (value: number) => void;
  select: (step: number) => void;
  fork: (step: number, rank: number) => Promise<void>;
  runToEnd: () => Promise<void>;
  stepCount: () => number;
  highlight: (region: string | null) => void;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function createDemo(dependencies: DemoDependencies): {
  run: () => Promise<void>;
  cancel: () => void;
  readonly running: boolean;
} {
  let cancelled = false;
  let running = false;

  const guard = (): boolean => cancelled;

  async function waitForTokens(target: number, timeoutMs = 12_000): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (dependencies.stepCount() < target && performance.now() < deadline && !cancelled) {
      await sleep(80);
    }
  }

  /** Eases a slider from a to b, or jumps in thirds when motion is reduced. */
  async function sweep(
    apply: (value: number) => void,
    from: number,
    to: number,
    durationMs: number,
  ): Promise<void> {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const t of [0.34, 0.67, 1]) {
        if (guard()) return;
        apply(from + (to - from) * t);
        await sleep(durationMs / 3);
      }
      return;
    }

    const start = performance.now();
    return new Promise<void>((resolve) => {
      const tick = (): void => {
        if (guard()) return resolve();
        const progress = Math.min(1, (performance.now() - start) / durationMs);
        // Ease in and out so the sweep looks deliberate rather than mechanical.
        const eased = progress < 0.5
          ? 2 * progress * progress
          : 1 - (-2 * progress + 2) ** 2 / 2;
        apply(from + (to - from) * eased);
        if (progress >= 1) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  return {
    get running() {
      return running;
    },

    cancel() {
      cancelled = true;
      dependencies.highlight(null);
    },

    async run() {
      if (running) return;
      running = true;
      cancelled = false;

      try {
        dependencies.reset();
        dependencies.setTemperature(0.7);
        dependencies.setTopP(1);
        await sleep(400);
        if (guard()) return;

        // 1. Watch it stream at a settled temperature.
        dependencies.highlight('stream');
        dependencies.start();
        await waitForTokens(14);
        if (guard()) return;
        dependencies.pause();
        await sleep(600);

        // 2. Temperature: flatten the distribution, then sharpen it.
        dependencies.highlight('temperature');
        await sweep(dependencies.setTemperature, 0.7, 2, 2600);
        if (guard()) return;
        await sleep(700);
        await sweep(dependencies.setTemperature, 2, 0.15, 2200);
        if (guard()) return;
        await sleep(700);
        await sweep(dependencies.setTemperature, 0.15, 0.85, 900);

        // 3. Top-p: watch the nucleus close.
        dependencies.highlight('top-p');
        await sweep(dependencies.setTopP, 1, 0.35, 2000);
        if (guard()) return;
        await sleep(800);
        await sweep(dependencies.setTopP, 0.35, 0.92, 900);
        if (guard()) return;

        // 4. Fork from an earlier step and run the new branch out.
        dependencies.highlight('fork');
        const forkStep = Math.max(0, Math.min(9, dependencies.stepCount() - 4));
        dependencies.select(forkStep);
        await sleep(900);
        if (guard()) return;
        await dependencies.fork(forkStep, 1);
        await sleep(400);
        if (guard()) return;

        dependencies.highlight('stream');
        await dependencies.runToEnd();
      } finally {
        dependencies.highlight(null);
        running = false;
      }
    },
  };
}
