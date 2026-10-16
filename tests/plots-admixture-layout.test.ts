// @vitest-environment jsdom
// Layout guard for the ADMIXTURE view. It is not part of the brief's three test files: it was added after a real-data
// screenshot showed the Anglo-Saxon takeaway running off the bottom of the viewBox. jsdom has no layout engine, so this
// reads the baselines the renderer wrote (the text y plus the tspan dy steps) and checks them against font-size estimates.
import { afterEach, describe, expect, it } from 'vitest';
import fixture from './fixtures/data.fixture.json';
import type { PeriodId, WorkshopData } from '../src/types';
import type { PlotAction } from '../src/commands';
import { INITIAL_PLOT, reducePlot, type PlotState } from '../src/plotState';
import { ADMIX_VIEW, renderAdmixture } from '../src/plots/admixture';

const ASCENT = 14;   // px above the baseline for the 16-18 px text used here
const DESCENT = 4;   // px below it

const data = (): WorkshopData => structuredClone(fixture) as unknown as WorkshopData;
const pca = (period: PeriodId | 'all'): PlotAction => ({ kind: 'pca', period });
const adm: PlotAction = { kind: 'admixture' };

function play(d: WorkshopData, actions: PlotAction[]): PlotState {
  let s = INITIAL_PLOT;
  for (const a of actions) s = reducePlot(s, a, d);
  return s;
}

const firstBaseline = (t: Element): number => Number(t.getAttribute('y'));
const lastBaseline = (t: Element): number =>
  firstBaseline(t) + [...t.querySelectorAll('tspan')].reduce((sum, s) => sum + Number(s.getAttribute('dy') ?? 0), 0);

// The guided Beat 3 screen, and the busiest one (all eight bars: the longest label wraps to four lines).
const STATES: [string, (d: WorkshopData) => PlotState][] = [
  ['guided Beat 3 (six bars, three outlined)', (d) => play(d, [pca('Today'), pca('FirstFarmers'), pca('BellBeaker'), adm, pca('IronAge'), pca('Roman'), pca('AngloSaxon'), adm])],
  ['all eight bars', (d) => play(d, [pca('all'), adm])],
];

afterEach(() => document.body.replaceChildren());

describe.each(STATES)('ADMIXTURE layout, %s', (_name, make) => {
  function draw(): SVGSVGElement {
    const d = data();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(svg);
    renderAdmixture(svg, d, make(d));
    return svg;
  }

  it('keeps every line of text inside the viewBox, the whole Anglo-Saxon takeaway included', () => {
    const svg = draw();
    const takeaway = svg.querySelector('.admix-takeaway');
    expect(takeaway).not.toBeNull();
    for (const t of svg.querySelectorAll('text')) {
      expect(firstBaseline(t) - ASCENT, `top of: ${t.textContent}`).toBeGreaterThanOrEqual(0);
      expect(lastBaseline(t) + DESCENT, `bottom of: ${t.textContent}`).toBeLessThanOrEqual(ADMIX_VIEW.height);
    }
  });

  it('keeps the takeaway clear of the bar labels above it and the bars clear of the labels', () => {
    const svg = draw();
    const takeaway = svg.querySelector('.admix-takeaway')!;
    const labels = [...svg.querySelectorAll('.bar-label')];
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) {
      expect(firstBaseline(l) - ASCENT).toBeGreaterThan(ADMIX_VIEW.barsBottom);
      expect(lastBaseline(l) + DESCENT).toBeLessThan(firstBaseline(takeaway) - ASCENT);
    }
  });
});
