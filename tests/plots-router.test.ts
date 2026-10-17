// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/data.fixture.json';
import type { GeneId, PeriodId, WorkshopData } from '../src/types';
import type { PlotAction } from '../src/commands';
import { INITIAL_PLOT, reducePlot, type PlotState } from '../src/plotState';
import { renderPlot } from '../src/plots/index';
import { PLOT_EMPTY } from '../src/content';

const data = (): WorkshopData => structuredClone(fixture) as unknown as WorkshopData;
const ORDER: PeriodId[] = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking', 'Today'];
const GENES: GeneId[] = ['LCT', 'SLC45A2', 'HERC2', 'TYK2', 'HLA-DQ2'];

function host(): HTMLElement {
  const h = document.createElement('div');
  document.body.append(h);
  return h;
}

// §6 rule 1: the only "ago"/"years" phrases allowed on screen, stripped before scanning.
const ALLOWED = ['about 2,000 years ago', 'about 100 generations ago', 'over the last 4,000 years'];
function assertNoDates(text: string): void {
  let t = text;
  for (const a of ALLOWED) t = t.split(a).join(' ');
  expect(t).not.toMatch(/\d[\d,.]*\s*(BCE|BC|BP|CE|kya|ya|years?|generations?)\b/i);
  expect(t).not.toMatch(/\b(years|generations) ago\b/i);
  expect(t).not.toMatch(/Mesolithic|Neolithic|Pal(a)?eolithic|Megalithic|Ice Age/i);
  expect(t).not.toMatch(/FirstFarmers|BellBeaker|BronzeAge|IronAge|AngloSaxon|ItalianNorth|STEPPE|FARMER|WHG|_/);
}

/** Invariants that must hold after every render, whatever order the commands came in. */
function checkRendered(h: HTMLElement, s: PlotState, d: WorkshopData): void {
  expect(h.getAttribute('data-view')).toBe(s.view);
  assertNoDates(h.textContent ?? '');
  if (s.view === 'pca') {
    const svg = h.querySelector('svg.plot-svg')!;
    expect(svg.getAttribute('data-frame')).toBe(s.frame);
    const drawn = [...svg.querySelectorAll('g.layer.period')].map((g) => g.getAttribute('data-layer'));
    expect(drawn).toEqual(['Today', ...ORDER.filter((id) => id !== 'Today' && s.layers.includes(id))]);
    expect(svg.querySelectorAll('[data-marker="north-sea"]')).toHaveLength(s.showNorthSea ? 1 : 0);
    for (const id of ['Roman', 'AngloSaxon'] as PeriodId[]) {
      expect(svg.querySelectorAll(`g.arrow[data-arrow="${id}"]`)).toHaveLength(s.frame === 'britain' && s.layers.includes(id) ? 1 : 0);
    }
  }
  if (s.view === 'admixture') {
    const svg = h.querySelector('svg.plot-svg')!;
    expect(svg.querySelector('.admix-callout')).not.toBeNull();
    expect(svg.querySelector('.admix-bridge')).toBeNull();
    const people = s.admixPeriod ? d.admixture.people[s.admixPeriod] ?? [] : [];
    if (people.length > 0) {
      expect(svg.querySelectorAll('g.person-bar')).toHaveLength(people.length);
    } else {
      const want = (s.admixShown.length ? s.admixShown : ['FirstFarmers', 'BellBeaker', 'Today'])
        .filter((id) => d.admixture.bars.some((b) => b.period === id));
      expect([...svg.querySelectorAll('g.period-bar')].map((g) => g.getAttribute('data-period'))).toEqual(want);
      const outlined = [...svg.querySelectorAll('g.period-bar.is-new')].map((g) => g.getAttribute('data-period'));
      expect(outlined).toEqual(want.filter((id) => s.admixNew.includes(id as PeriodId)));
    }
  }
  if (s.view === 'trait') {
    expect(h.querySelector('.traj')?.getAttribute('data-gene')).toBe(s.gene);
  }
}

function play(actions: PlotAction[]): void {
  const d = data();
  const h = host();
  let s = INITIAL_PLOT;
  renderPlot(h, d, s);
  for (const a of actions) {
    s = reducePlot(s, a, d);
    expect(() => renderPlot(h, d, s)).not.toThrow();
    checkRendered(h, s, d);
  }
}

