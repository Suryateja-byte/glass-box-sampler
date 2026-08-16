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
}

export interface FixtureOption {
  id: string;
  label: string;
  prompt: string;
}

export interface ControlsHandle {
  readonly element: HTMLElement;
  setStatus(status: 'idle' | 'streaming' | 'paused' | 'done' | 'error'): void;
  setPrompt(text: string): void;
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

  const prompt = document.createElement('textarea');
  prompt.id = 'prompt-input';
  prompt.dataset['testid'] = 'prompt-input';
  prompt.className = 'prompt-input';
  prompt.rows = 2;
  prompt.spellcheck = false;
  prompt.value = initial.prompt;
  prompt.setAttribute('aria-describedby', 'prompt-hint');
  prompt.addEventListener('input', () => handlers.onPromptChange(prompt.value));

  const promptHint = document.createElement('p');
  promptHint.className = 'field-hint';
  promptHint.id = 'prompt-hint';
  promptHint.textContent = labels.promptHint;

  promptField.append(promptLabel, prompt, promptHint);

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

  const run = document.createElement('button');
  run.type = 'button';
  run.className = 'button button-primary';
  run.dataset['testid'] = 'run';
  run.textContent = labels.runLabel;

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'button';
  reset.dataset['testid'] = 'reset';
  reset.textContent = labels.resetLabel;
  reset.addEventListener('click', handlers.onReset);

  const demoHint = document.createElement('span');
  demoHint.className = 'demo-hint';
  demoHint.textContent = labels.demoHint;

  transport.append(run, reset, demoHint);

  let status: ControlsHandle['setStatus'] extends (s: infer S) => void ? S : never = 'idle';
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

  element.append(promptField, fixtureField, transport, sourceField, error);

  return {
    element,
    setStatus(next) {
      status = next;
      run.textContent =
        next === 'streaming'
          ? labels.pauseLabel
          : next === 'paused'
            ? labels.resumeLabel
            : labels.runLabel;
      run.disabled = next === 'done';
    },
    setPrompt(text) {
      prompt.value = text;
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
