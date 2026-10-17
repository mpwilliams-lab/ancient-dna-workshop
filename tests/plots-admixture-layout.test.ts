// @vitest-environment jsdom
// Layout guard for the ADMIXTURE view. jsdom has no layout engine, so this reads the baselines the renderer wrote (the
// text y plus the tspan dy steps) and checks them against font-size estimates.
import { afterEach, describe, expect, it } from 'vitest';
import fixture from './fixtures/data.fixture.json';
import type { WorkshopData } from '../src/types';
import type { PlotAction } from '../src/commands';
import type { PcaPeriod } from '../src/parser';
import { INITIAL_PLOT, reducePlot, type PlotState } from '../src/plotState';
import { ADMIX_VIEW, renderAdmixture } from '../src/plots/admixture';
import { PERIOD_LABELS } from '../src/content';

const ASCENT = 14;   // px above the baseline for the 16-20 px text used here
const DESCENT = 4;   // px below it

const data = (): WorkshopData => structuredClone(fixture) as unknown as WorkshopData;
const pca = (period: PcaPeriod): PlotAction => ({ kind: 'pca', period });
const adm: PlotAction = { kind: 'admixture' };
const play = (d: WorkshopData, actions: PlotAction[]): PlotState => actions.reduce((s, a) => reducePlot(s, a, d), INITIAL_PLOT);

const firstBaseline = (t: Element): number => Number(t.getAttribute('y'));
const lastBaseline = (t: Element): number =>
  firstBaseline(t) + [...t.querySelectorAll('tspan')].reduce((sum, s) => sum + Number(s.getAttribute('dy') ?? 0), 0);
/** Bottom edge of the bars as drawn (the steppe segment sits on it). */
const barsBottom = (svg: SVGSVGElement): number => {
  const s = svg.querySelector('g.period-bar .seg-STEPPE')!;
  return Number(s.getAttribute('y')) + Number(s.getAttribute('height'));
};
const barsTop = (svg: SVGSVGElement): number =>
  Math.min(...[...svg.querySelectorAll('g.period-bar .seg')].map((s) => Number(s.getAttribute('y'))));

function draw(make: (d: WorkshopData) => PlotState): SVGSVGElement {
  const d = data();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  renderAdmixture(svg, d, make(d));
  return svg;
}

afterEach(() => document.body.replaceChildren());

// The guided last extra after step 12 (seven bars, reveal callout and note, takeaway), and the busiest screen (all eight
// bars: the First farmers label wraps to four lines and the takeaway to four).
const WITH_TAKEAWAY: [string, (d: WorkshopData) => PlotState][] = [
  ['the last extra after step 12', (d) => play(d, [pca('Europe'), pca('FirstFarmers'), pca('BellBeaker'), adm, pca('BronzeAge'),
    pca('IronAge'), pca('Today'), adm, pca('Roman'), pca('AngloSaxon'), adm])],
  ['all eight bars', (d) => play(d, [pca('all'), adm])],
];

describe.each(WITH_TAKEAWAY)('ADMIXTURE layout, %s', (_name, make) => {
  it('keeps every line of text inside the viewBox, the whole takeaway and the reveal note included', () => {
    const svg = draw(make);
    expect(svg.querySelector('.admix-takeaway')).not.toBeNull();
    expect(svg.querySelector('.admix-reveal-note')).not.toBeNull();
    for (const t of svg.querySelectorAll('text')) {
      expect(firstBaseline(t) - ASCENT, `top of: ${t.textContent}`).toBeGreaterThanOrEqual(0);
      expect(lastBaseline(t) + DESCENT, `bottom of: ${t.textContent}`).toBeLessThanOrEqual(ADMIX_VIEW.height);
    }
  });

  it('keeps the takeaway clear of the bar labels, the labels clear of the bars, and the note clear of the steppe labels', () => {
    const svg = draw(make);
    const takeaway = svg.querySelector('.admix-takeaway')!;
    const labels = [...svg.querySelectorAll('.bar-label')];
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) {
      expect(firstBaseline(l) - ASCENT).toBeGreaterThan(barsBottom(svg));
      expect(lastBaseline(l) + DESCENT).toBeLessThan(firstBaseline(takeaway) - ASCENT);
    }
    const note = svg.querySelector('.admix-reveal-note')!;
    for (const p of svg.querySelectorAll('.steppe-pct')) expect(lastBaseline(note) + DESCENT).toBeLessThan(firstBaseline(p) - ASCENT);
    expect(barsBottom(svg)).toBeLessThanOrEqual(ADMIX_VIEW.barsBottom);
  });

  it('stacks the header in order: the legend, then the callout, then the note, then the steppe labels', () => {
    const svg = draw(make);
    const callout = svg.querySelector('.admix-callout')!;
    const note = svg.querySelector('.admix-reveal-note')!;
    const legendBottom = Math.max(...[...svg.querySelectorAll('.admix-legend text')].map(lastBaseline)) + DESCENT;
    expect(firstBaseline(callout) - ASCENT).toBeGreaterThan(legendBottom);
    expect(firstBaseline(note) - ASCENT).toBeGreaterThan(lastBaseline(callout) + DESCENT);
  });

  it('keeps at least 200 px of bar height', () => {
    const svg = draw(make);
    expect(barsBottom(svg) - barsTop(svg)).toBeGreaterThanOrEqual(200);
  });
});

