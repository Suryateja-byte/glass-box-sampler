import type { DisplayDistribution, StepDistribution, TokenRecord } from '../engine/types';

/**
 * The per-step readouts: entropy, the chosen token's probability, how many
 * candidates survived top-p, and the mass sitting outside the top ten.
 *
 * Every number lives in a fixed-size element using tabular figures. These
 * values change on every frame of a slider drag, and proportional digits would
 * make the panel twitch as widths shift. `contain` keeps a text change from
 * reflowing anything outside its own box.
 */

export interface StatsHandle {
  readonly element: HTMLElement;
  update(
    distribution: StepDistribution | null,
    display: DisplayDistribution | null,
    record: TokenRecord | null,
  ): void;
}

interface Readout {
  readonly value: HTMLElement;
  last: string;
}

export function mountStats(labels: {
  entropyLabel: string;
  entropyHint: string;
  chosenLabel: string;
  chosenHint: string;
  nucleusLabel: string;
  nucleusHint: string;
  tailLabel: string;
  tailHint: string;
  empty: string;
}): StatsHandle {
  const element = document.createElement('dl');
  element.className = 'stats';
  element.dataset['testid'] = 'stats';

  const make = (label: string, hint: string, testid: string): Readout => {
    const term = document.createElement('dt');
    term.className = 'stat-label';
    term.textContent = label;
    term.title = hint;

    const definition = document.createElement('dd');
    definition.className = 'stat-value';
    definition.dataset['testid'] = testid;
    definition.textContent = labels.empty;

    element.append(term, definition);
    return { value: definition, last: labels.empty };
  };

  const entropy = make(labels.entropyLabel, labels.entropyHint, 'entropy');
  const chosen = make(labels.chosenLabel, labels.chosenHint, 'chosen-prob');
  const nucleus = make(labels.nucleusLabel, labels.nucleusHint, 'nucleus-size');
  const tail = make(labels.tailLabel, labels.tailHint, 'tail-mass');

  const write = (readout: Readout, text: string): void => {
    if (readout.last === text) return;
    readout.value.textContent = text;
    readout.last = text;
  };

  return {
    element,
    update(distribution, display, record) {
      if (!distribution || !display) {
        for (const readout of [entropy, chosen, nucleus, tail]) {
          write(readout, labels.empty);
        }
        return;
      }

      write(entropy, `${display.entropyBits.toFixed(2)} bits`);
      write(
        chosen,
        record ? `${(record.chosenProb * 100).toFixed(1)}%` : labels.empty,
      );
      write(nucleus, `${display.nucleusSize} of ${display.count}`);
      write(tail, `${(distribution.tailMass * 100).toFixed(1)}%`);
    },
  };
}
