import type { Frame, PeriodId, PersonPt, Pt, WorkshopData } from '../types';
import { layerOpacity, type PcaCaptionItem, type PlotState } from '../plotState';
import {
  EAST_ENGLAND_LEGEND, LEGEND_ANCIENT, LEGEND_LIVING, MAP_GROUP_LABELS, NORTH_SEA_LABEL, PCA_CAPTION, PERIOD_LABELS, withN,
} from '../content';
import { chipElement } from '../icons';
import { INK, MAP_GREY, PERIOD_COLORS, PERIOD_SHAPES, shapePath, svgEl, wireTips } from './svg';

/**
 * Plot box inside the fixed 1000 x 760 viewBox (spec §2.3). The plot box is unchanged from v2.1; legend rows run under
 * it at legendTop + legendRow * k (k <= 5). Captions, chips and the zoom note are HTML under the svg (renderPcaCaptions).
 */
export const PCA_VIEW = { width: 1000, height: 760, left: 20, right: 980, top: 20, bottom: 590, legendTop: 616, legendRow: 22 } as const;

/** Britain today is drawn as hollow rings so it reads apart from every period's filled marks. */
export const TODAY_RING = { r: 3.5, strokeWidth: 1.5, stroke: '#3A3A3A' } as const;

const PERIOD_ORDER: PeriodId[] = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking', 'Today'];
const ANCIENT: PeriodId[] = PERIOD_ORDER.filter((id) => id !== 'Today');
const ARROW_PERIODS: PeriodId[] = ['Roman', 'AngloSaxon'];

/** Opacity of a clipped point. A string on purpose: svgEl rounds numbers to one decimal, which would turn 0.35 into 0.4. */
const GHOST_OPACITY = '0.35';

/** An eastern-England Anglo-Saxon point is drawn this much bigger than its neighbours, with a black outline this thick. The legend item that explains it uses the same two numbers. */
const EAST_GROW = 1.5;
const EAST_STROKE = 2.5;

/** Width estimate for a 16 px bold centre label: about 9.3 px per character (measured 7.8 to 10.7 in Chrome). */
const LABEL_CHAR_W = 9.3;
/** The biggest centre marker (a diamond of radius 12) reaches 1.3 x 12 px from its centre. */
const MARKER_REACH = 15.6;
/** Legend widths: 14 px item text about 7.6 px per character, the 14 px bold heading about 8.4. */
const LEGEND_CHAR_W = 7.6;
const HEADING_CHAR_W = 8.4;

interface Box { left: number; right: number; top: number; bottom: number }
interface Segment { x1: number; y1: number; x2: number; y2: number }

function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** True when any point of the segment lies inside the box (sampled every 4 px; the boxes used here are at least 18 px tall). */
function segmentHitsBox(s: Segment, b: Box): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / 4));
  for (let i = 0; i <= steps; i += 1) {
    const x = s.x1 + ((s.x2 - s.x1) * i) / steps;
    const y = s.y1 + ((s.y2 - s.y1) * i) / steps;
    if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return true;
  }
  return false;
}

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
  const tx = from.offX - from.k * from.frame.xmin - s * (to.offX - to.k * to.frame.xmin);
  const ty = from.offY + from.k * from.frame.ymax - s * (to.offY + to.k * to.frame.ymax);
  return `matrix(${s}, 0, 0, ${s}, ${tx}, ${ty})`;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface LegendItem { key: string; tip: string; text: string; mark: (x: number, y: number) => SVGElement }

