import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { ReplaySource } from '../sources/replay';
import type { FixtureFile } from './types';

/**
 * The coupled cluster's invariants: determinism, the sliders genuinely changing
 * the sampled path, and forking that leaves the line it branched from intact.
 *
 * These are the properties the browser-level determinism gate depends on. Proving
 * them here means a failure in that gate points at the UI or the harness rather
 * than at the engine.
 */

/** A synthetic lattice. Every candidate carries a continuation, exactly as the
 *  shipped fixtures do, so any of them can be forked into. */
function makeLattice(steps: number): FixtureFile {
  const nodes: Record<string, FixtureFile['nodes'][string]> = {};
  for (let step = 0; step < steps; step += 1) {
    const next = step === steps - 1 ? 'end' : `n${step + 1}`;
    nodes[`n${step}`] = {
      c: Array.from({ length: 10 }, (_, rank) => {
        // A Zipf-ish spread, varied per step so the draws are not all alike.
        const logprob = -0.15 - rank * 0.55 - (step % 3) * 0.08;
        return [` t${step}_${rank}`, logprob, next] as const;
      }),
    };
  }
  nodes['end'] = { c: [], eos: true };

  return {
    version: 1,
    id: 'test-lattice',
    label: 'test',
    description: 'synthetic lattice for engine tests',
    prompt: 'test prompt',
    k: 10,
    entry: 'n0',
    nodes,
  };
}

const FIXTURE = makeLattice(24);

function makeEngine(seed: number, temperature: number, topP = 1): Engine {
  return new Engine({ seed, settings: { temperature, topP }, prompt: FIXTURE.prompt });
}

const source = (): ReplaySource => new ReplaySource(FIXTURE, 0);

async function runFully(engine: Engine): Promise<string> {
  await engine.runToEnd(source());
  return engine.text();
}

describe('replay determinism', () => {
  it('produces identical text for the same seed and settings', async () => {
    const first = await runFully(makeEngine(42, 0.9));
    const second = await runFully(makeEngine(42, 0.9));
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('produces different text for a different seed', async () => {
    const a = await runFully(makeEngine(42, 1.2));
    const b = await runFully(makeEngine(7, 1.2));
    expect(a).not.toBe(b);
  });

  it('is unaffected by playback cadence', async () => {
    // Cadence must be presentation only. The draws are keyed by step index
    // rather than pulled from a stream, so time cannot leak into the content.
    const fast = makeEngine(42, 1.1);
    await fast.runToEnd(new ReplaySource(FIXTURE, 0));
    const slow = makeEngine(42, 1.1);
    await slow.runToEnd(new ReplaySource(FIXTURE, 3));
    expect(slow.text()).toBe(fast.text());
  });
});

describe('the sliders are generative, not decorative', () => {
  it('temperature changes which tokens are drawn', async () => {
    const cold = await runFully(makeEngine(42, 0.05));
    const hot = await runFully(makeEngine(42, 2));
    expect(cold).not.toBe(hot);
  });

  it('near-zero temperature always takes the leading candidate', async () => {
    const engine = makeEngine(42, 0.005);
    await runFully(engine);
    for (const record of engine.chainTokens()) {
      expect(record.chosenIndex).toBe(0);
    }
  });

  it('top-p confines draws to the nucleus', async () => {
    // With a tight nucleus every committed token must come from inside it;
    // drawing an excluded candidate would contradict the cutoff on screen.
    const engine = makeEngine(42, 1.5, 0.35);
    await runFully(engine);
    for (const record of engine.chainTokens()) {
      const display = engine.computeDisplay(record.distribution, record.settings);
      expect(record.chosenIndex).toBeLessThan(display.nucleusSize);
    }
  });

  it('freezes each token\'s statistics at the moment it was committed', async () => {
    const engine = makeEngine(42, 0.6);
    await runFully(engine);
    const before = engine.chainTokens().map((r) => r.chosenProb);

    // Moving a slider afterwards reshapes the live view, but must not rewrite
    // what the sampler actually faced.
    engine.setSettings({ temperature: 2, topP: 0.5 });
    expect(engine.chainTokens().map((r) => r.chosenProb)).toEqual(before);
  });
});

describe('forking', () => {
  it('keeps the shared prefix and commits the chosen candidate', async () => {
    const engine = makeEngine(42, 0.9);
    await runFully(engine);
    const original = engine.chainTokens();
    const prefix = original.slice(0, 6).map((r) => r.chosenIndex);

    engine.fork('root', 6, 3, source());
    await engine.runToEnd(source());

    const forked = engine.chainTokens();
    expect(forked.slice(0, 6).map((r) => r.chosenIndex)).toEqual(prefix);
    expect(forked[6]?.chosenIndex).toBe(3);
    expect(forked[6]?.origin).toBe('forced');
  });

  it('leaves the branch it forked from untouched', async () => {
    // This is what the keyed RNG buys. With a sequential generator, consuming
    // draws on a branch would shift every subsequent draw on the parent.
    const engine = makeEngine(42, 0.9);
    await runFully(engine);
    const rootText = engine.text('root');

    engine.fork('root', 5, 2, source());
    await engine.runToEnd(source());

    expect(engine.text('root')).toBe(rootText);
    expect(engine.text()).not.toBe(rootText);
  });

  it('names branches for where they diverged and what they took', async () => {
    const engine = makeEngine(42, 0.9);
    await runFully(engine);
    const branch = engine.fork('root', 4, 7, source());
    expect(branch.id).toBe('root/4.7');
    expect(branch.parentId).toBe('root');
    expect(branch.forkStep).toBe(4);
  });

  it('supports forking a branch that was itself a fork', async () => {
    const engine = makeEngine(42, 0.9);
    await runFully(engine);
    engine.fork('root', 5, 1, source());
    await engine.runToEnd(source());

    const nested = engine.fork('root/5.1', 8, 2, source());
    await engine.runToEnd(source());

    expect(nested.id).toBe('root/5.1/8.2');
    // The chain must still assemble correctly through two levels of parentage.
    expect(engine.chainTokens()[8]?.chosenIndex).toBe(2);
    expect(engine.chainLength()).toBeGreaterThan(8);
  });

  it('reproduces the same branch text when the same fork is taken again', async () => {
    const run = async (): Promise<string> => {
      const engine = makeEngine(42, 1.1);
      await runFully(engine);
      engine.fork('root', 7, 4, source());
      await engine.runToEnd(source());
      return engine.text();
    };
    expect(await run()).toBe(await run());
  });
});

describe('branch bookkeeping', () => {
  it('returns to an earlier branch without losing either line', async () => {
    const engine = makeEngine(42, 0.9);
    await runFully(engine);
    const rootText = engine.text('root');

    const branch = engine.fork('root', 6, 2, source());
    await engine.runToEnd(source());
    const branchText = engine.text(branch.id);

    engine.switchBranch('root');
    expect(engine.text()).toBe(rootText);

    engine.switchBranch(branch.id);
    expect(engine.text()).toBe(branchText);
  });

  it('reports chain length as fork point plus own suffix', async () => {
    const engine = makeEngine(42, 0.9);
    await runFully(engine);
    const rootLength = engine.chainLength();

    engine.fork('root', 3, 1, source());
    expect(engine.chainLength()).toBe(4);

    await engine.runToEnd(source());
    expect(engine.chainLength()).toBeGreaterThan(4);
    expect(rootLength).toBeGreaterThan(0);
  });
});
