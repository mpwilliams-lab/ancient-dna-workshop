// Plot-state model v3 (spec v3 §2.3, §9.1; CONTRACT §4.5). Rewritten for v3: Britain today is never added automatically.
import { describe, it, expect } from 'vitest';
import fixtureRaw from './fixtures/data.fixture.json';
import type { WorkshopData, PeriodId, FrameId } from '../src/types';
import { PERIOD_FRAME } from '../src/types';
import type { Command, PcaPeriod } from '../src/parser';
import type { PlotAction } from '../src/commands';
import { execute } from '../src/commands';
import { advance, SCRIPT } from '../src/hints';
import {
  CHIP_DNA_CHANGED, CHIP_DNA_CHANGED_EAST, EUROPE_CAPTION, FINALE_CAPTION, PCA_CAPTION, REVEAL_PCA_CAPTION,
  ROMAN_FOCUS_CAPTION, zoomNote,
} from '../src/content';
import {
  INITIAL_PLOT, admixBars, admixCallout, layerOpacity, pcaCaptions, reducePlot, steppePct, todayShown, zoomFactor,
  type PcaCaptionItem, type PlotState,
} from '../src/plotState';

const data = fixtureRaw as unknown as WorkshopData;
const PERIODS: PeriodId[] = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking', 'Today'];
/** Spec v3 §2.3 frames: Europe frame for Europe, FirstFarmers, BellBeaker and all; British frame for everything else, Today included. */
const FRAME: Record<PcaPeriod, FrameId> = {
  Europe: 'europe', all: 'europe', FirstFarmers: 'europe', BellBeaker: 'europe',
  BronzeAge: 'britain', IronAge: 'britain', Roman: 'britain', AngloSaxon: 'britain', Viking: 'britain', Today: 'britain',
};
const pca = (period: PcaPeriod): PlotAction => ({ kind: 'pca', period });
const adm = (period?: PeriodId): PlotAction => (period === undefined ? { kind: 'admixture' } : { kind: 'admixture', period });
const run = (actions: PlotAction[], from: PlotState = INITIAL_PLOT, d: WorkshopData = data): PlotState =>
  actions.reduce((s, a) => reducePlot(s, a, d), from);
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') { Object.values(o as object).forEach(deepFreeze); Object.freeze(o); }
  return o;
}
const keys = (items: PcaCaptionItem[]): string[] => items.map((i) => (i.kind === 'zoom' ? 'zoom' : i.key));

/** The guided plot actions of spec v3 §2.1, steps 2 to 13 (the steps that draw). */
const GUIDED: [string, PlotAction][] = [
  ['europe', pca('Europe')], ['firstFarmers', pca('FirstFarmers')], ['bellBeaker', pca('BellBeaker')], ['admix1', adm()],
  ['bronzeAge', pca('BronzeAge')], ['ironAge', pca('IronAge')], ['revealPca', pca('Today')], ['revealAdmix', adm()],
  ['roman', pca('Roman')], ['angloSaxon', pca('AngloSaxon')], ['finale', pca('all')],
];
function guidedUpTo(id: string): PlotState {
  const k = GUIDED.findIndex(([g]) => g === id);
  return run(GUIDED.slice(0, k + 1).map(([, a]) => a));
}

describe('fixture and constants', () => {
  it('fixture periods carry the contract order; their JSON frames agree with PERIOD_FRAME except Today (either is valid)', () => {
    expect(data.periods.map((p) => p.id)).toEqual(PERIODS);
    for (const p of data.periods) {
      expect(p.order).toBe(PERIODS.indexOf(p.id));
      if (p.id === 'Today') expect(['europe', 'britain']).toContain(p.frame);
      else expect(p.frame).toBe(PERIOD_FRAME[p.id]);
    }
  });
  it('PERIOD_FRAME puts Britain today in the British frame (spec v3 §2.3)', () => {
    expect(PERIOD_FRAME).toEqual({
      FirstFarmers: 'europe', BellBeaker: 'europe', BronzeAge: 'britain', IronAge: 'britain',
      Roman: 'britain', AngloSaxon: 'britain', Viking: 'britain', Today: 'britain',
    });
  });
  it('starts empty, with no focus', () => {
    expect(INITIAL_PLOT).toEqual({ view: 'none', layers: [], frame: 'europe', showNorthSea: false, admixShown: [], admixNew: [] });
    expect(todayShown(INITIAL_PLOT)).toBe(false);
  });
});

