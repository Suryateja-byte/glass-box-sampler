import { Engine } from '../engine/engine';
import type { FixtureFile, SamplerSource } from '../engine/types';
import { K } from '../engine/types';
import { LiveSource, clearApiKey, setApiKey } from '../sources/live';
import { ReplaySource } from '../sources/replay';
import { mountBars } from './bars';
import { mountControls, type FixtureOption } from './controls';
import { COPY } from './copy';
import { createDemo } from './demo';
import { installHooks } from './metrics';
import { Dirty, FrameScheduler } from './raf';
import { mountSliders } from './sliders';
import { mountStats } from './stats';
import { mountStream, mountSurprisalLegend } from './stream';
import { mountTrail } from './trail';

/**
 * Wires the engine to the renderers.
 *
 * All the hot paths converge here on one rule: nothing writes to the DOM except
 * the frame scheduler. Engine events and input handlers only set dirty flags, so
 * a token arriving in the same frame as a slider move costs one write pass
 * rather than two, and a read can never interleave with a write to force layout.
 */

export interface AppOptions {
  root: HTMLElement;
  /** id, label and prompt for the picker, without loading every lattice. */
  catalog: readonly FixtureOption[];
  initialFixture: FixtureFile;
  /** Fixtures are fetched on demand so only the one in use costs anything. */
  loadFixture: (id: string) => Promise<FixtureFile>;
  seed: number;
  cadenceMs: number;
  deterministic: boolean;
}

