import { K } from '../engine/types';
import type { DisplayDistribution, StepDistribution } from '../engine/types';

/**
 * The top-k probability bars.
 *
 * Plain DOM elements, not canvas. Ten elements is far below where canvas starts
 * paying off, and canvas would cost the accessibility gate: these rows are real
 * buttons with real text, so a screen reader and the keyboard get them for free
 * instead of needing a parallel DOM built by hand.
 *
 * Everything animated is a `transform`, which the compositor handles off the
 * main thread. The row skeleton is built once and its geometry never changes,
 * so a bar update cannot trigger layout.
 *
 * ORDER IS STABLE BY CONSTRUCTION. Temperature is a monotonic map on logits and
 * top-p truncates a sorted prefix, so neither slider can reorder the bars. The
 * candidates are sorted once when the step arrives, which removes any need for
 * reorder animation or FLIP bookkeeping in the hot path.
 */

export interface BarsHandle {
  readonly element: HTMLElement;
  update(
    distribution: StepDistribution | null,
    display: DisplayDistribution | null,
    chosenIndex: number | null,
  ): void;
  /** During a drag, transitions are off and the fills track the pointer 1:1. */
  setDragging(dragging: boolean): void;
  onFork(handler: (rank: number) => void): void;
}

interface Row {
  readonly root: HTMLLIElement;
  readonly button: HTMLButtonElement;
  readonly token: HTMLSpanElement;
  readonly fill: HTMLSpanElement;
  readonly percent: HTMLSpanElement;
  // Last written values, so an unchanged row costs a comparison instead of a
  // DOM write. Text writes are the expensive part of this render.
  //
  // The percentage caches the RENDERED STRING, not the probability it came
  // from. Caching a rounded number was a real defect: two different
  // probabilities that round alike -- 0.0003 and 0.00001 both round to zero at
  // three decimal places -- would skip the write and leave the previous step's
  // figure on screen. A readout that silently shows a stale number is worse
  // than one that is slow.
  lastScale: number;
  lastPercent: string;
  lastToken: string;
  lastState: string;
}

/** Renders the invisible parts of a token so the tokenizer stays visible. */
export function displayToken(text: string): string {
  return text
    .replace(/^ /, '·')
    .replaceAll('\n', '⏎')
    .replaceAll('\t', '→');
}

export function mountBars(labels: {
  regionLabel: string;
  rowDescription: (token: string, percent: string, rank: number) => string;
  excludedSuffix: string;
}): BarsHandle {
  const element = document.createElement('ol');
  element.className = 'bars';
  element.dataset['testid'] = 'bars';
  element.setAttribute('aria-label', labels.regionLabel);

  const rows: Row[] = [];
  let forkHandler: ((rank: number) => void) | null = null;

  for (let rank = 0; rank < K; rank += 1) {
    const root = document.createElement('li');
    root.className = 'bar-row';
    root.dataset['testid'] = 'bar-row';
    root.dataset['rank'] = String(rank);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bar-button';
    button.dataset['testid'] = 'fork-button';

    const rankLabel = document.createElement('span');
    rankLabel.className = 'bar-rank';
    rankLabel.textContent = String(rank + 1);
    rankLabel.setAttribute('aria-hidden', 'true');

    const token = document.createElement('span');
    token.className = 'bar-token';

    const track = document.createElement('span');
    track.className = 'bar-track';
    const fill = document.createElement('span');
    fill.className = 'bar-fill';
    track.append(fill);

    const percent = document.createElement('span');
    percent.className = 'bar-percent';

    button.append(rankLabel, token, track, percent);
    root.append(button);
    element.append(root);

    button.addEventListener('click', () => forkHandler?.(rank));

    rows.push({
      root,
      button,
      token,
      fill,
      percent,
      lastScale: -1,
      lastPercent: '',
      lastToken: '',
      lastState: '',
    });
  }

  const update: BarsHandle['update'] = (distribution, display, chosenIndex) => {
    const count = display?.count ?? 0;

    for (let rank = 0; rank < K; rank += 1) {
      const row = rows[rank]!;

      if (!distribution || !display || rank >= count) {
        if (row.lastState !== 'empty') {
          row.root.className = 'bar-row is-empty';
          row.button.disabled = true;
          // Hidden from assistive technology rather than left as an unnamed
          // button: an empty slot carries no information, and ten nameless
          // controls are noise to a screen reader and an accessibility defect.
          row.root.setAttribute('aria-hidden', 'true');
          row.button.removeAttribute('aria-label');
          row.lastState = 'empty';
          row.lastToken = '';
          row.lastPercent = '';
        }
        if (row.lastScale !== 0) {
          row.fill.style.transform = 'scaleX(0)';
          row.lastScale = 0;
        }
        continue;
      }

      const candidate = distribution.candidates[rank]!;
      const inNucleus = rank < display.nucleusSize;
      // Excluded candidates keep their true height and lose contrast instead of
      // collapsing to zero. Seeing what top-p discarded is the entire point of
      // showing the cutoff.
      const probability = inNucleus
        ? (display.nucleusProbs[rank] ?? 0)
        : (display.probs[rank] ?? 0);

      const scale = Math.max(0, Math.min(1, probability));
      if (scale !== row.lastScale) {
        row.fill.style.transform = `scaleX(${scale.toFixed(5)})`;
        row.lastScale = scale;
      }

      const percentText = formatPercent(probability);
      const percentChanged = percentText !== row.lastPercent;
      if (percentChanged) {
        row.percent.textContent = percentText;
        row.lastPercent = percentText;
      }

      const label = displayToken(candidate.text);
      const tokenChanged = label !== row.lastToken;
      if (tokenChanged) {
        row.token.textContent = label;
        row.lastToken = label;
      }

      const state =
        `${inNucleus ? 'in' : 'out'}${rank === chosenIndex ? '-chosen' : ''}` +
        `${rank === display.nucleusSize - 1 && display.nucleusSize < count ? '-edge' : ''}`;
      const stateChanged = state !== row.lastState;
      if (stateChanged) {
        row.root.removeAttribute('aria-hidden');
        row.root.className =
          'bar-row' +
          (inNucleus ? '' : ' is-excluded') +
          (rank === chosenIndex ? ' is-chosen' : '') +
          (rank === display.nucleusSize - 1 && display.nucleusSize < count
            ? ' is-nucleus-edge'
            : '');
        row.button.disabled = false;
        row.lastState = state;
      }

      // The accessible name carries what colour and length convey visually,
      // including exclusion, which is otherwise a contrast-only signal.
      //
      // Rewritten only when something in it actually changed. Rebuilding this
      // string and calling setAttribute for ten rows on every frame of a drag
      // is pure waste, and it is waste on the one path the frame-time gate
      // measures.
      if (percentChanged || tokenChanged || stateChanged) {
        row.button.setAttribute(
          'aria-label',
          labels.rowDescription(candidate.text, formatPercent(probability), rank + 1) +
            (inNucleus ? '' : labels.excludedSuffix),
        );
      }
    }
  };

  return {
    element,
    update,
    setDragging(dragging) {
      element.classList.toggle('is-dragging', dragging);
    },
    onFork(handler) {
      forkHandler = handler;
    },
  };
}

/** Small probabilities still read as distinct rather than a row of "0.0%". */
export function formatPercent(probability: number): string {
  const percent = probability * 100;
  if (percent >= 10) return `${percent.toFixed(1)}%`;
  if (percent >= 1) return `${percent.toFixed(2)}%`;
  if (percent >= 0.01) return `${percent.toFixed(2)}%`;
  if (percent > 0) return '<0.01%';
  return '0%';
}