describe('reducePlot: PCA layers, focus and frames', () => {
  it('a none action returns the same state object', () => {
    const s = run([pca('IronAge')]);
    expect(reducePlot(s, { kind: 'none' }, data)).toBe(s);
  });
  it('Britain today is never added automatically', () => {
    expect(run([pca('BellBeaker')])).toEqual({ ...INITIAL_PLOT, view: 'pca', layers: ['BellBeaker'], focus: 'BellBeaker', frame: 'europe' });
    const s = run([pca('FirstFarmers'), pca('BellBeaker'), adm(), pca('BronzeAge'), pca('IronAge'), pca('Roman'), pca('AngloSaxon'), pca('Viking')]);
    expect(s.layers).not.toContain('Today');
    expect(todayShown(s)).toBe(false);
  });
  it('Britain today enters only through run_pca(Today) or run_pca(all)', () => {
    expect(run([pca('Today')]).layers).toEqual(['Today']);
    expect(todayShown(run([pca('Today')]))).toBe(true);
    expect(run([pca('all')]).layers).toEqual(PERIODS);
    expect(todayShown(run([pca('Europe')]))).toBe(false);
  });
  it('the frame comes from the app constant for the period just run, never from history', () => {
    for (const prior of [[], [pca('IronAge')], [pca('Today')], [pca('all')], [pca('Europe')], [pca('Viking'), pca('FirstFarmers')]]) {
      for (const p of [...PERIODS, 'all' as const, 'Europe' as const]) expect(run([...prior, pca(p)]).frame, `${p}`).toBe(FRAME[p]);
    }
  });
  it('the frame never comes from periods[].frame in the JSON (RF2)', () => {
    const d = structuredClone(data);
    for (const p of d.periods) p.frame = p.frame === 'europe' ? 'britain' : 'europe';
    for (const p of PERIODS) expect(run([pca(p)], INITIAL_PLOT, d).frame, p).toBe(PERIOD_FRAME[p]);
  });
  it('the focus is the period just run', () => {
    expect(run([pca('IronAge')]).focus).toBe('IronAge');
    expect(run([pca('IronAge'), pca('FirstFarmers')]).focus).toBe('FirstFarmers');
    expect(run([pca('IronAge'), pca('Europe')]).focus).toBe('Europe');
    expect(run([pca('IronAge'), pca('all')]).focus).toBe('all');
    expect(run([pca('IronAge'), { kind: 'trait', gene: 'LCT' }]).focus).toBe('IronAge');   // a trait keeps it
    expect(run([pca('IronAge'), adm()]).focus).toBe('IronAge');                            // so do the bars
  });
  it('run_pca(Europe): PCA view, Europe frame, focus Europe, layers and North Sea marker unchanged', () => {
    const before = run([pca('IronAge'), pca('AngloSaxon')]);
    const after = reducePlot(before, pca('Europe'), data);
    expect(after).toEqual({ ...before, view: 'pca', focus: 'Europe', frame: 'europe' });
    expect(run([pca('Europe')])).toEqual({ ...INITIAL_PLOT, view: 'pca', focus: 'Europe', frame: 'europe' });
  });
  it('run_pca(all): all eight layers, focus all, Europe frame, North Sea marker on', () => {
    expect(run([pca('Roman'), pca('all')])).toEqual({
      ...INITIAL_PLOT, view: 'pca', layers: PERIODS, focus: 'all', frame: 'europe', showNorthSea: true,
    });
  });
  it('the North Sea marker appears once AngloSaxon or Viking has been run, and stays', () => {
    expect(run([pca('IronAge'), pca('Roman')]).showNorthSea).toBe(false);
    expect(run([pca('AngloSaxon')]).showNorthSea).toBe(true);
    expect(run([pca('Viking')]).showNorthSea).toBe(true);
    expect(run([pca('AngloSaxon'), pca('Today'), { kind: 'trait', gene: 'LCT' }, pca('FirstFarmers'), pca('Europe')]).showNorthSea).toBe(true);
  });
  it('Roman before BellBeaker: layers stay in time order, frame and focus follow the last period', () => {
    const afterRoman = run([pca('Roman')]);
    expect(afterRoman.layers).toEqual(['Roman']);
    expect(afterRoman.frame).toBe('britain');
    const afterBeaker = reducePlot(afterRoman, pca('BellBeaker'), data);
    expect(afterBeaker.layers).toEqual(['BellBeaker', 'Roman']);
    expect(afterBeaker.frame).toBe('europe');
    expect(afterBeaker.focus).toBe('BellBeaker');
  });
  it('Today early (free pacing): Britain today shows at once, in the British frame, with no reveal caption yet', () => {
    const s = run([pca('Europe'), pca('Today')]);
    expect(s.layers).toEqual(['Today']);
    expect(s.frame).toBe('britain');
    expect(keys(pcaCaptions(s, data))).toEqual(['PCA_CAPTION', 'zoom']);
    const later = run([pca('FirstFarmers'), pca('IronAge')], s);
    expect(later.layers).toEqual(['FirstFarmers', 'IronAge', 'Today']);
  });
  it('repeating a command changes nothing', () => {
    const once = run([pca('Today'), pca('IronAge')]);
    expect(reducePlot(once, pca('IronAge'), data)).toEqual(once);
    const europe = run([pca('Europe')]);
    expect(reducePlot(europe, pca('Europe'), data)).toEqual(europe);
  });
  it('a trait in between keeps the layers; the next run_pca redraws all of them', () => {
    const s = run([pca('IronAge'), pca('AngloSaxon'), { kind: 'trait', gene: 'TYK2' }]);
    expect(s.view).toBe('trait');
    expect(s.gene).toBe('TYK2');
    const back = reducePlot(s, pca('Roman'), data);
    expect(back.view).toBe('pca');
    expect(back.layers).toEqual(['IronAge', 'Roman', 'AngloSaxon']);
  });
  it('an unknown period, gene or action leaves the state untouched; a consumer action does nothing until Task 18', () => {
    const s = run([pca('IronAge')]);
    expect(reducePlot(s, { kind: 'pca', period: 'Neolithic' } as unknown as PlotAction, data)).toBe(s);
    expect(reducePlot(s, { kind: 'admixture', period: 'Neolithic' } as unknown as PlotAction, data)).toBe(s);
    expect(reducePlot(s, { kind: 'trait', gene: 'XYZ' } as unknown as PlotAction, data)).toBe(s);
    expect(reducePlot(s, { kind: 'bogus' } as unknown as PlotAction, data)).toBe(s);
    expect(reducePlot(s, { kind: 'consumer', person: 'IronAge' }, data)).toBe(s);
  });
  it('never mutates the previous state', () => {
    const s = deepFreeze(run([pca('IronAge')]));
    expect(() => run([pca('Viking'), adm(), adm('Viking'), { kind: 'trait', gene: 'LCT' }, pca('all'), pca('Europe')], s)).not.toThrow();
    expect(s.layers).toEqual(['IronAge']);
    expect(s.focus).toBe('IronAge');
  });
});

