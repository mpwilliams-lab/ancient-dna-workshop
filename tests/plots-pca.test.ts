// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/data.fixture.json';
import type { ChipKey, PeriodId, WorkshopData } from '../src/types';
import { INITIAL_PLOT, layerOpacity, type PcaCaptionItem, type PlotState } from '../src/plotState';
import {
  PCA_VIEW, TODAY_RING, clampToFrame, frameTransition, makeScale, renderPca, renderPcaCaptions,
} from '../src/plots/pca';
import { INK, MAP_GREY, OKABE_ITO, PERIOD_COLORS, PERIOD_SHAPES, f1, textBlock, wrapText } from '../src/plots/svg';
import { CHIP_ICON_PATHS, chipElement } from '../src/icons';
import {
  CHIP_TEXT, EAST_ENGLAND_LEGEND, EUROPE_CAPTION, LEGEND_ANCIENT, LEGEND_LIVING, MAP_GROUP_LABELS, NORTH_SEA_LABEL,
  PCA_CAPTION, PERIOD_LABELS, withN, zoomNote,
} from '../src/content';

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
    const s = "At least 90% ± 2% of Britain's gene pool was replaced";
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
