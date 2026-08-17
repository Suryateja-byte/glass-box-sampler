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

/**
 * Bit thresholds for the five tint steps, chosen at probability landmarks:
 * 0.15 bits is p = 0.90, 0.5 is p = 0.71, 1.5 is p = 0.35, 3.5 is p = 0.09.
 *
 * The previous set (1 / 2.5 / 5 / 8 bits) was picked from the range surprisal
 * can span rather than the range it actually occupies. A sampled token is
 * usually a likely one, so measured across the default fixture 63 of 68 tokens
 * fell into the first bucket -- transparent background, zero underline -- and
 * the encoding conveyed nothing at all for 93% of the text it was colouring.
 * These thresholds separate "the model was sure" from "the model hesitated"
 * from "a long shot", which is the distinction a reader is looking for.
 */
export const SURPRISAL_STEPS = [0.15, 0.5, 1.5, 3.5];

export function surprisalBucket(bits: number): number {
  for (let index = 0; index < SURPRISAL_STEPS.length; index += 1) {
    if (bits < SURPRISAL_STEPS[index]!) return index;
  }
  return SURPRISAL_STEPS.length;
}

/**
 * The key to the tint ramp.
 *
 * Without it the colouring is decoration: a reader can see that some tokens are
 * darker but has no way to learn what "darker" is worth. Naming the thresholds
 * in bits turns the wash into a readable axis, and stating that underline
 * weight carries the same signal makes it clear the information is not
 * colour-only.
 */
export function mountSurprisalLegend(labels: {
  title: string;
  low: string;
  high: string;
  encoding: string;
}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'legend';
  root.dataset['testid'] = 'surprisal-legend';

  const title = document.createElement('span');
  title.className = 'legend-title';
  title.textContent = labels.title;

  const low = document.createElement('span');
  low.className = 'legend-end';
  low.textContent = labels.low;

  const ramp = document.createElement('span');
  ramp.className = 'legend-ramp';
  // One swatch per bucket, each labelled with the bit value where it begins, so
  // the ramp reads as a scale rather than a gradient.
  const bounds = ['0', ...SURPRISAL_STEPS.map(String)];
  bounds.forEach((bound, index) => {
    const swatch = document.createElement('span');
    swatch.className = `legend-swatch tok tok-s${index}`;
    swatch.textContent = bound;
    swatch.title = `${bound} bits and up`;
    ramp.append(swatch);
  });

  const high = document.createElement('span');
  high.className = 'legend-end';
  high.textContent = labels.high;

  const unit = document.createElement('span');
  unit.className = 'legend-end';
  unit.textContent = 'bits';

  const note = document.createElement('p');
  note.className = 'legend-note';
  note.textContent = labels.encoding;

  root.append(low, ramp, unit, high, note);
  root.prepend(title);
  return root;
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
      // Drop everything from the first divergence onward, not just the span
      // that diverged. Removing only the mismatched one left every later span
      // orphaned in the DOM, so a re-sampled completion showed its new first
      // token followed by the tail of the old one -- and since the tail usually
      // dominates, the text looked unchanged when it had in fact been redrawn.
      for (let index = 0; index < spans.length; index += 1) {
        const record = records[index]!;
        const span = spans[index]!;
        if (span.dataset['token'] !== record.distribution.candidates[record.chosenIndex]?.text) {
          for (const stale of spans.splice(index)) stale.remove();
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
