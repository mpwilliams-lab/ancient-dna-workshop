// The map slot of a map or distribution card (spec §5.2, §6). Drawn only in the card's upgraded form, which
// cardView decides with Task 15's cardShowsUpgrade (flag on, map checked, spec built) plus mapDataReady.
import { cardMapId } from './assets';
import type { Card } from './cards';
import { mapSpec } from './maps';
import { renderMap } from './plots/map';
import { SVG_NS } from './plots/svg';
import type { WorkshopData } from './types';

/** <div class="card-map" data-map="ID"><svg class="map-svg">…</svg>[<ul class="card-map-side">…</ul>]</div> */
export function renderCardMap(doc: Document, card: Card, data: WorkshopData): HTMLDivElement {
  const id = cardMapId(card);
  if (id === undefined) throw new Error(`card ${card.id} has no map`);
  const spec = mapSpec(id, data);
  const wrap = doc.createElement('div');
  wrap.className = 'card-map';
  wrap.dataset.map = id;
  const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.classList.add('map-svg');
  renderMap(svg, spec);
  // renderMap hides the svg from assistive technology; on a card the map is a picture named by the card's title (and, for a
  // distribution map, its numbers), so it is exposed as one (its text labels are then presentational children of the image, never
  // read out one by one).
  svg.removeAttribute('aria-hidden');
  svg.setAttribute('role', 'img');
  // A distribution map is the only place its numbers are written (the value bars of the text form are replaced by it), so its name
  // lists them, "<place> <copies>", as its labels do; the rows with no place on the map are the side list beside it, real text.
  const numbers = (spec.points ?? []).some((p) => p.role === 'value') ? (spec.texts ?? []).map((t) => t.text) : [];
  svg.setAttribute('aria-label', numbers.length > 0 ? `${card.title}: ${numbers.join(', ')}` : card.title);
  wrap.append(svg);
  if (spec.sideList && spec.sideList.length > 0) {
    const ul = doc.createElement('ul');
    ul.className = 'card-map-side';
    for (const row of spec.sideList) {
      const li = doc.createElement('li');
      const label = doc.createElement('span');
      label.className = 'value-label';
      label.textContent = row.label;
      const num = doc.createElement('span');
      num.className = 'value-num';
      num.textContent = row.display;
      li.append(label, ' ', num);
      ul.append(li);
    }
    wrap.append(ul);
  }
  return wrap;
}
