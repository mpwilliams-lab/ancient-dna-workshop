// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/data.fixture.json';
import type { ChipKey, Frame, NamedPoint, PeriodId, WorkshopData } from '../src/types';
import { validateData } from '../src/data';
import { ALL_OFF, withFeatures, type Features } from '../src/features';
import { INITIAL_PLOT, layerOpacity, reducePlot, type PcaCaptionItem, type PlotState } from '../src/plotState';
import { guidedPlot } from '../e2e/guidedPlay';
import {
  PCA_VIEW, TODAY_RING, YORK_EDGE_INSET, YORK_LABEL_CHARS, YORK_LINE, YORK_MARKER_R, YORK_POINTER_BASE, YORK_POINTER_HALF, YORK_POINTER_REACH,
  clampToFrame, frameTransition, makeScale, renderPca, renderPcaCaptions, yorkTravellerMark,
} from '../src/plots/pca';
import { INK, MAP_GREY, OKABE_ITO, PERIOD_COLORS, PERIOD_SHAPES, f1, shapePath, textBlock, wrapText } from '../src/plots/svg';
import { CHIP_ICON_PATHS, chipElement } from '../src/icons';
import {
  CHIP_TEXT, EAST_ENGLAND_LEGEND, EUROPE_CAPTION, LEGEND_ANCIENT, LEGEND_LIVING, MAP_GROUP_LABELS, NORTH_SEA_LABEL,
  PCA_CAPTION, PERIOD_LABELS, YORK_TRAVELLER_LABEL, withN, zoomNote,
} from '../src/content';
import { ruleViolations } from './contentRules';
import { FIXTURE } from './fixtures/fixture';

// The shared fixture supplies everything else; the PCA geometry is pinned here so the
// expected pixel values below do not depend on how the fixture's points were chosen.
function makeData(): WorkshopData {
  const d = structuredClone(fixture) as unknown as WorkshopData;
  d.frames = {
    europe: { xmin: -8, xmax: 8, ymin: -8, ymax: 6 },
    britain: { xmin: 0.5, xmax: 2.7, ymin: 2.6, ymax: 4.8 },
  };
  const centre: Record<PeriodId, { x: number; y: number }> = {
    FirstFarmers: { x: -4, y: -2 }, BellBeaker: { x: 1, y: 3.5 }, BronzeAge: { x: 1.2, y: 3.6 },
    IronAge: { x: 1, y: 3 }, Roman: { x: 1.1, y: 3.1 }, AngloSaxon: { x: 1.6, y: 3.8 },
    Viking: { x: 1.8, y: 4.2 }, Today: { x: 1.3, y: 3.4 },
  };
  const nPca: Record<PeriodId, number> = {
    FirstFarmers: 4, BellBeaker: 4, BronzeAge: 3, IronAge: 5, Roman: 3, AngloSaxon: 5, Viking: 2, Today: 4,
  };
  d.periods = d.periods.map((p) => ({ ...p, centre: centre[p.id], n_pca: nPca[p.id] }));
  d.points = [
    { period: 'FirstFarmers', points: [{ x: -4.2, y: -2.1 }, { x: -3.8, y: -1.9 }, { x: -4.1, y: -2.3 }, { x: -3.9, y: -1.7 }] },
    { period: 'BellBeaker', points: [{ x: 0.9, y: 3.4 }, { x: 1.1, y: 3.6 }, { x: 1.2, y: 3.3 }, { x: 0.8, y: 3.7 }] },
    { period: 'BronzeAge', points: [{ x: 1.1, y: 3.5 }, { x: 1.3, y: 3.7 }, { x: 1.2, y: 3.6 }] },
    { period: 'IronAge', points: [{ x: 0.9, y: 2.9 }, { x: 1.1, y: 3.1 }, { x: 1.0, y: 3.0 }, { x: 0.8, y: 2.8 }, { x: 6.0, y: 3.0 }] },
    { period: 'Roman', points: [{ x: 1.0, y: 3.1 }, { x: 1.2, y: 3.0 }, { x: 1.1, y: 3.2 }] },
    { period: 'AngloSaxon', points: [{ x: 1.4, y: 3.6 }, { x: 1.5, y: 3.7 }, { x: 1.9, y: 4.1, east: true }, { x: 2.0, y: 4.2, east: true }, { x: 1.3, y: 3.5, east: false }] },
    { period: 'Viking', points: [{ x: 1.7, y: 4.1 }, { x: 1.9, y: 4.3 }] },
    { period: 'Today', points: [{ x: 1.2, y: 3.3 }, { x: 1.4, y: 3.5 }, { x: 1.3, y: 3.4 }, { x: 1.3, y: 3.4 }] },
  ];
  d.map_groups = [
    { id: 'Sardinian', n: 3, centre: { x: -6, y: -6 }, points: [{ x: -6.1, y: -6.1 }, { x: -5.9, y: -5.9 }, { x: -6, y: -6 }] },
    { id: 'Spanish', n: 3, centre: { x: -3, y: -3 }, points: [{ x: -3.1, y: -3.1 }, { x: -2.9, y: -2.9 }, { x: -3, y: -3 }] },
    { id: 'ItalianNorth', n: 3, centre: { x: -1, y: -4 }, points: [{ x: -1.1, y: -4.1 }, { x: -0.9, y: -3.9 }, { x: -1, y: -4 }] },
    { id: 'French', n: 3, centre: { x: 0, y: 1 }, points: [{ x: -0.1, y: 0.9 }, { x: 0.1, y: 1.1 }, { x: 0, y: 1 }] },
    { id: 'Norwegian', n: 3, centre: { x: 2, y: 5 }, points: [{ x: 1.9, y: 4.9 }, { x: 2.1, y: 5.1 }, { x: 2, y: 5 }] },
  ];
  d.north_sea = { n: 6, centre: { x: 2.4, y: 4.6 } };
  return d;
}

/** The real build's counts (CONTRACT §2.2), so legend widths are realistic. */
function withRealCounts(d: WorkshopData): WorkshopData {
  const n: Record<PeriodId, number> = {
    FirstFarmers: 118, BellBeaker: 77, BronzeAge: 83, IronAge: 371, Roman: 17, AngloSaxon: 206, Viking: 37, Today: 108,
  };
  const m = { Sardinian: 27, Spanish: 173, ItalianNorth: 37, French: 60, Norwegian: 12 } as const;
  d.periods = d.periods.map((p) => ({ ...p, n_pca: n[p.id] }));
  d.map_groups = d.map_groups.map((g) => ({ ...g, n: m[g.id] }));
  return d;
}

const ALL: PeriodId[] = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking', 'Today'];
const pca = (over: Partial<PlotState>): PlotState => ({ ...INITIAL_PLOT, view: 'pca', ...over });

function newSvg(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  return svg;
}

const layerIds = (svg: SVGSVGElement) =>
  [...svg.querySelectorAll('g.layer.period')].map((g) => g.getAttribute('data-layer'));
const countIn = (svg: SVGSVGElement, layer: string) =>
  svg.querySelectorAll(`g.layer[data-layer="${layer}"] .pt`).length;
const num = (el: Element | null, attr: string) => Number(el?.getAttribute(attr));
const opacityOf = (svg: SVGSVGElement, id: PeriodId) =>
  svg.querySelector(`g.layer.period[data-layer="${id}"]`)?.getAttribute('opacity');
const groupTexts = (svg: SVGSVGElement, group: 'ancient' | 'living') =>
  [...svg.querySelectorAll(`g.legend-group[data-legend-group="${group}"] .legend-item`)].map((t) => t.textContent);
const eastItem = (svg: SVGSVGElement) => svg.querySelector('.legend .legend-item[data-legend="east"]');

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('makeScale / clampToFrame', () => {
  it('uses one pixels-per-unit for both axes and centres the frame (pinned)', () => {
    const d = makeData();
    const b = makeScale(d.frames.britain);
    expect(b.k).toBeCloseTo(259.0909, 3);
    expect(b.offX).toBeCloseTo(215, 6);
    expect(b.offY).toBeCloseTo(20, 6);
    expect(b.toX(1)).toBeCloseTo(344.5455, 3);
    expect(b.toY(3)).toBeCloseTo(486.3636, 3);
    // equal aspect: one unit right and one unit north move the same number of pixels
    expect(b.toX(2) - b.toX(1)).toBeCloseTo(b.toY(3) - b.toY(4), 9);
    const e = makeScale(d.frames.europe);
    expect(e.k).toBeCloseTo(40.7143, 3);
    expect(e.offX).toBeCloseTo(174.2857, 3);
    expect(e.toY(6)).toBeCloseTo(PCA_VIEW.top, 6);
    expect(e.toY(-8)).toBeCloseTo(PCA_VIEW.bottom, 6);
  });

  it('clamps points outside the frame to its edge and flags them', () => {
    const fr = makeData().frames.britain;
    expect(clampToFrame({ x: 6, y: 3 }, fr)).toEqual({ x: 2.7, y: 3, clipped: true });
    expect(clampToFrame({ x: -1, y: 9 }, fr)).toEqual({ x: 0.5, y: 4.8, clipped: true });
    expect(clampToFrame({ x: 1, y: 3 }, fr)).toEqual({ x: 1, y: 3, clipped: false });
  });
});

describe('wrapText / textBlock', () => {
  it('wraps on spaces and keeps the exact sentence in textContent', () => {
    expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four']);
    expect(wrapText('  ', 10)).toEqual([]);
    const s = 'Each dot is one person; close dots share more ancestry';
    const { el, lines } = textBlock(s, 20, 10, 20, 18);
    expect(lines).toBe(3);
    expect(el.querySelectorAll('tspan')).toHaveLength(3);
    expect(el.textContent).toBe(s);
  });
});