describe('ADMIXTURE layout, the first run (two bars, Beaker callout, no takeaway)', () => {
  it('keeps every line inside the viewBox and the bars on the usual baseline', () => {
    const svg = draw((d) => play(d, [pca('Europe'), pca('FirstFarmers'), pca('BellBeaker'), adm]));
    for (const t of svg.querySelectorAll('text')) {
      expect(firstBaseline(t) - ASCENT, `top of: ${t.textContent}`).toBeGreaterThanOrEqual(0);
      expect(lastBaseline(t) + DESCENT, `bottom of: ${t.textContent}`).toBeLessThanOrEqual(ADMIX_VIEW.height);
    }
    expect(barsBottom(svg)).toBeCloseTo(ADMIX_VIEW.barsBottom, 0);
    const callout = svg.querySelector('.admix-callout')!;
    for (const p of svg.querySelectorAll('.steppe-pct')) expect(lastBaseline(callout) + DESCENT).toBeLessThan(firstBaseline(p) - ASCENT);
  });
});

// The bars end at ADMIX_VIEW.barsBottom, and only higher when the takeaway is shown and the bar
// labels would otherwise touch it. The real strings never need the move (the four-line label clears the takeaway with
// 4 px to spare at 510), so these tests lengthen one label to exercise it: that is what "a longer label cannot overlap
// again" rests on.
describe('ADMIXTURE layout: the bars end higher only when a longer label would touch the takeaway', () => {
  const LONGER = `${PERIOD_LABELS.FirstFarmers}, early`;   // five lines at the eight-bar label width (four for the real label)
  function drawWithLongerLabel(make: (d: WorkshopData) => PlotState): SVGSVGElement {
    const original = PERIOD_LABELS.FirstFarmers;
    PERIOD_LABELS.FirstFarmers = LONGER;
    try {
      return draw(make);
    } finally {
      PERIOD_LABELS.FirstFarmers = original;
    }
  }

  it('with the takeaway: the bars end above the usual baseline, the labels stay clear of the takeaway, 200 px of bar remain', () => {
    const svg = drawWithLongerLabel((d) => play(d, [pca('all'), adm]));
    const labelLines = svg.querySelector('.bar-label')!.querySelectorAll('tspan').length;
    expect(labelLines).toBe(5);
    expect(barsBottom(svg)).toBeLessThan(ADMIX_VIEW.barsBottom);
    const takeaway = svg.querySelector('.admix-takeaway')!;
    for (const l of svg.querySelectorAll('.bar-label')) {
      expect(firstBaseline(l) - ASCENT).toBeGreaterThan(barsBottom(svg));
      expect(lastBaseline(l) + DESCENT).toBeLessThan(firstBaseline(takeaway) - ASCENT);
    }
    expect(barsBottom(svg) - barsTop(svg)).toBeGreaterThanOrEqual(200);
  });

  it('without the takeaway: the bars stay on the usual baseline however long the labels are', () => {
    const svg = drawWithLongerLabel((d) => play(d, [pca('Europe'), pca('FirstFarmers'), pca('BellBeaker'), adm]));
    expect(svg.querySelector('.admix-takeaway')).toBeNull();
    expect(barsBottom(svg)).toBeCloseTo(ADMIX_VIEW.barsBottom, 0);
  });

  it('the outline of a newly added bar ends 4 px under the bars, on the moved edge too', () => {
    const svg = drawWithLongerLabel((d) => play(d, [pca('FirstFarmers'), pca('BellBeaker'), adm, pca('all'), adm]));
    expect(barsBottom(svg)).toBeLessThan(ADMIX_VIEW.barsBottom);
    const outlines = [...svg.querySelectorAll('.new-outline')];
    expect(outlines).toHaveLength(6);   // Bronze Age to Britain today are new on the second run
    for (const o of outlines) expect(Number(o.getAttribute('y')) + Number(o.getAttribute('height'))).toBeCloseTo(barsBottom(svg) + 4, 0);
  });
});
