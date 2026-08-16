/**
 * A minimal stand-in for the application, used to prove the harness can fail.
 *
 * Each mock page sets window.__MOCK_DEFECTS before loading this file. The green
 * mock sets none and must pass every gate; each red mock enables exactly one
 * defect and must trip exactly the corresponding gate and no other. That
 * property is what makes a passing harness run mean something.
 */
(() => {
  const defects = window.__MOCK_DEFECTS ?? {};
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get('seed') ?? 42);

  // A tiny deterministic hash, so the mock's "generation" is reproducible for
  // the same reasons the real engine's is: no sequential state, no clock.
  function hash01(a, b, c) {
    let h = 2166136261 >>> 0;
    const text = `${a}|${b}|${c}`;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= h >>> 16;
    h = Math.imul(h, 2246822507) >>> 0;
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------- markup
  const style = document.createElement('style');
  style.textContent = `
    :root { color-scheme: light dark; }
    body { font: 14px system-ui, sans-serif; margin: 0; padding: 16px; }
    .row { display: flex; align-items: center; gap: 8px; height: 24px; }
    .track { position: relative; flex: 1; height: 10px; background: #8883; }
    .fill { position: absolute; inset: 0; transform-origin: left;
            background: #4a7; transform: scaleX(0.1);
            transition: transform 200ms linear; }
    ${
      defects.ignoreReducedMotion
        ? '/* deliberately no reduced-motion rule */'
        : '@media (prefers-reduced-motion: reduce) { .fill { transition-duration: 0s; } }'
    }
    ${defects.overflow ? '.wide { width: 3000px; height: 8px; background: #f00; }' : ''}
  `;
  document.head.append(style);

  const container = document.createElement('main');
  const fills = [];
  for (let i = 0; i < 10; i += 1) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.textContent = `tok${i}`;
    const track = document.createElement('div');
    track.className = 'track';
    const fill = document.createElement('div');
    fill.className = 'fill';
    track.append(fill);
    row.append(label, track);
    container.append(row);
    fills.push(fill);
  }
  if (defects.overflow) {
    const wide = document.createElement('div');
    wide.className = 'wide';
    container.append(wide);
  }
  document.body.append(container);

  // ---------------------------------------------------------------- defects
  if (defects.consoleNoise) {
    console.warn('mock: this warning must fail the console gate');
  }

  // Every mock animates continuously, including the green one.
  //
  // This is not decoration. Chromium skips compositor frames on a page where
  // nothing changes, so requestAnimationFrame on an idle page fires in starved
  // bursts and any percentile taken from it is meaningless. The real gate
  // measures the app while tokens stream and bars move, so the mocks have to
  // animate too or the self-test would validate a situation that never occurs.
  let phase = 0;
  const animate = () => {
    phase += 0.02;
    for (let i = 0; i < fills.length; i += 1) {
      const height = 0.5 + 0.45 * Math.sin(phase + i * 0.4);
      fills[i].style.transform = `scaleX(${height.toFixed(4)})`;
    }
    if (defects.jank) {
      // Occupies the main thread for well over a frame budget, every frame.
      const until = performance.now() + 30;
      while (performance.now() < until) {
        /* deliberately blocking */
      }
    }
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);

  // ---------------------------------------------------------------- engine
  const state = {
    status: 'idle',
    steps: [],
    branches: [{ id: 'root', parentId: null, forkStep: 0 }],
    activeBranchId: 'root',
    temperature: 1,
    topP: 1,
  };

  function makeStep(index) {
    const candidates = [];
    for (let rank = 0; rank < 10; rank += 1) {
      const raw = hash01(seed, `${state.activeBranchId}|${index}`, rank);
      const shaped = Math.exp(-rank * 0.6) * (0.85 + raw * 0.3);
      candidates.push(shaped);
    }
    const total = candidates.reduce((a, b) => a + b, 0);
    const probs = candidates.map((c) => c / total);
    const chosen = Math.floor(hash01(seed, state.activeBranchId, index) * 10);
    return {
      index,
      branchId: state.activeBranchId,
      chosenIndex: chosen,
      chosenTokenText: ` w${index}`,
      temperature: state.temperature,
      topP: state.topP,
      entropyBits: -probs.reduce((a, p) => a + p * Math.log2(p), 0),
      surprisalBits: -Math.log2(probs[chosen]),
      origin: 'sampled',
      candidates: probs.map((p, rank) => ({
        tokenText: ` t${rank}`,
        // The nondeterminism defect hides here: a value that changes run to run
        // while the visible token sequence stays identical. Screenshot
        // comparison would miss it; byte-comparing the record does not.
        pDisplayed: defects.nondeterministic ? p * (1 + Math.random() * 1e-9) : p,
        inNucleus: true,
      })),
    };
  }

  function render() {
    const step = state.steps[state.steps.length - 1];
    if (!step) return;
    for (let i = 0; i < fills.length; i += 1) {
      fills[i].style.transform = `scaleX(${step.candidates[i].pDisplayed.toFixed(6)})`;
    }
  }

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  window.__glassbox = {
    version: 1,
    deterministic: params.get('deterministic') === '1',
    ready: Promise.resolve(),
    getState: () => ({
      status: state.status,
      stepCount: state.steps.length,
      activeBranchId: state.activeBranchId,
      temperature: state.temperature,
      topP: state.topP,
    }),
    setParams: (next) => {
      if (typeof next.temperature === 'number') state.temperature = next.temperature;
      if (typeof next.topP === 'number') state.topP = next.topP;
      render();
    },
    advanceToStep: async (n) => {
      while (state.steps.length < n) state.steps.push(makeStep(state.steps.length));
      state.status = 'paused';
      render();
    },
    runToEnd: async () => {
      while (state.steps.length < 20) state.steps.push(makeStep(state.steps.length));
      state.status = 'done';
      render();
    },
    fork: async (stepIndex, altRank) => {
      state.steps = state.steps.slice(0, stepIndex);
      const id = `root/${stepIndex}.${altRank}`;
      state.branches.push({ id, parentId: state.activeBranchId, forkStep: stepIndex });
      state.activeBranchId = id;
      const forced = makeStep(stepIndex);
      forced.chosenIndex = altRank;
      forced.origin = 'forced';
      state.steps.push(forced);
      render();
    },
    startDemo: async () => {
      await window.__glassbox.runToEnd();
    },
    serializeRun: () => ({
      fixtureId: 'mock',
      seed,
      engineVersion: 'mock-1',
      steps: state.steps,
      branches: state.branches,
      activeBranchId: state.activeBranchId,
      finalText: state.steps.map((s) => s.chosenTokenText).join(''),
    }),
    getEffectiveMotion: () => ({
      // The motion mock deliberately CLAIMS to honour reduced motion while its
      // stylesheet does not. If the harness trusted this self-report, the lie
      // would pass; the independent computed-style audit is what catches it.
      reduced: reducedMotion,
      maxTransitionMs: reducedMotion ? 0 : 200,
      maxAnimationMs: 0,
    }),
  };
})();