const pca = (period: PeriodId | 'all'): PlotAction => ({ kind: 'pca', period });
const adm = (period?: PeriodId): PlotAction => (period ? { kind: 'admixture', period } : { kind: 'admixture' });
const trait = (gene: GeneId): PlotAction => ({ kind: 'trait', gene });

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('renderPlot router', () => {
  it('shows the empty-panel text before any drawing command', () => {
    const h = host();
    renderPlot(h, data(), INITIAL_PLOT);
    expect(h.querySelector('.plot-empty')?.textContent).toBe(PLOT_EMPTY);
    expect(h.getAttribute('data-view')).toBe('none');
  });

  it('reuses one svg across PCA and ADMIXTURE, and swaps to HTML for traits', () => {
    const d = data();
    const h = host();
    let s = reducePlot(INITIAL_PLOT, pca('IronAge'), d);
    renderPlot(h, d, s);
    const svg = h.querySelector('svg.plot-svg');
    expect(svg).not.toBeNull();
    s = reducePlot(s, adm(), d);
    renderPlot(h, d, s);
    expect(h.querySelector('svg.plot-svg')).toBe(svg);
    expect(h.children).toHaveLength(1);
    s = reducePlot(s, trait('LCT'), d);
    renderPlot(h, d, s);
    expect(h.querySelector('svg.plot-svg')).toBeNull();
    expect(h.querySelector('.traj')).not.toBeNull();
    s = reducePlot(s, pca('Roman'), d);
    renderPlot(h, d, s);
    expect(h.querySelector('svg.plot-svg')).not.toBeNull();
    expect(h.children).toHaveLength(1);
  });

  it('never throws: a broken data object logs and shows the empty panel', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = host();
    const broken = { ...data(), frames: {} } as unknown as WorkshopData;
    expect(() => renderPlot(h, broken, { ...INITIAL_PLOT, view: 'pca', frame: 'britain', layers: ['Roman'] })).not.toThrow();
    expect(h.querySelector('.plot-empty')?.textContent).toBe(PLOT_EMPTY);
    expect(err).toHaveBeenCalledTimes(1);
  });
});

describe('RF2: out-of-order commands under free pacing', () => {
  it('the guided script in order', () => {
    play([pca('Today'), pca('FirstFarmers'), pca('BellBeaker'), adm(), pca('IronAge'), pca('Roman'), pca('AngloSaxon'), adm(),
      ...GENES.map(trait)]);
  });
  it('Roman before Bell Beaker', () => play([pca('Roman'), pca('BellBeaker'), adm(), pca('IronAge'), adm()]));
  it('run_admixture before any run_pca', () => play([adm(), adm(), pca('Today'), adm()]));
  it('run_pca("all") first, then a British-frame period', () => play([pca('all'), adm(), pca('AngloSaxon'), pca('all')]));
  it('First farmers after Iron Age', () => play([pca('IronAge'), pca('FirstFarmers'), adm(), pca('Roman')]));
  it('repeated commands', () => play([pca('IronAge'), pca('IronAge'), pca('IronAge'), adm(), adm(), trait('TYK2'), trait('TYK2'), pca('IronAge')]));
  it('per-person view in any order, including a period with no per-person data', () =>
    play([adm('BellBeaker'), pca('Viking'), adm('Today'), adm('IronAge'), adm(), pca('BronzeAge')]));
  it('traits interleaved with maps', () => play([trait('HLA-DQ2'), pca('AngloSaxon'), trait('HERC2'), adm(), trait('SLC45A2'), pca('Viking')]));
});

describe('§6 rule 1 across every view the router can draw', () => {
  it('no rendered text shows dates, ages, prehistoric period words or raw ids', () => {
    const d = data();
    const h = host();
    const states: PlotState[] = [
      { ...INITIAL_PLOT, view: 'pca', layers: [...ORDER], frame: 'europe', showNorthSea: true },
      { ...INITIAL_PLOT, view: 'pca', layers: [...ORDER], frame: 'britain', showNorthSea: true },
      { ...INITIAL_PLOT, view: 'admixture', admixShown: [...ORDER], admixNew: [...ORDER] },
      ...ORDER.map((p): PlotState => ({ ...INITIAL_PLOT, view: 'admixture', admixPeriod: p, admixShown: [], admixNew: [] })),
      ...GENES.map((g): PlotState => ({ ...INITIAL_PLOT, view: 'trait', gene: g })),
    ];
    for (const s of states) {
      renderPlot(h, d, s);
      assertNoDates(h.textContent ?? '');
    }
  });
});
