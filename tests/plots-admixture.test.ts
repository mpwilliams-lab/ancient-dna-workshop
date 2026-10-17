// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import fixture from './fixtures/data.fixture.json';
import type { AdmixBar, PeriodId, WorkshopData } from '../src/types';
import type { PlotAction } from '../src/commands';
import type { PcaPeriod } from '../src/parser';
import { INITIAL_PLOT, admixCallout, reducePlot, type PlotState } from '../src/plotState';
import { ADMIX_VIEW, renderAdmixture, steppePct } from '../src/plots/admixture';
import {
  ANGLO_SAXON_TAKEAWAY, BEAKER_CALLOUT, PERIOD_LABELS, PLOT_EMPTY, REVEAL_CALLOUT, SOURCE_LABELS, TRAIT_Y_LABEL,
  admixPeopleTitle, allRenderableStrings, revealNote, steppePctLabel,
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
const pca = (period: PcaPeriod): PlotAction => ({ kind: 'pca', period });
const adm: PlotAction = { kind: 'admixture' };
const play = (d: WorkshopData, actions: PlotAction[]): PlotState => actions.reduce((s, a) => reducePlot(s, a, d), INITIAL_PLOT);
/** The guided path: step 5 (first run_admixture) and step 10 (the reveal run). */
const ADMIX1: PlotAction[] = [pca('Europe'), pca('FirstFarmers'), pca('BellBeaker'), adm];
const REVEAL: PlotAction[] = [...ADMIX1, pca('BronzeAge'), pca('IronAge'), pca('Today'), adm];

function newSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  return svg;
}
const barIds = (svg: SVGSVGElement) => [...svg.querySelectorAll('g.period-bar')].map((g) => g.getAttribute('data-period'));
const outlined = (svg: SVGSVGElement) => [...svg.querySelectorAll('g.period-bar.is-new')].map((g) => g.getAttribute('data-period'));
const h = (el: Element | null) => Number(el?.getAttribute('height'));
const barHeight = (svg: SVGSVGElement) =>
  [...svg.querySelector('g.period-bar')!.querySelectorAll('.seg')].reduce((sum, s) => sum + h(s), 0);

afterEach(() => document.body.replaceChildren());

describe('ADMIXTURE text is under the content scan', () => {
  it('allRenderableStrings() includes the bar strings; the callouts are the spec §3.2/§3.3 text', () => {
    const all = allRenderableStrings();
    expect(steppePctLabel(65)).toBe('65% steppe');
    expect(admixPeopleTitle(PERIOD_LABELS.BellBeaker, 64)).toBe(`${PERIOD_LABELS.BellBeaker}: one bar per person (n = 64)`);
    for (const s of [steppePctLabel(65), admixPeopleTitle(PERIOD_LABELS.BellBeaker, 64), PLOT_EMPTY, TRAIT_Y_LABEL, BEAKER_CALLOUT, REVEAL_CALLOUT]) {
      expect(all).toContain(s);
    }
    expect(BEAKER_CALLOUT).toBe(
      "Within about ten generations of the Beaker people arriving, at least 9 in 10 parts of Britain's DNA came from the newcomers. " +
      "The First farmers / Stonehenge builders' share shrank to about 1 in 10 or less (Olalde et al. 2018).");
    expect(REVEAL_CALLOUT).toBe(
      "Most of Britain's ancestry today was already here by the Iron Age. Later, Anglo-Saxon newcomers added a sizeable share, " +
      'most of it in eastern England (Gretzinger et al. 2022).');
    expect(revealNote(56, 57)).toBe(
      'Britain today: 56% steppe. Iron Age: 57% steppe. Of all the periods, the Iron Age bar is the closest match.');
  });
});

