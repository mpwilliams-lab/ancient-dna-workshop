import { describe, it, expect } from 'vitest';
import fixtureRaw from './fixtures/data.fixture.json';
import type { WorkshopData, PeriodId, FrameId } from '../src/types';
import type { Command } from '../src/parser';
import type { PlotAction } from '../src/commands';
import { execute } from '../src/commands';
import { advance, SCRIPT } from '../src/hints';
import { INITIAL_PLOT, reducePlot, type PlotState } from '../src/plotState';

const data = fixtureRaw as unknown as WorkshopData;
const PERIODS: PeriodId[] = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking', 'Today'];
const FRAME: Record<PeriodId | 'all', FrameId> = {
  Today: 'europe', FirstFarmers: 'europe', BellBeaker: 'europe', all: 'europe',
  BronzeAge: 'britain', IronAge: 'britain', Roman: 'britain', AngloSaxon: 'britain', Viking: 'britain',
};
const pca = (period: PeriodId | 'all'): PlotAction => ({ kind: 'pca', period });
const run = (actions: PlotAction[], from: PlotState = INITIAL_PLOT): PlotState => actions.reduce((s, a) => reducePlot(s, a, data), from);
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') { Object.values(o as object).forEach(deepFreeze); Object.freeze(o); }
  return o;
}

describe('fixture guard', () => {
  it('fixture periods carry the contract order and frames', () => {
    expect(data.periods.map((p) => p.id)).toEqual(PERIODS);
    for (const p of data.periods) { expect(p.order).toBe(PERIODS.indexOf(p.id)); expect(p.frame).toBe(FRAME[p.id]); }
  });
});

describe('reducePlot: PCA (spec §4.4)', () => {
  it('starts empty', () => {
    expect(INITIAL_PLOT).toEqual({ view: 'none', layers: [], frame: 'europe', showNorthSea: false, admixShown: [], admixNew: [] });
  });
  it('a none action returns the same state object', () => {
    const s = run([pca('IronAge')]);
    expect(reducePlot(s, { kind: 'none' }, data)).toBe(s);
  });
  it('always includes the Today base layer, even if Today was never run', () => {
    expect(run([pca('BellBeaker')])).toEqual({ ...INITIAL_PLOT, view: 'pca', layers: ['BellBeaker', 'Today'], frame: 'europe' });
    expect(run([pca('Today')]).layers).toEqual(['Today']);
  });
  it('the frame depends only on the period just run, never on history', () => {
    for (const prior of [[], [pca('IronAge')], [pca('Today')], [pca('all')], [pca('Viking'), pca('FirstFarmers')]]) {
      for (const p of [...PERIODS, 'all' as const]) expect(run([...prior, pca(p)]).frame).toBe(FRAME[p]);
    }
  });
  it('run_pca("all") adds every layer at once in the full frame, with the North Sea marker', () => {
    expect(run([pca('Roman'), pca('all')])).toEqual({
      ...INITIAL_PLOT, view: 'pca', layers: PERIODS, frame: 'europe', showNorthSea: true,
    });
  });
  it('the North Sea marker appears once AngloSaxon or Viking has been run, and stays', () => {
    expect(run([pca('IronAge'), pca('Roman')]).showNorthSea).toBe(false);
    expect(run([pca('AngloSaxon')]).showNorthSea).toBe(true);
    expect(run([pca('Viking')]).showNorthSea).toBe(true);
    expect(run([pca('AngloSaxon'), pca('Today'), { kind: 'trait', gene: 'LCT' }, pca('FirstFarmers')]).showNorthSea).toBe(true);
  });
  it('Roman before BellBeaker: layers stay in time order, frame follows the last period', () => {
    const afterRoman = run([pca('Roman')]);
    expect(afterRoman.layers).toEqual(['Roman', 'Today']);
    expect(afterRoman.frame).toBe('britain');
    const afterBeaker = reducePlot(afterRoman, pca('BellBeaker'), data);
    expect(afterBeaker.layers).toEqual(['BellBeaker', 'Roman', 'Today']);
    expect(afterBeaker.frame).toBe('europe');
  });
  it('FirstFarmers after IronAge: zooms back out to Europe and keeps both layers', () => {
    const s = run([pca('IronAge'), pca('FirstFarmers')]);
    expect(s.layers).toEqual(['FirstFarmers', 'IronAge', 'Today']);
    expect(s.frame).toBe('europe');
  });
  it('repeating a command changes nothing', () => {
    const once = run([pca('Today'), pca('IronAge')]);
    expect(reducePlot(once, pca('IronAge'), data)).toEqual(once);
  });
  it('a trait in between keeps the layers; the next run_pca redraws all of them', () => {
    const s = run([pca('IronAge'), pca('AngloSaxon'), { kind: 'trait', gene: 'TYK2' }]);
    expect(s.view).toBe('trait');
    expect(s.gene).toBe('TYK2');
    const back = reducePlot(s, pca('Roman'), data);
    expect(back.view).toBe('pca');
    expect(back.layers).toEqual(['IronAge', 'Roman', 'AngloSaxon', 'Today']);
  });
  it('an unknown period leaves the state untouched', () => {
    const s = run([pca('IronAge')]);
    expect(reducePlot(s, { kind: 'pca', period: 'Neolithic' } as unknown as PlotAction, data)).toBe(s);
    expect(reducePlot(s, { kind: 'admixture', period: 'Neolithic' } as unknown as PlotAction, data)).toBe(s);
    expect(reducePlot(s, { kind: 'trait', gene: 'XYZ' } as unknown as PlotAction, data)).toBe(s);
    expect(reducePlot(s, { kind: 'bogus' } as unknown as PlotAction, data)).toBe(s);
  });
  it('never mutates the previous state', () => {
    const s = deepFreeze(run([pca('IronAge')]));
    expect(() => run([pca('Viking'), { kind: 'admixture' }, { kind: 'admixture', period: 'Viking' }, { kind: 'trait', gene: 'LCT' }, pca('all')], s)).not.toThrow();
    expect(s.layers).toEqual(['IronAge', 'Today']);
  });
});

