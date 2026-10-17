import type { AdmixBar, AdmixShares, PeriodId, SourceId, WorkshopData } from '../types';
import { admixBars, admixCallout, steppePct, type PlotState } from '../plotState';
import {
  ANGLO_SAXON_TAKEAWAY, BEAKER_CALLOUT, PERIOD_LABELS, REVEAL_CALLOUT, SOURCE_LABELS, admixPeopleTitle, revealNote, steppePctLabel,
} from '../content';
import { INK, SOURCE_COLORS, clearPlotMarkers, svgEl, textBlock, wrapText } from './svg';

/**
 * barsBottom leaves room below the bars for the bar labels (up to four lines for the longest period name when all
 * eight bars are shown) and the four-line Anglo-Saxon takeaway (v3 §3.5 text), all inside the 700 px viewBox. When the
 * takeaway is shown and a longer label or takeaway would still touch it, the renderer ends the bars higher (never lower).
 */
export const ADMIX_VIEW = { width: 1000, height: 700, left: 40, right: 960, barsBottom: 510 } as const;

// The takeaway is anchored to the bottom edge and grows upward: its last baseline sits TAKEAWAY_BOTTOM above the edge.
const TAKEAWAY_CHARS = 90;
const TAKEAWAY_LINE = 22;
const TAKEAWAY_BOTTOM = 12;
const TEXT_ASCENT = 14;
const CALLOUT_CHARS = 78;
const CALLOUT_LINE = 26;
const NOTE_CHARS = 86;
const NOTE_LINE = 23;
const LABEL_FIRST = 24;     // first bar-label baseline below the bars
const LABEL_LINE = 20;

const SOURCES: SourceId[] = ['STEPPE', 'FARMER', 'WHG'];      // stacked bottom -> top

// Whole-percent steppe share, as shown on screen. It lives in plotState (admixCallout reads it too, so the bar labels, the
// reveal note and the callout choice share one rounding rule) and is re-exported here for the renderer's callers.
export { steppePct };

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

function barOf(data: WorkshopData, id: PeriodId): AdmixBar | undefined {
  return data.admixture.bars.find((b) => b.period === id);
}

export function renderAdmixture(svg: SVGSVGElement, data: WorkshopData, p: PlotState): void {
  clearPlotMarkers(svg); // the PCA's frame and focus, the consumer bars' person: the next PCA must not animate from a stale frame
  svg.setAttribute('viewBox', `0 0 ${ADMIX_VIEW.width} ${ADMIX_VIEW.height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet'); // the bars stay centred; the PCA sets its own (top-anchored) value
  svg.setAttribute('role', 'img');
  svg.setAttribute('data-view', 'admixture');
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
  const parts: SVGElement[] = [legend];

  // Header: the Beaker callout, or the reveal callout with its note (spec §2.3); nothing on the per-person view.
  const callout = admixCallout(p, data);
  const people = p.admixPeriod ? data.admixture.people[p.admixPeriod] ?? [] : [];
  let y = 70;
  let ariaLabel: string;
  if (callout.kind === 'none') {
    ariaLabel = p.admixPeriod
      ? (people.length > 0 ? admixPeopleTitle(PERIOD_LABELS[p.admixPeriod], people.length) : PERIOD_LABELS[p.admixPeriod])
      : '';
  } else {
    ariaLabel = callout.kind === 'reveal' ? REVEAL_CALLOUT : BEAKER_CALLOUT;
    const head = textBlock(ariaLabel, CALLOUT_CHARS, ADMIX_VIEW.left, y, CALLOUT_LINE, {
      class: 'admix-callout', 'font-size': 20, 'font-weight': '700', fill: INK,
    });
    parts.push(head.el);
    y += head.lines * CALLOUT_LINE + 6;
    const today = barOf(data, 'Today');
    const iron = barOf(data, 'IronAge');
    if (callout.kind === 'reveal' && today && iron) {
      // Same whole percents as the bar labels, so the note always agrees with the bars on screen.
      const note = textBlock(revealNote(steppePct(today), steppePct(iron)), NOTE_CHARS, ADMIX_VIEW.left, y + 2, NOTE_LINE, {
        class: 'admix-reveal-note', 'font-size': 18, fill: INK,
      });
      parts.push(note.el);
      y += note.lines * NOTE_LINE + 2;
    }
  }
  svg.setAttribute('aria-label', ariaLabel);
  svg.setAttribute('data-callout', callout.kind);
  const barsTop = y + 34; // room for the steppe % labels

  const body = svgEl('g', { class: 'bars' });
  const innerW = ADMIX_VIEW.right - ADMIX_VIEW.left;

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
    // One mean bar per period run so far (time order; Britain today only once shown), or First farmers + Bell Beaker.
    const wanted = p.admixShown.length > 0 ? p.admixShown : admixBars(p);
    const bars = wanted.map((id) => barOf(data, id)).filter((b): b is AdmixBar => b !== undefined);
    const slot = innerW / Math.max(bars.length, 1);
    const w = Math.min(96, slot * 0.6);
    const labelChars = Math.max(8, Math.floor(slot / 9));
    const showTakeaway = bars.some((b) => b.period === 'AngloSaxon');
    const takeawayLines = showTakeaway ? wrapText(ANGLO_SAXON_TAKEAWAY, TAKEAWAY_CHARS).length : 0;
    const takeawayFirst = ADMIX_VIEW.height - TAKEAWAY_BOTTOM - (takeawayLines - 1) * TAKEAWAY_LINE;
    const labelLines = Math.max(1, ...bars.map((b) => wrapText(PERIOD_LABELS[b.period], labelChars).length));
    const labelsBlock = LABEL_FIRST + (labelLines - 1) * LABEL_LINE + 4;
    // The bars end at barsBottom, or higher when the takeaway is shown and the bar labels would otherwise touch it.
    const bottom = showTakeaway
      ? Math.min(ADMIX_VIEW.barsBottom, takeawayFirst - TEXT_ASCENT - 6 - labelsBlock)
      : ADMIX_VIEW.barsBottom;
    bars.forEach((b, i) => {
      const cx = ADMIX_VIEW.left + slot * (i + 0.5);
      const g = stack(cx - w / 2, w, barsTop, bottom, b, 2);
      g.classList.add('period-bar');
      g.setAttribute('data-period', b.period);
      if (p.admixNew.includes(b.period)) {
        g.classList.add('is-new');
        g.append(svgEl('rect', {
          class: 'new-outline', x: cx - w / 2 - 4, y: barsTop - 4, width: w + 8, height: bottom - barsTop + 8,
          fill: 'none', stroke: INK, 'stroke-width': 3, rx: 4,
        }));
      }
      g.append(svgEl('text', {
        class: 'steppe-pct', x: cx, y: barsTop - 10, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': '700', fill: INK,
      }, steppePctLabel(steppePct(b))));
      const label = textBlock(PERIOD_LABELS[b.period], labelChars, cx, bottom + LABEL_FIRST, LABEL_LINE, {
        class: 'bar-label', 'text-anchor': 'middle', 'font-size': 16, fill: INK,
      });
      g.append(label.el);
      body.append(g);
    });
    if (showTakeaway) {
      const take = textBlock(ANGLO_SAXON_TAKEAWAY, TAKEAWAY_CHARS, ADMIX_VIEW.left, takeawayFirst, TAKEAWAY_LINE, {
        class: 'admix-takeaway', 'font-size': 18, 'font-weight': '700', fill: INK,
      });
      body.append(take.el);
    }
  }

  svg.append(...parts, body);
}