describe('renderPca v3: frame, layers, focus and fading', () => {
  it('uses the 1000 x 760 viewBox, marks frame and focus, and keeps every caption out of the svg', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['FirstFarmers'], focus: 'FirstFarmers' }));
    expect(PCA_VIEW).toEqual({ width: 1000, height: 760, left: 20, right: 980, top: 20, bottom: 590, legendTop: 616, legendRow: 22 });
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 760');
    // top-anchored: the caption strip under the svg changes height from step to step, and a centred plot would jump with it
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMin meet');
    expect(svg.getAttribute('data-view')).toBe('pca');
    expect(svg.getAttribute('data-frame')).toBe('europe');
    expect(svg.getAttribute('data-focus')).toBe('FirstFarmers');
    expect(svg.getAttribute('aria-label')).toBe(PCA_CAPTION);
    expect(svg.querySelector('.pca-caption, .zoom-note, .chip')).toBeNull();
    expect(svg.textContent).not.toContain(PCA_CAPTION);
    renderPca(svg, makeData(), pca({ layers: [] }));
    expect(svg.hasAttribute('data-focus')).toBe(false);
  });

  it('always draws the five continental map groups; no Britons before a period is run', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: [], focus: 'Europe' }));
    expect(svg.querySelectorAll('g.layer.map-group')).toHaveLength(5);
    expect(svg.querySelectorAll('g.layer.map-group .pt')).toHaveLength(15);
    expect([...svg.querySelectorAll('.map-label')].map((t) => t.textContent).sort()).toEqual(Object.values(MAP_GROUP_LABELS).sort());
    expect(layerIds(svg)).toEqual([]);
    expect(svg.querySelectorAll('.today-ring')).toHaveLength(0);
    expect(svg.querySelectorAll('.centre, .arrow, [data-marker="north-sea"]')).toHaveLength(0);
    expect(svg.querySelector('g.legend-group[data-legend-group="ancient"]')).toBeNull();
    expect(svg.querySelector('g.legend-group[data-legend-group="living"] .legend-heading')?.textContent).toBe(LEGEND_LIVING);
    expect(groupTexts(svg, 'living')).toEqual(
      (['Sardinian', 'Spanish', 'ItalianNorth', 'French', 'Norwegian'] as const).map((id) => withN(MAP_GROUP_LABELS[id], 3)));
  });

  it('draws Britain today only once it is in layers, as hollow rings (r 3.5, stroke 1.5, #3A3A3A)', () => {
    const svg = newSvg();
    const d = makeData();
    renderPca(svg, d, pca({ layers: ['IronAge'], focus: 'IronAge', frame: 'britain' }));
    expect(svg.querySelectorAll('.today-ring')).toHaveLength(0);
    expect(svg.querySelector('g.layer[data-layer="Today"]')).toBeNull();
    renderPca(svg, d, pca({ layers: ['IronAge', 'Today'], focus: 'Today', frame: 'britain' }));
    expect(TODAY_RING).toEqual({ r: 3.5, strokeWidth: 1.5, stroke: '#3A3A3A' });
    const rings = [...svg.querySelectorAll('g.layer[data-layer="Today"] path.pt.today-ring')];
    expect(rings).toHaveLength(4);
    for (const r of rings) {
      expect(r.getAttribute('fill')).toBe('none');
      expect(r.getAttribute('stroke')).toBe('#3A3A3A');
      expect(r.getAttribute('stroke-width')).toBe('1.5');
      expect(r.getAttribute('d')).toContain('a3.5 3.5');
      // an unfilled path takes the pointer only on its 1 px stroke; "all" makes the whole disc hoverable and tappable
      expect(r.getAttribute('pointer-events')).toBe('all');
    }
    expect(svg.querySelector('.centre[data-centre="Today"]')).toBeNull();
  });

  it('fades by focus with string opacities: focus 1, Iron Age 0.6 behind Today/Roman/Anglo-Saxon, others 0.3', () => {
    const cases: [PlotState, Partial<Record<PeriodId, string>>][] = [
      [pca({ layers: ['FirstFarmers', 'BellBeaker'], focus: 'BellBeaker' }), { FirstFarmers: '0.3', BellBeaker: '1' }],
      [pca({ layers: ['BronzeAge', 'IronAge', 'Today'], focus: 'Today', frame: 'britain' }), { BronzeAge: '0.3', IronAge: '0.6', Today: '1' }],
      [pca({ layers: ['IronAge', 'Roman'], focus: 'Roman', frame: 'britain' }), { IronAge: '0.6', Roman: '1' }],
      [pca({ layers: ['BellBeaker', 'IronAge', 'AngloSaxon'], focus: 'AngloSaxon', frame: 'britain' }), { BellBeaker: '0.3', IronAge: '0.6', AngloSaxon: '1' }],
      [pca({ layers: ['BronzeAge', 'IronAge'], focus: 'IronAge', frame: 'britain' }), { BronzeAge: '0.3', IronAge: '1' }],
    ];
    const svg = newSvg();
    for (const [s, want] of cases) {
      renderPca(svg, makeData(), s);
      for (const [id, o] of Object.entries(want) as [PeriodId, string][]) {
        expect(opacityOf(svg, id), `${s.focus}: ${id}`).toBe(o);
        expect(opacityOf(svg, id), `${s.focus}: ${id}`).toBe(layerOpacity(s, id));
      }
    }
  });

  it('does not fade when the focus is Europe, all or not set', () => {
    const svg = newSvg();
    for (const focus of ['Europe', 'all', undefined] as const) {
      renderPca(svg, makeData(), pca({ layers: ALL, focus, frame: 'europe' }));
      for (const id of ALL) expect(opacityOf(svg, id), `${focus}: ${id}`).toBe('1');
    }
  });

  it('draws the non-focus layers in time order, then the focus layer on top, marked data-focus', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Today'], focus: 'BronzeAge', frame: 'britain' }));
    expect(layerIds(svg)).toEqual(['FirstFarmers', 'BellBeaker', 'IronAge', 'Today', 'BronzeAge']);
    expect([...svg.querySelectorAll('g.layer.period[data-focus="true"]')].map((g) => g.getAttribute('data-layer'))).toEqual(['BronzeAge']);
  });

  it('keeps centre markers, centre labels and arrows at full opacity, outside the faded layers', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['IronAge', 'Roman', 'AngloSaxon'], focus: 'AngloSaxon', frame: 'britain', showNorthSea: true }));
    const marks = [...svg.querySelectorAll('.centre, .centre-label, g.arrow, [data-marker="north-sea"]')];
    expect(marks.length).toBeGreaterThan(5);
    for (const el of marks) {
      expect(el.closest('g.layer')).toBeNull();
      expect(el.hasAttribute('opacity')).toBe(false);
    }
  });

  it('europe frame: period layers in time order with the focus last, no centre markers or arrows', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['BellBeaker', 'Today', 'FirstFarmers'], focus: 'BellBeaker', frame: 'europe' }));
    expect(layerIds(svg)).toEqual(['FirstFarmers', 'Today', 'BellBeaker']);
    expect(countIn(svg, 'FirstFarmers')).toBe(4);
    expect(countIn(svg, 'BellBeaker')).toBe(4);
    expect(svg.querySelectorAll('.centre, .arrow')).toHaveLength(0);
  });

  it('britain frame: centre markers, Iron Age arrows, the focus layer\'s ghost and off-frame map groups hidden', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['IronAge', 'Roman', 'AngloSaxon'], focus: 'IronAge', frame: 'britain', showNorthSea: true }));
    expect([...svg.querySelectorAll('.centre')].map((c) => c.getAttribute('data-centre'))).toEqual(['IronAge', 'Roman', 'AngloSaxon']);
    expect([...svg.querySelectorAll('.centre-label')].map((c) => c.textContent))
      .toEqual(expect.arrayContaining([PERIOD_LABELS.IronAge, PERIOD_LABELS.Roman, PERIOD_LABELS.AngloSaxon]));
    expect([...svg.querySelectorAll('g.arrow')].map((a) => a.getAttribute('data-arrow'))).toEqual(['Roman', 'AngloSaxon']);
    const as = svg.querySelector('g.arrow[data-arrow="AngloSaxon"] line');
    // tail = Iron Age centre (1, 3); head stops 14 px short of the Anglo-Saxon centre (1.6, 3.8)
    expect(num(as, 'x1')).toBe(344.5);
    expect(num(as, 'y1')).toBe(486.4);
    expect(num(as, 'x2')).toBe(491.6);
    expect(num(as, 'y2')).toBe(290.3);
    expect(svg.querySelectorAll('.arrow-tail')).toHaveLength(0);
    // the Iron Age point at x = 6 is the focus layer's: pinned to the right edge (x = 2.7 -> 785 px) as a ghost
    const clipped = svg.querySelectorAll('g.layer[data-layer="IronAge"] .pt.clipped');
    expect(clipped).toHaveLength(1);
    expect(clipped[0]!.getAttribute('d')).toMatch(/^M780 /);
    expect(svg.querySelectorAll('g.layer.map-group .pt')).toHaveLength(0);
    expect(svg.querySelectorAll('.map-label')).toHaveLength(0);
    expect(svg.querySelector('[data-marker="north-sea"]')?.textContent).toBe(NORTH_SEA_LABEL);
  });

  it('centre labels never sit closer than 18 px vertically', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking'], focus: 'Viking', frame: 'britain' }));
    const ys = [...svg.querySelectorAll('.centre-label')].map((t) => num(t, 'y')).sort((a, b) => a - b);
    expect(ys).toHaveLength(5);
    for (let i = 1; i < ys.length; i += 1) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(17.95);
  });

  it('RF2: Roman before Iron Age still draws the arrow from the Iron Age centre, with a tail ring', () => {
    const svg = newSvg();
    expect(() => renderPca(svg, makeData(), pca({ layers: ['Roman'], focus: 'Roman', frame: 'britain' }))).not.toThrow();
    const line = svg.querySelector('g.arrow[data-arrow="Roman"] line');
    expect(num(line, 'x1')).toBe(344.5);
    expect(num(line, 'y1')).toBe(486.4);
    expect(svg.querySelectorAll('.arrow-tail')).toHaveLength(1);
    expect(svg.querySelector('.centre[data-centre="IronAge"]')).toBeNull();
  });

  it('RF2: any combination of layers, focus and frame renders exactly the layers in the state, focus last', () => {
    const cases: PlotState[] = [
      pca({ layers: ['Roman', 'BellBeaker'], focus: 'Roman', frame: 'europe' }),
      pca({ layers: ['IronAge', 'FirstFarmers'], focus: 'FirstFarmers', frame: 'europe' }),
      pca({ layers: ['FirstFarmers', 'IronAge'], focus: 'IronAge', frame: 'britain' }),
      pca({ layers: ['Viking'], focus: 'Viking', frame: 'britain', showNorthSea: true }),
      pca({ layers: ALL, focus: 'all', frame: 'europe', showNorthSea: true }),
      pca({ layers: ['AngloSaxon', 'AngloSaxon'], focus: 'AngloSaxon', frame: 'britain', showNorthSea: true }),
      pca({ layers: ['IronAge', 'Today'], focus: 'Today', frame: 'britain' }),
      pca({ layers: [], focus: 'Europe', frame: 'europe' }),
      pca({ layers: ['Today'], focus: 'Europe', frame: 'europe' }),
    ];
    const svg = newSvg();
    for (const s of cases) {
      expect(() => renderPca(svg, makeData(), s)).not.toThrow();
      const inOrder = ALL.filter((id) => s.layers.includes(id));
      const f = inOrder.find((id) => id === s.focus);
      expect(layerIds(svg)).toEqual(f ? [...inOrder.filter((id) => id !== f), f] : inOrder);
      expect(svg.querySelectorAll('[data-marker="north-sea"]')).toHaveLength(s.showNorthSea ? 1 : 0);
      expect(svg.querySelectorAll('.centre').length > 0).toBe(s.frame === 'britain');
    }
  });

  it('shows the n of every layer in the legend (Roman n on screen)', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['IronAge', 'Roman'], focus: 'Roman', frame: 'britain' }));
    expect(groupTexts(svg, 'ancient')).toEqual([withN(PERIOD_LABELS.IronAge, 5), withN(PERIOD_LABELS.Roman, 3)]);
    expect(svg.textContent).toContain('Roman (n = 3)');
  });

  it('tap/hover shows only the period or group name; no per-sample data anywhere', () => {
    const svg = newSvg();
    const addListener = vi.spyOn(svg, 'addEventListener');
    const d = makeData();
    const s = pca({ layers: ['AngloSaxon', 'Today'], focus: 'AngloSaxon', frame: 'europe' });
    renderPca(svg, d, s);
    const tip = () => svg.querySelector('.plot-tip')?.textContent;
    svg.querySelector('g.layer[data-layer="AngloSaxon"] .pt')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(tip()).toBe(PERIOD_LABELS.AngloSaxon);
    svg.querySelector('g.layer[data-layer="French"] .pt')!.dispatchEvent(new Event('click', { bubbles: true }));
    expect(tip()).toBe(MAP_GROUP_LABELS.French);
    svg.dispatchEvent(new Event('pointerleave'));
    expect(tip()).toBe('');
    expect(svg.querySelectorAll('[data-id], title')).toHaveLength(0);
    renderPca(svg, d, s);
    expect(addListener).toHaveBeenCalledTimes(3);
    svg.querySelector('g.layer[data-layer="Today"] .pt')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(tip()).toBe(PERIOD_LABELS.Today);
  });

  it('re-rendering replaces content instead of stacking it', () => {
    const svg = newSvg();
    const s = pca({ layers: ['IronAge'], focus: 'IronAge', frame: 'britain' });
    renderPca(svg, makeData(), s);
    const n = svg.querySelectorAll('*').length;
    renderPca(svg, makeData(), s);
    expect(svg.querySelectorAll('*').length).toBe(n);
  });

  it('animates a frame change once (500 ms) and maps old pixels onto new ones', () => {
    withFakeAnimate((animate) => {
      const d = makeData();
      const svg = newSvg();
      renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'europe' }));
      expect(animate).not.toHaveBeenCalled();
      renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'britain' }));
      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate.mock.calls[0]![1]).toEqual({ duration: 500, easing: 'ease-in-out' });
      renderPca(svg, d, pca({ layers: ['IronAge', 'Roman'], frame: 'britain' }));
      expect(animate).toHaveBeenCalledTimes(1);
      const from = makeScale(d.frames.europe);
      const to = makeScale(d.frames.britain);
      const m = frameTransition(from, to).match(/matrix\(([^)]+)\)/)![1]!.split(',').map(Number);
      const [s, , , , tx, ty] = m;
      expect(s! * to.toX(1) + tx!).toBeCloseTo(from.toX(1), 6);
      expect(s! * to.toY(3) + ty!).toBeCloseTo(from.toY(3), 6);
    });
  });

  it('animate: false (restore, Back) never starts the frame transition', () => {
    withFakeAnimate((animate) => {
      const d = makeData();
      const svg = newSvg();
      renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'europe' }));
      renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'britain' }), { animate: false });
      expect(animate).not.toHaveBeenCalled();
      renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'europe' }));
      expect(animate).toHaveBeenCalledTimes(1);
    });
  });

  it('draws the seven periods in seven distinct Okabe-Ito hues', () => {
    const hues = Object.values(OKABE_ITO) as string[];
    const periods = ALL.filter((id) => id !== 'Today');
    for (const id of periods) expect(hues).toContain(PERIOD_COLORS[id]);
    expect(new Set(periods.map((id) => PERIOD_COLORS[id])).size).toBe(7);
  });

  it('§6 rule 1: no dates, ages, Group IDs or raw ids in any rendered PCA text', () => {
    const svg = newSvg();
    for (const [frame, focus] of [['europe', 'all'], ['britain', 'AngloSaxon'], ['britain', 'Today'], ['europe', 'Europe']] as const) {
      renderPca(svg, makeData(), pca({ layers: ALL, focus, frame, showNorthSea: true }));
      const text = svg.textContent ?? '';
      expect(text).not.toMatch(/\d[\d,.]*\s*(BCE|BC|BP|CE|kya|ya|years?|generations?)\b/i);
      expect(text).not.toMatch(/Mesolithic|Neolithic|Pal(a)?eolithic|Megalithic|Ice Age/i);
      expect(text).not.toMatch(/FirstFarmers|BellBeaker|BronzeAge|IronAge|AngloSaxon|ItalianNorth|_/);
    }
  });
});

