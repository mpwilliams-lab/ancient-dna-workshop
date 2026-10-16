import type { AdmixShares, PeriodId, SourceId, WorkshopData } from '../types';
import type { PlotState } from '../plotState';
import {
  ANGLO_SAXON_TAKEAWAY, BEAKER_CALLOUT, PERIOD_LABELS, SOURCE_LABELS, admixPeopleTitle, beakerBridge, steppePctLabel,
} from '../content';
import { INK, SOURCE_COLORS, svgEl, textBlock } from './svg';

export const ADMIX_VIEW = { width: 1000, height: 700, left: 40, right: 960, barsBottom: 560 } as const;

const SOURCES: SourceId[] = ['STEPPE', 'FARMER', 'WHG'];      // stacked bottom -> top
const DEFAULT_BARS: PeriodId[] = ['FirstFarmers', 'BellBeaker', 'Today'];

/** Whole-percent steppe share, as shown on screen. */
export function steppePct(s: AdmixShares): number {
  return Math.round(s.STEPPE * 100);
}

/** One stacked bar (STEPPE at the base so "the steppe colour rises"). */
function stack(x: number, w: number, top: number, bottom: number, s: AdmixShares, gap: number): SVGGElement {
  const g = svgEl('g', { class: 'stack' });
  const h = bottom - top;
  const total = s.STEPPE + s.FARMER + s.WHG || 1;
  let y = bottom;
  for (const src of SOURCES) {
    const sh = (s[src] / total) * h;
    y -= sh;
    g.append(svgEl('rect', {
      class: `seg seg-${src}`, 'data-source': src, x, y, width: w, height: sh,
      fill: SOURCE_COLORS[src], stroke: '#FFFFFF', 'stroke-width': gap,
    }));
  }
  return g;
}

export function renderAdmixture(svg: SVGSVGElement, data: WorkshopData, p: PlotState): void {
  svg.setAttribute('viewBox', `0 0 ${ADMIX_VIEW.width} ${ADMIX_VIEW.height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', BEAKER_CALLOUT);
  svg.setAttribute('data-view', 'admixture');
  svg.removeAttribute('data-frame'); // the next PCA render must not animate from a stale frame
  svg.replaceChildren();

  // Legend: the three sources, once.
  const legend = svgEl('g', { class: 'legend admix-legend' });
  let lx = ADMIX_VIEW.left;
  for (const src of SOURCES) {
    const item = svgEl('g', { class: 'legend-item', 'data-legend': src });
    item.append(svgEl('rect', { x: lx, y: 14, width: 18, height: 18, rx: 3, fill: SOURCE_COLORS[src] }));
    item.append(svgEl('text', { x: lx + 26, y: 29, 'font-size': 18, fill: INK }, SOURCE_LABELS[src]));
    legend.append(item);
    lx += 26 + SOURCE_LABELS[src].length * 9.5 + 34;
  }

  // Callout + bridging line: always with the bars (§6 rule 3).
  let y = 70;
  const callout = textBlock(BEAKER_CALLOUT, 78, ADMIX_VIEW.left, y, 26, {
    class: 'admix-callout', 'font-size': 20, 'font-weight': '700', fill: INK,
  });
  y += callout.lines * 26 + 6;
  const bridge = textBlock(beakerBridge(data.admixture.beaker_steppe_pct), 86, ADMIX_VIEW.left, y, 24, {
    class: 'admix-bridge', 'font-size': 18, 'font-style': 'italic', fill: INK,
  });
  y += bridge.lines * 24;
  const barsTop = y + 34; // room for the steppe % labels

  const body = svgEl('g', { class: 'bars' });
  const innerW = ADMIX_VIEW.right - ADMIX_VIEW.left;
  const people = p.admixPeriod ? data.admixture.people[p.admixPeriod] ?? [] : [];

  if (p.admixPeriod && people.length > 0) {
    // One thin bar per person, highest steppe share first.
    const sorted = [...people].sort((a, b) => b.STEPPE - a.STEPPE);
    const w = innerW / sorted.length;
    body.setAttribute('data-period', p.admixPeriod);
    body.append(svgEl('text', {
      class: 'admix-people-title', x: ADMIX_VIEW.left, y: barsTop - 12, 'font-size': 18, 'font-weight': '700', fill: INK,
    }, admixPeopleTitle(PERIOD_LABELS[p.admixPeriod], sorted.length)));
    sorted.forEach((s, i) => {
      const g = stack(ADMIX_VIEW.left + i * w, w, barsTop, ADMIX_VIEW.barsBottom, s, sorted.length > 150 ? 0 : 1);
      g.classList.add('person-bar');
      body.append(g);
    });
  } else {
    // One mean bar per period run so far (time order, Today last), or the default three.
    const wanted = p.admixShown.length > 0 ? p.admixShown : DEFAULT_BARS;
    const bars = wanted
      .map((id) => data.admixture.bars.find((b) => b.period === id))
      .filter((b): b is NonNullable<typeof b> => b !== undefined);
    const slot = innerW / Math.max(bars.length, 1);
    const w = Math.min(96, slot * 0.6);
    bars.forEach((b, i) => {
      const cx = ADMIX_VIEW.left + slot * (i + 0.5);
      const g = stack(cx - w / 2, w, barsTop, ADMIX_VIEW.barsBottom, b, 2);
      g.classList.add('period-bar');
      g.setAttribute('data-period', b.period);
      if (p.admixNew.includes(b.period)) {
        g.classList.add('is-new');
        g.append(svgEl('rect', {
          class: 'new-outline', x: cx - w / 2 - 4, y: barsTop - 4, width: w + 8, height: ADMIX_VIEW.barsBottom - barsTop + 8,
          fill: 'none', stroke: INK, 'stroke-width': 3, rx: 4,
        }));
      }
      g.append(svgEl('text', {
        class: 'steppe-pct', x: cx, y: barsTop - 10, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': '700', fill: INK,
      }, steppePctLabel(steppePct(b))));
      const label = textBlock(PERIOD_LABELS[b.period], Math.max(8, Math.floor(slot / 9)), cx, ADMIX_VIEW.barsBottom + 24, 20, {
        class: 'bar-label', 'text-anchor': 'middle', 'font-size': 16, fill: INK,
      });
      g.append(label.el);
      body.append(g);
    });
    if (bars.some((b) => b.period === 'AngloSaxon')) {
      const take = textBlock(ANGLO_SAXON_TAKEAWAY, 90, ADMIX_VIEW.left, ADMIX_VIEW.height - 22, 22, {
        class: 'admix-takeaway', 'font-size': 18, 'font-weight': '700', fill: INK,
      });
      body.append(take.el);
    }
  }

  svg.append(legend, callout.el, bridge.el, body);
}