describe('renderAdmixture: the guided path (spec §2.1 steps 5 and 10)', () => {
  it('the first run shows exactly First farmers / Stonehenge builders and Bell Beaker, with the Beaker callout', () => {
    const d = makeData();
    const svg = newSvg();
    renderAdmixture(svg, d, play(d, ADMIX1));
    expect(barIds(svg)).toEqual(['FirstFarmers', 'BellBeaker']);
    expect([...svg.querySelectorAll('.bar-label')].map((t) => t.textContent)).toEqual([PERIOD_LABELS.FirstFarmers, PERIOD_LABELS.BellBeaker]);
    expect(outlined(svg)).toEqual([]); // the first call outlines nothing
    expect(svg.getAttribute('data-callout')).toBe('beaker');
    expect(svg.querySelector('.admix-callout')?.textContent).toBe(BEAKER_CALLOUT);
    expect(svg.getAttribute('aria-label')).toBe(BEAKER_CALLOUT);
    expect(svg.querySelector('.admix-reveal-note')).toBeNull();
    expect(svg.querySelector('.admix-takeaway')).toBeNull();
  });

  it('the reveal run adds Bronze Age, Iron Age and Britain today, outlined, with the reveal callout and note', () => {
    const d = makeData();
    const svg = newSvg();
    const s = play(d, REVEAL);
    expect(admixCallout(s, d).kind).toBe('reveal');
    renderAdmixture(svg, d, s);
    expect(barIds(svg)).toEqual(['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Today']);
    expect(outlined(svg)).toEqual(['BronzeAge', 'IronAge', 'Today']);
    expect(svg.getAttribute('data-callout')).toBe('reveal');
    expect(svg.querySelector('.admix-callout')?.textContent).toBe(REVEAL_CALLOUT);
    expect(svg.getAttribute('aria-label')).toBe(REVEAL_CALLOUT);
    expect(svg.textContent).not.toContain(BEAKER_CALLOUT);
    // the note reads the same whole percents as the bar labels (Today 0.48 -> 48, Iron Age 0.5 -> 50)
    expect(svg.querySelector('.admix-reveal-note')?.textContent).toBe(revealNote(48, 50));
    expect(svg.querySelector('g.period-bar[data-period="Today"] .steppe-pct')?.textContent).toBe(steppePctLabel(48));
    expect(svg.querySelector('g.period-bar[data-period="IronAge"] .steppe-pct')?.textContent).toBe(steppePctLabel(50));
  });

  it('Britain today without the Iron Age keeps the Beaker callout; the Iron Age without Britain today too', () => {
    const d = makeData();
    const svg = newSvg();
    for (const actions of [[pca('Today'), adm], [pca('FirstFarmers'), pca('Today'), adm], [pca('IronAge'), adm]]) {
      renderAdmixture(svg, d, play(d, actions));
      expect(svg.getAttribute('data-callout')).toBe('beaker');
      expect(svg.querySelector('.admix-callout')?.textContent).toBe(BEAKER_CALLOUT);
      expect(svg.querySelector('.admix-reveal-note')).toBeNull();
    }
    renderAdmixture(svg, d, play(d, [pca('Today'), adm]));
    expect(barIds(svg)).toEqual(['Today']);
  });

  it('with no layers the bars are First farmers / Stonehenge builders and Bell Beaker only (no default Britain today)', () => {
    const d = makeData();
    const svg = newSvg();
    renderAdmixture(svg, d, play(d, [adm]));
    expect(barIds(svg)).toEqual(['FirstFarmers', 'BellBeaker']);
    renderAdmixture(svg, d, admix({ admixShown: [], admixNew: [] })); // a hand-built state falls back the same way
    expect(barIds(svg)).toEqual(['FirstFarmers', 'BellBeaker']);
  });

  it('draws no bridge line in any state', () => {
    const d = makeData();
    const svg = newSvg();
    for (const actions of [ADMIX1, REVEAL, [pca('all'), adm], [adm]]) {
      renderAdmixture(svg, d, play(d, actions));
      expect(svg.querySelector('.admix-bridge')).toBeNull();
      expect(svg.textContent).not.toMatch(/not 90%|rises to/);
    }
  });

  it('eight bars with the reveal callout, note and takeaway keep at least 200 px of bar height', () => {
    const d = makeData();
    const svg = newSvg();
    renderAdmixture(svg, d, play(d, [pca('all'), adm]));
    expect(barIds(svg)).toHaveLength(8);
    expect(svg.getAttribute('data-callout')).toBe('reveal');
    expect(svg.querySelector('.admix-reveal-note')).not.toBeNull();
    expect(svg.querySelector('.admix-takeaway')?.textContent).toBe(ANGLO_SAXON_TAKEAWAY);
    expect(barHeight(svg)).toBeGreaterThanOrEqual(200);
  });
});

describe('renderAdmixture: a JSON without the Today or the Iron Age bar', () => {
  it.each(['Today', 'IronAge'] as PeriodId[])('without the %s bar the Beaker callout stays, there is no note, and nothing throws', (missing) => {
    const d = makeData();
    d.admixture.bars = d.admixture.bars.filter((b) => b.period !== missing);
    const s = play(d, REVEAL); // the state still lists both periods; only the data lacks one bar
    expect(s.admixShown).toContain(missing);
    expect(admixCallout(s, d)).toEqual({ kind: 'beaker' });
    const svg = newSvg();
    expect(() => renderAdmixture(svg, d, s)).not.toThrow();
    expect(svg.getAttribute('data-callout')).toBe('beaker');
    expect(svg.querySelector('.admix-callout')?.textContent).toBe(BEAKER_CALLOUT);
    expect(svg.getAttribute('aria-label')).toBe(BEAKER_CALLOUT);
    expect(svg.querySelector('.admix-reveal-note')).toBeNull();
    expect(barIds(svg)).toEqual(s.admixShown.filter((id) => id !== missing));
  });
});