describe('plot tip', () => {
  it('ignores the pointer, so it never swallows the hover on the mark underneath', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({}));
    expect(svg.querySelector('.plot-tip')?.getAttribute('pointer-events')).toBe('none');
  });
});

/** Installs a fake Element.prototype.animate (jsdom has none) while `run` executes. */
function withFakeAnimate(run: (animate: ReturnType<typeof vi.fn>) => void): void {
  const animate = vi.fn();
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
  try {
    run(animate);
  } finally {
    if (original) Object.defineProperty(Element.prototype, 'animate', original);
    else delete (Element.prototype as unknown as { animate?: unknown }).animate;
  }
}

describe('frame change animation hand-over', () => {
  it('animates only from a previous PCA drawing, never from a frame another view left on the svg', () => {
    withFakeAnimate((animate) => {
      const d = makeData();
      const svg = newSvg();
      renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'europe' }));
      // the bars or a trait plot take the svg over; data-frame is still 'europe' from the PCA before them
      svg.setAttribute('data-view', 'admixture');
      renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'britain' }));
      expect(animate).not.toHaveBeenCalled(); // a stale frame is no starting point
      svg.setAttribute('data-view', 'trait');
      renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'europe' }));
      expect(animate).not.toHaveBeenCalled();
      // no data-view at all (an svg that never showed a PCA): nothing to animate from either
      svg.removeAttribute('data-view');
      renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'britain' }));
      expect(animate).not.toHaveBeenCalled();
      // but a real PCA drawing is a starting point again
      renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'europe' }));
      expect(animate).toHaveBeenCalledTimes(1);
    });
  });
});

/** Moves one period's centre (the fixture is already a private clone, so this edits it in place). */
function withCentre(d: WorkshopData, id: PeriodId, centre: { x: number; y: number }): WorkshopData {
  d.periods = d.periods.map((p) => (p.id === id ? { ...p, centre } : p));
  return d;
}

describe('ghosts: only the focus layer in the British frame (spec §2.3)', () => {
  it("a non-focus layer's clipped points are not drawn, and with none in frame it leaves the legend", () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['FirstFarmers', 'IronAge'], focus: 'IronAge', frame: 'britain' }));
    expect(svg.querySelector('g.layer.period[data-layer="FirstFarmers"]')).not.toBeNull(); // the (empty) layer is kept
    expect(countIn(svg, 'FirstFarmers')).toBe(0);
    expect(svg.querySelector('.legend-item[data-legend="FirstFarmers"]')).toBeNull();
    expect(svg.querySelector('.centre[data-centre="FirstFarmers"]')).toBeNull();
    expect(svg.querySelectorAll('.pt.clipped')).toHaveLength(1); // only the focus layer's Iron Age point at x = 6
  });

  it("the focus layer's clipped points are hollow, faint edge ghosts, and the legend still names it", () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['FirstFarmers', 'IronAge'], focus: 'FirstFarmers', frame: 'britain' }));
    const ff = [...svg.querySelectorAll('g.layer[data-layer="FirstFarmers"] .pt')];
    expect(ff).toHaveLength(4);
    for (const pt of ff) {
      expect(pt.classList.contains('clipped')).toBe(true);
      expect(pt.getAttribute('fill')).toBe('none');
      expect(pt.getAttribute('stroke')).toBe(PERIOD_COLORS.FirstFarmers);
      expect(pt.getAttribute('opacity')).toBe('0.35');
    }
    expect(svg.querySelector('.centre[data-centre="FirstFarmers"]')).toBeNull();
    expect(svg.querySelector('.legend-item[data-legend="FirstFarmers"]')?.textContent).toBe(withN(PERIOD_LABELS.FirstFarmers, 4));
    expect(countIn(svg, 'IronAge')).toBe(4); // the non-focus Iron Age layer drops its clipped point
  });

  it('a partly clipped focus layer keeps its centre marker and label; only its clipped points are ghosts', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['IronAge'], focus: 'IronAge', frame: 'britain' }));
    const pts = [...svg.querySelectorAll('g.layer[data-layer="IronAge"] .pt')];
    const ghosts = pts.filter((p) => p.classList.contains('clipped'));
    const solid = pts.filter((p) => !p.classList.contains('clipped'));
    expect(ghosts).toHaveLength(1);
    expect(solid).toHaveLength(4);
    expect(ghosts[0]!.getAttribute('fill')).toBe('none');
    for (const p of solid) {
      expect(p.getAttribute('fill')).toBe(PERIOD_COLORS.IronAge);
      expect(p.hasAttribute('opacity')).toBe(false);
    }
    expect(svg.querySelector('.centre[data-centre="IronAge"]')).not.toBeNull();
    expect(svg.querySelector('.centre-label[data-centre-label="IronAge"]')?.textContent).toBe(PERIOD_LABELS.IronAge);
  });

  it('the Europe frame keeps ghosts for every layer', () => {
    const d = makeData();
    d.points.find((p) => p.period === 'IronAge')!.points.push({ x: 9, y: 0 });
    const svg = newSvg();
    renderPca(svg, d, pca({ layers: ['BellBeaker', 'IronAge'], focus: 'BellBeaker', frame: 'europe' }));
    expect(svg.querySelectorAll('g.layer[data-layer="IronAge"] .pt.clipped')).toHaveLength(1);
  });

  it('skips the arrow whose head centre is outside the frame and keeps the others', () => {
    const svg = newSvg();
    const d = withCentre(makeData(), 'AngloSaxon', { x: 6, y: 3.8 });
    renderPca(svg, d, pca({ layers: ['IronAge', 'Roman', 'AngloSaxon'], focus: 'AngloSaxon', frame: 'britain' }));
    expect([...svg.querySelectorAll('g.arrow')].map((a) => a.getAttribute('data-arrow'))).toEqual(['Roman']);
    expect([...svg.querySelectorAll('.centre')].map((c) => c.getAttribute('data-centre'))).toEqual(['IronAge', 'Roman']);
  });

  it('draws no arrow, and no tail ring, when the Iron Age centre (the tail) is outside the frame', () => {
    const svg = newSvg();
    const d = withCentre(makeData(), 'IronAge', { x: -4, y: -2 });
    renderPca(svg, d, pca({ layers: ['Roman', 'AngloSaxon'], focus: 'AngloSaxon', frame: 'britain' }));
    expect(svg.querySelectorAll('g.arrow')).toHaveLength(0);
    expect(svg.querySelectorAll('.arrow-tail')).toHaveLength(0);
    expect([...svg.querySelectorAll('.centre')].map((c) => c.getAttribute('data-centre'))).toEqual(['Roman', 'AngloSaxon']);
  });
});