describe('layerOpacity: focus fading (spec v3 §2.3)', () => {
  it('no fading without a focus, or with the focus on Europe or all', () => {
    for (const focus of [undefined, 'Europe', 'all'] as const) {
      const s: PlotState = { ...INITIAL_PLOT, view: 'pca', layers: PERIODS, ...(focus ? { focus } : {}) };
      for (const id of PERIODS) expect(layerOpacity(s, id), `${focus}/${id}`).toBe('1');
    }
  });
  it('focus 1, Iron Age 0.6 when the focus is Today, Roman or AngloSaxon, everything else 0.3', () => {
    for (const focus of PERIODS) {
      const s: PlotState = { ...INITIAL_PLOT, view: 'pca', layers: PERIODS, focus };
      for (const id of PERIODS) {
        const want = id === focus ? '1' : id === 'IronAge' && ['Today', 'Roman', 'AngloSaxon'].includes(focus) ? '0.6' : '0.3';
        expect(layerOpacity(s, id), `focus ${focus}, layer ${id}`).toBe(want);
      }
    }
  });
  it('values are the strings the SVG gets', () => {
    const s = guidedUpTo('angloSaxon');
    expect([layerOpacity(s, 'AngloSaxon'), layerOpacity(s, 'IronAge'), layerOpacity(s, 'FirstFarmers')]).toEqual(['1', '0.6', '0.3']);
  });
});

describe('zoomFactor', () => {
  it('is round(min of the two span ratios) of the JSON frames', () => {
    expect(zoomFactor(data)).toBe(7);   // fixture: 0.12 / 0.018 = 6.67 on both axes
    const d = structuredClone(data);
    d.frames = { europe: { xmin: -0.02943, xmax: 0.0775, ymin: -0.07073, ymax: 0.02116 }, britain: { xmin: -0.01254, xmax: 0.00382, ymin: -0.00054, ymax: 0.01797 } };
    expect(zoomFactor(d)).toBe(5);      // the current real frames: min(6.54, 4.96) = 4.96 -> 5 (pinned on the real JSON in real-data.test.ts)
  });
});

