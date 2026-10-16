import type { Frame, PeriodId, Pt, WorkshopData } from '../types';
import type { PlotState } from '../plotState';
import {
  MAP_GROUP_LABELS, NORTH_SEA_LABEL, PCA_CAPTION, PERIOD_LABELS, withN,
} from '../content';
import {
  INK, MAP_GREY, PERIOD_COLORS, PERIOD_SHAPES, shapePath, svgEl, wireTips,
} from './svg';

/** Plot box inside the fixed 1000 x 700 viewBox; the strip below it holds legend + caption. */
export const PCA_VIEW = { width: 1000, height: 700, left: 20, right: 980, top: 20, bottom: 590 } as const;

const PERIOD_ORDER: PeriodId[] = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking', 'Today'];
const ARROW_PERIODS: PeriodId[] = ['Roman', 'AngloSaxon'];

export interface PcaScale {
  k: number;           // pixels per PC unit, identical on both axes
  offX: number;
  offY: number;
  frame: Frame;
  toX(x: number): number;
  toY(y: number): number;
}

/** Equal-aspect scale: the whole frame fits the plot box, centred; larger y = north = up. */
export function makeScale(frame: Frame): PcaScale {
  const innerW = PCA_VIEW.right - PCA_VIEW.left;
  const innerH = PCA_VIEW.bottom - PCA_VIEW.top;
  const spanX = Math.max(frame.xmax - frame.xmin, 1e-9);
  const spanY = Math.max(frame.ymax - frame.ymin, 1e-9);
  const k = Math.min(innerW / spanX, innerH / spanY);
  const offX = PCA_VIEW.left + (innerW - spanX * k) / 2;
  const offY = PCA_VIEW.top + (innerH - spanY * k) / 2;
  return {
    k, offX, offY, frame,
    toX: (x) => offX + (x - frame.xmin) * k,
    toY: (y) => offY + (frame.ymax - y) * k,
  };
}

/** Clamp a point to the frame edge; reports whether it moved. */
export function clampToFrame(p: Pt, fr: Frame): { x: number; y: number; clipped: boolean } {
  const x = Math.min(Math.max(p.x, fr.xmin), fr.xmax);
  const y = Math.min(Math.max(p.y, fr.ymin), fr.ymax);
  return { x, y, clipped: x !== p.x || y !== p.y };
}

function inFrame(p: Pt, fr: Frame): boolean {
  return p.x >= fr.xmin && p.x <= fr.xmax && p.y >= fr.ymin && p.y <= fr.ymax;
}

/**
 * Transform that makes content drawn with scale `to` appear where scale `from` drew it.
 * Animating from this matrix to identity gives the ~0.5 s frame change.
 */
