// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import fixture from './fixtures/data.fixture.json';
import type { AdmixBar, PeriodId, WorkshopData } from '../src/types';
import { INITIAL_PLOT, type PlotState } from '../src/plotState';
import { ADMIX_VIEW, renderAdmixture, steppePct } from '../src/plots/admixture';
import {
  ANGLO_SAXON_TAKEAWAY, BEAKER_CALLOUT, PERIOD_LABELS, PLOT_EMPTY, SOURCE_LABELS, TRAIT_Y_LABEL,
  admixPeopleTitle, allRenderableStrings, beakerBridge, steppePctLabel,
} from '../src/content';

// Bars and people pinned here (the shared fixture supplies the rest).
function makeData(): WorkshopData {
  const d = structuredClone(fixture) as unknown as WorkshopData;
  const bar = (period: PeriodId, n: number, STEPPE: number, FARMER: number, WHG: number): AdmixBar => ({ period, n, STEPPE, FARMER, WHG });
  d.admixture = {
    bars: [
      bar('FirstFarmers', 3, 0.004, 0.756, 0.24),
      bar('BellBeaker', 4, 0.6349, 0.2551, 0.11),
      bar('BronzeAge', 3, 0.55, 0.33, 0.12),
      bar('IronAge', 3, 0.5, 0.37, 0.13),
      bar('Roman', 2, 0.49, 0.38, 0.13),
      bar('AngloSaxon', 3, 0.51, 0.36, 0.13),
      bar('Viking', 2, 0.52, 0.35, 0.13),
      bar('Today', 4, 0.48, 0.39, 0.13),
    ],
    people: {
      BellBeaker: [
        { STEPPE: 0.5, FARMER: 0.4, WHG: 0.1 }, { STEPPE: 0.7, FARMER: 0.2, WHG: 0.1 },
        { STEPPE: 0.6, FARMER: 0.3, WHG: 0.1 }, { STEPPE: 0.74, FARMER: 0.12, WHG: 0.14 },
      ],
    },
    beaker_steppe_pct: 63,
  };
  return d;
}

const admix = (over: Partial<PlotState>): PlotState => ({ ...INITIAL_PLOT, view: 'admixture', ...over });

function newSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  return svg;
}
const barIds = (svg: SVGSVGElement) => [...svg.querySelectorAll('g.period-bar')].map((g) => g.getAttribute('data-period'));
const h = (el: Element | null) => Number(el?.getAttribute('height'));

afterEach(() => document.body.replaceChildren());

describe('Task 12 text is under the spec §6 scan', () => {
  it('allRenderableStrings() includes the new strings and sample outputs of the new text functions', () => {
    const all = allRenderableStrings();
    expect(steppePctLabel(65)).toBe('65% steppe');
    expect(admixPeopleTitle(PERIOD_LABELS.BellBeaker, 64)).toBe(`${PERIOD_LABELS.BellBeaker}: one bar per person (n = 64)`);
    expect(all).toContain(steppePctLabel(65));
    expect(all).toContain(admixPeopleTitle(PERIOD_LABELS.BellBeaker, 64));
    expect(all).toContain(PLOT_EMPTY);
    expect(all).toContain(TRAIT_Y_LABEL);
  });
});

