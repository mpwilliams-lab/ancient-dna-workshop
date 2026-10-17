// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/data.fixture.json';
import type { PeriodId, WorkshopData } from '../src/types';
import { INITIAL_PLOT, type PlotState } from '../src/plotState';
import { PCA_VIEW, clampToFrame, frameTransition, makeScale, renderPca } from '../src/plots/pca';
import { INK, OKABE_ITO, PERIOD_COLORS, PERIOD_SHAPES, f1, textBlock, wrapText } from '../src/plots/svg';
import { EAST_ENGLAND_LEGEND, MAP_GROUP_LABELS, NORTH_SEA_LABEL, PCA_CAPTION, PERIOD_LABELS, withN } from '../src/content';

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
    const addListener = vi.spyOn(svg, 'addEventListener'); // installed before the first render, so every attachment is counted
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
    // re-rendering must not stack listeners. Stacked handlers would all write the same text, so a tip check cannot
    // see them; count the attachments instead: pointerover, click and pointerleave, once across both renders.
    renderPca(svg, d, pca({ layers: ['AngloSaxon'], frame: 'europe' }));
    expect(addListener).toHaveBeenCalledTimes(3);
    // the tip of the new render still works
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

  it('draws the seven periods in seven distinct Okabe-Ito hues', () => {
    const hues = Object.values(OKABE_ITO) as string[];
    const periods: PeriodId[] = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking'];
    for (const id of periods) expect(hues).toContain(PERIOD_COLORS[id]);
    expect(new Set(periods.map((id) => PERIOD_COLORS[id])).size).toBe(7);
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

describe('layers outside the frame', () => {
  it('a layer whose centre is outside the frame is still drawn, as ghosts on the edge, but gets no centre marker or label', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['FirstFarmers', 'IronAge'], frame: 'britain' }));
    const ff = [...svg.querySelectorAll('g.layer[data-layer="FirstFarmers"] .pt')];
    expect(ff).toHaveLength(4); // the layer is still drawn (spec 4.4)
    for (const pt of ff) {
      // clamped to the frame edge as before (spec 5.1), but hollow and faint so it does not read as data
      expect(pt.classList.contains('clipped')).toBe(true);
      expect(pt.getAttribute('fill')).toBe('none');
      expect(pt.getAttribute('stroke')).toBe(PERIOD_COLORS.FirstFarmers);
      // svgEl rounds numbers to one decimal, so only a string keeps the second decimal
      expect(pt.getAttribute('opacity')).toBe('0.35');
    }
    expect(svg.querySelector('.centre[data-centre="FirstFarmers"]')).toBeNull();
    expect(svg.querySelector('[data-centre-label="FirstFarmers"]')).toBeNull();
    expect([...svg.querySelectorAll('.centre-label')].map((t) => t.textContent)).toEqual([PERIOD_LABELS.IronAge]);
    // the legend still names the layer, so the ghosts are identified
    expect(svg.querySelector('.legend-item[data-legend="FirstFarmers"]')?.textContent)
      .toBe(withN(PERIOD_LABELS.FirstFarmers, 4));
  });

  it('a partly clipped layer keeps its centre marker and label; only its clipped points are ghosts', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['IronAge'], frame: 'britain' }));
    const pts = [...svg.querySelectorAll('g.layer[data-layer="IronAge"] .pt')];
    const ghosts = pts.filter((p) => p.classList.contains('clipped'));
    const solid = pts.filter((p) => !p.classList.contains('clipped'));
    expect(ghosts).toHaveLength(1); // the point at x = 6
    expect(solid).toHaveLength(4);
    expect(ghosts[0].getAttribute('fill')).toBe('none');
    for (const p of solid) {
      expect(p.getAttribute('fill')).toBe(PERIOD_COLORS.IronAge);
      expect(p.hasAttribute('opacity')).toBe(false);
    }
    expect(svg.querySelector('.centre[data-centre="IronAge"]')).not.toBeNull();
    expect(svg.querySelector('.centre-label[data-centre-label="IronAge"]')?.textContent).toBe(PERIOD_LABELS.IronAge);
  });

  it('skips the arrow whose head centre is outside the frame and keeps the others', () => {
    const svg = newSvg();
    const d = withCentre(makeData(), 'AngloSaxon', { x: 6, y: 3.8 });
    renderPca(svg, d, pca({ layers: ['IronAge', 'Roman', 'AngloSaxon'], frame: 'britain' }));
    expect([...svg.querySelectorAll('g.arrow')].map((a) => a.getAttribute('data-arrow'))).toEqual(['Roman']);
    expect([...svg.querySelectorAll('.centre')].map((c) => c.getAttribute('data-centre'))).toEqual(['IronAge', 'Roman']);
  });

  it('draws no arrow, and no tail ring, when the Iron Age centre (the tail) is outside the frame', () => {
    const svg = newSvg();
    const d = withCentre(makeData(), 'IronAge', { x: -4, y: -2 });
    renderPca(svg, d, pca({ layers: ['Roman', 'AngloSaxon'], frame: 'britain' }));
    expect(svg.querySelectorAll('g.arrow')).toHaveLength(0);
    expect(svg.querySelectorAll('.arrow-tail')).toHaveLength(0);
    expect([...svg.querySelectorAll('.centre')].map((c) => c.getAttribute('data-centre'))).toEqual(['Roman', 'AngloSaxon']);
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

// ---------- final review: the outlined eastern-England points get a legend item (Beat 3) ----------
// The Anglo-Saxon layer outlines the burials flagged `east` in black. Nothing on screen said what the outline meant,
// so a student who asked "why are some of them black-edged?" had no answer in the plot itself.
describe('the legend explains the outlined eastern-England points', () => {
  const ALL_LAYERS: PeriodId[] = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking', 'Today'];
  const eastItem = (svg: SVGSVGElement) => svg.querySelector('.legend .legend-item[data-legend="east"]');
  const legendTexts = (svg: SVGSVGElement) => [...svg.querySelectorAll('.legend-item')].map((t) => t.textContent);

  it('the label is "Anglo-Saxon burials, eastern England (outlined)" (v3 §3.5), written once in content.ts', () => {
    expect(EAST_ENGLAND_LEGEND).toBe('Anglo-Saxon burials, eastern England (outlined)');
  });

  it('adds exactly one item, straight after the Anglo-Saxon one, when that layer is drawn and a point carries east', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['IronAge', 'AngloSaxon', 'Viking'], frame: 'britain' }));
    expect(legendTexts(svg)).toEqual([
      withN(PERIOD_LABELS.Today, 4),
      withN(PERIOD_LABELS.IronAge, 5),
      withN(PERIOD_LABELS.AngloSaxon, 5),
      EAST_ENGLAND_LEGEND,
      withN(PERIOD_LABELS.Viking, 2),
    ]);
    expect(svg.querySelectorAll('.legend-item[data-legend="east"]')).toHaveLength(1);
    // the plot itself has the outlined points the item talks about
    expect(svg.querySelectorAll('.pt.east')).toHaveLength(2);
  });

  it('appears on the Europe frame too, and once even when the layer is listed twice', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['AngloSaxon', 'AngloSaxon'], frame: 'europe' }));
    expect(legendTexts(svg)).toEqual([withN(PERIOD_LABELS.Today, 4), withN(PERIOD_LABELS.AngloSaxon, 5), EAST_ENGLAND_LEGEND]);
  });

  it('is absent whenever the Anglo-Saxon layer is not drawn (nothing is outlined, so nothing to explain)', () => {
    const cases: PeriodId[][] = [[], ['IronAge', 'Roman'], ['FirstFarmers', 'BellBeaker'], ['BronzeAge', 'Viking'], ['Today']];
    for (const frame of ['europe', 'britain'] as const) {
      for (const layers of cases) {
        const svg = newSvg();
        renderPca(svg, makeData(), pca({ layers, frame, showNorthSea: true }));
        const what = `${frame}: ${layers.join(', ') || 'no layers'}`;
        expect(legendTexts(svg), what).not.toContain(EAST_ENGLAND_LEGEND);
        expect(eastItem(svg), what).toBeNull();
        expect(svg.querySelectorAll('.pt.east'), what).toHaveLength(0);
      }
    }
  });

  it('is absent when the Anglo-Saxon layer is drawn but no point carries east (nothing is outlined)', () => {
    const d = makeData();
    for (const g of d.points) for (const pt of g.points) delete (pt as { east?: boolean }).east;
    const svg = newSvg();
    renderPca(svg, d, pca({ layers: ['AngloSaxon'], frame: 'britain' }));
    expect(svg.querySelectorAll('.pt.east')).toHaveLength(0);
    expect(eastItem(svg)).toBeNull();
    expect(legendTexts(svg)).toEqual([withN(PERIOD_LABELS.Today, 4), withN(PERIOD_LABELS.AngloSaxon, 5)]);
    // east: false everywhere is the same
    const e = makeData();
    for (const pt of e.points.find((g) => g.period === 'AngloSaxon')!.points) pt.east = false;
    const svg2 = newSvg();
    renderPca(svg2, e, pca({ layers: ['AngloSaxon'], frame: 'britain' }));
    expect(eastItem(svg2)).toBeNull();
  });

  it('is gone again when a later render drops the Anglo-Saxon layer (a redraw never keeps a stale item)', () => {
    const svg = newSvg();
    const d = makeData();
    renderPca(svg, d, pca({ layers: ['AngloSaxon'], frame: 'britain' }));
    expect(eastItem(svg)).not.toBeNull();
    renderPca(svg, d, pca({ layers: ['IronAge'], frame: 'britain' }));
    expect(eastItem(svg)).toBeNull();
    expect(svg.querySelectorAll('.legend-item[data-legend="east"]')).toHaveLength(0);
  });

  it('its mark looks like the plotted points it explains: an Anglo-Saxon triangle in its colour with the same black outline', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ['AngloSaxon'], frame: 'britain' }));
    const mark = eastItem(svg)!.querySelector('path')!;
    const plotted = svg.querySelector('.pt.east')!;
    const plain = svg.querySelector('.legend-item[data-legend="AngloSaxon"] path')!;
    expect(PERIOD_SHAPES.AngloSaxon).toBe('triangle');
    expect(mark.getAttribute('stroke')).toBe(INK);
    expect(mark.getAttribute('stroke')).toBe(plotted.getAttribute('stroke'));
    expect(mark.getAttribute('stroke-width')).toBe(plotted.getAttribute('stroke-width'));
    expect(mark.getAttribute('fill')).toBe(PERIOD_COLORS.AngloSaxon);
    expect(mark.getAttribute('fill')).toBe(plotted.getAttribute('fill'));
    // the same shape as the plain Anglo-Saxon item beside it (path commands only: M, L, L, Z for a triangle)
    const commands = (el: Element) => (el.getAttribute('d') ?? '').replace(/[^A-Za-z]/g, '');
    expect(commands(mark)).toBe('MLLZ');
    expect(commands(mark)).toBe(commands(plain));
    // and the plain item keeps its plain look: no outline
    expect(plain.getAttribute('stroke')).toBeNull();
  });

  it('has a hover tip with the same words, and flows into the legend rows: never past the right edge or into the caption', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ALL_LAYERS, frame: 'britain' }));
    const item = eastItem(svg)!;
    expect(item.getAttribute('data-tip')).toBe(EAST_ENGLAND_LEGEND);
    item.querySelector('path')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(svg.querySelector('.plot-tip')?.textContent).toBe(EAST_ENGLAND_LEGEND);
    // nine items (eight layers and this one) now share the rows under the plot box
    expect(svg.querySelectorAll('.legend-item')).toHaveLength(9);
    const captionY = num(svg.querySelector('.pca-caption'), 'y');
    for (const t of svg.querySelectorAll('.legend text')) {
      expect(num(t, 'y'), t.textContent ?? '').toBeLessThan(captionY - 14);
      expect(num(t, 'x') + (t.textContent ?? '').length * 7.6, t.textContent ?? '').toBeLessThanOrEqual(PCA_VIEW.right + 1);
    }
  });

  it('adds no text that breaks a §6 rule (no ages, no Group or sample IDs)', () => {
    const svg = newSvg();
    renderPca(svg, makeData(), pca({ layers: ALL_LAYERS, frame: 'europe', showNorthSea: true }));
    const text = eastItem(svg)?.textContent ?? '';
    expect(text).toBe(EAST_ENGLAND_LEGEND);
    expect(text).not.toMatch(/\d|BCE|BC\b|BP\b|years|ago|Neolithic|Mesolithic|_/i);
  });
});
