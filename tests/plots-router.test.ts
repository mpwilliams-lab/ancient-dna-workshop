// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/data.fixture.json';
import type { GeneId, PeriodId, WorkshopData } from '../src/types';
import type { PlotAction } from '../src/commands';
import type { PcaPeriod } from '../src/parser';
import { INITIAL_PLOT, pcaCaptions, reducePlot, type PcaCaptionItem, type PlotState } from '../src/plotState';
import { finishPlotAnimations, plotIsAnimating, renderPlot } from '../src/plots/index';
import {
  CHIP_TEXT, EUROPE_CAPTION, FINALE_CAPTION, PCA_CAPTION, PLOT_EMPTY, REVEAL_PCA_CAPTION, ROMAN_FOCUS_CAPTION,
} from '../src/content';

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

const itemKey = (it: PcaCaptionItem): string => (it.kind === 'zoom' ? `zoom:${it.text}` : `${it.kind}:${it.key}:${it.text}`);
function elKey(el: Element): string {
  if (el.matches('p.pca-caption')) return `caption:${el.getAttribute('data-caption')}:${el.textContent}`;
  if (el.matches('span.chip')) return `chip:${el.getAttribute('data-chip')}:${el.textContent}`;
  if (el.matches('p.zoom-note')) return `zoom:${el.textContent}`;
  return `other:${el.outerHTML}`;
}
const captionKeys = (h: HTMLElement): string[] => [...(h.querySelector('div.pca-captions')?.children ?? [])].map(elKey);

