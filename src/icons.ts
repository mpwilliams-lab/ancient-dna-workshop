// Chip icons (spec §3.5 chip rule, rule 13): "DNA changed" chips carry a double helix, "Culture changed" chips a pot,
// so the pair reads without colour. Own drawings, stroke-only paths in a 24 x 24 box, drawn in currentColor.
import type { ChipIcon, ChipKey } from './types';
import { CHIP_TEXT, chipIcon } from './content';
import { SVG_NS } from './plots/svg';

export const CHIP_ICON_PATHS: Readonly<Record<ChipIcon, string>> = {
  // two strands crossing twice, with three rungs
  dna: 'M7 3c0 4 10 5 10 9s-10 5-10 9M17 3c0 4-10 5-10 9s10 5 10 9M8.5 5.5h7M7.5 12h9M8.5 18.5h7',
  // a bell-shaped beaker with two decorated bands
  pot: 'M7 3h10l-1.5 4.5c2.2 1.7 3.5 4 3.5 6.5 0 3.9-3.1 7-7 7s-7-3.1-7-7c0-2.5 1.3-4.8 3.5-6.5ZM6.4 12h11.2M7 16h10',
};

/** <span class="chip chip--dna|chip--pot" data-chip="KEY"><svg class="chip-icon" aria-hidden="true">…</svg>TEXT</span> */
export function chipElement(doc: Document, key: ChipKey): HTMLSpanElement {
  const icon = chipIcon(key);
  const span = doc.createElement('span');
  span.className = `chip chip--${icon}`;
  span.setAttribute('data-chip', key);
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'chip-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', CHIP_ICON_PATHS[icon]);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  span.append(svg, doc.createTextNode(CHIP_TEXT[key]));
  return span;
}