// Britain today follows the same ghost rule as every period (spec §2.3), drawn as rings; and a frame change honours
// prefers-reduced-motion. Neither is pinned by the blocks above.
describe('Britain today at the frame edge, and reduced motion', () => {
  const withFarToday = (): WorkshopData => {
    const d = makeData();
    d.points.find((g) => g.period === 'Today')!.points.push({ x: 9, y: 3 }); // outside both frames (Europe xmax 8, Britain xmax 2.7)
    return d;
  };
  const todayRings = (svg: SVGSVGElement) => [...svg.querySelectorAll('g.layer[data-layer="Today"] path.pt.today-ring')];

  it('in the British frame a clipped ring is a faint edge ghost only while Britain today is the focus', () => {
    const svg = newSvg();
    const d = withFarToday();
    renderPca(svg, d, pca({ layers: ['IronAge', 'Today'], focus: 'Today', frame: 'britain' }));
    expect(todayRings(svg)).toHaveLength(5);
    const ghosts = todayRings(svg).filter((r) => r.classList.contains('clipped'));
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]!.getAttribute('fill')).toBe('none');
    expect(ghosts[0]!.getAttribute('stroke')).toBe(TODAY_RING.stroke);
    expect(ghosts[0]!.getAttribute('opacity')).toBe('0.35');
    expect(ghosts[0]!.getAttribute('pointer-events')).toBe('all');
    expect(ghosts[0]!.getAttribute('d')).toMatch(/^M781\.5 /); // pinned to x = 2.7 (785 px), minus the ring radius 3.5
    for (const r of todayRings(svg).filter((x) => !x.classList.contains('clipped'))) expect(r.hasAttribute('opacity')).toBe(false);
    // another period in focus: Britain today stays on the map as faded rings, but its clipped point is not drawn
    renderPca(svg, d, pca({ layers: ['IronAge', 'Today'], focus: 'IronAge', frame: 'britain' }));
    expect(todayRings(svg)).toHaveLength(4);
    expect(svg.querySelectorAll('g.layer[data-layer="Today"] .clipped')).toHaveLength(0);
    expect(svg.querySelector('g.layer[data-layer="Today"]')?.getAttribute('opacity')).toBe('0.3');
  });

  it('the Europe frame keeps the ghost of a clipped ring whatever the focus', () => {
    const svg = newSvg();
    renderPca(svg, withFarToday(), pca({ layers: ['BellBeaker', 'Today'], focus: 'BellBeaker', frame: 'europe' }));
    expect(todayRings(svg)).toHaveLength(5);
    expect(todayRings(svg).filter((r) => r.classList.contains('clipped'))).toHaveLength(1);
  });

  it('prefers-reduced-motion: a frame change is drawn at once, with no transition', () => {
    withFakeAnimate((animate) => {
      const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
      Object.defineProperty(window, 'matchMedia', {
        value: (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query }),
        configurable: true, writable: true,
      });
      try {
        const d = makeData();
        const svg = newSvg();
        renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'europe' }));
        renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'britain' }));
        expect(svg.getAttribute('data-frame')).toBe('britain');
        expect(animate).not.toHaveBeenCalled();
      } finally {
        if (original) Object.defineProperty(window, 'matchMedia', original);
        else delete (window as unknown as { matchMedia?: unknown }).matchMedia;
      }
    });
  });
});

type Box = { left: number; right: number; top: number; bottom: number };
const overlap = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
// Geometry measured in Chrome, deliberately independent of the renderer's own estimate: the 16 px bold labels are
// 7.8 to 10.7 px per character wide and an 18 px tall line (15 above the baseline, 3 below); the biggest centre
// marker (a diamond of radius 12) reaches 15.6 px from its centre.
const WIDEST_CHAR = 10.7;
const textBox = (x: number, y: number, chars: number, anchorEnd: boolean): Box => {
  const w = chars * WIDEST_CHAR;
  return { left: anchorEnd ? x - w : x, right: anchorEnd ? x : x + w, top: y - 15, bottom: y + 3 };
};
const labelBox = (t: Element): Box =>
  textBox(num(t, 'x'), num(t, 'y'), (t.textContent ?? '').length, t.getAttribute('text-anchor') === 'end');
const markerBox = (x: number, y: number): Box => ({ left: x - 15.6, right: x + 15.6, top: y - 15.6, bottom: y + 15.6 });
const labelOf = (svg: SVGSVGElement, id: PeriodId) => svg.querySelector(`.centre-label[data-centre-label="${id}"]`)!;

describe('centre label placement', () => {
  it('leaves a label on the right of its marker when nothing is in the way', () => {
    const d = makeData();
    const sc = makeScale(d.frames.britain);
    const svg = newSvg();
    renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'britain' }));
    const label = labelOf(svg, 'IronAge');
    expect(label.hasAttribute('text-anchor')).toBe(false);
    expect(num(label, 'x')).toBe(Number(f1(sc.toX(1) + 18)));
  });

  it('flips a label to the left of its marker when the next centre sits 51 px to its right on the same row', () => {
    const d = makeData();
    const sc = makeScale(d.frames.britain);
    const romanX = 1 + 51 / sc.k; // as in the real data: Iron Age and Roman share a row, 51 px apart
    withCentre(d, 'IronAge', { x: 1, y: 3 });
    withCentre(d, 'Roman', { x: romanX, y: 3 });
    const iron = { x: sc.toX(1), y: sc.toY(3) };
    const roman = { x: sc.toX(romanX), y: sc.toY(3) };
    // on the right the Iron Age label would run straight through the Roman marker (so this case is a real test)
    expect(overlap(textBox(iron.x + 18, iron.y + 5, PERIOD_LABELS.IronAge.length, false), markerBox(roman.x, roman.y))).toBe(true);

    const svg = newSvg();
    renderPca(svg, d, pca({ layers: ['IronAge', 'Roman'], frame: 'britain' }));
    const left = labelOf(svg, 'IronAge');
    const right = labelOf(svg, 'Roman');
    expect(left.getAttribute('text-anchor')).toBe('end');
    expect(num(left, 'x')).toBe(Number(f1(iron.x - 18)));
    expect(overlap(labelBox(left), markerBox(roman.x, roman.y))).toBe(false); // clear of the right-hand marker
    expect(overlap(labelBox(left), markerBox(iron.x, iron.y))).toBe(false); // and of its own
    // the Roman label has nothing to its right and stays there
    expect(right.hasAttribute('text-anchor')).toBe(false);
    expect(num(right, 'x')).toBe(Number(f1(roman.x + 18)));
    expect(overlap(labelBox(right), markerBox(iron.x, iron.y))).toBe(false);
  });

  it('judges overlap by the marker, not its centre point: Viking 35 px right and 15.7 px below Anglo-Saxon (real data)', () => {
    const d = makeData();
    const sc = makeScale(d.frames.britain);
    withCentre(d, 'AngloSaxon', { x: 1.6, y: 3.8 });
    withCentre(d, 'Viking', { x: 1.6 + 35.1 / sc.k, y: 3.8 - 15.7 / sc.k });
    const viking = { x: sc.toX(1.6 + 35.1 / sc.k), y: sc.toY(3.8 - 15.7 / sc.k) };
    const svg = newSvg();
    renderPca(svg, d, pca({ layers: ['AngloSaxon', 'Viking'], frame: 'britain' }));
    expect(labelOf(svg, 'AngloSaxon').getAttribute('text-anchor')).toBe('end');
    expect(labelOf(svg, 'Viking').hasAttribute('text-anchor')).toBe(false);
    expect(overlap(labelBox(labelOf(svg, 'AngloSaxon')), markerBox(viking.x, viking.y))).toBe(false);
  });

  it('flips a label when only an arrow, not a marker, runs through its right-hand box', () => {
    const d = makeData();
    const sc = makeScale(d.frames.britain);
    const asX = 1 + 150 / sc.k; // 150 px to the right on the same row: the arrow lies along the Iron Age label
    withCentre(d, 'IronAge', { x: 1, y: 3 });
    withCentre(d, 'AngloSaxon', { x: asX, y: 3 });
    const iron = { x: sc.toX(1), y: sc.toY(3) };
    const as = { x: sc.toX(asX), y: sc.toY(3) };
    // the Anglo-Saxon marker itself is well outside the label's reach, so only the arrow is in the way
    expect(overlap(textBox(iron.x + 18, iron.y + 5, PERIOD_LABELS.IronAge.length, false), markerBox(as.x, as.y))).toBe(false);

    const svg = newSvg();
    renderPca(svg, d, pca({ layers: ['IronAge', 'AngloSaxon'], frame: 'britain' }));
    expect(labelOf(svg, 'IronAge').getAttribute('text-anchor')).toBe('end');
    expect(labelOf(svg, 'AngloSaxon').hasAttribute('text-anchor')).toBe(false);
  });

  it('still pushes labels of centres on the same row 18 px apart (real data: Iron Age and Roman share a y)', () => {
    const d = makeData();
    const sc = makeScale(d.frames.britain);
    withCentre(d, 'IronAge', { x: 1, y: 3 });
    withCentre(d, 'Roman', { x: 1 + 51 / sc.k, y: 3 });
    withCentre(d, 'AngloSaxon', { x: 1 + 102 / sc.k, y: 3 });
    const svg = newSvg();
    renderPca(svg, d, pca({ layers: ['IronAge', 'Roman', 'AngloSaxon'], frame: 'britain' }));
    const ys = [...svg.querySelectorAll('.centre-label')].map((t) => num(t, 'y')).sort((a, b) => a - b);
    expect(ys).toHaveLength(3);
    for (let i = 1; i < ys.length; i += 1) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(17.95);
  });
});

// Colour distance exactly as the dataviz validator (validate_palette.js) computes it: OKLab distance x 100, with the
// Machado, Oliveira and Fernandes (2009) severity-1.0 simulation for protan and deutan colour-vision deficiency.
const CVD_MATRIX = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
} as const;

function linearRgb(hex: string): number[] {
  return [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
}

function oklab([r, g, b]: number[]): number[] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Distance between two hex colours; `cvd` simulates how a protan or deutan reader sees both. */
function colourDistance(a: string, b: string, cvd?: keyof typeof CVD_MATRIX): number {
  const see = (hex: string): number[] => {
    const rgb = linearRgb(hex);
    if (!cvd) return rgb;
    return CVD_MATRIX[cvd].map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])));
  };
  const p = oklab(see(a));
  const q = oklab(see(b));
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

describe('palette: shapes back up the colours', () => {
  // The validator's own thresholds. A pair closer than 8 under colour-vision deficiency needs a second cue, and
  // two periods that share a shape must stay 15 or more apart for normal vision (8 or more for protan and deutan).
  // The seven periods only: Today is a neutral grey base layer, outside the validator's categorical scope.
  const CVD_TARGET = 8;
  const NORMAL_FLOOR = 15;
  const periods: PeriodId[] = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking'];
  const pairs = periods.flatMap((a, i) => periods.slice(i + 1).map((b) => [a, b] as const));
  const normal = (a: PeriodId, b: PeriodId) => colourDistance(PERIOD_COLORS[a], PERIOD_COLORS[b]);
  const cvd = (a: PeriodId, b: PeriodId) => Math.min(
    colourDistance(PERIOD_COLORS[a], PERIOD_COLORS[b], 'protan'),
    colourDistance(PERIOD_COLORS[a], PERIOD_COLORS[b], 'deutan'),
  );

  it('measures colour distance the way the validator does (the pairs the brief quotes: 7.6 and 15.6)', () => {
    expect(colourDistance(PERIOD_COLORS.BronzeAge, PERIOD_COLORS.BellBeaker, 'deutan')).toBeCloseTo(7.6, 1);
    expect(normal('FirstFarmers', 'Roman')).toBeCloseTo(15.6, 1);
  });

  it('periods that look alike under colour-vision deficiency differ in shape (all 21 pairs, First farmers and Bell Beaker included)', () => {
    expect(pairs).toHaveLength(21);
    for (const [a, b] of pairs) {
      if (cvd(a, b) < CVD_TARGET) expect(PERIOD_SHAPES[a], `${a} and ${b} look alike under CVD`).not.toBe(PERIOD_SHAPES[b]);
    }
  });

  it('periods that share a shape are far apart in colour, for normal vision and for protan and deutan readers', () => {
    for (const [a, b] of pairs.filter(([x, y]) => PERIOD_SHAPES[x] === PERIOD_SHAPES[y])) {
      expect(normal(a, b), `${a} and ${b}, normal vision`).toBeGreaterThanOrEqual(NORMAL_FLOOR);
      expect(cvd(a, b), `${a} and ${b}, colour-vision deficiency`).toBeGreaterThanOrEqual(CVD_TARGET);
    }
  });
});