export function createApp(options: AppOptions): void {
  const { root } = options;

  let fixture = options.initialFixture;
  let source: SamplerSource = new ReplaySource(fixture, options.cadenceMs);
  let mode: 'replay' | 'live' = 'replay';
  let liveConfig = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };

  const engine = new Engine({
    seed: options.seed,
    settings: { temperature: 0.8, topP: 1 },
    prompt: fixture.prompt,
  });

  const scheduler = new FrameScheduler();

  // ------------------------------------------------------------------ layout

  const header = document.createElement('header');
  header.className = 'app-header';
  const title = document.createElement('h1');
  title.className = 'app-title';
  title.textContent = COPY.app.title;
  const subtitle = document.createElement('p');
  subtitle.className = 'app-subtitle';
  subtitle.textContent = COPY.app.subtitle;
  header.append(title, subtitle);

  const bars = mountBars({
    regionLabel: COPY.a11y.candidatesRegion,
    rowDescription: (token, percent, rank) =>
      `${COPY.a11y.forkButton(token)}. Rank ${rank}, ${percent}`,
    excludedSuffix: ', excluded by top-p',
    droppedMark: '—',
    columnToken: 'token',
    columnProbability: 'p',
    columnCumulative: 'Σp',
    columnAfter: 'after',
  });

  const stream = mountStream({
    regionLabel: COPY.a11y.completionRegion,
    tokenTitle: (token, probability, bits) =>
      `${COPY.a11y.spokenToken(token)} · ${probability} · ${bits} bits surprisal`,
    placeholder: COPY.idle.title,
  });

  const stats = mountStats({
    entropyLabel: COPY.entropy.label,
    entropyHint: COPY.entropy.explain,
    chosenLabel: 'Chosen p',
    chosenHint:
      'The probability these settings give the token that was committed. It moves with the sliders, like the accent bar above it; what the sampler actually faced is recorded on the token itself.',
    nucleusLabel: 'Nucleus',
    nucleusHint: COPY.topP.explain,
    tailLabel: COPY.candidates.tailLabel,
    tailHint: COPY.candidates.headOnly,
    empty: '—',
  });

  const trail = mountTrail({
    regionLabel: COPY.a11y.branchesRegion,
    rootLabel: COPY.branches.root,
    branchLabel: (token, step) => `${token} @ ${step}`,
    branchTitle: (token, step) => `${COPY.branches.explain} (${token}, step ${step})`,
  });

  const sliders = mountSliders(
    {
      temperatureLabel: COPY.temperature.label,
      temperatureHint: COPY.temperature.explain,
      temperatureValueText: COPY.a11y.temperatureValueText,
      topPLabel: COPY.topP.label,
      topPHint: COPY.topP.explain,
      topPValueText: COPY.a11y.topPValueText,
    },
    engine.getState().settings,
    {
      onChange: (patch) => {
        // The whole one-frame claim lives in these two lines: update state,
        // mark dirty, return. The rAF requested here runs in this same frame.
        engine.setSettings(patch);
        scheduler.mark(Dirty.Bars | Dirty.Stats);
      },
      onDragStateChange: (dragging) => bars.setDragging(dragging),
    },
  );

  const fixtureOptions = options.catalog;

  const controls = mountControls(
    {
      promptLabel: COPY.sections.prompt,
      promptHint: COPY.source.replayExactness,
      fixtureLabel: 'Fixture',
      runLabel: COPY.buttons.run,
      pauseLabel: COPY.buttons.pause,
      resumeLabel: COPY.buttons.resume,
      resetLabel: COPY.buttons.reset,
      demoHint: 'Press D for the demo',
      sourceLabel: COPY.source.heading,
      replayOption: COPY.source.replay.label,
      liveOption: COPY.source.live.label,
      liveNotice: COPY.source.liveHonesty,
      baseUrlLabel: 'Base URL',
      modelLabel: 'Model',
      apiKeyLabel: 'API key',
      apiKeyHint: 'Held in memory for this tab only. Never stored.',
    },
    fixtureOptions,
    { fixtureId: fixture.id, prompt: fixture.prompt },
    {
      onRun: () => startOrResume(),
      onPause: () => engine.pause(),
      onReset: () => resetAll(),
      onFixtureChange: (id) => {
        void options.loadFixture(id).then(
          (next) => {
            fixture = next;
            controls.setPrompt(next.prompt);
            resetAll(next.prompt);
          },
          (error: unknown) => {
            controls.showError(
              COPY.errors.unknown(error instanceof Error ? error.message : String(error)),
            );
          },
        );
      },
      onPromptChange: () => {
        /* Replay fixtures are keyed to their own prompt; editing is a live-mode
           affordance and takes effect on the next run. */
      },
      onSourceChange: (next) => {
        mode = next;
        engine.pause();
        source = makeSource();
      },
      onLiveConfigChange: (config) => {
        if (config.baseUrl !== undefined) liveConfig.baseUrl = config.baseUrl;
        if (config.model !== undefined) liveConfig.model = config.model;
        if (config.apiKey !== undefined) {
          if (config.apiKey) setApiKey(config.apiKey);
          else clearApiKey();
        }
        source = makeSource();
      },
    },
  );

  // Panels ------------------------------------------------------------------

  const panel = (heading: string, hint: string | null, ...children: Node[]): HTMLElement => {
    const section = document.createElement('section');
    section.className = 'panel';
    const h = document.createElement('h2');
    h.className = 'panel-title';
    h.textContent = heading;
    section.append(h);
    if (hint) {
      const p = document.createElement('p');
      p.className = 'panel-hint';
      p.textContent = hint;
      section.append(p);
    }
    section.append(...children);
    return section;
  };

  const tailCaption = document.createElement('p');
  tailCaption.className = 'tail-caption';
  tailCaption.dataset['testid'] = 'tail-caption';

  const liveRegion = document.createElement('div');
  liveRegion.className = 'visually-hidden';
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');

  const layout = document.createElement('div');
  layout.className = 'layout';
  layout.append(
    panel(COPY.sections.controls, null, controls.element, sliders.element),
    panel(COPY.sections.candidates, COPY.candidates.explain(K), bars.element, tailCaption, stats.element),
    panel(
      COPY.sections.completion,
      COPY.fork.hint,
      trail.element,
      stream.element,
      mountSurprisalLegend({
        title: COPY.surprisal.label,
        low: COPY.surprisal.legendLow,
        high: COPY.surprisal.legendHigh,
        encoding: COPY.surprisal.encoding,
      }),
    ),
  );

  root.append(header, layout, liveRegion);

  // ------------------------------------------------------------- render pass

  scheduler.register(Dirty.Bars, () => {
    const record = engine.selectedRecord();
    if (!record) {
      bars.update(null, null, null);
      tailCaption.textContent = '';
      return;
    }
    const display = engine.computeDisplay(record.distribution, engine.getState().settings);
    bars.update(record.distribution, display, record.chosenIndex);
    // When top-p has cut the list there are two normalisations on screen, so
    // the caption names them. Otherwise the ghosts sit exactly under the fills
    // and there is nothing extra to explain.
    // When a cut is in force, say in words exactly what the Σp column shows:
    // which rank first reached the threshold, and therefore why the line is
    // where it is. The reader should never have to do the addition themselves.
    const settings = engine.getState().settings;
    if (display.nucleusSize < display.count) {
      let reached = 0;
      for (let i = 0; i < display.nucleusSize; i += 1) reached += display.probs[i] ?? 0;
      tailCaption.textContent =
        COPY.candidates.cutExplain(
          settings.topP,
          display.nucleusSize,
          Math.min(1, reached),
          display.count,
        ) +
        ' ' +
        COPY.candidates.tailExplain(record.distribution.tailMass);
    } else {
      tailCaption.textContent = COPY.candidates.tailExplain(record.distribution.tailMass);
    }
  });

  scheduler.register(Dirty.Stats, () => {
    const record = engine.selectedRecord();
    if (!record) {
      stats.update(null, null, null);
      return;
    }
    const display = engine.computeDisplay(record.distribution, engine.getState().settings);
    stats.update(record.distribution, display, record);
  });

  scheduler.register(Dirty.Stream, () => {
    const state = engine.getState();
    stream.sync(engine.chainTokens(), state.selectedStep?.step ?? null);
  });

  scheduler.register(Dirty.Trail, () => trail.update(engine.getState()));

  scheduler.register(Dirty.Controls, () => {
    const state = engine.getState();
    controls.setStatus(state.status);
    controls.showError(state.error);
    sliders.reflect(state.settings);
  });

  // ------------------------------------------------------------------ events

  engine.on((event) => {
    switch (event.type) {
      case 'token':
        scheduler.mark(Dirty.Bars | Dirty.Stats | Dirty.Stream);
        // Announced per token, never per frame: at streaming cadence a longer
        // message would queue faster than a screen reader can speak it.
        liveRegion.textContent = COPY.a11y.committedToken(
          event.record.distribution.candidates[event.record.chosenIndex]?.text ?? '',
          event.record.chosenProb,
          event.record.surprisalBits,
        );
        break;
      case 'fork':
        scheduler.mark(Dirty.Trail | Dirty.Stream | Dirty.Bars | Dirty.Stats);
        break;
      case 'select':
        scheduler.mark(Dirty.Bars | Dirty.Stats | Dirty.Stream);
        break;
      case 'settings':
        scheduler.mark(Dirty.Bars | Dirty.Stats | Dirty.Controls);
        break;
      case 'status':
      case 'error':
        scheduler.mark(Dirty.Controls);
        break;
      case 'reset':
        stream.clear();
        scheduler.mark(Dirty.All);
        break;
    }
  });

  bars.onFork((rank) => {
    const state = engine.getState();
    const step = state.selectedStep?.step ?? engine.chainLength() - 1;
    if (step < 0) return;
    engine.fork(state.selectedStep?.branchId ?? state.activeBranchId, step, rank, makeSource());
  });

  stream.onSelect((step) => {
    engine.select({ branchId: engine.getState().activeBranchId, step });
  });

  trail.onSelectBranch((branchId) => {
    engine.switchBranch(branchId);
    scheduler.mark(Dirty.All);
  });

  // ------------------------------------------------------------------ helpers

  function makeSource(): SamplerSource {
    return mode === 'replay'
      ? new ReplaySource(fixture, options.cadenceMs)
      : new LiveSource({ baseUrl: liveConfig.baseUrl, model: liveConfig.model });
  }

  function startOrResume(): void {
    source = makeSource();
    engine.select(null);
    engine.start(source);
  }

  function resetAll(prompt?: string): void {
    engine.reset(prompt);
    source = makeSource();
  }

  // --------------------------------------------------------------- demo mode

  const demo = createDemo({
    start: () => startOrResume(),
    pause: () => engine.pause(),
    reset: () => resetAll(),
    setTemperature: (value) => {
      engine.setSettings({ temperature: value });
      scheduler.mark(Dirty.Bars | Dirty.Stats | Dirty.Controls);
    },
    setTopP: (value) => {
      engine.setSettings({ topP: value });
      scheduler.mark(Dirty.Bars | Dirty.Stats | Dirty.Controls);
    },
    select: (step) => engine.select({ branchId: engine.getState().activeBranchId, step }),
    fork: async (step, rank) => {
      engine.fork(engine.getState().activeBranchId, step, rank, makeSource());
    },
    runToEnd: () => engine.runToEnd(makeSource()),
    stepCount: () => engine.chainLength(),
    highlight: (region) => {
      root.dataset['demoFocus'] = region ?? '';
    },
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'd' && event.key !== 'D') return;
    const target = event.target as HTMLElement | null;
    // Never steal the key from someone typing a prompt or an API key.
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    void demo.run();
  });

  // ------------------------------------------------------------------- hooks

  installHooks({
    engine,
    fixtureId: fixture.id,
    deterministic: options.deterministic,
    ready: Promise.resolve(),
    setParams: (params) => {
      engine.setSettings(params);
      scheduler.mark(Dirty.Bars | Dirty.Stats | Dirty.Controls);
    },
    advanceToStep: (n) => engine.advanceToStep(n, makeSource()),
    runToEnd: () => engine.runToEnd(makeSource()),
    fork: async (stepIndex, altRank) => {
      engine.fork(engine.getState().activeBranchId, stepIndex, altRank, makeSource());
    },
    startDemo: () => demo.run(),
  });

  // The first render is flushed synchronously rather than waiting for a frame.
  // A browser that is not compositing -- a background tab, a hidden pane -- may
  // not run requestAnimationFrame at all, and an app whose initial paint hangs
  // off one would show nothing until it became visible. Every later write still
  // goes through the frame scheduler.
  scheduler.mark(Dirty.All);
  scheduler.flushNow();
}