describe('pcaCaptions: the caption strip per state (spec v3 §2.3, §3.5)', () => {
  it('the guided path, step by step', () => {
    const z = 'zoom';
    expect(keys(pcaCaptions(guidedUpTo('europe'), data))).toEqual(['PCA_CAPTION', 'EUROPE_CAPTION']);
    expect(keys(pcaCaptions(guidedUpTo('firstFarmers'), data))).toEqual(['PCA_CAPTION']);
    expect(keys(pcaCaptions(guidedUpTo('bellBeaker'), data))).toEqual(['PCA_CAPTION', 'CHIP_DNA_CHANGED']);
    expect(keys(pcaCaptions(guidedUpTo('bronzeAge'), data))).toEqual(['PCA_CAPTION', z]);
    expect(keys(pcaCaptions(guidedUpTo('ironAge'), data))).toEqual(['PCA_CAPTION', z]);
    expect(keys(pcaCaptions(guidedUpTo('revealPca'), data))).toEqual(['PCA_CAPTION', 'REVEAL_PCA_CAPTION', z]);
    expect(keys(pcaCaptions(guidedUpTo('roman'), data))).toEqual(['PCA_CAPTION', 'ROMAN_FOCUS_CAPTION', z]);
    expect(keys(pcaCaptions(guidedUpTo('angloSaxon'), data))).toEqual(['PCA_CAPTION', 'CHIP_DNA_CHANGED_EAST', z]);
    expect(keys(pcaCaptions(guidedUpTo('finale'), data))).toEqual(['PCA_CAPTION', 'FINALE_CAPTION']);
  });
  it('carries the exact texts, the chip icons and the zoom note from the data', () => {
    const items = [...pcaCaptions(guidedUpTo('bellBeaker'), data), ...pcaCaptions(guidedUpTo('angloSaxon'), data), ...pcaCaptions(guidedUpTo('europe'), data)];
    expect(items).toContainEqual({ kind: 'caption', key: 'PCA_CAPTION', text: PCA_CAPTION });
    expect(items).toContainEqual({ kind: 'caption', key: 'EUROPE_CAPTION', text: EUROPE_CAPTION });
    expect(items).toContainEqual({ kind: 'chip', key: 'CHIP_DNA_CHANGED', text: CHIP_DNA_CHANGED, icon: 'dna' });
    expect(items).toContainEqual({ kind: 'chip', key: 'CHIP_DNA_CHANGED_EAST', text: CHIP_DNA_CHANGED_EAST, icon: 'dna' });
    expect(items).toContainEqual({ kind: 'zoom', text: zoomNote(7) });
    expect(pcaCaptions(guidedUpTo('revealPca'), data)).toContainEqual({ kind: 'caption', key: 'REVEAL_PCA_CAPTION', text: REVEAL_PCA_CAPTION });
    expect(pcaCaptions(guidedUpTo('roman'), data)).toContainEqual({ kind: 'caption', key: 'ROMAN_FOCUS_CAPTION', text: ROMAN_FOCUS_CAPTION });
    expect(pcaCaptions(guidedUpTo('finale'), data)).toContainEqual({ kind: 'caption', key: 'FINALE_CAPTION', text: FINALE_CAPTION });
  });
  it('Europe after Britain today is shown: no "held back" caption', () => {
    expect(keys(pcaCaptions(run([pca('Today'), pca('Europe')]), data))).toEqual(['PCA_CAPTION']);
    expect(keys(pcaCaptions(run([pca('all'), pca('Europe')]), data))).toEqual(['PCA_CAPTION']);
  });
  it('the reveal caption needs Iron Age on the map: Today without it shows only the zoom note', () => {
    expect(keys(pcaCaptions(run([pca('FirstFarmers'), pca('Today')]), data))).toEqual(['PCA_CAPTION', 'zoom']);
    expect(keys(pcaCaptions(run([pca('IronAge'), pca('Today')]), data))).toEqual(['PCA_CAPTION', 'REVEAL_PCA_CAPTION', 'zoom']);
  });
  it('every British-frame PCA has the zoom note last; no Europe-frame PCA has one', () => {
    for (const p of [...PERIODS, 'all' as const, 'Europe' as const]) {
      const items = pcaCaptions(run([pca('IronAge'), pca(p)]), data);
      expect(items[items.length - 1]!.kind === 'zoom', p).toBe(FRAME[p] === 'britain');
      expect(items.filter((i) => i.kind === 'zoom').length, p).toBe(FRAME[p] === 'britain' ? 1 : 0);
    }
  });
});

