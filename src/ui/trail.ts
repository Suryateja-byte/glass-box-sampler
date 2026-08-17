import type { GenerationState } from '../engine/types';
import { displayToken } from './bars';

/**
 * The branch trail: the path of forks that produced the text on screen.
 *
 * Without it a fork is indistinguishable from a re-run -- the transcript simply
 * changes and the reader has no way to see that a decision was made, or to get
 * back. Each chip is a real button, so returning to an earlier line is one
 * click and one Tab stop.
 */

export interface TrailHandle {
  readonly element: HTMLElement;
  update(state: Readonly<GenerationState>): void;
  onSelectBranch(handler: (branchId: string) => void): void;
}

export function mountTrail(labels: {
  regionLabel: string;
  rootLabel: string;
  rootTitle: string;
  branchLabel: (token: string, step: number) => string;
  branchTitle: (token: string, step: number) => string;
}): TrailHandle {
  const element = document.createElement('nav');
  element.className = 'trail';
  element.dataset['testid'] = 'trail';
  element.setAttribute('aria-label', labels.regionLabel);

  let handler: ((branchId: string) => void) | null = null;
  let lastSignature = '';

  element.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest('[data-branch]');
    if (target) handler?.((target as HTMLElement).dataset['branch']!);
  });

  return {
    element,

    update(state) {
      // EVERY branch gets a chip, not just the active line's ancestors.
      //
      // Showing only the ancestor chain meant that returning to the root made
      // the branch you had just opened vanish from the interface: it still
      // existed, but nothing could reach it, which is the opposite of what a
      // trail is for. Listing them all keeps the promise that every line you
      // open stays open.
      const branches = [...state.branches.values()];
      const isAncestorOfActive = new Set<string>();
      let cursor = state.branches.get(state.activeBranchId);
      while (cursor) {
        isAncestorOfActive.add(cursor.id);
        cursor = cursor.parentId ? state.branches.get(cursor.parentId) : undefined;
      }

      // Forking is rare, so a cheap signature check keeps this out of the
      // streaming path entirely.
      const signature = `${branches.map((b) => b.id).join(',')}|${state.activeBranchId}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      element.replaceChildren();
      element.classList.toggle('is-branched', branches.length > 1);

      branches.forEach((branch, index) => {
        if (index > 0) {
          const separator = document.createElement('span');
          separator.className = 'trail-separator';
          separator.setAttribute('aria-hidden', 'true');
          separator.textContent = '·';
          element.append(separator);
        }

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'trail-chip';
        chip.dataset['branch'] = branch.id;
        chip.dataset['testid'] = 'trail-chip';
        if (branch.id === state.activeBranchId) {
          chip.classList.add('is-current');
          chip.setAttribute('aria-current', 'true');
        } else if (isAncestorOfActive.has(branch.id)) {
          chip.classList.add('is-ancestor');
        }

        if (branch.parentId === null) {
          chip.textContent = labels.rootLabel;
          chip.title = labels.rootTitle;
        } else {
          const forced = branch.tokens[0];
          const token = forced
            ? displayToken(forced.distribution.candidates[forced.chosenIndex]?.text ?? '')
            : '';
          chip.textContent = labels.branchLabel(token, branch.forkStep);
          chip.title = labels.branchTitle(token, branch.forkStep);
        }

        element.append(chip);
      });
    },

    onSelectBranch(next) {
      handler = next;
    },
  };
}
