/**
 * Prompt, source selection and transport controls.
 *
 * The live-mode key field is a password input that is never persisted: no
 * localStorage, no sessionStorage, no cookie, no URL. It lives in a variable in
 * the live adapter for as long as the tab is open and is cleared on pagehide.
 * Anything else would leave a credential on a machine after the visitor left.
 */

export interface ControlLabels {
  promptLabel: string;
  promptHint: string;
  fixtureLabel: string;
  runLabel: string;
  pauseLabel: string;
  resumeLabel: string;
  resetLabel: string;
  demoHint: string;
  sourceLabel: string;
  replayOption: string;
  liveOption: string;
  liveNotice: string;
  baseUrlLabel: string;
  modelLabel: string;
  apiKeyLabel: string;
  apiKeyHint: string;
  /** Spoken and shown on the status dot, one per engine state. */
  statusLabels: Record<ControlStatus, string>;
  /** `N / 256` under the prompt box. */
  charCount: (used: number, limit: number) => string;
}

export type ControlStatus = 'idle' | 'streaming' | 'paused' | 'done' | 'error';

/**
 * The prompt limit. It only binds in live mode -- replay prompts are fixed by
 * their fixture and the field is read-only there -- but the counter is shown in
 * both, because a field that silently stops accepting characters is worse than
 * one that says where the end is.
 */
const PROMPT_LIMIT = 256;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A 16px glyph from a path.
 *
 * Returns the path element alongside the svg so a caller can rewrite `d` in
 * place: the Run button swaps between play and pause, and replacing the whole
 * icon on every status change would churn the DOM on a control that is already
 * being relabelled.
 */
function icon(d: string): { svg: SVGSVGElement; path: SVGPathElement } {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return { svg, path };
}

const ICON_PLAY = 'M4.5 2.75 13 8l-8.5 5.25Z';
const ICON_PAUSE = 'M4.5 3h2.75v10H4.5Zm4.25 0h2.75v10H8.75Z';
/** An arrow bent back on itself: start again from the top. */
const ICON_RESET =
  'M8 3.4a4.6 4.6 0 1 0 4.4 3.26l1.34-.4A6 6 0 1 1 8 2v1.4Zm-.7-2.65 2.6 1.9-2.6 1.9Z';

export interface FixtureOption {
  id: string;
  label: string;
  prompt: string;
}

export interface ControlsHandle {
  readonly element: HTMLElement;
  /**
   * Where the sliders go. They are a separate component with its own grid, but
   * they belong in the middle of this stack rather than after it, so the panel
   * hands out the position instead of the caller stacking two siblings.
   */
  readonly slidersSlot: HTMLElement;
  setStatus(status: ControlStatus): void;
  setPrompt(text: string): void;
  /**
   * Replay fixtures are keyed to their own prompt, so the field is read-only
   * there and editable only in live mode.
   *
   * It was previously editable in both. You could type a new prompt, press Run,
   * and get the old fixture streamed back at you under a full panel of correct
   * arithmetic describing a prompt that was no longer on screen. A control that
   * looks live and is silently inert is worse than no control.
   */
  setPromptEditable(editable: boolean, note: string): void;
  readonly promptValue: string;
  showError(message: string | null): void;
}