describe('ADMIXTURE bars and callout (spec v3 §2.3)', () => {
  it('admixBars: the layers in time order, or First farmers + Bell Beaker when nothing is mapped', () => {
    expect(admixBars(INITIAL_PLOT)).toEqual(['FirstFarmers', 'BellBeaker']);
    expect(admixBars(run([pca('Europe')]))).toEqual(['FirstFarmers', 'BellBeaker']);
    expect(admixBars(run([pca('Viking'), pca('BronzeAge')]))).toEqual(['BronzeAge', 'Viking']);
    expect(admixBars(run([pca('Today')]))).toEqual(['Today']);
  });
  it('run_admixture before any run_pca draws First farmers and Bell Beaker, none outlined, no Britain today', () => {
    expect(run([adm()])).toEqual({ ...INITIAL_PLOT, view: 'admixture', admixShown: ['FirstFarmers', 'BellBeaker'], admixNew: [] });
  });
  it('guided path: admix1 shows exactly First farmers + Bell Beaker; revealAdmix outlines Bronze Age, Iron Age and Britain today', () => {
    const first = guidedUpTo('admix1');
    expect(first.admixShown).toEqual(['FirstFarmers', 'BellBeaker']);
    expect(first.admixNew).toEqual([]);
    const second = guidedUpTo('revealAdmix');
    expect(second.admixShown).toEqual(['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Today']);
    expect(second.admixNew).toEqual(['BronzeAge', 'IronAge', 'Today']);
  });
  it('bars follow the mapped periods in time order; all gives all eight', () => {
    expect(run([pca('Viking'), pca('BronzeAge'), adm()]).admixShown).toEqual(['BronzeAge', 'Viking']);
    expect(run([pca('all'), adm()]).admixShown).toEqual(PERIODS);
  });
  it('a repeated run_admixture outlines nothing new', () => {
    const s = run([pca('BellBeaker'), adm(), adm()]);
    expect(s.admixShown).toEqual(['BellBeaker']);
    expect(s.admixNew).toEqual([]);
  });
  it('period = P shows one bar per person and leaves the mean-bar bookkeeping alone', () => {
    const before = guidedUpTo('revealAdmix');
    const per = reducePlot(before, adm('BellBeaker'), data);
    expect(per.view).toBe('admixture');
    expect(per.admixPeriod).toBe('BellBeaker');
    expect(per.admixShown).toEqual(before.admixShown);
    expect(per.admixNew).toEqual(before.admixNew);
    const back = reducePlot(per, adm(), data);
    expect('admixPeriod' in back).toBe(false);
  });
  it('admixCallout: Beaker at admix1, reveal with the JSON steppe percents at revealAdmix, none per person', () => {
    expect(admixCallout(guidedUpTo('admix1'), data)).toEqual({ kind: 'beaker' });
    expect(admixCallout(guidedUpTo('revealAdmix'), data)).toEqual({ kind: 'reveal', todaySteppe: 56, ironSteppe: 57 }); // fixture 0.556 / 0.571
    expect(admixCallout(reducePlot(guidedUpTo('revealAdmix'), adm('IronAge'), data), data)).toEqual({ kind: 'none' });
  });
  it('admixCallout: Britain today without Iron Age keeps the Beaker callout; Iron Age without Britain today too', () => {
    expect(admixCallout(run([pca('FirstFarmers'), pca('Today'), adm()]), data)).toEqual({ kind: 'beaker' });
    expect(admixCallout(run([pca('IronAge'), adm()]), data)).toEqual({ kind: 'beaker' });
    expect(admixCallout(run([pca('all'), adm()]), data)).toMatchObject({ kind: 'reveal' });
    expect(admixCallout(INITIAL_PLOT, data)).toEqual({ kind: 'beaker' });
  });
  it('admixCallout: falls back to the Beaker callout, and never throws, when the JSON lacks the Today bar or the Iron Age bar', () => {
    const s = guidedUpTo('revealAdmix');
    expect(s.admixShown).toEqual(expect.arrayContaining(['Today', 'IronAge']));
    expect(admixCallout(s, data).kind).toBe('reveal'); // the complete data, for contrast
    for (const missing of ['Today', 'IronAge'] as PeriodId[]) {
      const d: WorkshopData = { ...data, admixture: { ...data.admixture, bars: data.admixture.bars.filter((b) => b.period !== missing) } };
      expect(() => admixCallout(s, d), missing).not.toThrow();
      expect(admixCallout(s, d), missing).toEqual({ kind: 'beaker' });
    }
    expect(admixCallout(s, { ...data, admixture: { ...data.admixture, bars: [] } })).toEqual({ kind: 'beaker' });
  });
  it('admixCallout: "among the bars" means the bars drawn (admixShown); the layers decide only while nothing has been drawn', () => {
    const base: PlotState = { ...INITIAL_PLOT, view: 'admixture' };
    expect(admixCallout({ ...base, admixShown: ['IronAge', 'Today'] }, data).kind).toBe('reveal');                          // no layers at all
    expect(admixCallout({ ...base, admixShown: ['IronAge'], layers: ['IronAge', 'Today'] }, data).kind).toBe('beaker');     // layers ahead of the bars
    expect(admixCallout({ ...base, admixShown: [], layers: ['IronAge', 'Today'] }, data).kind).toBe('reveal');              // nothing drawn yet
  });
  it('steppePct: whole percent, rounded half up; admixCallout reads the two steppe numbers through it (one rounding rule)', () => {
    expect([0, 0.004, 0.005, 0.4951, 0.5, 0.5651, 0.556, 0.571, 1].map((STEPPE) => steppePct({ STEPPE, FARMER: 0, WHG: 0 })))
      .toEqual([0, 0, 1, 50, 50, 57, 56, 57, 100]);
    const edge: WorkshopData = {
      ...data,
      admixture: {
        ...data.admixture,
        bars: data.admixture.bars.map((b) =>
          b.period === 'Today' ? { ...b, STEPPE: 0.4951 } : b.period === 'IronAge' ? { ...b, STEPPE: 0.5651 } : b),
      },
    };
    const bar = (id: PeriodId) => edge.admixture.bars.find((b) => b.period === id)!;
    expect(admixCallout(guidedUpTo('revealAdmix'), edge)).toEqual({
      kind: 'reveal', todaySteppe: steppePct(bar('Today')), ironSteppe: steppePct(bar('IronAge')),
    });
    expect([steppePct(bar('Today')), steppePct(bar('IronAge'))]).toEqual([50, 57]);
  });
  it('a trait keeps the layers and records the gene', () => {
    const s = run([pca('Today'), { kind: 'trait', gene: 'HERC2' }]);
    expect(s).toEqual({ ...INITIAL_PLOT, view: 'trait', layers: ['Today'], focus: 'Today', frame: 'britain', gene: 'HERC2' });
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
  it('the full guided script ends on the last trait with every layer and the finale focus', () => {
    const { i, plot } = play(SCRIPT);
    expect(i).toBe(19);
    expect(plot.view).toBe('trait');
    expect(plot.gene).toBe('HLA-DQ2');
    expect(plot.layers).toEqual(PERIODS);
    expect(plot.focus).toBe('all');
    expect(plot.admixNew).toEqual(['BronzeAge', 'IronAge', 'Today']);
    expect(plot.showNorthSea).toBe(true);
  });
  it('Britain today is hidden through the guided path until step 9 (revealPca)', () => {
    let plot = INITIAL_PLOT;
    SCRIPT.forEach((c, k) => {
      plot = reducePlot(plot, execute(c, data).plot, data);
      expect(todayShown(plot), `after step ${k}`).toBe(k >= 9);
    });
  });
  it('a student who races ahead keeps every plot but the hint waits at the first unfinished step', () => {
    const { i, plot } = play([
      { name: 'run_pca', period: 'Roman' }, { name: 'run_admixture', K: 3 }, { name: 'run_pca', period: 'all' },
      { name: 'ancestry_test', person: 'me' }, { name: 'run_admixture', K: 4 }, { name: 'run_pca', period: 'FirstFarmers' },
    ]);
    expect(i).toBe(1);
    expect(plot.view).toBe('pca');
    expect(plot.frame).toBe('europe');
    expect(plot.focus).toBe('FirstFarmers');
    expect(plot.layers).toEqual(PERIODS);
    expect(plot.admixShown).toEqual(['Roman']);
  });
  it('all then Europe: every layer stays, focus Europe, no fading', () => {
    const { plot } = play([{ name: 'run_pca', period: 'all' }, { name: 'run_pca', period: 'Europe' }]);
    expect(plot.layers).toEqual(PERIODS);
    expect(plot.focus).toBe('Europe');
    for (const id of PERIODS) expect(layerOpacity(plot, id)).toBe('1');
  });
});
