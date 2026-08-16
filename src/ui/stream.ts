import type { TokenRecord } from '../engine/types';
import { displayToken } from './bars';

/**
 * The generated text, one span per token, tinted by surprisal.
 *
 * Append-only: a committed token adds one span and never touches the others, so
 * a long completion costs the same per token as a short one.
 *
 * Surprisal is carried by BOTH a background tint and an underline weight.
 * Colour alone would put the information out of reach of a colour-blind reader
 * and would fail the accessibility bar; the underline says the same thing
 * through a second channel, and the title attribute states it exactly.
 */

/** Bit thresholds for the five tint steps. Roughly: a 1-in-2 token is unremarkable,
 *  a 1-in-1000 token is worth noticing. */
const SURPRISAL_STEPS = [1, 2.5, 5, 8];

export function surprisalBucket(bits: number): number {
  for (let index = 0; index < SURPRISAL_STEPS.length; index += 1) {
    if (bits < SURPRISAL_STEPS[index]!) return index;
  }
  return SURPRISAL_STEPS.length;
}

export interface StreamHandle {
  readonly element: HTMLElement;
  /** Appends any records not yet rendered. */
  sync(records: readonly TokenRecord[], selectedStep: number | null): void;
  clear(): void;
  onSelect(handler: (step: number) => void): void;
}

export function mountStream(labels: {
  regionLabel: string;
  tokenTitle: (token: string, probability: string, bits: string) => string;
  placeholder: string;
}): StreamHandle {
  const element = document.createElement('div');
  element.className = 'stream';
  element.dataset['testid'] = 'stream';
  element.setAttribute('aria-label', labels.regionLabel);

  const placeholder = document.createElement('span');
  placeholder.className = 'stream-placeholder';
  placeholder.textContent = labels.placeholder;
  element.append(placeholder);

  const spans: HTMLElement[] = [];
  let selectHandler: ((step: number) => void) | null = null;
  let selected: number | null = null;

  element.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest('[data-step]');
    if (!target) return;
    const step = Number((target as HTMLElement).dataset['step']);
    if (Number.isFinite(step)) selectHandler?.(step);
  });

  return {
    element,

    sync(records, selectedStep) {
      // A fork replaces the tail of the transcript, so any span at or past the
      // divergence is dropped before appending. Everything before it is
      // untouched shared history and must not be re-rendered.
      while (spans.length > records.length) {
        spans.pop()?.remove();
      }
      for (let index = 0; index < spans.length; index += 1) {
        const record = records[index]!;
        const span = spans[index]!;
        if (span.dataset['token'] !== record.distribution.candidates[record.chosenIndex]?.text) {
          span.remove();
          spans.splice(index);
          break;
        }
      }

      if (records.length > 0) placeholder.remove();

      for (let index = spans.length; index < records.length; index += 1) {
        const record = records[index]!;
        const text = record.distribution.candidates[record.chosenIndex]?.text ?? '';
        const span = document.createElement('span');
        span.className = `tok tok-s${surprisalBucket(record.surprisalBits)}`;
        if (record.origin === 'forced') span.classList.add('tok-forced');
        span.dataset['step'] = String(record.step);
        span.dataset['token'] = text;
        span.textContent = displayToken(text).replace(/^·/, ' ');
        span.title = labels.tokenTitle(
          text,
          `${(record.chosenProb * 100).toFixed(1)}%`,
          record.surprisalBits.toFixed(2),
        );
        element.append(span);
        spans.push(span);
      }

      if (selected !== selectedStep) {
        if (selected !== null) spans[selected]?.classList.remove('is-selected');
        if (selectedStep !== null) spans[selectedStep]?.classList.add('is-selected');
        selected = selectedStep;
      }
    },

    clear() {
      for (const span of spans) span.remove();
      spans.length = 0;
      selected = null;
      element.append(placeholder);
    },

    onSelect(handler) {
      selectHandler = handler;
    },
  };
}
