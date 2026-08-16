import type { Engine } from '../engine/engine';
import { ENGINE_VERSION } from '../engine/engine';
import type { RunRecord, SerializedCandidate, SerializedStep } from '../../harness/hooks';

/**
 * The test surface, implementing the contract in harness/hooks.d.ts.
 *
 * Note what is NOT here: any frame-timing report. The harness injects its own
 * probe, because a page grading its own smoothness is not evidence of
 * smoothness. The optional `?hud=1` overlay below is a development aid and is
 * never read as a gate.
 *
 * The mutating hooks exist for the determinism schedule, where two runs must
 * receive identical parameter values and a pixel drag cannot promise that.
 * Every other gate drives the real controls.
 */

export interface HookDependencies {
  engine: Engine;
  fixtureId: string;
  deterministic: boolean;
  ready: Promise<void>;
  advanceToStep: (n: number) => Promise<void>;
  runToEnd: () => Promise<void>;
  fork: (stepIndex: number, altRank: number) => Promise<void>;
  startDemo: () => Promise<void>;
  setParams: (params: { temperature?: number; topP?: number }) => void;
}

export function installHooks(dependencies: HookDependencies): void {
  const { engine } = dependencies;

  const serializeRun = (): RunRecord => {
    const state = engine.getState();
    const chain = engine.chainTokens();

    const steps: SerializedStep[] = chain.map((record) => {
      const display = engine.computeDisplay(record.distribution, record.settings);
      const candidates: SerializedCandidate[] = record.distribution.candidates.map(
        (candidate, index) => ({
          tokenText: candidate.text,
          // Full float64 precision on purpose. Rounding here would paper over
          // exactly the drift the determinism gate exists to catch.
          pDisplayed:
            index < display.nucleusSize
              ? (display.nucleusProbs[index] ?? 0)
              : (display.probs[index] ?? 0),
          inNucleus: index < display.nucleusSize,
        }),
      );

      return {
        index: record.step,
        branchId: state.activeBranchId,
        chosenIndex: record.chosenIndex,
        chosenTokenText: record.distribution.candidates[record.chosenIndex]?.text ?? '',
        temperature: record.settings.temperature,
        topP: record.settings.topP,
        entropyBits: record.entropyBits,
        surprisalBits: record.surprisalBits,
        origin: record.origin,
        candidates,
      };
    });

    return {
      fixtureId: dependencies.fixtureId,
      seed: state.seed,
      engineVersion: ENGINE_VERSION,
      steps,
      // Map iteration follows insertion order, so this array is stable.
      branches: [...state.branches.values()].map((branch) => ({
        id: branch.id,
        parentId: branch.parentId,
        forkStep: branch.forkStep,
      })),
      activeBranchId: state.activeBranchId,
      finalText: engine.text(),
    };
  };

  window.__glassbox = {
    version: 1,
    deterministic: dependencies.deterministic,
    ready: dependencies.ready,

    getState() {
      const state = engine.getState();
      return {
        status: state.status,
        stepCount: engine.chainLength(),
        activeBranchId: state.activeBranchId,
        temperature: state.settings.temperature,
        topP: state.settings.topP,
      };
    },

    setParams: dependencies.setParams,
    advanceToStep: dependencies.advanceToStep,
    runToEnd: dependencies.runToEnd,
    fork: dependencies.fork,
    startDemo: dependencies.startDemo,
    serializeRun,

    getEffectiveMotion() {
      // Reported from the computed styles of a real animated element rather
      // than from a flag. A boolean can drift out of step with the stylesheet;
      // asking the element what it will actually do cannot.
      const sample = document.querySelector('.bar-fill');
      const parse = (value: string): number =>
        value
          .split(',')
          .map((part) => {
            const trimmed = part.trim();
            if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed);
            if (trimmed.endsWith('s')) return Number.parseFloat(trimmed) * 1000;
            return 0;
          })
          .reduce((max, current) => Math.max(max, current), 0);

      const styles = sample ? getComputedStyle(sample) : null;
      return {
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        maxTransitionMs: styles ? parse(styles.transitionDuration) : 0,
        maxAnimationMs: styles ? parse(styles.animationDuration) : 0,
      };
    },
  };
}