describe('renderAdmixture: one steppe percentage for the bar labels, the note and admixCallout', () => {
  it('reads the same whole percents on values that sit on a rounding edge (a floor or a truncation would differ)', () => {
    const d = makeData();
    // 0.4951 -> 50 (floor 49) and 0.5651 -> 57 (floor 56)
    d.admixture.bars = d.admixture.bars.map((b) =>
      b.period === 'Today' ? { ...b, STEPPE: 0.4951 } : b.period === 'IronAge' ? { ...b, STEPPE: 0.5651 } : b);
    const s = play(d, REVEAL);
    const svg = newSvg();
    renderAdmixture(svg, d, s);
    const label = (id: string) => svg.querySelector(`g.period-bar[data-period="${id}"] .steppe-pct`)?.textContent;
    expect(label('Today')).toBe(steppePctLabel(50));
    expect(label('IronAge')).toBe(steppePctLabel(57));
    expect(svg.querySelector('.admix-reveal-note')?.textContent).toBe(revealNote(50, 57));
    expect(admixCallout(s, d)).toEqual({ kind: 'reveal', todaySteppe: 50, ironSteppe: 57 });
    const bar = (id: string) => d.admixture.bars.find((b) => b.period === id)!;
    expect([steppePct(bar('Today')), steppePct(bar('IronAge'))]).toEqual([50, 57]);
  });
});

describe('renderAdmixture: mean bars', () => {
  it('follows admixShown order and outlines exactly the admixNew bars', () => {
    const svg = newSvg();
    renderAdmixture(svg, makeData(), admix({
      admixShown: ['FirstFarmers', 'BellBeaker', 'IronAge', 'Roman', 'AngloSaxon', 'Today'],
      admixNew: ['IronAge', 'Roman', 'AngloSaxon'],
    }));
    expect(barIds(svg)).toEqual(['FirstFarmers', 'BellBeaker', 'IronAge', 'Roman', 'AngloSaxon', 'Today']);
    expect(outlined(svg)).toEqual(['IronAge', 'Roman', 'AngloSaxon']);
    expect(svg.querySelectorAll('.new-outline')).toHaveLength(3);
    expect([...svg.querySelectorAll('.bar-label')].map((t) => t.textContent))
      .toEqual(['FirstFarmers', 'BellBeaker', 'IronAge', 'Roman', 'AngloSaxon', 'Today'].map((id) => PERIOD_LABELS[id as PeriodId]));
  });

  it('keeps the per-bar steppe labels; the Bell Beaker label agrees with the JSON value', () => {
    const svg = newSvg();
    const d = makeData();
    renderAdmixture(svg, d, admix({ admixShown: ['FirstFarmers', 'BellBeaker', 'Today'], admixNew: [] }));
    expect([...svg.querySelectorAll('.steppe-pct')].map((t) => t.textContent))
      .toEqual([steppePctLabel(0), steppePctLabel(63), steppePctLabel(48)]);
    const bb = d.admixture.bars.find((b) => b.period === 'BellBeaker')!;
    expect(steppePct(bb)).toBe(d.admixture.beaker_steppe_pct);
  });

  it('names the three sources once, in the legend, in steppe/farmer/hunter-gatherer order', () => {
    const svg = newSvg();
    renderAdmixture(svg, makeData(), admix({ admixShown: ['FirstFarmers', 'BellBeaker'], admixNew: [] }));
    expect([...svg.querySelectorAll('.admix-legend .legend-item')].map((t) => t.textContent))
      .toEqual([SOURCE_LABELS.STEPPE, SOURCE_LABELS.FARMER, SOURCE_LABELS.WHG]);
    for (const label of Object.values(SOURCE_LABELS)) expect((svg.textContent ?? '').split(label).length - 1).toBe(1);
  });

  it('stacks steppe at the base with segment heights proportional to the shares', () => {
    const svg = newSvg();
    renderAdmixture(svg, makeData(), admix({ admixShown: ['BellBeaker'], admixNew: [] }));
    const g = svg.querySelector('g.period-bar[data-period="BellBeaker"]')!;
    const steppe = g.querySelector('.seg-STEPPE')!;
    const total = h(steppe) + h(g.querySelector('.seg-FARMER')) + h(g.querySelector('.seg-WHG'));
    expect(h(steppe) / total).toBeCloseTo(0.6349, 2);
    expect(h(g.querySelector('.seg-WHG')) / total).toBeCloseTo(0.11, 2);
    expect(Number(steppe.getAttribute('y')) + h(steppe)).toBeCloseTo(ADMIX_VIEW.barsBottom, 0);
  });

  it('shows the corrected Anglo-Saxon takeaway only when the Anglo-Saxon bar is drawn', () => {
    const svg = newSvg();
    renderAdmixture(svg, makeData(), admix({ admixShown: ['IronAge', 'Roman'], admixNew: [] }));
    expect(svg.querySelector('.admix-takeaway')).toBeNull();
    renderAdmixture(svg, makeData(), admix({ admixShown: ['IronAge', 'Roman', 'AngloSaxon'], admixNew: ['AngloSaxon'] }));
    expect(svg.querySelector('.admix-takeaway')?.textContent).toBe(ANGLO_SAXON_TAKEAWAY);
    expect(ANGLO_SAXON_TAKEAWAY).toBe(
      'A real migration: Anglo-Saxon-period burials sampled in England carry about 76% continental ancestry on average ' +
      '(Gretzinger et al. 2022). Yet the Anglo-Saxon bar looks almost the same as the Iron Age bar: both groups were part ' +
      "steppe herder, part farmer, so this three-colour test can't tell them apart.");
  });

  it('skips periods with no bar in the data instead of throwing, and clears the PCA frame and focus markers', () => {
    const svg = newSvg();
    svg.setAttribute('data-frame', 'britain');
    svg.setAttribute('data-focus', 'IronAge');
    const d = makeData();
    d.admixture.bars = d.admixture.bars.filter((b) => b.period !== 'Viking');
    expect(() => renderAdmixture(svg, d, admix({ admixShown: ['IronAge', 'Viking'], admixNew: ['Viking'] }))).not.toThrow();
    expect(barIds(svg)).toEqual(['IronAge']);
    expect(svg.hasAttribute('data-frame')).toBe(false);
    expect(svg.hasAttribute('data-focus')).toBe(false);
    expect(svg.getAttribute('data-view')).toBe('admixture');
  });
});