// ---------- v3 legend: two headings, living groups, the east outline only with Anglo-Saxon focus ----------
describe('legend (spec §2.3, §3.5)', () => {
  it('the eastern-England legend label is the v3 text', () => {
    expect(EAST_ENGLAND_LEGEND).toBe('Anglo-Saxon burials, eastern England (outlined)');
    expect(LEGEND_ANCIENT).toBe('Ancient Britons');
    expect(LEGEND_LIVING).toBe('People living today');
  });

  it('groups items under two headings, each group on its own row: Ancient Britons, then People living today', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['FirstFarmers', 'BellBeaker', 'Today'], focus: 'BellBeaker' }));
    const groups = [...svg.querySelectorAll('g.legend-group')];
    expect(groups.map((g) => g.getAttribute('data-legend-group'))).toEqual(['ancient', 'living']);
    expect(groups.map((g) => g.querySelector('text.legend-heading')?.textContent)).toEqual([LEGEND_ANCIENT, LEGEND_LIVING]);
    // the headings are what tells ancient from living at a glance: bold, while no item text is
    expect(groups.map((g) => g.querySelector('text.legend-heading')?.getAttribute('font-weight'))).toEqual(['700', '700']);
    expect(svg.querySelectorAll('.legend-item text[font-weight]')).toHaveLength(0);
    expect(groupTexts(svg, 'ancient')).toEqual([withN(PERIOD_LABELS.FirstFarmers, 4), withN(PERIOD_LABELS.BellBeaker, 4)]);
    expect([...groups[1]!.querySelectorAll('.legend-item')].map((i) => i.getAttribute('data-legend')))
      .toEqual(['Sardinian', 'Spanish', 'ItalianNorth', 'French', 'Norwegian', 'Today']);
    expect(groupTexts(svg, 'living').at(-1)).toBe(withN(PERIOD_LABELS.Today, 4));
    const heading = (g: Element) => num(g.querySelector('text.legend-heading'), 'y');
    expect(heading(groups[0]!)).toBe(PCA_VIEW.legendTop);
    expect(heading(groups[1]!)).toBeGreaterThan(heading(groups[0]!));
    const todayMark = svg.querySelector('.legend-item[data-legend="Today"] path')!;
    expect(todayMark.getAttribute('fill')).toBe('none');
    expect(todayMark.getAttribute('stroke')).toBe(TODAY_RING.stroke);
    expect(todayMark.getAttribute('pointer-events')).toBe('all'); // the legend ring is hoverable over its whole disc too
    expect(svg.querySelector('.legend-item[data-legend="French"] path')?.getAttribute('fill')).toBe(MAP_GREY);
  });

  it('in the British frame a non-focus layer or map group with no point in the frame is left out; the focus layer never is', () => {
    const svg = newSvg();
    const d = makeData();
    renderPca(svg, d, pca({ layers: ['FirstFarmers', 'IronAge', 'Today'], focus: 'IronAge', frame: 'britain' }));
    expect(groupTexts(svg, 'ancient')).toEqual([withN(PERIOD_LABELS.IronAge, 5)]);
    expect(groupTexts(svg, 'living')).toEqual([withN(PERIOD_LABELS.Today, 4)]);
    renderPca(svg, d, pca({ layers: ['FirstFarmers', 'IronAge', 'Today'], focus: 'FirstFarmers', frame: 'britain' }));
    expect(groupTexts(svg, 'ancient')).toEqual([withN(PERIOD_LABELS.FirstFarmers, 4), withN(PERIOD_LABELS.IronAge, 5)]);
  });

  it('outlines the eastern-England points, with their legend item, only while Anglo-Saxon is the focus', () => {
    const svg = newSvg();
    const d = makeData();
    renderPca(svg, d, pca({ layers: ['IronAge', 'AngloSaxon', 'Viking'], focus: 'AngloSaxon', frame: 'britain' }));
    expect(groupTexts(svg, 'ancient')).toEqual([
      withN(PERIOD_LABELS.IronAge, 5), withN(PERIOD_LABELS.AngloSaxon, 5), EAST_ENGLAND_LEGEND, withN(PERIOD_LABELS.Viking, 2),
    ]);
    expect(svg.querySelectorAll('g.layer[data-layer="AngloSaxon"] .pt.east')).toHaveLength(2);
    for (const focus of ['Viking', 'IronAge', undefined] as const) {
      renderPca(svg, d, pca({ layers: ['IronAge', 'AngloSaxon', 'Viking'], focus, frame: 'britain' }));
      expect(svg.querySelectorAll('.pt.east'), String(focus)).toHaveLength(0);
      expect(eastItem(svg), String(focus)).toBeNull();
    }
    renderPca(svg, d, pca({ layers: ALL, focus: 'all', frame: 'europe', showNorthSea: true }));
    expect(svg.querySelectorAll('.pt.east')).toHaveLength(0);
    expect(eastItem(svg)).toBeNull();
  });

  it('has no east item when no Anglo-Saxon point carries east', () => {
    const d = makeData();
    for (const g of d.points) for (const pt of g.points) delete (pt as { east?: boolean }).east;
    const svg = newSvg();
    renderPca(svg, d, pca({ layers: ['AngloSaxon'], focus: 'AngloSaxon', frame: 'britain' }));
    expect(svg.querySelectorAll('.pt.east')).toHaveLength(0);
    expect(eastItem(svg)).toBeNull();
  });

  it('its mark looks like the plotted points it explains: an Anglo-Saxon triangle in its colour with the same black outline', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['AngloSaxon'], focus: 'AngloSaxon', frame: 'britain' }));
    const mark = eastItem(svg)!.querySelector('path')!;
    const plotted = svg.querySelector('.pt.east')!;
    const plain = svg.querySelector('.legend-item[data-legend="AngloSaxon"] path')!;
    expect(mark.getAttribute('stroke')).toBe(INK);
    expect(mark.getAttribute('stroke')).toBe(plotted.getAttribute('stroke'));
    expect(mark.getAttribute('stroke-width')).toBe(plotted.getAttribute('stroke-width'));
    expect(mark.getAttribute('fill')).toBe(PERIOD_COLORS.AngloSaxon);
    expect(mark.getAttribute('fill')).toBe(plotted.getAttribute('fill'));
    const commands = (el: Element) => (el.getAttribute('d') ?? '').replace(/[^A-Za-z]/g, '');
    expect(PERIOD_SHAPES.AngloSaxon).toBe('triangle');
    expect(commands(mark)).toBe('MLLZ');
    expect(commands(mark)).toBe(commands(plain));
    expect(plain.getAttribute('stroke')).toBeNull();
    expect(eastItem(svg)!.getAttribute('data-tip')).toBe(EAST_ENGLAND_LEGEND);
  });

  it('renders all (Viking included) and Anglo-Saxon focus with no legend item past the viewBox (spec §9.1)', () => {
    const d = withRealCounts(makeData());
    const svg = newSvg();
    const cases = [
      pca({ layers: ALL, focus: 'all', frame: 'europe', showNorthSea: true }),
      pca({ layers: ALL, focus: 'AngloSaxon', frame: 'britain', showNorthSea: true }),
      pca({ layers: ALL, focus: 'Today', frame: 'britain', showNorthSea: true }),
    ];
    for (const s of cases) {
      renderPca(svg, d, s);
      if (s.focus === 'all') {
        expect(layerIds(svg)).toEqual(ALL); // Britain today drawn last
        expect(svg.querySelector('.legend-item[data-legend="Viking"]')?.textContent).toBe(withN(PERIOD_LABELS.Viking, 37));
      }
      const texts = [...svg.querySelectorAll('.legend text')];
      expect(texts.length).toBeGreaterThan(4);
      for (const t of texts) {
        const w = (t.textContent ?? '').length * (t.classList.contains('legend-heading') ? 8.4 : 7.6);
        expect(num(t, 'x') + w, `${s.focus}: ${t.textContent}`).toBeLessThanOrEqual(PCA_VIEW.right + 1);
        expect(num(t, 'y') + 4, `${s.focus}: ${t.textContent}`).toBeLessThanOrEqual(PCA_VIEW.height);
        expect(num(t, 'y'), `${s.focus}: ${t.textContent}`).toBeLessThanOrEqual(PCA_VIEW.legendTop + 5 * PCA_VIEW.legendRow);
      }
    }
  });

  it('adds no legend text that breaks a §6 rule (no ages, no Group or sample IDs)', () => {
    const svg = newSvg();
    renderPca(svg, withRealCounts(makeData()), pca({ layers: ALL, focus: 'AngloSaxon', frame: 'britain', showNorthSea: true }));
    const text = svg.querySelector('.legend')?.textContent ?? '';
    expect(text).toContain(EAST_ENGLAND_LEGEND);
    expect(text).not.toMatch(/BCE|BC\b|BP\b|years|ago|Neolithic|Mesolithic|_/i);
  });
});

