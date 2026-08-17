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

/**
 * The chosen token's probability UNDER THE CURRENT SETTINGS, not the value
 * frozen when it was committed.
 *
 * Every other number in this panel recomputes as the sliders move, and the
 * accent bar directly above it does too. A frozen figure here read as a second,
 * contradictory probability for the same token -- 96.8% printed beside a bar
 * drawn at 57.0%. What the sampler actually faced is still recorded: it is on
 * the token in the transcript, where history belongs.
 */
function chosenProbability(
  display: DisplayDistribution,
  record: TokenRecord | null,
): { text: string; excluded: boolean } | null {
  if (!record) return null;
  const index = record.chosenIndex;
  const inNucleus = index < display.nucleusSize;
  const probability = inNucleus
    ? (display.nucleusProbs[index] ?? 0)
    : (display.probs[index] ?? 0);
  return { text: `${(probability * 100).toFixed(1)}%`, excluded: !inNucleus };
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

      const chosenNow = chosenProbability(display, record);
      write(chosen, chosenNow ? chosenNow.text : labels.empty);
      chosen.value.classList.toggle('is-excluded', chosenNow?.excluded === true);

      write(nucleus, `${display.nucleusSize} of ${display.count}`);

      // Coverage, not a slice of the chart above.
      //
      // The bars renormalise over the ten candidates the endpoint returned, so
      // they always sum to 100%. Printing the residual mass as though it were
      // an eleventh slice made the panel assert 102.5% -- the tail counted
      // twice, once inside the renormalisation and once beside it. Stating it
      // as how much of the distribution these ten covered is the same fact
      // without the contradiction.
      write(tail, `${((1 - distribution.tailMass) * 100).toFixed(1)}%`);
    },
  };
}
