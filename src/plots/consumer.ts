// Consumer-style ancestry bars (spec §3.3, CONTRACT §4.12): one horizontal bar per label, sorted by share, with the same
// whole percents the terminal prints (commands.ts shownPercents). Only drawn when the consumerBars flag is on.
import type { ConsumerLabel, ConsumerShare, PeriodId, WorkshopData } from '../types';
import { shownPercents } from '../commands';
import {
  CONSUMER_PLOT_NOTE, CONSUMER_PLOT_SUBTITLE, HOOK_NOTE, ME_HEADING, ME_RESULT, PERIOD_LABELS, consumerTitle,
} from '../content';
import { INK, OKABE_ITO, clearPlotMarkers, svgEl, textBlock } from './svg';

export const CONSUMER_VIEW = { width: 1000, height: 700 } as const;
// Text sizes are for the back of a lab: the labels and percents are the data, so they are the biggest text after the title.
// titleChars 60 keeps the made-up customer's whole heading (59 characters) on one line, which still fits the 920 units between
// the margins in a wide sans-serif at 26 px bold (about 0.58 em a character).
const LAYOUT = {
  left: 40, titleY: 50, titleLine: 32, titleChars: 60,
  labelRight: 230, barLeft: 250, barMax: 600, pctGap: 14,
  barsTop: 140, barsBottom: 560, rowMax: 74, barFill: 0.62,
  noteGap: 60, noteMaxY: 610, noteLine: 24, noteChars: 84,
} as const;
const TRACK = '#EDEDED';

export interface ConsumerRow { label: ConsumerLabel; pct: number }

/** The rows the plot draws: the terminal's order and its whole percents (commands.ts shownPercents, the terminal's own call). */
export function consumerRows(data: WorkshopData, person: PeriodId | 'me'): ConsumerRow[] {
  const shares: readonly ConsumerShare[] = person === 'me' ? ME_RESULT : data.consumer[person] ?? [];
  return shownPercents(shares);
}

export function renderConsumer(svg: SVGSVGElement, data: WorkshopData, person: PeriodId | 'me'): void {
  const n = person === 'me' ? 0 : data.periods.find((p) => p.id === person)?.n_pca ?? 0;
  const title = person === 'me' ? ME_HEADING : consumerTitle(PERIOD_LABELS[person], n);
  const note = person === 'me' ? HOOK_NOTE : CONSUMER_PLOT_NOTE;

  // The PCA's and the ADMIXTURE bars' markers must not linger (a later PCA would animate from a stale frame), nor a running flag.
  clearPlotMarkers(svg);
  svg.setAttribute('viewBox', `0 0 ${CONSUMER_VIEW.width} ${CONSUMER_VIEW.height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  svg.setAttribute('data-view', 'consumer');
  svg.setAttribute('data-person', person);
  svg.replaceChildren();

  const head = textBlock(title, LAYOUT.titleChars, LAYOUT.left, LAYOUT.titleY, LAYOUT.titleLine, {
    class: 'consumer-title', 'font-size': 26, 'font-weight': '700', fill: INK,
  });
  const subY = LAYOUT.titleY + head.lines * LAYOUT.titleLine + 4;
  const sub = svgEl('text', { class: 'consumer-subtitle', x: LAYOUT.left, y: subY, 'font-size': 20, fill: '#4D4D4D' }, CONSUMER_PLOT_SUBTITLE);

  const rows = consumerRows(data, person);
  const top = Math.max(LAYOUT.barsTop, subY + 40);
  const rowH = Math.min(LAYOUT.rowMax, (LAYOUT.barsBottom - top) / Math.max(rows.length, 1));
  const h = rowH * LAYOUT.barFill;
  const body = svgEl('g', { class: 'consumer-bars' });
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const mid = y + h / 2 + 8;
    const w = (Math.max(0, Math.min(100, r.pct)) / 100) * LAYOUT.barMax;
    const g = svgEl('g', { class: 'consumer-bar', 'data-label': r.label, 'data-pct': String(r.pct) });
    g.append(svgEl('text', { class: 'consumer-label', x: LAYOUT.labelRight, y: mid, 'text-anchor': 'end', 'font-size': 24, fill: INK }, r.label));
    g.append(svgEl('rect', { class: 'consumer-track', x: LAYOUT.barLeft, y, width: LAYOUT.barMax, height: h, rx: 4, fill: TRACK }));
    if (w > 0) g.append(svgEl('rect', { class: 'consumer-fill', x: LAYOUT.barLeft, y, width: w, height: h, rx: 4, fill: OKABE_ITO.blue }));
    g.append(svgEl('text', {
      class: 'consumer-pct', x: LAYOUT.barLeft + LAYOUT.barMax + LAYOUT.pctGap, y: mid, 'font-size': 24, 'font-weight': '700', fill: INK,
    }, `${r.pct}%`));
    body.append(g);
  });

  // The note follows the last bar, so a short list (the two-label customer) keeps its disclaimer next to it; it never goes below noteMaxY.
  const barsEnd = top + Math.max(rows.length - 1, 0) * rowH + h;
  const foot = textBlock(note, LAYOUT.noteChars, LAYOUT.left, Math.min(LAYOUT.noteMaxY, barsEnd + LAYOUT.noteGap), LAYOUT.noteLine, {
    class: 'consumer-note', 'font-size': 19, fill: INK,
  });
  svg.append(head.el, sub, body, foot.el);
}