/** Invariants that must hold after every render, whatever order the commands came in. */
function checkRendered(h: HTMLElement, s: PlotState, d: WorkshopData): void {
  expect(h.getAttribute('data-view')).toBe(s.view);
  assertNoDates(h.textContent ?? '');
  if (s.view === 'pca') {
    expect([...h.children].map((k) => (k.matches('svg.plot-svg') ? 'svg' : k.matches('div.pca-captions') ? 'captions' : 'other')))
      .toEqual(['svg', 'captions']);
    const svg = h.querySelector('svg.plot-svg')!;
    expect(svg.getAttribute('data-frame')).toBe(s.frame);
    const inOrder = ORDER.filter((id) => s.layers.includes(id));
    const f = inOrder.find((id) => id === s.focus);
    expect([...svg.querySelectorAll('g.layer.period')].map((g) => g.getAttribute('data-layer')))
      .toEqual(f ? [...inOrder.filter((id) => id !== f), f] : inOrder);
    expect(svg.querySelectorAll('[data-marker="north-sea"]')).toHaveLength(s.showNorthSea ? 1 : 0);
    for (const id of ['Roman', 'AngloSaxon'] as PeriodId[]) {
      expect(svg.querySelectorAll(`g.arrow[data-arrow="${id}"]`)).toHaveLength(s.frame === 'britain' && s.layers.includes(id) ? 1 : 0);
    }
    expect(captionKeys(h)).toEqual(pcaCaptions(s, d).map(itemKey));
  }
  if (s.view === 'admixture') {
    expect(h.children).toHaveLength(1); // no caption strip on the bars
    const svg = h.querySelector('svg.plot-svg')!;
    const people = s.admixPeriod ? d.admixture.people[s.admixPeriod] ?? [] : [];
    if (people.length > 0) {
      expect(svg.querySelectorAll('g.person-bar')).toHaveLength(people.length);
    } else if (s.admixShown.length > 0) {
      const want = s.admixShown.filter((id) => d.admixture.bars.some((b) => b.period === id));
      expect([...svg.querySelectorAll('g.period-bar')].map((g) => g.getAttribute('data-period'))).toEqual(want);
      expect([...svg.querySelectorAll('g.period-bar.is-new')].map((g) => g.getAttribute('data-period')))
        .toEqual(want.filter((id) => s.admixNew.includes(id)));
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

const pca = (period: PcaPeriod): PlotAction => ({ kind: 'pca', period });
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

  it('reuses one svg across PCA and ADMIXTURE, adds the caption strip only to the PCA, and swaps to HTML for traits', () => {
    const d = data();
    const h = host();
    let s = reducePlot(INITIAL_PLOT, pca('IronAge'), d);
    renderPlot(h, d, s);
    const svg = h.querySelector('svg.plot-svg');
    expect(svg).not.toBeNull();
    expect(h.children).toHaveLength(2);
    expect(h.children[0]).toBe(svg);
    expect(h.children[1]!.className).toBe('pca-captions');
    s = reducePlot(s, adm(), d);
    renderPlot(h, d, s);
    expect(h.querySelector('svg.plot-svg')).toBe(svg);
    expect(h.children).toHaveLength(1);
    s = reducePlot(s, pca('Roman'), d);
    renderPlot(h, d, s);
    expect(h.querySelector('svg.plot-svg')).toBe(svg);
    expect(h.children).toHaveLength(2);
    s = reducePlot(s, trait('LCT'), d);
    renderPlot(h, d, s);
    expect(h.querySelector('svg.plot-svg')).toBeNull();
    expect(h.querySelector('.pca-captions')).toBeNull();
    expect(h.querySelector('.traj')).not.toBeNull();
  });

  it('never throws: a broken data object logs and shows the empty panel', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = host();
    const broken = { ...data(), frames: {} } as unknown as WorkshopData;
    expect(() => renderPlot(h, broken, { ...INITIAL_PLOT, view: 'pca', frame: 'britain', layers: ['Roman'], focus: 'Roman' })).not.toThrow();
    expect(h.querySelector('.plot-empty')?.textContent).toBe(PLOT_EMPTY);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('passes animate: false through to the PCA (no frame transition on restore or Back)', () => {
    const animate = vi.fn();
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
    Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
    try {
      const d = data();
      const h = host();
      const europe = reducePlot(INITIAL_PLOT, pca('FirstFarmers'), d);
      renderPlot(h, d, europe);
      renderPlot(h, d, reducePlot(europe, pca('IronAge'), d), { animate: false });
      expect(animate).not.toHaveBeenCalled();
      renderPlot(h, d, europe);
      expect(animate).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(Element.prototype, 'animate', original);
      else delete (Element.prototype as unknown as { animate?: unknown }).animate;
    }
  });

  it('plotIsAnimating is false for every static plot and reads svg[data-animating="true"]', () => {
    const d = data();
    const h = host();
    renderPlot(h, d, reducePlot(INITIAL_PLOT, pca('all'), d));
    expect(plotIsAnimating(h)).toBe(false);
    h.querySelector('svg.plot-svg')!.setAttribute('data-animating', 'true');
    expect(plotIsAnimating(h)).toBe(true);
  });

  it('finishPlotAnimations finishes every running animation under the host, and is safe without the API', () => {
    const h = host();
    expect(() => finishPlotAnimations(h)).not.toThrow();
    const a = { finish: vi.fn() };
    const b = { finish: vi.fn(() => { throw new Error('idle'); }) };
    const getAnimations = vi.fn(() => [a, b]);
    (h as unknown as { getAnimations: typeof getAnimations }).getAnimations = getAnimations;
    expect(() => finishPlotAnimations(h)).not.toThrow();
    expect(getAnimations).toHaveBeenCalledWith({ subtree: true });
    expect(a.finish).toHaveBeenCalledTimes(1);
    expect(b.finish).toHaveBeenCalledTimes(1);
  });
});

describe('RF2: out-of-order commands under free pacing', () => {
  it('the v3 guided script in order', () => {
    play([pca('Europe'), pca('FirstFarmers'), pca('BellBeaker'), adm(), pca('BronzeAge'), pca('IronAge'), pca('Today'), adm(),
      pca('Roman'), pca('AngloSaxon'), pca('all'), adm(), ...GENES.map(trait)]);
  });
  it('Britain today early, then Europe', () => play([pca('Today'), pca('Europe'), pca('FirstFarmers'), adm(), pca('IronAge')]));
  it('Roman before Bell Beaker', () => play([pca('Roman'), pca('BellBeaker'), adm(), pca('IronAge'), adm()]));
  it('run_admixture before any run_pca', () => play([adm(), adm(), pca('Today'), adm()]));
  it('run_pca("all") first, then Europe and a British-frame period', () => play([pca('all'), pca('Europe'), adm(), pca('AngloSaxon'), pca('all')]));
  it('First farmers after Iron Age', () => play([pca('IronAge'), pca('FirstFarmers'), adm(), pca('Roman')]));
  it('repeated commands', () => play([pca('IronAge'), pca('IronAge'), pca('IronAge'), adm(), adm(), trait('TYK2'), trait('TYK2'), pca('IronAge')]));
  it('per-person view in any order, including a period with no per-person data', () =>
    play([adm('BellBeaker'), pca('Viking'), adm('Today'), adm('IronAge'), adm(), pca('BronzeAge')]));
  it('traits interleaved with maps', () => play([trait('HLA-DQ2'), pca('AngloSaxon'), trait('HERC2'), adm(), trait('SLC45A2'), pca('Viking')]));
});

describe('caption strip: text that depends on what has been run (spec §2.3, free pacing)', () => {
  function captionsAfter(actions: PlotAction[]): string[] {
    const d = data();
    const h = host();
    const s = actions.reduce((p, a) => reducePlot(p, a, d), INITIAL_PLOT);
    renderPlot(h, d, s);
    return captionKeys(h);
  }
  const cap = (key: string, text: string) => `caption:${key}:${text}`;

  it('Europe first: PCA_CAPTION, then EUROPE_CAPTION', () => {
    expect(captionsAfter([pca('Europe')])).toEqual([cap('PCA_CAPTION', PCA_CAPTION), cap('EUROPE_CAPTION', EUROPE_CAPTION)]);
  });
  it('Europe after Britain today: only PCA_CAPTION', () => {
    expect(captionsAfter([pca('Today'), pca('Europe')])).toEqual([cap('PCA_CAPTION', PCA_CAPTION)]);
  });
  it('Britain today early (no Iron Age yet): no reveal caption; the zoom note closes the strip', () => {
    const k = captionsAfter([pca('Today')]);
    expect(k.some((x) => x.includes('REVEAL_PCA_CAPTION'))).toBe(false);
    expect(k[k.length - 1]).toMatch(/^zoom:Zoomed in about \d+× on Britain$/);
  });
  it('Britain today after the Iron Age: the reveal caption', () => {
    expect(captionsAfter([pca('IronAge'), pca('Today')])).toContain(cap('REVEAL_PCA_CAPTION', REVEAL_PCA_CAPTION));
  });
  it('Bell Beaker focus: the "DNA changed" chip with its helix icon', () => {
    const d = data();
    const h = host();
    renderPlot(h, d, reducePlot(reducePlot(INITIAL_PLOT, pca('FirstFarmers'), d), pca('BellBeaker'), d));
    expect(captionKeys(h)).toContain(`chip:CHIP_DNA_CHANGED:${CHIP_TEXT.CHIP_DNA_CHANGED}`);
    expect(h.querySelector('.pca-captions span.chip.chip--dna svg.chip-icon')).not.toBeNull();
  });
  it('Roman focus: ROMAN_FOCUS_CAPTION; Anglo-Saxon focus: the east chip', () => {
    expect(captionsAfter([pca('IronAge'), pca('Roman')])).toContain(cap('ROMAN_FOCUS_CAPTION', ROMAN_FOCUS_CAPTION));
    expect(captionsAfter([pca('IronAge'), pca('AngloSaxon')])).toContain(`chip:CHIP_DNA_CHANGED_EAST:${CHIP_TEXT.CHIP_DNA_CHANGED_EAST}`);
  });
  it('all (static finale): FINALE_CAPTION, shown at once', () => {
    const d = data();
    const h = host();
    renderPlot(h, d, reducePlot(INITIAL_PLOT, pca('all'), d));
    expect(captionKeys(h)).toContain(cap('FINALE_CAPTION', FINALE_CAPTION));
    expect(h.querySelector('p.pca-caption[data-caption="FINALE_CAPTION"]')?.hasAttribute('hidden')).toBe(false);
  });

  // The strip is the router's business, the items are plotState's: pcaCaptions looks at what has been run, never at p.view
  // (Task 5 carry-forward; the router alone decides that only the PCA view gets a strip).
  const RUNS: PlotAction[][] = [
    [pca('Europe')], [pca('Today'), pca('Europe')], [pca('FirstFarmers'), pca('BellBeaker')], [pca('IronAge'), pca('Today')],
    [pca('IronAge'), pca('Roman')], [pca('IronAge'), pca('AngloSaxon')], [pca('all')],
  ];
  const VIEWS = ['none', 'pca', 'admixture', 'trait', 'consumer'] as const;
  it('pcaCaptions ignores p.view: the same run gives the same items whichever view the state names', () => {
    const d = data();
    for (const actions of RUNS) {
      const s = actions.reduce((p, a) => reducePlot(p, a, d), INITIAL_PLOT);
      const items = pcaCaptions(s, d);
      expect(items.length, JSON.stringify(actions)).toBeGreaterThan(0);
      for (const view of VIEWS) expect(pcaCaptions({ ...s, view }, d), `${view} after ${JSON.stringify(actions)}`).toEqual(items);
    }
  });
  it('only the PCA view gets the strip, whatever has been run', () => {
    const d = data();
    for (const actions of RUNS) {
      const run = actions.reduce((p, a) => reducePlot(p, a, d), INITIAL_PLOT);
      for (const view of VIEWS) {
        const h = host();
        renderPlot(h, d, { ...run, view, gene: 'LCT' });
        expect(h.querySelector('div.pca-captions') !== null, `${view} after ${JSON.stringify(actions)}`).toBe(view === 'pca');
      }
    }
  });
});

describe('§6 rule 1 across every view the router can draw', () => {
  it('no rendered text shows dates, ages, prehistoric period words or raw ids', () => {
    const d = data();
    const h = host();
    const states: PlotState[] = [
      { ...INITIAL_PLOT, view: 'pca', layers: [...ORDER], focus: 'all', frame: 'europe', showNorthSea: true },
      { ...INITIAL_PLOT, view: 'pca', layers: [...ORDER], focus: 'AngloSaxon', frame: 'britain', showNorthSea: true },
      { ...INITIAL_PLOT, view: 'pca', layers: [], focus: 'Europe', frame: 'europe' },
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