describe('renderAdmixture: mean bars', () => {
  it('draws First farmers, Bell Beaker and Today when no PCA period has been run', () => {
    const svg = newSvg();
    renderAdmixture(svg, makeData(), admix({ admixShown: [], admixNew: [] }));
    expect(barIds(svg)).toEqual(['FirstFarmers', 'BellBeaker', 'Today']);
    expect([...svg.querySelectorAll('.steppe-pct')].map((t) => t.textContent))
      .toEqual([steppePctLabel(0), steppePctLabel(63), steppePctLabel(48)]);
  });

  it('follows admixShown order and outlines exactly the admixNew bars', () => {
    const svg = newSvg();
    renderAdmixture(svg, makeData(), admix({
      admixShown: ['FirstFarmers', 'BellBeaker', 'IronAge', 'Roman', 'AngloSaxon', 'Today'],
      admixNew: ['IronAge', 'Roman', 'AngloSaxon'],
    }));
    expect(barIds(svg)).toEqual(['FirstFarmers', 'BellBeaker', 'IronAge', 'Roman', 'AngloSaxon', 'Today']);
    expect([...svg.querySelectorAll('g.period-bar.is-new')].map((g) => g.getAttribute('data-period')))
      .toEqual(['IronAge', 'Roman', 'AngloSaxon']);
    expect(svg.querySelectorAll('.new-outline')).toHaveLength(3);
    expect([...svg.querySelectorAll('.bar-label')].map((t) => t.textContent))
      .toEqual(['FirstFarmers', 'BellBeaker', 'IronAge', 'Roman', 'AngloSaxon', 'Today'].map((id) => PERIOD_LABELS[id as PeriodId]));
  });

  it('always shows the exact Beaker callout and the bridging line with the JSON steppe %', () => {
    const svg = newSvg();
    const d = makeData();
    renderAdmixture(svg, d, admix({ admixShown: ['IronAge'], admixNew: [] }));
    expect(svg.querySelector('.admix-callout')?.textContent).toBe(BEAKER_CALLOUT);
    expect(svg.querySelector('.admix-bridge')?.textContent).toBe(beakerBridge(63));
    expect(svg.querySelector('.admix-bridge')?.textContent).toContain('63%');
    // the Bell Beaker bar's own label agrees with the JSON value
    renderAdmixture(svg, d, admix({ admixShown: ['BellBeaker'], admixNew: [] }));
    const bb = d.admixture.bars.find((b) => b.period === 'BellBeaker')!;
    expect(steppePct(bb)).toBe(d.admixture.beaker_steppe_pct);
    expect(svg.querySelector('g.period-bar[data-period="BellBeaker"] .steppe-pct')?.textContent).toBe(steppePctLabel(63));
  });

  it('names the three sources once, in the legend, in steppe/farmer/hunter-gatherer order', () => {
    const svg = newSvg();
    renderAdmixture(svg, makeData(), admix({ admixShown: [], admixNew: [] }));
    expect([...svg.querySelectorAll('.admix-legend .legend-item')].map((t) => t.textContent))
      .toEqual([SOURCE_LABELS.STEPPE, SOURCE_LABELS.FARMER, SOURCE_LABELS.WHG]);
    for (const label of Object.values(SOURCE_LABELS)) {
      expect((svg.textContent ?? '').split(label).length - 1).toBe(1);
    }
  });

  it('stacks steppe at the base with segment heights proportional to the shares', () => {
    const svg = newSvg();
    renderAdmixture(svg, makeData(), admix({ admixShown: ['BellBeaker'], admixNew: [] }));
    const g = svg.querySelector('g.period-bar[data-period="BellBeaker"]')!;
    const steppe = g.querySelector('.seg-STEPPE')!;
    const farmer = g.querySelector('.seg-FARMER')!;
    const whg = g.querySelector('.seg-WHG')!;
    const total = h(steppe) + h(farmer) + h(whg);
    expect(h(steppe) / total).toBeCloseTo(0.6349, 2);
    expect(h(whg) / total).toBeCloseTo(0.11, 2);
    // steppe sits on the baseline
    expect(Number(steppe.getAttribute('y')) + h(steppe)).toBeCloseTo(ADMIX_VIEW.barsBottom, 0);
  });

  it('shows the Anglo-Saxon takeaway only when the Anglo-Saxon bar is drawn', () => {
    const svg = newSvg();
    renderAdmixture(svg, makeData(), admix({ admixShown: ['IronAge', 'Roman'], admixNew: [] }));
    expect(svg.querySelector('.admix-takeaway')).toBeNull();
    renderAdmixture(svg, makeData(), admix({ admixShown: ['IronAge', 'Roman', 'AngloSaxon'], admixNew: ['AngloSaxon'] }));
    expect(svg.querySelector('.admix-takeaway')?.textContent).toBe(ANGLO_SAXON_TAKEAWAY);
  });

  it('skips periods with no bar in the data instead of throwing, and clears the PCA frame marker', () => {
    const svg = newSvg();
    svg.setAttribute('data-frame', 'britain');
    const d = makeData();
    d.admixture.bars = d.admixture.bars.filter((b) => b.period !== 'Viking');
    expect(() => renderAdmixture(svg, d, admix({ admixShown: ['IronAge', 'Viking'], admixNew: ['Viking'] }))).not.toThrow();
    expect(barIds(svg)).toEqual(['IronAge']);
    expect(svg.hasAttribute('data-frame')).toBe(false);
    expect(svg.getAttribute('data-view')).toBe('admixture');
  });
});

describe('renderAdmixture: one bar per person', () => {
  it('draws one thin bar per person, highest steppe first, with callout and bridge', () => {
    const svg = newSvg();
    renderAdmixture(svg, makeData(), admix({ admixPeriod: 'BellBeaker', admixShown: ['BellBeaker'], admixNew: [] }));
    const bars = [...svg.querySelectorAll('g.person-bar')];
    expect(bars).toHaveLength(4);
    expect(svg.querySelectorAll('g.period-bar')).toHaveLength(0);
    const steppeH = bars.map((b) => h(b.querySelector('.seg-STEPPE')));
    expect([...steppeH].sort((a, b) => b - a)).toEqual(steppeH);
    expect(Number(bars[0].querySelector('rect')?.getAttribute('width'))).toBe(230); // 920 / 4
    expect(svg.querySelector('.admix-people-title')?.textContent).toBe(admixPeopleTitle(PERIOD_LABELS.BellBeaker, 4));
    expect(svg.querySelector('.admix-callout')?.textContent).toBe(BEAKER_CALLOUT);
    expect(svg.querySelector('.admix-bridge')?.textContent).toBe(beakerBridge(63));
  });

  it('falls back to the mean bars when the period has no per-person shares', () => {
    const svg = newSvg();
    renderAdmixture(svg, makeData(), admix({ admixPeriod: 'Today', admixShown: ['Today'], admixNew: [] }));
    expect(svg.querySelectorAll('g.person-bar')).toHaveLength(0);
    expect(barIds(svg)).toEqual(['Today']);
  });
});
