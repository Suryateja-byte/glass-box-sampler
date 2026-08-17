/**
 * The About button and the dialog behind it.
 *
 * A native `<dialog>` rather than a div with a z-index: `showModal()` gives the
 * top layer, a backdrop, Escape to dismiss, a focus trap and focus restoration
 * to the button -- all of which would otherwise have to be written, tested and
 * kept correct by hand. Nothing here animates, deliberately: the reduced-motion
 * gate walks `document.getAnimations()`, and an entrance animation on a surface
 * this incidental would be motion for its own sake.
 */

export interface AboutLabels {
  label: string;
  title: string;
  body: readonly string[];
  close: string;
}

export interface AboutHandle {
  /** Lives in the header, beside the title. */
  readonly button: HTMLButtonElement;
  /** Appended at the end of the app root, outside the layout grid. */
  readonly dialog: HTMLDialogElement;
}

/** An 'i' in a circle, drawn rather than typed so it matches the type ramp. */
function infoIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.25');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '8');
  circle.setAttribute('cy', '8');
  circle.setAttribute('r', '6.25');

  const stem = document.createElementNS(ns, 'path');
  stem.setAttribute('d', 'M8 7.25v4');

  const dot = document.createElementNS(ns, 'path');
  dot.setAttribute('d', 'M8 4.75v.5');

  svg.append(circle, stem, dot);
  return svg;
}

export function mountAbout(labels: AboutLabels): AboutHandle {
  const dialog = document.createElement('dialog');
  dialog.className = 'about-dialog';
  dialog.setAttribute('aria-labelledby', 'about-title');

  const heading = document.createElement('h2');
  heading.className = 'about-title';
  heading.id = 'about-title';
  heading.textContent = labels.title;
  dialog.append(heading);

  for (const paragraph of labels.body) {
    const p = document.createElement('p');
    p.className = 'about-body';
    p.textContent = paragraph;
    dialog.append(p);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'button about-close';
  close.textContent = labels.close;
  close.addEventListener('click', () => dialog.close());
  dialog.append(close);

  // Clicking the backdrop dismisses. The backdrop is not a separate element, so
  // the test is geometric: a click whose coordinates fall outside the dialog's
  // own box landed on it. Keyboard activation of a child button reports (0, 0)
  // in some browsers, which is outside every box -- hence the detail check.
  dialog.addEventListener('click', (event) => {
    if (event.detail === 0) return;
    const box = dialog.getBoundingClientRect();
    const outside =
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom;
    if (outside) dialog.close();
  });

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'about-button';
  button.dataset['testid'] = 'about';
  button.append(infoIcon());

  const caption = document.createElement('span');
  caption.textContent = labels.label;
  button.append(caption);

  button.addEventListener('click', () => dialog.showModal());

  return { button, dialog };
}