describe('reducePlot: ADMIXTURE bars (spec §4.4)', () => {
  it('run_admixture before any run_pca draws First farmers, BellBeaker and Today, none outlined', () => {
    const s = run([{ kind: 'admixture' }]);
    expect(s).toEqual({ ...INITIAL_PLOT, view: 'admixture', admixShown: ['FirstFarmers', 'BellBeaker', 'Today'], admixNew: [] });
  });
  it('guided path: first call shows FF, BB, Today; second outlines the three periods added since', () => {
    const first = run([pca('Today'), pca('FirstFarmers'), pca('BellBeaker'), { kind: 'admixture' }]);
    expect(first.admixShown).toEqual(['FirstFarmers', 'BellBeaker', 'Today']);
    expect(first.admixNew).toEqual([]);
    const second = run([pca('IronAge'), pca('Roman'), pca('AngloSaxon'), { kind: 'admixture' }], first);
    expect(second.admixShown).toEqual(['FirstFarmers', 'BellBeaker', 'IronAge', 'Roman', 'AngloSaxon', 'Today']);
    expect(second.admixNew).toEqual(['IronAge', 'Roman', 'AngloSaxon']);
    expect(second.layers).toEqual(['FirstFarmers', 'BellBeaker', 'IronAge', 'Roman', 'AngloSaxon', 'Today']);
  });
  it('bars match the periods whose PCA layer has been run, in time order with Today last', () => {
    const s = run([pca('Viking'), pca('BronzeAge'), { kind: 'admixture' }]);
    expect(s.admixShown).toEqual(['BronzeAge', 'Viking', 'Today']);
    expect(run([pca('all'), { kind: 'admixture' }]).admixShown).toEqual(PERIODS);
  });
  it('a repeated run_admixture outlines nothing new', () => {
    const s = run([pca('BellBeaker'), { kind: 'admixture' }, { kind: 'admixture' }]);
    expect(s.admixShown).toEqual(['BellBeaker', 'Today']);
    expect(s.admixNew).toEqual([]);
  });
  it('after the default bars, running a PCA period then ADMIXTURE outlines only that period', () => {
    const s = run([{ kind: 'admixture' }, pca('IronAge'), { kind: 'admixture' }]);
    expect(s.admixShown).toEqual(['IronAge', 'Today']);
    expect(s.admixNew).toEqual(['IronAge']);
  });
  it('period = P shows one bar per person and leaves the mean-bar bookkeeping alone', () => {
    // The guided second call, so admixNew is not empty and "leaves it alone" is a real claim.
    const before = run([
      pca('Today'), pca('FirstFarmers'), pca('BellBeaker'), { kind: 'admixture' },
      pca('IronAge'), pca('Roman'), pca('AngloSaxon'), { kind: 'admixture' },
    ]);
    expect(before.admixNew).toEqual(['IronAge', 'Roman', 'AngloSaxon']);
    const per = reducePlot(before, { kind: 'admixture', period: 'BellBeaker' }, data);
    expect(per.view).toBe('admixture');
    expect(per.admixPeriod).toBe('BellBeaker');
    expect(per.admixShown).toEqual(before.admixShown);
    expect(per.admixNew).toEqual(before.admixNew);
    const back = reducePlot(per, { kind: 'admixture' }, data);
    expect(back.admixPeriod).toBeUndefined();
    expect('admixPeriod' in back).toBe(false);
  });
  it('a trait switches the view and records the gene', () => {
    const s = run([pca('Today'), { kind: 'trait', gene: 'HERC2' }]);
    expect(s).toEqual({ ...INITIAL_PLOT, view: 'trait', layers: ['Today'], gene: 'HERC2' });
  });
});

describe('RF2: free-pacing sequences through execute -> reducePlot -> advance', () => {
  function play(cmds: Command[]): { i: number; plot: PlotState } {
    let i = 0;
    let plot = INITIAL_PLOT;
    for (const c of cmds) {
      const r = execute(c, data);
      plot = reducePlot(plot, r.plot, data);
      if (!r.refused) i = advance(i, c);
    }
    return { i, plot };
  }
  it('the full guided script ends on the last trait with every layer (the finale ran all)', () => {
    const { i, plot } = play(SCRIPT);
    expect(i).toBe(19);
    expect(plot.view).toBe('trait');
    expect(plot.gene).toBe('HLA-DQ2');
    expect(plot.layers).toEqual(PERIODS);
    expect(plot.admixNew).toEqual(['BronzeAge', 'IronAge']); // Task 5 makes this Bronze Age, Iron Age and Britain today
    expect(plot.showNorthSea).toBe(true);
  });
  it('a student who races ahead keeps every plot but the hint waits at the first unfinished step', () => {
    const { i, plot } = play([
      { name: 'run_pca', period: 'Roman' }, { name: 'run_admixture', K: 3 }, { name: 'run_pca', period: 'all' },
      { name: 'ancestry_test', person: 'me' }, { name: 'run_admixture', K: 4 }, { name: 'run_pca', period: 'FirstFarmers' },
    ]);
    expect(i).toBe(1);
    expect(plot.view).toBe('pca');
    expect(plot.frame).toBe('europe');
    expect(plot.layers).toEqual(PERIODS);
    expect(plot.admixShown).toEqual(['Roman', 'Today']);
  });
});