/** Two legend groups, each starting a new row with its bold heading; items flow and wrap as in v2.1. */
function renderLegend(groups: [key: 'ancient' | 'living', heading: string, items: LegendItem[]][]): SVGGElement {
  const legend = svgEl('g', { class: 'legend' });
  let lx = PCA_VIEW.left;
  let ly = PCA_VIEW.legendTop;
  let used = false;
  const newRow = (): void => {
    lx = PCA_VIEW.left;
    ly += PCA_VIEW.legendRow;
  };
  for (const [key, heading, items] of groups) {
    if (items.length === 0) continue;
    if (used) newRow();
    used = true;
    const g = svgEl('g', { class: 'legend-group', 'data-legend-group': key });
    g.append(svgEl('text', { class: 'legend-heading', x: lx, y: ly, 'font-size': 14, 'font-weight': '700', fill: INK }, heading));
    lx += heading.length * HEADING_CHAR_W + 14;
    for (const it of items) {
      const w = 22 + it.text.length * LEGEND_CHAR_W + 22;
      if (lx + w > PCA_VIEW.right && lx > PCA_VIEW.left) newRow();
      const item = svgEl('g', { class: 'legend-item', 'data-legend': it.key, 'data-tip': it.tip });
      item.append(it.mark(lx + 7, ly - 5));
      item.append(svgEl('text', { x: lx + 20, y: ly, 'font-size': 14, fill: INK }, it.text));
      g.append(item);
      lx += w;
    }
    legend.append(g);
  }
  return legend;
}