describe('caption strip and chips (renderPcaCaptions, icons.ts)', () => {
  it('builds div.pca-captions in item order: captions, a chip with its icon, the zoom note', () => {
    const items: PcaCaptionItem[] = [
      { kind: 'caption', key: 'PCA_CAPTION', text: PCA_CAPTION },
      { kind: 'caption', key: 'EUROPE_CAPTION', text: EUROPE_CAPTION },
      { kind: 'chip', key: 'CHIP_DNA_CHANGED', text: CHIP_TEXT.CHIP_DNA_CHANGED, icon: 'dna' },
      { kind: 'zoom', text: zoomNote(5) },
    ];
    const strip = renderPcaCaptions(document, items);
    expect(strip.tagName).toBe('DIV');
    expect(strip.className).toBe('pca-captions');
    const kids = [...strip.children];
    expect(kids.map((k) => k.tagName.toLowerCase())).toEqual(['p', 'p', 'span', 'p']);
    expect(kids[0]!.className).toBe('pca-caption');
    expect(kids[0]!.getAttribute('data-caption')).toBe('PCA_CAPTION');
    expect(kids[0]!.textContent).toBe(PCA_CAPTION);
    expect(kids[1]!.getAttribute('data-caption')).toBe('EUROPE_CAPTION');
    expect(kids[1]!.textContent).toBe('Each dot is a person living in Europe today. Britain is held back for now.');
    expect(kids[2]!.matches('span.chip.chip--dna[data-chip="CHIP_DNA_CHANGED"]')).toBe(true);
    expect(kids[2]!.textContent).toBe('DNA changed: new people');
    expect(kids[2]!.querySelector('svg.chip-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(kids[3]!.className).toBe('zoom-note');
    expect(kids[3]!.textContent).toBe('Zoomed in about 5× on Britain');
    expect(renderPcaCaptions(document, []).children).toHaveLength(0);
  });

  it('every chip carries the icon of its stem: DNA changed -> helix, Culture changed -> pot', () => {
    for (const key of Object.keys(CHIP_TEXT) as ChipKey[]) {
      const el = chipElement(document, key);
      const icon = CHIP_TEXT[key].startsWith('DNA changed') ? 'dna' : 'pot';
      expect(CHIP_TEXT[key].startsWith('DNA changed') || CHIP_TEXT[key].startsWith('Culture changed'), key).toBe(true);
      expect(el.className).toBe(`chip chip--${icon}`);
      expect(el.getAttribute('data-chip')).toBe(key);
      expect(el.querySelector('svg.chip-icon path')?.getAttribute('d')).toBe(CHIP_ICON_PATHS[icon]);
      expect(el.querySelector('svg.chip-icon')?.getAttribute('viewBox')).toBe('0 0 24 24');
      // built in the SVG namespace (an svg made any other way would not draw), written out so a re-declared constant is caught
      expect(el.querySelector('svg.chip-icon')?.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(el.querySelector('svg.chip-icon path')?.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(el.textContent).toBe(CHIP_TEXT[key]);
    }
  });
});

// ---- Task 29 (P3, flag yorkTraveller): the York traveller on the Roman plot ----
// The point sits off the British frame (the label says "off this zoomed map"), so it is drawn pinned to the frame edge with a pointer
// toward where it really lies. Both flag states are driven by an explicit `features` argument, never by the shipped FEATURES.

// The mark's three parts and the legend's entries as boxes in the drawing's own units, read from the svg's attributes. jsdom has no layout,
// so the words and the legend text are sized at 8.5 units a character: wider than 15 px semi-bold or 14 px regular type run in Chrome, and
// independent of the renderer's own 7.6 and 8.4 estimates. e2e/p3-roman.spec.ts measures the same in a browser.
const WIDE = 8.5;
const nums = (d: string | null): number[] => [...(d ?? '').matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
function yorkBoxes(g: Element): Record<'mark' | 'arrow' | 'words', Box> {
  const [x0, y0, w, h] = nums(g.querySelector('path.york-marker')!.getAttribute('d')) as [number, number, number, number];   // "M x y h w v w h -w Z"
  const corners = nums(g.querySelector('path.york-pointer')!.getAttribute('d'));                                           // "M tip L base L base Z"
  const xs = corners.filter((_, i) => i % 2 === 0);
  const ys = corners.filter((_, i) => i % 2 === 1);
  const label = g.querySelector('text.york-label')!;
  const lines = [...label.querySelectorAll('tspan')].map((t) => (t.textContent ?? '').trim().length);
  const lx = num(label, 'x');
  const wide = Math.max(...lines) * WIDE;
  const end = label.getAttribute('text-anchor') === 'end';
  return {
    mark: { left: x0 - 1.5, right: x0 + w + 1.5, top: y0 - 1.5, bottom: y0 + h + 1.5 },       // its outline is 3 wide
    arrow: { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) },
    words: { left: end ? lx - wide : lx, right: end ? lx : lx + wide, top: num(label, 'y') - 15, bottom: num(label, 'y') + (lines.length - 1) * YORK_LINE + 4 },
  };
}
const legendBox = (item: Element): Box => {
  const t = item.querySelector('text')!;
  return { left: num(t, 'x') - 20, right: num(t, 'x') + (t.textContent ?? '').length * WIDE, top: num(t, 'y') - 14, bottom: num(t, 'y') + 4 };
};
/** None of the mark's three parts touches any entry of the legend under the plot. */
function expectClearOfLegend(svg: SVGSVGElement, where: string): void {
  const g = svg.querySelector('g.york-traveller');
  expect(g, `${where}: he is drawn`).not.toBeNull();
  const parts = yorkBoxes(g!);
  const items = [...svg.querySelectorAll('g.legend-item')];
  expect(items.length, `${where}: the legend has entries`).toBeGreaterThan(0);
  for (const item of items) {
    for (const [name, box] of Object.entries(parts)) {
      expect(overlap(box, legendBox(item)), `${where}: the ${name} lies over the legend entry "${item.textContent}"`).toBe(false);
    }
  }
}
/**
 * Where the tip of his arrow was before Task 29's fix round 1, when the mark sat right on the frame's edge (the box's bottom edge at the
 * south-east corner): 22 on from the mark toward where he really lies. It then lay inside the legend's Roman entry in the guided run.
 */
function oldArrowTip(fr: Frame, named: NamedPoint): { x: number; y: number } {
  const sc = makeScale(fr);
  const c = clampToFrame(named, fr);
  const edge = { x: sc.toX(c.x), y: sc.toY(c.y) };
  const t = { x: sc.toX(named.x), y: sc.toY(named.y) };
  const len = Math.hypot(t.x - edge.x, t.y - edge.y);
  return { x: edge.x + (22 * (t.x - edge.x)) / len, y: edge.y + (22 * (t.y - edge.y)) / len };
}

describe('York traveller edge marker (Task 29, flag yorkTraveller)', () => {
  const york: NamedPoint = { key: 'york_traveller', period: 'Roman', x: 0.045, y: 0.005 };
  const data: WorkshopData = { ...FIXTURE, named: [york] };
  const roman = reducePlot(INITIAL_PLOT, { kind: 'pca', period: 'Roman' }, data);
  const on = withFeatures({ yorkTraveller: true }, ALL_OFF);
  const draw = (d: WorkshopData, p: PlotState, features?: Features): SVGSVGElement => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.replaceChildren(svg);
    renderPca(svg, d, p, { animate: false, ...(features === undefined ? {} : { features }) });
    return svg;
  };

  it('the label is the verbatim §3.3 text and passes the content rules', () => {
    expect(YORK_TRAVELLER_LABEL).toBe('A man buried in York whose DNA is most like people in the Middle East today (off this zoomed map)');
    expect(ruleViolations(YORK_TRAVELLER_LABEL)).toEqual([]);
  });

  it('draws one marker on a Roman-focus plot, with the label and a hover tip', () => {
    expect(roman.focus).toBe('Roman');
    const svg = draw(data, roman, on);
    const g = svg.querySelectorAll('g.york-traveller');
    expect(g).toHaveLength(1);
    expect(g[0]!.getAttribute('data-named')).toBe('york_traveller');
    expect(g[0]!.getAttribute('data-tip')).toBe(YORK_TRAVELLER_LABEL);
    expect(g[0]!.querySelector('text.york-label')?.textContent).toBe(YORK_TRAVELLER_LABEL);
  });

  it('the marker is a hollow Roman square a little bigger than a data point, with a Roman-coloured pointer, and shows nothing but the label as text', () => {
    const g = draw(data, roman, on).querySelector('g.york-traveller')!;
    const marker = g.querySelector('path.york-marker')!;
    expect(marker.getAttribute('fill')).toBe('#FFFFFF');
    expect(marker.getAttribute('stroke')).toBe(PERIOD_COLORS.Roman);
    expect(YORK_MARKER_R).toBeGreaterThan(5);                       // a data point has radius 5
    expect(g.querySelector('path.york-pointer')!.getAttribute('fill')).toBe(PERIOD_COLORS.Roman);
    expect(g.querySelector('path.york-pointer')!.getAttribute('d')).toMatch(/^M[\d. -]+L[\d. -]+L[\d. -]+Z$/);
    expect(g.querySelectorAll('text')).toHaveLength(1);              // no sample ID, group ID or place name besides the label
    expect(g.textContent).toBe(YORK_TRAVELLER_LABEL);
  });

  // The mark is pinned to the frame's edge, but kept 30 units inside the plot box (src/plots/pca.ts YORK_EDGE_INSET): the legend runs under the
  // box and its first row reaches under the south-east corner in the guided run, where the arrow, which reaches 22 beyond the mark, once landed on
  // the Roman entry (Task 29, fix round 1). The 30 and the 22 are written out here, not read from the module, so changing either is noticed.
  it('pins the marker to the frame edge, 30 inside the plot box, and points toward the real position', () => {
    const fr = data.frames[roman.frame];
    const sc = makeScale(fr);
    const c = clampToFrame(york, fr);
    expect(c.clipped).toBe(true);
    const edge = { x: sc.toX(c.x), y: sc.toY(c.y) };
    // the fixture's frame is square: its south-east corner is the plot box's (785, 590)
    expect(edge.x).toBeCloseTo(785, 3);
    expect(edge.y).toBeCloseTo(590, 3);
    const q = { x: Math.min(Math.max(edge.x, PCA_VIEW.left + 30), PCA_VIEW.right - 30), y: Math.min(Math.max(edge.y, PCA_VIEW.top + 30), PCA_VIEW.bottom - 30) };
    expect(q.x, 'on the frame\'s east edge').toBeCloseTo(785, 3);
    expect(q.y, '30 above the box\'s bottom edge').toBeCloseTo(560, 3);
    const t = { x: sc.toX(york.x), y: sc.toY(york.y) };
    const g = draw(data, roman, on).querySelector('g.york-traveller')!;
    expect(g.querySelector('path.york-marker')!.getAttribute('d')).toBe(shapePath(PERIOD_SHAPES.Roman, q.x, q.y, YORK_MARKER_R));
    const tip = (g.querySelector('path.york-pointer')!.getAttribute('d') ?? '').match(/^M(-?[\d.]+) (-?[\d.]+)/)!;
    const v = { x: Number(tip[1]) - q.x, y: Number(tip[2]) - q.y };
    expect(v.x * (t.x - q.x) + v.y * (t.y - q.y)).toBeGreaterThan(0);
  });

  it('pins the arrow: a triangle whose tip is 22 from the mark\'s centre toward where he lies, its base 12 from the centre and 12 wide; the mark sits 30 inside the box', () => {
    expect([YORK_EDGE_INSET, YORK_POINTER_REACH, YORK_POINTER_BASE, YORK_POINTER_HALF]).toEqual([30, 22, 12, 6]);
    // The arrow reaches at most YORK_POINTER_REACH beyond the mark, and the square is 0.9 x 8 = 7.2 to its edge and 1.5 more with its stroke, so a
    // mark kept YORK_EDGE_INSET inside the box has both entirely inside it.
    expect(YORK_EDGE_INSET).toBeGreaterThanOrEqual(YORK_POINTER_REACH);
    expect(YORK_EDGE_INSET).toBeGreaterThanOrEqual(0.9 * YORK_MARKER_R + 1.5);
    const g = draw(data, roman, on).querySelector('g.york-traveller')!;
    const c = { x: 785, y: 560 };
    const pts = [...(g.querySelector('path.york-pointer')!.getAttribute('d') ?? '').matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    expect(pts).toHaveLength(3);
    const [tip, b1, b2] = pts as [readonly [number, number], readonly [number, number], readonly [number, number]];
    expect(Math.hypot(tip[0] - c.x, tip[1] - c.y)).toBeCloseTo(22, 0);
    expect(Math.hypot((b1[0] + b2[0]) / 2 - c.x, (b1[1] + b2[1]) / 2 - c.y)).toBeCloseTo(12, 0);
    expect(Math.hypot(b1[0] - b2[0], b1[1] - b2[1])).toBeCloseTo(12, 0);
    // The tip, the middle of the base and the mark's centre lie on one line (the arrow points straight away from the mark).
    const cross = (tip[0] - c.x) * ((b1[1] + b2[1]) / 2 - c.y) - (tip[1] - c.y) * ((b1[0] + b2[0]) / 2 - c.x);
    expect(Math.abs(cross)).toBeLessThan(1);
    // And the whole of it lies inside the plot box, so it can touch nothing under the box.
    for (const [x, y] of [tip, b1, b2]) expect(x >= PCA_VIEW.left && x <= PCA_VIEW.right && y >= PCA_VIEW.top && y <= PCA_VIEW.bottom, `${x}, ${y}`).toBe(true);
  });

  it('sets the words in three lines (wrapped at 36 characters, 18 apart) of 15 px type with a white outline, so they read over the dots', () => {
    expect([YORK_LABEL_CHARS, YORK_LINE, YORK_MARKER_R]).toEqual([36, 18, 8]);
    const label = draw(data, roman, on).querySelector('text.york-label')!;
    expect(label.querySelectorAll('tspan')).toHaveLength(3);
    expect(label.getAttribute('font-size')).toBe('15');
    expect(label.getAttribute('font-weight')).toBe('600');
    expect([label.getAttribute('stroke'), label.getAttribute('stroke-width'), label.getAttribute('paint-order')]).toEqual(['#FFFFFF', '4', 'stroke']);
    expect(label.getAttribute('pointer-events'), 'the words never take the hover from the mark under them').toBe('none');
  });

  // textBlock keeps the space between two lines at the end of the first. A right-anchored line counts that space in its width, so the lines
  // would stop a space (about 4 units) short of the last one: for a right-anchored label the spaces are at the front of the next line.
  it('right-anchored lines all end on their last letter: the space between two lines is at the front of the next one, and the sentence is unchanged', () => {
    const label = draw(data, roman, on).querySelector('text.york-label')!;
    expect(label.getAttribute('text-anchor')).toBe('end');
    const lines = [...label.querySelectorAll('tspan')].map((t) => t.textContent!);
    expect(lines).toHaveLength(3);
    lines.forEach((l, i) => {
      expect(l.endsWith(' '), `line ${i} ends in a space`).toBe(false);
      expect(l.startsWith(' '), `line ${i} starts with a space`).toBe(i > 0);
      expect(l.trim().length, `line ${i}`).toBeLessThanOrEqual(YORK_LABEL_CHARS);
    });
    expect(label.textContent).toBe(YORK_TRAVELLER_LABEL);
  });

  it('left-anchored lines start on their first letter: the space between two lines stays at the end of the first, and the sentence is unchanged', () => {
    const nw: WorkshopData = { ...FIXTURE, named: [{ ...york, x: 0.0, y: 0.05 }] };       // north-west of the frame: the words start right of the mark
    const label = draw(nw, reducePlot(INITIAL_PLOT, { kind: 'pca', period: 'Roman' }, nw), on).querySelector('text.york-label')!;
    expect(label.hasAttribute('text-anchor')).toBe(false);
    const lines = [...label.querySelectorAll('tspan')].map((t) => t.textContent!);
    lines.forEach((l, i) => {
      expect(l.startsWith(' '), `line ${i} starts with a space`).toBe(false);
      expect(l.endsWith(' '), `line ${i} ends in a space`).toBe(i < lines.length - 1);
    });
    expect(label.textContent).toBe(YORK_TRAVELLER_LABEL);
  });

  it('keeps every label line inside the plot box', () => {
    const label = draw(data, roman, on).querySelector('text.york-label')!;
    const lines = label.querySelectorAll('tspan').length;
    expect(lines).toBeGreaterThanOrEqual(2);
    for (const span of Array.from(label.querySelectorAll('tspan'))) expect(span.textContent!.trim().length).toBeLessThanOrEqual(YORK_LABEL_CHARS);
    const y0 = Number(label.getAttribute('y'));
    expect(y0).toBeGreaterThanOrEqual(PCA_VIEW.top);
    expect(y0 + (lines - 1) * YORK_LINE).toBeLessThanOrEqual(PCA_VIEW.bottom);
    const x = Number(label.getAttribute('x'));
    expect(x).toBeGreaterThanOrEqual(PCA_VIEW.left);
    expect(x).toBeLessThanOrEqual(PCA_VIEW.right);
  });

  it('puts the label on the plot-centre side of the marker: a marker in the right half ends its label (text-anchor end) above and left of it', () => {
    const g = draw(data, roman, on).querySelector('g.york-traveller')!;
    const label = g.querySelector('text.york-label')!;
    const m = /^M(-?[\d.]+) (-?[\d.]+)/.exec(g.querySelector('path.york-marker')!.getAttribute('d') ?? '')!;
    const markerLeft = Number(m[1]);                               // the square's top-left corner x; its centre is 0.9 r further right
    const centreX = markerLeft + YORK_MARKER_R * 0.9;
    expect(centreX).toBeGreaterThan((PCA_VIEW.left + PCA_VIEW.right) / 2);
    expect(label.getAttribute('text-anchor')).toBe('end');
    expect(Number(label.getAttribute('x'))).toBeLessThan(centreX);
    const bottomLine = Number(label.getAttribute('y')) + (label.querySelectorAll('tspan').length - 1) * YORK_LINE;
    const centreY = Number(m[2]) + YORK_MARKER_R * 0.9;
    expect(bottomLine).toBeLessThan(centreY);                       // the block ends above the marker
  });

  // The data puts him south-east of the British frame, but the rule is general: wherever he is off the frame he is pinned to its nearest edge or
  // corner, kept 30 inside the plot box; the pointer leads away from the mark toward where he lies; the words sit on the plot-centre side of the
  // mark, not over it; and the mark, its arrow and its words all lie inside the box, so none of them can reach the legend under it.
  it('puts the words on the plot-centre side of the mark at every edge and corner of the frame, never over it, inside the plot box', () => {
    const spots: Record<string, [number, number]> = {
      NW: [0.0, 0.05], N: [0.02, 0.05], NE: [0.04, 0.05], E: [0.04, 0.03], SE: [0.045, 0.005], S: [0.02, 0.0], SW: [0.0, 0.0], W: [0.0, 0.03],
    };
    const WORD = 8.5;                                   // an estimate of a 15 px semi-bold character, in plot units
    const fr = data.frames[roman.frame];
    const sc = makeScale(fr);
    const pin = (e: { x: number; y: number }): { x: number; y: number } => ({     // the frame-edge point, 30 inside the plot box (YORK_EDGE_INSET)
      x: Math.min(Math.max(e.x, PCA_VIEW.left + 30), PCA_VIEW.right - 30),
      y: Math.min(Math.max(e.y, PCA_VIEW.top + 30), PCA_VIEW.bottom - 30),
    });
    for (const [name, [x, y]] of Object.entries(spots)) {
      const d: WorkshopData = { ...FIXTURE, named: [{ ...york, x, y }] };
      const svg = draw(d, reducePlot(INITIAL_PLOT, { kind: 'pca', period: 'Roman' }, d), on);
      const g = svg.querySelector('g.york-traveller');
      expect(g, name).not.toBeNull();
      const c = clampToFrame({ x, y }, fr);
      const q = pin({ x: sc.toX(c.x), y: sc.toY(c.y) });
      const t = { x: sc.toX(x), y: sc.toY(y) };
      const right = q.x > (PCA_VIEW.left + PCA_VIEW.right) / 2;
      const below = q.y > (PCA_VIEW.top + PCA_VIEW.bottom) / 2;
      expect(g!.querySelector('path.york-marker')!.getAttribute('d'), `${name}: the mark is at the frame's edge, kept 30 inside the plot box`).toBe(shapePath(PERIOD_SHAPES.Roman, q.x, q.y, YORK_MARKER_R));
      const tip = /^M(-?[\d.]+) (-?[\d.]+)/.exec(g!.querySelector('path.york-pointer')!.getAttribute('d') ?? '')!;
      expect((Number(tip[1]) - q.x) * (t.x - q.x) + (Number(tip[2]) - q.y) * (t.y - q.y), `${name}: the pointer leads toward where he lies`).toBeGreaterThan(0);
      const parts = yorkBoxes(g!);
      for (const part of ['mark', 'arrow'] as const) {
        const b = parts[part];
        expect(b.left >= PCA_VIEW.left && b.right <= PCA_VIEW.right && b.top >= PCA_VIEW.top && b.bottom <= PCA_VIEW.bottom, `${name}: the ${part} lies inside the plot box`).toBe(true);
      }
      const label = g!.querySelector('text.york-label')!;
      const lines = label.querySelectorAll('tspan').length;
      const lx = Number(label.getAttribute('x'));
      const ly = Number(label.getAttribute('y'));
      expect(label.getAttribute('text-anchor') === 'end', `${name}: right-anchored exactly in the right half`).toBe(right);
      // The block's estimated extent: its width runs left of the anchor when right-anchored and right of it otherwise; 15 px type, lines YORK_LINE apart.
      const wide = YORK_LABEL_CHARS * WORD;
      const block = { left: right ? lx - wide : lx, right: right ? lx : lx + wide, top: ly - 15, bottom: ly + (lines - 1) * YORK_LINE + 4 };
      expect(block.left, `${name}: the words start inside the plot box`).toBeGreaterThanOrEqual(PCA_VIEW.left);
      expect(block.right, `${name}: the words end inside the plot box`).toBeLessThanOrEqual(PCA_VIEW.right);
      expect(block.top, `${name}: the words start below the plot box's top`).toBeGreaterThanOrEqual(PCA_VIEW.top);
      expect(block.bottom, `${name}: the words end above the plot box's bottom`).toBeLessThanOrEqual(PCA_VIEW.bottom);
      const s = 0.9 * YORK_MARKER_R;                    // the square mark's half-width
      const apart = block.right < q.x - s || block.left > q.x + s || block.bottom < q.y - s || block.top > q.y + s;
      expect(apart, `${name}: the words are clear of the mark`).toBe(true);
      expect(below ? block.bottom < q.y : block.top > q.y, `${name}: the block is on the plot-centre side vertically`).toBe(true);
    }
  });

  // The British frame is nearly square, so it leaves room either side of itself in the plot box and only the bottom (and top) of the clamp is
  // reached by the real data. A frame as wide as the plot box has every edge on the box's own edge: the mark is then 30 inside on all four sides.
  it('keeps the mark 30 inside the plot box on all four sides, and its arrow and words inside, when the frame fills the box', () => {
    const wide: Frame = { xmin: 0, xmax: 0.96, ymin: 0, ymax: 0.57 };       // 960 x 570 units: exactly the plot box
    const sc = makeScale(wide);
    expect([sc.toX(0), sc.toX(0.96), sc.toY(0.57), sc.toY(0)].map((v) => Math.round(v * 1000) / 1000)).toEqual([20, 980, 20, 590]);
    const spots: Record<string, { at: [number, number]; mark: [number, number] }> = {
      NW: { at: [-0.2, 0.8], mark: [50, 50] }, N: { at: [0.48, 0.8], mark: [500, 50] }, NE: { at: [1.1, 0.8], mark: [950, 50] },
      E: { at: [1.1, 0.3], mark: [950, 290] }, SE: { at: [1.1, -0.2], mark: [950, 560] }, S: { at: [0.48, -0.2], mark: [500, 560] },
      SW: { at: [-0.2, -0.2], mark: [50, 560] }, W: { at: [-0.2, 0.3], mark: [50, 290] },
    };
    for (const [name, { at, mark }] of Object.entries(spots)) {
      const d: WorkshopData = { ...FIXTURE, frames: { ...FIXTURE.frames, britain: wide }, named: [{ ...york, x: at[0], y: at[1] }] };
      const g = draw(d, reducePlot(INITIAL_PLOT, { kind: 'pca', period: 'Roman' }, d), on).querySelector('g.york-traveller');
      expect(g, name).not.toBeNull();
      expect(g!.querySelector('path.york-marker')!.getAttribute('d'), `${name}: the mark is 30 inside the box`).toBe(shapePath(PERIOD_SHAPES.Roman, mark[0], mark[1], YORK_MARKER_R));
      for (const [part, b] of Object.entries(yorkBoxes(g!))) {
        expect(b.left >= PCA_VIEW.left && b.right <= PCA_VIEW.right && b.top >= PCA_VIEW.top && b.bottom <= PCA_VIEW.bottom, `${name}: the ${part} lies inside the plot box`).toBe(true);
      }
    }
  });

  // A class reaches the Roman step by typing the guided commands from the start, not by jumping to it: the plot then holds six layers and the
  // legend's first row runs Bell Beaker, Bronze Age, Iron Age, Roman, the last under the plot's south-east corner, where the arrow of a mark
  // pinned to the box's bottom edge once landed (Task 29, fix round 1). The counts here are the real build's, so the entries are as long as a class's.
  it('at the Roman step of the guided run, the mark, its arrow and its words are clear of every legend entry', () => {
    const counts: Record<PeriodId, number> = { FirstFarmers: 118, BellBeaker: 77, BronzeAge: 83, IronAge: 371, Roman: 17, AngloSaxon: 206, Viking: 37, Today: 108 };
    const d: WorkshopData = { ...data, periods: data.periods.map((p) => ({ ...p, n_pca: counts[p.id] })) };
    const flow = withFeatures({ yorkTraveller: true, consumerBars: true, back: true, finaleAnimation: true }, ALL_OFF);
    const plot = guidedPlot(d, 'roman', flow);
    expect(plot.focus).toBe('Roman');
    expect(plot.layers, 'the class\'s six layers, not the shortcut\'s two').toEqual(['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'Today']);
    const svg = draw(d, plot, flow);
    const entries = [...svg.querySelectorAll('g.legend-item')].map((i) => i.getAttribute('data-legend'));
    expect(entries.slice(0, 4), 'the legend\'s first row').toEqual(['BellBeaker', 'BronzeAge', 'IronAge', 'Roman']);
    const romanEntry = legendBox(svg.querySelector('g.legend-item[data-legend="Roman"]')!);
    expectClearOfLegend(svg, 'guided run');
    // The check has teeth: the arrow's tip, where the mark used to sit, was inside this legend's Roman entry.
    const tip = oldArrowTip(d.frames[plot.frame], york);
    expect(overlap({ left: tip.x - 1, right: tip.x + 1, top: tip.y - 1, bottom: tip.y + 1 }, romanEntry), 'the old arrow tip was on the Roman entry').toBe(true);
  });

  it('lies wholly inside the 1000 x 760 drawing where the data puts him: the pointer\'s three corners and the square mark', () => {
    const g = draw(data, roman, on).querySelector('g.york-traveller')!;
    const corners = [...(g.querySelector('path.york-pointer')!.getAttribute('d') ?? '').matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    expect(corners).toHaveLength(3);
    for (const [x, y] of corners) expect(x >= 0 && x <= PCA_VIEW.width && y >= 0 && y <= PCA_VIEW.height, `pointer corner ${x}, ${y}`).toBe(true);
    // The square is drawn "M x y h w v w h -w Z": its top-left corner, then its width and height.
    const sq = /^M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v([\d.]+)/.exec(g.querySelector('path.york-marker')!.getAttribute('d') ?? '')!;
    const [x0, y0, w, h] = [sq[1], sq[2], sq[3], sq[4]].map(Number) as [number, number, number, number];
    expect(x0 >= 0 && x0 + w <= PCA_VIEW.width && y0 >= 0 && y0 + h <= PCA_VIEW.height, 'the mark').toBe(true);
  });

  it('is drawn inside the plot group, after the centre labels and before the legend', () => {
    const svg = draw(data, roman, on);
    const world = svg.querySelector('g.world')!;
    const mark = world.querySelector(':scope > g.york-traveller');
    expect(mark, 'a child of g.world, so a frame change carries it along').not.toBeNull();
    const labels = [...world.querySelectorAll(':scope > text.centre-label')];
    expect(labels.length, 'the British frame has centre labels').toBeGreaterThan(0);
    for (const l of labels) expect(l.compareDocumentPosition(mark!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mark!.compareDocumentPosition(svg.querySelector('g.legend')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws nothing when the focus is not Roman', () => {
    const ironAfter = reducePlot(roman, { kind: 'pca', period: 'IronAge' }, data);
    expect(draw(data, ironAfter, on).querySelector('g.york-traveller')).toBeNull();
    const all = reducePlot(roman, { kind: 'pca', period: 'all' }, data);
    expect(draw(data, all, on).querySelector('g.york-traveller')).toBeNull();
    const europe = reducePlot(roman, { kind: 'pca', period: 'Europe' }, data);
    expect(draw(data, europe, on).querySelector('g.york-traveller')).toBeNull();
  });

  it('draws nothing without named data, or when the point is inside the frame (the label would be false)', () => {
    const { named: _drop, ...noNamed } = data;
    expect(draw(noNamed as WorkshopData, roman, on).querySelector('g.york-traveller')).toBeNull();
    expect(draw({ ...FIXTURE, named: [] }, roman, on).querySelector('g.york-traveller')).toBeNull();
    const inside: WorkshopData = { ...FIXTURE, named: [{ ...york, x: 0.02, y: 0.03 }] };
    expect(yorkTravellerMark(inside, reducePlot(INITIAL_PLOT, { kind: 'pca', period: 'Roman' }, inside), on)).toBeNull();
  });

  it('reads the first named point and never assumes there is only one (validateNamed accepts any count; the data build guarantees one)', () => {
    const second: NamedPoint = { key: 'york_traveller', period: 'Roman', x: -0.2, y: 0.5 };
    const two: WorkshopData = { ...FIXTURE, named: [york, second] };
    const svg = draw(two, roman, on);
    expect(svg.querySelectorAll('g.york-traveller')).toHaveLength(1);
    expect(svg.querySelector('g.york-traveller path.york-marker')!.getAttribute('d')).toBe(draw(data, roman, on).querySelector('g.york-traveller path.york-marker')!.getAttribute('d'));
  });

  it('is not drawn on any other view', () => {
    for (const view of ['admixture', 'trait', 'consumer', 'none'] as const) {
      expect(yorkTravellerMark(data, { ...roman, view }, on), view).toBeNull();
    }
  });

  it('the flag is read from the `features` argument, and from the shipped FEATURES when none is given', () => {
    expect(yorkTravellerMark(data, roman, ALL_OFF)).toBeNull();
    expect(yorkTravellerMark(data, roman, withFeatures({ yorkTraveller: true }))).not.toBeNull();
    const shipped = yorkTravellerMark(data, roman);           // no features argument: the build's own flag set
    const shown = draw(data, roman).querySelectorAll('g.york-traveller').length;
    expect(shipped === null).toBe(shown === 0);
    expect(withFeatures({ yorkTraveller: true }).yorkTraveller).toBe(true);
  });
});

const REAL_JSON = resolve(__dirname, '../src/data/workshop_data.json');   // (not import.meta.url: under jsdom it is not a file URL)
describe.runIf(process.env.REAL_DATA === '1' && existsSync(REAL_JSON))('York traveller on the real data (Task 29)', () => {
  // Read inside each test, as tests/plots-consumer.test.ts does: a skipped describe still runs this function to collect its tests, so reading and
  // validating the build's JSON here would make a plain `npm test` depend on it.
  const real = (): WorkshopData => validateData(JSON.parse(readFileSync(REAL_JSON, 'utf8')));
  const on = withFeatures({ yorkTraveller: true }, ALL_OFF);
  const draw = (d: WorkshopData, p: PlotState, features: Features = on): SVGSVGElement => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.replaceChildren(svg);
    renderPca(svg, d, p, { animate: false, features });
    return svg;
  };

  it('is drawn on the Roman focus as an edge marker inside the plot box', () => {
    const d = real();
    const label = draw(d, reducePlot(INITIAL_PLOT, { kind: 'pca', period: 'Roman' }, d)).querySelector('g.york-traveller text.york-label');
    expect(label?.textContent).toBe(YORK_TRAVELLER_LABEL);
    const y0 = Number(label!.getAttribute('y'));
    expect(y0).toBeGreaterThanOrEqual(PCA_VIEW.top);
    expect(y0 + (label!.querySelectorAll('tspan').length - 1) * YORK_LINE).toBeLessThanOrEqual(PCA_VIEW.bottom);
  });

  it('is off the British frame to the east and south, so he is pinned to its south-east corner, 30 inside the plot box, and points down and to the right', () => {
    const d = real();
    const named = d.named?.[0];
    expect(named, 'the build has the named point').toBeDefined();
    const fr = d.frames.britain;
    expect(named!.x).toBeGreaterThan(fr.xmax);
    expect(named!.y).toBeLessThan(fr.ymin);
    const sc = makeScale(fr);
    const corner = { x: sc.toX(fr.xmax), y: sc.toY(fr.ymin) };
    expect(corner.y, 'the frame\'s corner is on the plot box\'s bottom edge').toBeCloseTo(PCA_VIEW.bottom, 6);
    const mark = { x: corner.x, y: corner.y - 30 };                         // 30 inside the box (YORK_EDGE_INSET, pinned above)
    const g = draw(d, reducePlot(INITIAL_PLOT, { kind: 'pca', period: 'Roman' }, d)).querySelector('g.york-traveller')!;
    expect(g.querySelector('path.york-marker')!.getAttribute('d')).toBe(shapePath(PERIOD_SHAPES.Roman, mark.x, mark.y, YORK_MARKER_R));
    const tip = /^M(-?[\d.]+) (-?[\d.]+)/.exec(g.querySelector('path.york-pointer')!.getAttribute('d') ?? '')!;
    expect(Number(tip[1])).toBeGreaterThan(mark.x);
    expect(Number(tip[2])).toBeGreaterThan(mark.y);
    expect(Number(tip[2]), 'and its tip is still inside the plot box').toBeLessThan(PCA_VIEW.bottom);
  });

  // What a class sees at the Roman step: the guided commands typed from the start (a shortcut such as the Iron Age and then the Roman period
  // leaves out four layers and their legend entries, and hid the arrow on the Roman entry that fix round 1 removed).
  it('at the Roman step of the guided run, the mark, its arrow and its words are clear of every legend entry', () => {
    const d = real();
    const flow = withFeatures({ yorkTraveller: true, consumerBars: true, back: true, finaleAnimation: true }, ALL_OFF);
    const plot = guidedPlot(d, 'roman', flow);
    expect(plot.focus).toBe('Roman');
    expect(plot.layers).toEqual(['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'Today']);
    const svg = draw(d, plot, flow);
    const entries = [...svg.querySelectorAll('g.legend-item')].map((i) => i.getAttribute('data-legend'));
    expect(entries.slice(0, 4), 'the legend\'s first row').toEqual(['BellBeaker', 'BronzeAge', 'IronAge', 'Roman']);
    expectClearOfLegend(svg, 'guided run, real data');
    const tip = oldArrowTip(d.frames[plot.frame], d.named![0]!);
    const roman = legendBox(svg.querySelector('g.legend-item[data-legend="Roman"]')!);
    expect(overlap({ left: tip.x - 1, right: tip.x + 1, top: tip.y - 1, bottom: tip.y + 1 }, roman), 'the old arrow tip was on the Roman entry').toBe(true);
  });
});
