// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/data.fixture.json';
import type { GeneId, PeriodId, WorkshopData } from '../src/types';
import type { PlotAction } from '../src/commands';
import type { PcaPeriod } from '../src/parser';
import { INITIAL_PLOT, admixCallout, pcaCaptions, reducePlot, type PcaCaptionItem, type PlotState } from '../src/plotState';
import { consumerRows } from '../src/plots/consumer';
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
    expect(svg.hasAttribute('data-callout')).toBe(false); // an ADMIXTURE marker: never left over on the PCA
    expect(svg.hasAttribute('data-person')).toBe(false);  // nor the consumer bars' marker
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
    // The PCA markers are gone, and the callout marker names the callout shown (none for the per-person view).
    const callout = admixCallout(s, d).kind;
    expect(svg.hasAttribute('data-frame')).toBe(false);
    expect(svg.hasAttribute('data-focus')).toBe(false);
    expect(svg.hasAttribute('data-person')).toBe(false);
    expect(svg.getAttribute('data-callout')).toBe(callout);
    expect(svg.querySelectorAll('text.admix-callout')).toHaveLength(callout === 'none' ? 0 : 1);
    expect(svg.querySelectorAll('text.admix-reveal-note')).toHaveLength(callout === 'reveal' ? 1 : 0);
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
  if (s.view === 'consumer') {
    expect(h.children).toHaveLength(1); // no caption strip on the bars either
    const svg = h.querySelector('svg.plot-svg')!;
    // Every marker of the other views is gone; the bars carry only their own.
    for (const a of ['data-frame', 'data-focus', 'data-callout', 'data-animating']) expect(svg.hasAttribute(a), a).toBe(false);
    expect(svg.getAttribute('data-view')).toBe('consumer');
    expect(svg.getAttribute('data-person')).toBe(s.person);
    const rows = consumerRows(d, s.person!);
    expect([...svg.querySelectorAll('g.consumer-bar')].map((g) => [g.getAttribute('data-label'), g.getAttribute('data-pct')]))
      .toEqual(rows.map((r) => [r.label, String(r.pct)]));
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
const cons = (person: PeriodId | 'me'): PlotAction => ({ kind: 'consumer', person });

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

  it('on the shared svg each view sets its own aspect ratio and leaves none of the other view\'s markers behind', () => {
    const d = data();
    const h = host();
    let s = reducePlot(reducePlot(INITIAL_PLOT, pca('IronAge'), d), pca('Today'), d);
    renderPlot(h, d, s);
    const svg = h.querySelector('svg.plot-svg')!;
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMin meet');   // the PCA is top-anchored (caption strip below it)
    expect([svg.getAttribute('data-view'), svg.getAttribute('data-frame'), svg.getAttribute('data-focus')]).toEqual(['pca', 'britain', 'Today']);
    expect(svg.hasAttribute('data-callout')).toBe(false);
    s = reducePlot(s, adm(), d);
    renderPlot(h, d, s);
    expect(h.querySelector('svg.plot-svg')).toBe(svg);
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');   // the bars stay centred
    expect([svg.getAttribute('data-view'), svg.getAttribute('data-callout')]).toEqual(['admixture', 'reveal']);
    expect(svg.hasAttribute('data-frame')).toBe(false);
    expect(svg.hasAttribute('data-focus')).toBe(false);
    s = reducePlot(s, pca('Roman'), d);
    renderPlot(h, d, s);
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMin meet');
    expect([svg.getAttribute('data-view'), svg.getAttribute('data-frame'), svg.getAttribute('data-focus')]).toEqual(['pca', 'britain', 'Roman']);
    expect(svg.hasAttribute('data-callout')).toBe(false);
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

  it('plotIsAnimating is false for every static plot, and reports the finale run: a data-animating mark set by hand does not count (Task 22)', () => {
    const d = data();
    const h = host();
    renderPlot(h, d, reducePlot(INITIAL_PLOT, pca('all'), d)); // jsdom has no Web Animations, so the finale is the static plot
    expect(plotIsAnimating(h)).toBe(false);
    renderPlot(h, d, reducePlot(INITIAL_PLOT, pca('IronAge'), d));
    expect(plotIsAnimating(h)).toBe(false);
    h.querySelector('svg.plot-svg')!.setAttribute('data-animating', 'true');
    expect(plotIsAnimating(h)).toBe(false);                    // the mark is only what a running finale leaves; the run is what reports
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
  it('the consumer bars in the guided order: the hook first, then the Iron Age test between the PCA and the reveal', () =>
    play([cons('me'), pca('Europe'), pca('IronAge'), cons('IronAge'), pca('Today'), adm()]));
  it('the consumer bars between the other views, in any order', () =>
    play([cons('IronAge'), adm(), cons('Today'), trait('LCT'), cons('me'), pca('Roman'), cons('Roman'), adm('BellBeaker'), cons('Viking'), pca('all')]));
  it('every person in a row, then a PCA', () => play([cons('me'), ...ORDER.map(cons), pca('IronAge')]));
  it('the same bars twice, and a second person on the same svg', () => play([cons('IronAge'), cons('IronAge'), cons('FirstFarmers'), cons('me')]));
});

describe('the one svg: every view clears the markers of the others, whichever view came before', () => {
  type View = 'pca' | 'admixture' | 'consumer';
  const MARKERS = ['data-frame', 'data-focus', 'data-callout', 'data-person', 'data-animating'];
  const VIEW_ACTIONS: Record<View, PlotAction> = { pca: pca('IronAge'), admixture: adm(), consumer: cons('IronAge') };
  // The data-* markers each view leaves on the svg (and nothing else): data-view is the view's own name, not a marker to clear.
  const OWN: Record<View, string[]> = {
    pca: ['data-view', 'data-frame', 'data-focus'],
    admixture: ['data-view', 'data-callout'],
    consumer: ['data-view', 'data-person'],
  };
  const dataAttrs = (e: Element): string[] => [...e.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')).sort();
  const VIEWS: View[] = ['pca', 'admixture', 'consumer'];

  it.each(VIEWS.flatMap((a) => VIEWS.map((b) => [a, b] as const)))('%s, then %s: only the second view\'s own markers are left, and a stale flag is gone', (a, b) => {
    const d = data();
    const h = host();
    let s = reducePlot(INITIAL_PLOT, pca('IronAge'), d);
    s = reducePlot(s, VIEW_ACTIONS[a], d);
    renderPlot(h, d, s);
    const svg = h.querySelector('svg.plot-svg')!;
    expect(dataAttrs(svg), `after the ${a} view`).toEqual([...OWN[a]].sort());
    for (const m of MARKERS) svg.setAttribute(m, 'stale');          // whatever a view or a running animation left behind
    s = reducePlot(s, VIEW_ACTIONS[b], d);
    renderPlot(h, d, s);
    expect(h.querySelector('svg.plot-svg'), 'the svg is reused').toBe(svg);
    expect(dataAttrs(svg), `after the ${a} view, then the ${b} view`).toEqual([...OWN[b]].sort());
    expect(svg.getAttribute('data-view')).toBe(b);
  });

  it('the consumer view sets its own aspect ratio and role, and the PCA that follows sets the top-anchored one again', () => {
    const d = data();
    const h = host();
    let s = reducePlot(INITIAL_PLOT, cons('IronAge'), d);
    renderPlot(h, d, s);
    const svg = h.querySelector('svg.plot-svg')!;
    expect([svg.getAttribute('viewBox'), svg.getAttribute('preserveAspectRatio'), svg.getAttribute('role')]).toEqual(['0 0 1000 700', 'xMidYMid meet', 'img']);
    s = reducePlot(s, pca('Today'), d);
    renderPlot(h, d, s);
    expect([svg.getAttribute('viewBox'), svg.getAttribute('preserveAspectRatio')]).toEqual(['0 0 1000 760', 'xMidYMin meet']);
    expect(svg.getAttribute('data-frame')).toBe('britain');       // and the PCA's own marker is back
  });

  it('a PCA drawn after the bars does not animate from a stale frame', () => {
    const animate = vi.fn();
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
    Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
    try {
      const d = data();
      const h = host();
      let s = reducePlot(INITIAL_PLOT, pca('FirstFarmers'), d);         // the Europe frame
      renderPlot(h, d, s);
      s = reducePlot(s, cons('IronAge'), d);
      renderPlot(h, d, s);
      s = reducePlot(s, pca('IronAge'), d);                              // the British frame, straight after the bars
      renderPlot(h, d, s);
      expect(animate).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(Element.prototype, 'animate', original);
      else delete (Element.prototype as unknown as { animate?: unknown }).animate;
    }
  });
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
        renderPlot(h, d, { ...run, view, gene: 'LCT', person: 'IronAge' });
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
      ...(['me', ...ORDER] as const).map((person): PlotState => ({ ...INITIAL_PLOT, view: 'consumer', person })),
    ];
    for (const s of states) {
      renderPlot(h, d, s);
      assertNoDates(h.textContent ?? '');
    }
  });
});