export function renderPca(svg: SVGSVGElement, data: WorkshopData, p: PlotState, opts: { animate?: boolean } = {}): void {
  const fr = data.frames[p.frame];
  const sc = makeScale(fr);
  // Only an svg that currently shows a PCA has a frame worth animating from: data-frame can be a stale leftover
  // once the bars or a trait plot have used the same svg. Read both attributes before they are overwritten below.
  const prevFrameId = svg.getAttribute('data-view') === 'pca' ? svg.getAttribute('data-frame') : null;
  const prev = prevFrameId === 'europe' || prevFrameId === 'britain' ? data.frames[prevFrameId] : undefined;

  svg.setAttribute('viewBox', `0 0 ${PCA_VIEW.width} ${PCA_VIEW.height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', PCA_CAPTION);
  svg.setAttribute('data-view', 'pca');
  svg.setAttribute('data-frame', p.frame);
  if (p.focus !== undefined) svg.setAttribute('data-focus', p.focus);
  else svg.removeAttribute('data-focus');
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
  const british = p.frame === 'britain';
  const focus = p.focus;
  const pointsOf = (id: PeriodId): PersonPt[] => data.points.find((pp) => pp.period === id)?.points ?? [];
  const nOf = (id: PeriodId): number => data.periods.find((pi) => pi.id === id)?.n_pca ?? 0;
  const anyInFrame = (pts: readonly Pt[]): boolean => pts.some((pt) => inFrame(pt, fr));
  const eastOn = focus === 'AngloSaxon'; // spec §2.3: the eastern-England outline only while Anglo-Saxon is in focus

  // 1. Continental map groups (context, always drawn): only the points inside the frame.
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

  // 2. Period layers run so far: non-focus layers in time order, then the focus layer on top. Each layer carries its
  //    fading opacity; in the British frame only the focus layer draws its clipped points as edge ghosts.
  const drawn = PERIOD_ORDER.filter((id) => p.layers.includes(id));
  const ordered = [...drawn.filter((id) => id !== focus), ...drawn.filter((id) => id === focus)];
  for (const id of ordered) {
    const isFocus = id === focus;
    const layer = svgEl('g', {
      class: 'layer period', 'data-layer': id, 'data-tip': PERIOD_LABELS[id], opacity: layerOpacity(p, id),
      ...(isFocus ? { 'data-focus': 'true' } : {}),
    });
    const ghostsAllowed = !british || isFocus;
    for (const pt of pointsOf(id)) {
      const c = clampToFrame(pt, fr);
      if (c.clipped && !ghostsAllowed) continue;
      const q = pos(c);
      if (id === 'Today') {
        layer.append(svgEl('path', {
          class: c.clipped ? 'pt today-ring clipped' : 'pt today-ring',
          d: shapePath('circle', q.x, q.y, TODAY_RING.r),
          fill: 'none', stroke: TODAY_RING.stroke, 'stroke-width': TODAY_RING.strokeWidth,
          ...(c.clipped ? { opacity: GHOST_OPACITY } : {}),
        }));
        continue;
      }
      const east = eastOn && id === 'AngloSaxon' && pt.east === true;
      const ghost = c.clipped; // pinned to the frame edge, not where it lies: hollow and faint so it does not read as data
      const cls = ['pt', east ? 'east' : '', ghost ? 'clipped' : ''].filter(Boolean).join(' ');
      layer.append(svgEl('path', {
        class: cls,
        d: shapePath(PERIOD_SHAPES[id], q.x, q.y, east ? 5 + EAST_GROW : 5),
        fill: ghost ? 'none' : PERIOD_COLORS[id],
        stroke: east ? INK : ghost ? PERIOD_COLORS[id] : '#FFFFFF',
        'stroke-width': east ? EAST_STROKE : ghost ? 1.5 : 0.8,
        ...(ghost ? { opacity: GHOST_OPACITY } : {}),
      }));
    }
    world.append(layer);
  }

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

  // 5. British frame: arrows from the Iron Age centre, then centre markers with labels, all at full opacity (they sit
  //    outside the faded layer groups). A centre outside the frame gets no marker, label or arrow. Britain today has none.
  const layers = ANCIENT.filter((id) => p.layers.includes(id));
  if (british) {
    const centreOf = (id: PeriodId) => data.periods.find((pi) => pi.id === id)?.centre;
    const arrowSegments: Segment[] = [];
    const iron = centreOf('IronAge');
    if (iron && inFrame(iron, fr)) {
      const a = pos(iron);
      for (const id of ARROW_PERIODS) {
        if (!layers.includes(id)) continue;
        const target = centreOf(id);
        if (!target || !inFrame(target, fr)) continue;
        const b = pos(target);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const cut = len > 20 ? 14 / len : 0; // stop short of the target's centre marker
        const end = { x: b.x - (b.x - a.x) * cut, y: b.y - (b.y - a.y) * cut };
        arrowSegments.push({ x1: a.x, y1: a.y, x2: end.x, y2: end.y });
        const g = svgEl('g', { class: 'arrow', 'data-arrow': id, 'data-tip': PERIOD_LABELS[id] });
        if (!layers.includes('IronAge')) {
          g.append(svgEl('circle', { class: 'arrow-tail', cx: a.x, cy: a.y, r: 6, fill: 'none', stroke: PERIOD_COLORS.IronAge, 'stroke-width': 2.5 }));
        }
        g.append(svgEl('line', {
          x1: a.x, y1: a.y, x2: end.x, y2: end.y,
          stroke: INK, 'stroke-width': 3, 'marker-end': 'url(#pca-arrowhead)',
        }));
        world.append(g);
      }
    }
    const centres = layers
      .map((id) => ({ id, c: centreOf(id) }))
      .filter((e): e is { id: PeriodId; c: Pt } => e.c !== undefined && inFrame(e.c, fr))
      .map((e) => ({ id: e.id, ...pos(e.c) }));
    for (const c of centres) {
      world.append(svgEl('path', {
        class: 'centre', 'data-centre': c.id, 'data-tip': PERIOD_LABELS[c.id],
        d: shapePath(PERIOD_SHAPES[c.id], c.x, c.y, 12),
        fill: PERIOD_COLORS[c.id], stroke: INK, 'stroke-width': 2.5,
      }));
    }
    // Labels sit to the right of their centre, pushed down so no two are closer than 18 px. When another centre
    // marker or an arrow lies in a label's right-hand box, the label goes to the left of its marker instead.
    let lastY = -Infinity;
    for (const c of [...centres].sort((u, v) => u.y - v.y)) {
      const y = Math.max(c.y + 5, lastY + 18);
      lastY = y;
      const rightBox: Box = { left: c.x + 18, right: c.x + 18 + PERIOD_LABELS[c.id].length * LABEL_CHAR_W, top: y - 15, bottom: y + 3 };
      const blocked = centres.some((o) => o !== c && boxesOverlap(rightBox, {
        left: o.x - MARKER_REACH, right: o.x + MARKER_REACH, top: o.y - MARKER_REACH, bottom: o.y + MARKER_REACH,
      })) || arrowSegments.some((s) => segmentHitsBox(s, rightBox));
      world.append(svgEl('text', {
        class: 'centre-label', 'data-centre-label': c.id, x: blocked ? c.x - 18 : c.x + 18, y,
        ...(blocked ? { 'text-anchor': 'end' } : {}),
        'font-size': 16, 'font-weight': '700', fill: INK, stroke: '#FFFFFF', 'stroke-width': 4, 'paint-order': 'stroke',
      }, PERIOD_LABELS[c.id]));
    }
  }

  // 6. Legend: "Ancient Britons" (period layers, plus the east outline with Anglo-Saxon focus) and "People living today"
  //    (continental groups, then Britain today once shown). In the British frame anything non-focus with no point in the
  //    frame is left out.
  const legendVisible = (id: PeriodId): boolean => !british || id === focus || anyInFrame(pointsOf(id));
  const ancient: LegendItem[] = [];
  for (const id of layers) {
    if (!legendVisible(id)) continue;
    ancient.push({
      key: id, tip: PERIOD_LABELS[id], text: withN(PERIOD_LABELS[id], nOf(id)),
      mark: (x, y) => svgEl('path', { d: shapePath(PERIOD_SHAPES[id], x, y, 6), fill: PERIOD_COLORS[id] }),
    });
    if (id === 'AngloSaxon' && eastOn && pointsOf('AngloSaxon').some((pt) => pt.east === true)) {
      ancient.push({
        key: 'east', tip: EAST_ENGLAND_LEGEND, text: EAST_ENGLAND_LEGEND,
        mark: (x, y) => svgEl('path', {
          d: shapePath(PERIOD_SHAPES.AngloSaxon, x, y, 6 + EAST_GROW),
          fill: PERIOD_COLORS.AngloSaxon, stroke: INK, 'stroke-width': EAST_STROKE,
        }),
      });
    }
  }
  const living: LegendItem[] = [];
  for (const g of data.map_groups) {
    if (british && !anyInFrame(g.points)) continue;
    living.push({
      key: g.id, tip: MAP_GROUP_LABELS[g.id], text: withN(MAP_GROUP_LABELS[g.id], g.n),
      mark: (x, y) => svgEl('path', { d: shapePath('circle', x, y, 5), fill: MAP_GREY }),
    });
  }
  if (p.layers.includes('Today') && legendVisible('Today')) {
    living.push({
      key: 'Today', tip: PERIOD_LABELS.Today, text: withN(PERIOD_LABELS.Today, nOf('Today')),
      mark: (x, y) => svgEl('path', {
        d: shapePath('circle', x, y, 5), fill: 'none', stroke: TODAY_RING.stroke, 'stroke-width': TODAY_RING.strokeWidth,
      }),
    });
  }
  const legend = renderLegend([['ancient', LEGEND_ANCIENT, ancient], ['living', LEGEND_LIVING, living]]);

  // pointer-events none: the tip sits over the plot, so it must never take the hover from the mark underneath.
  const tip = svgEl('text', {
    class: 'plot-tip', x: PCA_VIEW.right, y: 40, 'text-anchor': 'end', 'font-size': 20, 'font-weight': '700',
    fill: INK, stroke: '#FFFFFF', 'stroke-width': 5, 'paint-order': 'stroke', 'pointer-events': 'none',
  });

  svg.append(defs, world, legend, tip);
  wireTips(svg);

  // 7. A live frame change animates (~0.5 s) where the browser supports it; restore and Back pass animate: false.
  if (opts.animate !== false && prev && prevFrameId !== p.frame && typeof world.animate === 'function' && !reducedMotion()) {
    world.animate(
      [{ transform: frameTransition(makeScale(prev), sc) }, { transform: 'matrix(1, 0, 0, 1, 0, 0)' }],
      { duration: 500, easing: 'ease-in-out' },
    );
  }
}

/** The HTML caption strip under the PCA svg (spec §2.3): captions, chips with their icons, then the zoom note. */
export function renderPcaCaptions(doc: Document, items: PcaCaptionItem[]): HTMLDivElement {
  const div = doc.createElement('div');
  div.className = 'pca-captions';
  for (const it of items) {
    if (it.kind === 'chip') {
      div.append(chipElement(doc, it.key));
      continue;
    }
    const p = doc.createElement('p');
    if (it.kind === 'caption') {
      p.className = 'pca-caption';
      p.setAttribute('data-caption', it.key);
    } else {
      p.className = 'zoom-note';
    }
    p.textContent = it.text;
    div.append(p);
  }
  return div;
}
