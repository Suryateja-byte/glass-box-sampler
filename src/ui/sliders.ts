import type { SamplerSettings } from '../engine/types';

/**
 * Temperature and top-p.
 *
 * This is the shortest path in the app, and deliberately so. The `input`
 * handler does exactly two things -- write the new value into engine state and
 * mark the render layer dirty -- then returns. No DOM writing happens here,
 * because several input events can land in a single frame and doing the work in
 * the handler would repeat it needlessly.
 *
 * The frame scheduled during input dispatch runs in that same frame, before
 * style and paint, so the bars move in the frame the pointer moved. There is no
 * store, no batching layer and no debounce between the two, which is what makes
 * "within one frame" a property of the structure rather than a hope.
 *
 * Native range inputs are used rather than a custom control: they arrive with
 * keyboard support, focus handling and screen-reader semantics already correct,
 * and the accessibility gate is non-negotiable.
 */

export interface SliderLabels {
  temperatureLabel: string;
  temperatureHint: string;
  temperatureValueText: (value: number) => string;
  topPLabel: string;
  topPHint: string;
  topPValueText: (value: number) => string;
}

export interface SlidersHandle {
  readonly element: HTMLElement;
  /** Reflects programmatic changes (demo mode, test hooks) back into the UI. */
  reflect(settings: SamplerSettings): void;
}

export function mountSliders(
  labels: SliderLabels,
  initial: SamplerSettings,
  handlers: {
    onChange: (patch: Partial<SamplerSettings>) => void;
    onDragStateChange: (dragging: boolean) => void;
  },
): SlidersHandle {
  const element = document.createElement('div');
  element.className = 'sliders';

  const build = (
    key: 'temperature' | 'topP',
    testid: string,
    label: string,
    hint: string,
    min: number,
    max: number,
    value: number,
    valueText: (value: number) => string,
  ): { input: HTMLInputElement; output: HTMLElement } => {
    const field = document.createElement('div');
    field.className = 'slider-field';

    const header = document.createElement('div');
    header.className = 'slider-header';

    const labelElement = document.createElement('label');
    labelElement.className = 'slider-label';
    labelElement.htmlFor = `slider-${testid}`;
    labelElement.textContent = label;

    const output = document.createElement('output');
    output.className = 'slider-value';
    output.htmlFor = `slider-${testid}`;
    output.textContent = value.toFixed(2);

    header.append(labelElement, output);

    const input = document.createElement('input');
    input.type = 'range';
    input.id = `slider-${testid}`;
    input.dataset['testid'] = testid;
    input.min = String(min);
    input.max = String(max);
    input.step = '0.01';
    input.value = String(value);
    input.setAttribute('aria-valuetext', valueText(value));

    const description = document.createElement('p');
    description.className = 'slider-hint';
    description.id = `hint-${testid}`;
    description.textContent = hint;
    input.setAttribute('aria-describedby', `hint-${testid}`);

    input.addEventListener('input', () => {
      const next = Number(input.value);
      output.textContent = next.toFixed(2);
      input.setAttribute('aria-valuetext', valueText(next));
      handlers.onChange(key === 'temperature' ? { temperature: next } : { topP: next });
    });

    // Transitions are suppressed for the duration of a drag so the fills track
    // the pointer exactly. Leaving a 200ms transition running would make every
    // bar chase the slider a fifth of a second behind it, which reads as lag
    // however fast the frames actually are.
    input.addEventListener('pointerdown', () => handlers.onDragStateChange(true));
    const endDrag = (): void => handlers.onDragStateChange(false);
    input.addEventListener('pointerup', endDrag);
    input.addEventListener('pointercancel', endDrag);
    input.addEventListener('blur', endDrag);

    field.append(header, input, description);
    element.append(field);
    return { input, output };
  };

  const temperature = build(
    'temperature',
    'temperature',
    labels.temperatureLabel,
    labels.temperatureHint,
    0,
    2,
    initial.temperature,
    labels.temperatureValueText,
  );

  const topP = build(
    'topP',
    'top-p',
    labels.topPLabel,
    labels.topPHint,
    0,
    1,
    initial.topP,
    labels.topPValueText,
  );

  return {
    element,
    reflect(settings) {
      if (Number(temperature.input.value) !== settings.temperature) {
        temperature.input.value = String(settings.temperature);
        temperature.output.textContent = settings.temperature.toFixed(2);
        temperature.input.setAttribute(
          'aria-valuetext',
          labels.temperatureValueText(settings.temperature),
        );
      }
      if (Number(topP.input.value) !== settings.topP) {
        topP.input.value = String(settings.topP);
        topP.output.textContent = settings.topP.toFixed(2);
        topP.input.setAttribute('aria-valuetext', labels.topPValueText(settings.topP));
      }
    },
  };
}
