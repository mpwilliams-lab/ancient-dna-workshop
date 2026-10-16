// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/data.fixture.json';
import type { PeriodId, WorkshopData } from '../src/types';
import { INITIAL_PLOT, type PlotState } from '../src/plotState';
import { PCA_VIEW, clampToFrame, frameTransition, makeScale, renderPca } from '../src/plots/pca';
import { OKABE_ITO, PERIOD_COLORS, PERIOD_SHAPES, textBlock, wrapText } from '../src/plots/svg';
import { MAP_GROUP_LABELS, NORTH_SEA_LABEL, PCA_CAPTION, PERIOD_LABELS, withN } from '../src/content';

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

describe('renderPca', () => {
  it('sets a fixed viewBox, aspect handling and the caption', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({}));
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 700');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(svg.getAttribute('data-frame')).toBe('europe');
    expect(svg.querySelector('.pca-caption')?.textContent).toBe(PCA_CAPTION);
  });

  it('always draws the Today base layer: 5 map groups (labelled) + Britain today, even with no layers run', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: [] }));
    expect(svg.querySelectorAll('g.layer.map-group')).toHaveLength(5);
    expect(svg.querySelectorAll('g.layer.map-group .pt')).toHaveLength(15);
    expect(countIn(svg, 'Today')).toBe(4);
    expect([...svg.querySelectorAll('.map-label')].map((t) => t.textContent).sort())
      .toEqual(Object.values(MAP_GROUP_LABELS).sort());
    expect(layerIds(svg)).toEqual(['Today']);
    expect(svg.querySelectorAll('.centre, .arrow, [data-marker="north-sea"]')).toHaveLength(0);
    expect([...svg.querySelectorAll('.legend-item')].map((t) => t.textContent))
      .toEqual([withN(PERIOD_LABELS.Today, 4)]);
  });

  it('europe frame: period layers in time order, no centre markers or arrows', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['BellBeaker', 'Today', 'FirstFarmers'], frame: 'europe' }));
    expect(layerIds(svg)).toEqual(['Today', 'FirstFarmers', 'BellBeaker']);
    expect(countIn(svg, 'FirstFarmers')).toBe(4);
    expect(countIn(svg, 'BellBeaker')).toBe(4);
    expect(svg.querySelectorAll('.centre, .arrow')).toHaveLength(0);
  });

  it('britain frame: centre markers, Iron Age arrows, clipping and off-frame map groups hidden', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['IronAge', 'Roman', 'AngloSaxon'], frame: 'britain', showNorthSea: true }));
    expect([...svg.querySelectorAll('.centre')].map((c) => c.getAttribute('data-centre')))
      .toEqual(['IronAge', 'Roman', 'AngloSaxon']);
    expect([...svg.querySelectorAll('.centre-label')].map((c) => c.textContent))
      .toEqual(expect.arrayContaining([PERIOD_LABELS.IronAge, PERIOD_LABELS.Roman, PERIOD_LABELS.AngloSaxon]));
    const arrows = [...svg.querySelectorAll('g.arrow')];
    expect(arrows.map((a) => a.getAttribute('data-arrow'))).toEqual(['Roman', 'AngloSaxon']);
    const as = svg.querySelector('g.arrow[data-arrow="AngloSaxon"] line');
    // tail = Iron Age centre (1, 3); head stops 14 px short of the Anglo-Saxon centre (1.6, 3.8)
    expect(num(as, 'x1')).toBe(344.5);
    expect(num(as, 'y1')).toBe(486.4);
    expect(num(as, 'x2')).toBe(491.6);
    expect(num(as, 'y2')).toBe(290.3);
    expect(svg.querySelectorAll('.arrow-tail')).toHaveLength(0);
    // the IronAge point at x = 6 is pinned to the right edge (x = 2.7 -> 785 px)
    const clipped = svg.querySelectorAll('g.layer[data-layer="IronAge"] .pt.clipped');
    expect(clipped).toHaveLength(1);
    expect(clipped[0].getAttribute('d')).toMatch(/^M780 /);
    // map-group points outside the British frame are not drawn (Norwegian y >= 4.9 > 4.8)
    expect(svg.querySelectorAll('g.layer.map-group .pt')).toHaveLength(0);
    expect(svg.querySelectorAll('.map-label')).toHaveLength(0);
    expect(svg.querySelector('[data-marker="north-sea"]')?.textContent).toBe(NORTH_SEA_LABEL);
  });

  it('centre labels never sit closer than 18 px vertically', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking'], frame: 'britain' }));
    const ys = [...svg.querySelectorAll('.centre-label')].map((t) => num(t, 'y')).sort((a, b) => a - b);
    expect(ys).toHaveLength(5);
    for (let i = 1; i < ys.length; i += 1) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(17.95);
  });

  it('RF2: Roman before Iron Age still draws the arrow from the Iron Age centre, with a tail ring', () => {
    const svg = newSvg();
    expect(() => renderPca(svg, makeData(), pca({ layers: ['Roman'], frame: 'britain' }))).not.toThrow();
    const line = svg.querySelector('g.arrow[data-arrow="Roman"] line');
    expect(num(line, 'x1')).toBe(344.5);
    expect(num(line, 'y1')).toBe(486.4);
    expect(svg.querySelectorAll('.arrow-tail')).toHaveLength(1);
    expect(svg.querySelector('.centre[data-centre="IronAge"]')).toBeNull();
  });

  it('RF2: any combination of layers and frames renders exactly the layers in the state', () => {
    const cases: PlotState[] = [
      pca({ layers: ['Roman', 'BellBeaker'], frame: 'europe' }),
      pca({ layers: ['IronAge', 'FirstFarmers'], frame: 'europe' }),
      pca({ layers: ['FirstFarmers', 'IronAge'], frame: 'britain' }),
      pca({ layers: ['Viking'], frame: 'britain', showNorthSea: true }),
      pca({ layers: ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking', 'Today'], frame: 'europe', showNorthSea: true }),
      pca({ layers: ['AngloSaxon', 'AngloSaxon'], frame: 'britain', showNorthSea: true }),
    ];
    const svg = newSvg();
    const order: PeriodId[] = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking'];
    for (const s of cases) {
      expect(() => renderPca(svg, makeData(), s)).not.toThrow();
      expect(layerIds(svg)).toEqual(['Today', ...order.filter((id) => s.layers.includes(id))]);
      expect(svg.querySelectorAll('[data-marker="north-sea"]')).toHaveLength(s.showNorthSea ? 1 : 0);
      expect(svg.querySelectorAll('.centre').length > 0).toBe(s.frame === 'britain');
    }
  });

  it('outlines eastern-England Anglo-Saxon burials only', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['AngloSaxon'], frame: 'britain', showNorthSea: true }));
    expect(svg.querySelectorAll('g.layer[data-layer="AngloSaxon"] .pt.east')).toHaveLength(2);
    expect(svg.querySelectorAll('.pt.east')).toHaveLength(2);
    expect(svg.querySelector('.pt.east')?.getAttribute('stroke')).toBe('#1A1A1A');
  });

  it('shows the n of every layer in the legend (Roman n on screen)', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['IronAge', 'Roman'], frame: 'britain' }));
    expect([...svg.querySelectorAll('.legend-item')].map((t) => t.textContent)).toEqual([
      withN(PERIOD_LABELS.Today, 4),
      withN(PERIOD_LABELS.IronAge, 5),
      withN(PERIOD_LABELS.Roman, 3),
    ]);
    expect(svg.textContent).toContain('Roman (n = 3)');
  });

  it('tap/hover shows only the period or group name; no per-sample data anywhere', () => {
    const svg = newSvg();
    const d = makeData();
    renderPca(svg, d, pca({ layers: ['AngloSaxon'], frame: 'europe' }));
    const tip = () => svg.querySelector('.plot-tip')?.textContent;
    svg.querySelector('g.layer[data-layer="AngloSaxon"] .pt')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(tip()).toBe(PERIOD_LABELS.AngloSaxon);
    svg.querySelector('g.layer[data-layer="French"] .pt')!.dispatchEvent(new Event('click', { bubbles: true }));
    expect(tip()).toBe(MAP_GROUP_LABELS.French);
    svg.dispatchEvent(new Event('pointerleave'));
    expect(tip()).toBe('');
    expect(svg.querySelectorAll('[data-id], title')).toHaveLength(0);
    // re-rendering does not stack listeners: one event still yields exactly the label
    renderPca(svg, d, pca({ layers: ['AngloSaxon'], frame: 'europe' }));
    svg.querySelector('g.layer[data-layer="Today"] .pt')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(tip()).toBe(PERIOD_LABELS.Today);
  });

  it('re-rendering replaces content instead of stacking it', () => {
    const svg = newSvg();
    const s = pca({ layers: ['IronAge'], frame: 'britain' });
    renderPca(svg, makeData(), s);
    const n = svg.querySelectorAll('*').length;
    renderPca(svg, makeData(), s);
    expect(svg.querySelectorAll('*').length).toBe(n);
  });

  it('animates a frame change once (500 ms) and maps old pixels onto new ones', () => {
    const animate = vi.fn();
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
    Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
    try {
      const d = makeData();
      const svg = newSvg();
      renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'europe' }));
      expect(animate).not.toHaveBeenCalled(); // first render: nothing to animate from
      renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'britain' }));
      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate.mock.calls[0][1]).toEqual({ duration: 500, easing: 'ease-in-out' });
      renderPca(svg, d, pca({ layers: ['IronAge', 'Roman'], frame: 'britain' }));
      expect(animate).toHaveBeenCalledTimes(1); // same frame: no animation
      // the start transform puts the Iron Age centre (drawn in britain pixels) back at its europe pixels
      const from = makeScale(d.frames.europe);
      const to = makeScale(d.frames.britain);
      const m = frameTransition(from, to).match(/matrix\(([^)]+)\)/)![1].split(',').map(Number);
      const [s, , , , tx, ty] = m;
      expect(s * to.toX(1) + tx).toBeCloseTo(from.toX(1), 6);
      expect(s * to.toY(3) + ty).toBeCloseTo(from.toY(3), 6);
    } finally {
      if (original) Object.defineProperty(Element.prototype, 'animate', original);
      else delete (Element.prototype as unknown as { animate?: unknown }).animate;
    }
  });

  it('uses a colour-blind-safe palette with a shape per period', () => {
    const hues = Object.values(OKABE_ITO) as string[];
    const periods: PeriodId[] = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking'];
    for (const id of periods) expect(hues).toContain(PERIOD_COLORS[id]);
    expect(new Set(periods.map((id) => PERIOD_COLORS[id])).size).toBe(7);
    // periods sharing a frame never share colour AND shape
    const britain: PeriodId[] = ['BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking'];
    expect(new Set(britain.map((id) => `${PERIOD_COLORS[id]}/${PERIOD_SHAPES[id]}`)).size).toBe(5);
  });

  it('§6 rule 1: no dates, ages, Group IDs or raw ids in any rendered PCA text', () => {
    const svg = newSvg();
    const all: PeriodId[] = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking', 'Today'];
    for (const frame of ['europe', 'britain'] as const) {
      renderPca(svg, makeData(), pca({ layers: all, frame, showNorthSea: true }));
      const text = svg.textContent ?? '';
      expect(text).not.toMatch(/\d[\d,.]*\s*(BCE|BC|BP|CE|kya|ya|years?|generations?)\b/i);
      expect(text).not.toMatch(/Mesolithic|Neolithic|Pal(a)?eolithic|Megalithic|Ice Age/i);
      expect(text).not.toMatch(/FirstFarmers|BellBeaker|BronzeAge|IronAge|AngloSaxon|ItalianNorth|_/);
    }
  });
});