describe('renderAdmixture: one bar per person', () => {
  it('draws one thin bar per person, highest steppe first, with no callout; the aria-label is the per-person title', () => {
    const svg = newSvg();
    renderAdmixture(svg, makeData(), admix({ admixPeriod: 'BellBeaker', admixShown: ['BellBeaker'], admixNew: [] }));
    const bars = [...svg.querySelectorAll('g.person-bar')];
    expect(bars).toHaveLength(4);
    expect(svg.querySelectorAll('g.period-bar')).toHaveLength(0);
    const steppeH = bars.map((b) => h(b.querySelector('.seg-STEPPE')));
    expect([...steppeH].sort((a, b) => b - a)).toEqual(steppeH);
    expect(Number(bars[0]!.querySelector('rect')?.getAttribute('width'))).toBe(230); // 920 / 4
    const title = admixPeopleTitle(PERIOD_LABELS.BellBeaker, 4);
    expect(svg.querySelector('.admix-people-title')?.textContent).toBe(title);
    expect(svg.getAttribute('data-callout')).toBe('none');
    expect(svg.getAttribute('aria-label')).toBe(title);
    expect(svg.querySelector('.admix-callout')).toBeNull();
    expect(svg.querySelector('.admix-reveal-note')).toBeNull();
  });

  it('falls back to the mean bars when the period has no per-person shares, still without a callout', () => {
    const svg = newSvg();
    renderAdmixture(svg, makeData(), admix({ admixPeriod: 'Today', admixShown: ['Today'], admixNew: [] }));
    expect(svg.querySelectorAll('g.person-bar')).toHaveLength(0);
    expect(barIds(svg)).toEqual(['Today']);
    expect(svg.getAttribute('data-callout')).toBe('none');
    expect(svg.getAttribute('aria-label')).toBe(PERIOD_LABELS.Today);
  });

  it('the per-person view never shows the reveal callout, even when Britain today and the Iron Age are both on the bars', () => {
    const d = makeData();
    const svg = newSvg();
    renderAdmixture(svg, d, { ...play(d, REVEAL), admixPeriod: 'BellBeaker' });
    expect(svg.getAttribute('data-callout')).toBe('none');
    expect(svg.querySelector('.admix-callout')).toBeNull();
    expect(svg.querySelector('.admix-reveal-note')).toBeNull();
    expect(svg.textContent).not.toContain(REVEAL_CALLOUT);
  });
});