export function mountControls(
  labels: ControlLabels,
  fixtures: readonly FixtureOption[],
  initial: { fixtureId: string; prompt: string },
  handlers: {
    onRun: () => void;
    onPause: () => void;
    onReset: () => void;
    onFixtureChange: (id: string) => void;
    onPromptChange: (text: string) => void;
    onSourceChange: (source: 'replay' | 'live') => void;
    onLiveConfigChange: (config: { baseUrl?: string; model?: string; apiKey?: string }) => void;
  },
): ControlsHandle {
  const element = document.createElement('section');
  element.className = 'controls';
  element.dataset['testid'] = 'controls';

  // --- prompt ---------------------------------------------------------------
  const promptField = document.createElement('div');
  promptField.className = 'field';

  const promptLabel = document.createElement('label');
  promptLabel.className = 'field-label';
  promptLabel.htmlFor = 'prompt-input';
  promptLabel.textContent = labels.promptLabel;

  // The textarea sits in a positioned wrapper so the status dot can hang in its
  // bottom-right corner without being a sibling that pushes layout around.
  const promptWrap = document.createElement('div');
  promptWrap.className = 'prompt-wrap';

  const prompt = document.createElement('textarea');
  prompt.id = 'prompt-input';
  prompt.dataset['testid'] = 'prompt-input';
  prompt.className = 'prompt-input';
  prompt.rows = 2;
  prompt.spellcheck = false;
  prompt.maxLength = PROMPT_LIMIT;
  prompt.value = initial.prompt;
  prompt.setAttribute('aria-describedby', 'prompt-hint');

  /**
   * Engine state, as a dot.
   *
   * Colour is a summary here, never the carrier: the same state is already in
   * the Run button's label, in the error banner's alert, and in this element's
   * own title and text, which is why the dot can be three hues without putting
   * anything out of reach of a reader who cannot tell them apart.
   */
  const statusDot = document.createElement('span');
  statusDot.className = 'status-dot';
  statusDot.dataset['status'] = 'idle';
  statusDot.title = labels.statusLabels.idle;

  const statusText = document.createElement('span');
  statusText.className = 'visually-hidden';
  statusText.textContent = labels.statusLabels.idle;
  statusDot.append(statusText);

  promptWrap.append(prompt, statusDot);

  const counter = document.createElement('p');
  counter.className = 'char-counter';
  // The limit is already machine-readable on the field itself, so this is a
  // sighted-reader convenience and would only be noise read aloud.
  counter.setAttribute('aria-hidden', 'true');

  const syncCounter = (): void => {
    counter.textContent = labels.charCount(prompt.value.length, PROMPT_LIMIT);
  };
  syncCounter();

  prompt.addEventListener('input', () => {
    syncCounter();
    handlers.onPromptChange(prompt.value);
  });

  const promptHint = document.createElement('p');
  promptHint.className = 'field-hint';
  promptHint.id = 'prompt-hint';
  promptHint.textContent = labels.promptHint;

  promptField.append(promptLabel, promptWrap, counter, promptHint);

  // --- fixture picker -------------------------------------------------------
  const fixtureField = document.createElement('div');
  fixtureField.className = 'field';

  const fixtureLabel = document.createElement('label');
  fixtureLabel.className = 'field-label';
  fixtureLabel.htmlFor = 'fixture-select';
  fixtureLabel.textContent = labels.fixtureLabel;

  const fixtureSelect = document.createElement('select');
  fixtureSelect.id = 'fixture-select';
  fixtureSelect.dataset['testid'] = 'fixture-select';
  fixtureSelect.className = 'select';
  for (const fixture of fixtures) {
    const option = document.createElement('option');
    option.value = fixture.id;
    option.textContent = fixture.label;
    if (fixture.id === initial.fixtureId) option.selected = true;
    fixtureSelect.append(option);
  }
  fixtureSelect.addEventListener('change', () => handlers.onFixtureChange(fixtureSelect.value));

  fixtureField.append(fixtureLabel, fixtureSelect);

  // --- transport ------------------------------------------------------------
  const transport = document.createElement('div');
  transport.className = 'transport';

  // Both buttons carry an icon, so their text lives in a span. Writing
  // `button.textContent` on a status change -- which is what this used to do --
  // would replace the icon along with the word.
  const run = document.createElement('button');
  run.type = 'button';
  run.className = 'button button-primary';
  run.dataset['testid'] = 'run';
  const runIcon = icon(ICON_PLAY);
  const runLabel = document.createElement('span');
  runLabel.className = 'button-label';
  runLabel.textContent = labels.runLabel;
  run.append(runIcon.svg, runLabel);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'button';
  reset.dataset['testid'] = 'reset';
  const resetLabel = document.createElement('span');
  resetLabel.className = 'button-label';
  resetLabel.textContent = labels.resetLabel;
  reset.append(icon(ICON_RESET).svg, resetLabel);
  reset.addEventListener('click', handlers.onReset);

  const demoHint = document.createElement('span');
  demoHint.className = 'demo-hint';
  demoHint.textContent = labels.demoHint;

  transport.append(run, reset, demoHint);

  let status: ControlStatus = 'idle';
  run.addEventListener('click', () => {
    if (status === 'streaming') handlers.onPause();
    else handlers.onRun();
  });

  // --- source ---------------------------------------------------------------
  const sourceField = document.createElement('fieldset');
  sourceField.className = 'field field-source';

  const sourceLegend = document.createElement('legend');
  sourceLegend.className = 'field-label';
  sourceLegend.textContent = labels.sourceLabel;
  sourceField.append(sourceLegend);

  const liveConfig = document.createElement('div');
  liveConfig.className = 'live-config';
  liveConfig.hidden = true;

  for (const [value, text] of [
    ['replay', labels.replayOption],
    ['live', labels.liveOption],
  ] as const) {
    const wrapper = document.createElement('label');
    wrapper.className = 'radio';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'source';
    radio.value = value;
    radio.dataset['testid'] = `source-${value}`;
    radio.checked = value === 'replay';
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      liveConfig.hidden = value !== 'live';
      handlers.onSourceChange(value);
    });

    const caption = document.createElement('span');
    caption.textContent = text;
    wrapper.append(radio, caption);
    sourceField.append(wrapper);
  }

  const liveNotice = document.createElement('p');
  liveNotice.className = 'field-hint';
  liveNotice.textContent = labels.liveNotice;
  liveConfig.append(liveNotice);

  const textField = (
    labelText: string,
    testid: string,
    type: 'text' | 'password',
    value: string,
    hint: string | null,
    onChange: (value: string) => void,
  ): void => {
    const field = document.createElement('div');
    field.className = 'field field-compact';

    const label = document.createElement('label');
    label.className = 'field-label';
    label.htmlFor = `input-${testid}`;
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = type;
    input.id = `input-${testid}`;
    input.dataset['testid'] = testid;
    input.className = 'text-input';
    input.value = value;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('input', () => onChange(input.value));

    field.append(label, input);
    if (hint) {
      const hintElement = document.createElement('p');
      hintElement.className = 'field-hint';
      hintElement.textContent = hint;
      field.append(hintElement);
    }
    liveConfig.append(field);
  };

  textField(labels.baseUrlLabel, 'base-url', 'text', 'https://api.openai.com/v1', null, (v) =>
    handlers.onLiveConfigChange({ baseUrl: v }),
  );
  textField(labels.modelLabel, 'model', 'text', 'gpt-4o-mini', null, (v) =>
    handlers.onLiveConfigChange({ model: v }),
  );
  textField(labels.apiKeyLabel, 'api-key', 'password', '', labels.apiKeyHint, (v) =>
    handlers.onLiveConfigChange({ apiKey: v }),
  );

  sourceField.append(liveConfig);

  // --- error banner ---------------------------------------------------------
  const error = document.createElement('p');
  error.className = 'error-banner';
  error.dataset['testid'] = 'error';
  error.setAttribute('role', 'alert');
  error.hidden = true;

  // Reading order is the order of the decisions: what to sample, which fixture,
  // where the numbers come from, how to reshape them, then run.
  const slidersSlot = document.createElement('div');
  slidersSlot.className = 'sliders-slot';

  element.append(promptField, fixtureField, sourceField, slidersSlot, transport, error);

  return {
    element,
    slidersSlot,
    setStatus(next) {
      status = next;
      runLabel.textContent =
        next === 'streaming'
          ? labels.pauseLabel
          : next === 'paused'
            ? labels.resumeLabel
            : labels.runLabel;
      // The glyph has to agree with the word. A play triangle over "Pause" is a
      // control that describes itself two different ways at once.
      runIcon.path.setAttribute('d', next === 'streaming' ? ICON_PAUSE : ICON_PLAY);
      run.disabled = next === 'done';

      statusDot.dataset['status'] = next;
      statusDot.title = labels.statusLabels[next];
      statusText.textContent = labels.statusLabels[next];
    },
    setPrompt(text) {
      prompt.value = text;
      syncCounter();
    },
    setPromptEditable(editable, note) {
      prompt.readOnly = !editable;
      prompt.classList.toggle('is-readonly', !editable);
      // A read-only textarea still takes focus and still shows a caret in some
      // browsers, so say plainly what it is rather than relying on styling.
      prompt.setAttribute('aria-readonly', String(!editable));
      promptHint.textContent = note;
    },
    get promptValue() {
      return prompt.value;
    },
    showError(message) {
      error.hidden = message === null;
      error.textContent = message ?? '';
    },
  };
}