export function frameTransition(from: PcaScale, to: PcaScale): string {
  const s = from.k / to.k;
  // x: px_from = s * px_to + tx, derived from both scales' affine maps
  const tx = from.offX - from.k * from.frame.xmin - s * (to.offX - to.k * to.frame.xmin);
  const ty = from.offY + from.k * from.frame.ymax - s * (to.offY + to.k * to.frame.ymax);
  return `matrix(${s}, 0, 0, ${s}, ${tx}, ${ty})`;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function periodLayers(p: PlotState): PeriodId[] {
  return PERIOD_ORDER.filter((id) => id !== 'Today' && p.layers.includes(id));
}

export function renderPca(svg: SVGSVGElement, data: WorkshopData, p: PlotState): void {
  const fr = data.frames[p.frame];
  const sc = makeScale(fr);
  const prevFrameId = svg.getAttribute('data-frame');
  const prev = prevFrameId === 'europe' || prevFrameId === 'britain' ? data.frames[prevFrameId] : undefined;

  svg.setAttribute('viewBox', `0 0 ${PCA_VIEW.width} ${PCA_VIEW.height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', PCA_CAPTION);
  svg.setAttribute('data-view', 'pca');
  svg.setAttribute('data-frame', p.frame);
  svg.replaceChildren();

  const defs = svgEl('defs');
  const marker = svgEl('marker', {
    id: 'pca-arrowhead', viewBox: '0 0 10 10', refX: '8', refY: '5',
    markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse',
  });
  marker.append(svgEl('path', { d: 'M0 0L10 5L0 10Z', fill: INK }));
  defs.append(marker);

  const world = svgEl('g', { class: 'world' });
  const pos = (pt: Pt) => ({ x: sc.toX(pt.x), y: sc.toY(pt.y) });

  // 1. Continental map groups (context): only the points inside the frame are drawn.
  for (const g of data.map_groups) {
    const label = MAP_GROUP_LABELS[g.id];
    const layer = svgEl('g', { class: 'layer map-group', 'data-layer': g.id, 'data-tip': label });
    for (const pt of g.points) {
      if (!inFrame(pt, fr)) continue;
      const q = pos(pt);
      layer.append(svgEl('path', { class: 'pt', d: shapePath('circle', q.x, q.y, 3), fill: MAP_GREY }));
    }
    world.append(layer);
  }

  // 2. Britons: Today base layer (always) then every period layer run so far, in time order.
  const drawPeriod = (id: PeriodId, r: number) => {
    const label = PERIOD_LABELS[id];
    const layer = svgEl('g', { class: 'layer period', 'data-layer': id, 'data-tip': label });
    const pts = data.points.find((pp) => pp.period === id)?.points ?? [];
    for (const pt of pts) {
      const c = clampToFrame(pt, fr);
      const q = pos(c);
      const east = id === 'AngloSaxon' && pt.east === true;
      const cls = ['pt', east ? 'east' : '', c.clipped ? 'clipped' : ''].filter(Boolean).join(' ');
      layer.append(svgEl('path', {
        class: cls,
        d: shapePath(PERIOD_SHAPES[id], q.x, q.y, east ? r + 1.5 : r),
        fill: PERIOD_COLORS[id],
        stroke: east ? INK : '#FFFFFF',
        'stroke-width': east ? 2.5 : 0.8,
      }));
    }
    world.append(layer);
  };
  drawPeriod('Today', 3.5);
  const layers = periodLayers(p);
  for (const id of layers) drawPeriod(id, 5);

  // 3. Map-group labels on top of the points (only when the group centre is in the frame).
  for (const g of data.map_groups) {
    if (!inFrame(g.centre, fr)) continue;
    const q = pos(g.centre);
    world.append(svgEl('text', {
      class: 'map-label', x: q.x, y: q.y - 12, 'text-anchor': 'middle', 'font-size': 16, 'font-weight': '600',
      fill: INK, stroke: '#FFFFFF', 'stroke-width': 4, 'paint-order': 'stroke', 'data-tip': MAP_GROUP_LABELS[g.id],
    }, MAP_GROUP_LABELS[g.id]));
  }

  // 4. North Sea marker (landmark only).
  if (p.showNorthSea) {
    const c = clampToFrame(data.north_sea.centre, fr);
    const q = pos(c);
    const ns = svgEl('g', { class: 'north-sea', 'data-marker': 'north-sea', 'data-tip': NORTH_SEA_LABEL });
    ns.append(svgEl('path', { d: shapePath('diamond', q.x, q.y, 9), fill: '#FFFFFF', stroke: INK, 'stroke-width': 3 }));
    ns.append(svgEl('text', {
      x: q.x + 16, y: q.y + 5, 'font-size': 16, 'font-weight': '600', fill: INK,
      stroke: '#FFFFFF', 'stroke-width': 4, 'paint-order': 'stroke',
    }, NORTH_SEA_LABEL));
    world.append(ns);
  }

  // 5. British frame: arrows from the Iron Age centre, then centre markers with labels.
  if (p.frame === 'britain') {
    const centreOf = (id: PeriodId) => data.periods.find((pi) => pi.id === id)?.centre;
    const iron = centreOf('IronAge');
    if (iron) {
      const a = pos(clampToFrame(iron, fr));
      for (const id of ARROW_PERIODS) {
        if (!layers.includes(id)) continue;
        const target = centreOf(id);
        if (!target) continue;
        const b = pos(clampToFrame(target, fr));
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const cut = len > 20 ? 14 / len : 0; // stop short of the target's centre marker
        const g = svgEl('g', { class: 'arrow', 'data-arrow': id, 'data-tip': PERIOD_LABELS[id] });
        if (!layers.includes('IronAge')) {
          g.append(svgEl('circle', { class: 'arrow-tail', cx: a.x, cy: a.y, r: 6, fill: 'none', stroke: PERIOD_COLORS.IronAge, 'stroke-width': 2.5 }));
        }
        g.append(svgEl('line', {
          x1: a.x, y1: a.y, x2: b.x - (b.x - a.x) * cut, y2: b.y - (b.y - a.y) * cut,
          stroke: INK, 'stroke-width': 3, 'marker-end': 'url(#pca-arrowhead)',
        }));
        world.append(g);
      }
    }
    const centres = layers
      .map((id) => ({ id, c: centreOf(id) }))
      .filter((e): e is { id: PeriodId; c: Pt } => e.c !== undefined)
      .map((e) => ({ id: e.id, ...pos(clampToFrame(e.c, fr)) }));
    for (const c of centres) {
      world.append(svgEl('path', {
        class: 'centre', 'data-centre': c.id, 'data-tip': PERIOD_LABELS[c.id],
        d: shapePath(PERIOD_SHAPES[c.id], c.x, c.y, 12),
        fill: PERIOD_COLORS[c.id], stroke: INK, 'stroke-width': 2.5,
      }));
    }
    // Labels to the right of each centre, pushed down so no two are closer than 18 px.
    let lastY = -Infinity;
    for (const c of [...centres].sort((u, v) => u.y - v.y)) {
      const y = Math.max(c.y + 5, lastY + 18);
      lastY = y;
      world.append(svgEl('text', {
        class: 'centre-label', 'data-centre-label': c.id, x: c.x + 18, y, 'font-size': 16, 'font-weight': '700',
        fill: INK, stroke: '#FFFFFF', 'stroke-width': 4, 'paint-order': 'stroke',
      }, PERIOD_LABELS[c.id]));
    }
  }

  // 6. Legend (flowing rows under the plot box) and caption.
  const legend = svgEl('g', { class: 'legend' });
  let lx = PCA_VIEW.left;
  let ly = PCA_VIEW.bottom + 26;
  for (const id of ['Today' as PeriodId, ...layers]) {
    const n = data.periods.find((pi) => pi.id === id)?.n_pca ?? 0;
    const text = withN(PERIOD_LABELS[id], n);
    const w = 22 + text.length * 7.6 + 22;
    if (lx + w > PCA_VIEW.right && lx > PCA_VIEW.left) {
      lx = PCA_VIEW.left;
      ly += 22;
    }
    const item = svgEl('g', { class: 'legend-item', 'data-legend': id, 'data-tip': PERIOD_LABELS[id] });
    item.append(svgEl('path', { d: shapePath(PERIOD_SHAPES[id], lx + 7, ly - 5, 6), fill: PERIOD_COLORS[id] }));
    item.append(svgEl('text', { x: lx + 20, y: ly, 'font-size': 14, fill: INK }, text));
    legend.append(item);
    lx += w;
  }
  const caption = svgEl('text', {
    class: 'pca-caption', x: PCA_VIEW.left, y: PCA_VIEW.height - 8, 'font-size': 14, fill: INK, 'font-style': 'italic',
  }, PCA_CAPTION);
  const tip = svgEl('text', {
    class: 'plot-tip', x: PCA_VIEW.right, y: 40, 'text-anchor': 'end', 'font-size': 20, 'font-weight': '700',
    fill: INK, stroke: '#FFFFFF', 'stroke-width': 5, 'paint-order': 'stroke',
  });

  svg.append(defs, world, legend, caption, tip);
  wireTips(svg);

  // 7. Frame change animates (~0.5 s) where the browser supports it.
  if (prev && prevFrameId !== p.frame && typeof world.animate === 'function' && !reducedMotion()) {
    world.animate(
      [{ transform: frameTransition(makeScale(prev), sc) }, { transform: 'matrix(1, 0, 0, 1, 0, 0)' }],
      { duration: 500, easing: 'ease-in-out' },
    );
  }
}
