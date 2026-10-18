import type { Frame, NamedPoint, PeriodId, PersonPt, Pt, WorkshopData } from '../types';
import { FEATURES, type Features } from '../features';
import { layerOpacity, type PcaCaptionItem, type PlotState } from '../plotState';
import {
  EAST_ENGLAND_LEGEND, LEGEND_ANCIENT, LEGEND_LIVING, MAP_GROUP_LABELS, NORTH_SEA_LABEL, PCA_CAPTION, PERIOD_LABELS, YORK_TRAVELLER_LABEL,
  withN,
} from '../content';
import { chipElement } from '../icons';
import { INK, MAP_GREY, PERIOD_COLORS, PERIOD_SHAPES, clearPlotMarkers, f1, shapePath, svgEl, textBlock, wireTips, wrapText } from './svg';

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

/** True when the visitor asked the system for less motion: the frame change and the finale are then drawn at once. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

/** York traveller marker (P3, flag yorkTraveller): Roman colour and shape, hollow, a little bigger than a point. */
export const YORK_MARKER_R = 8;
/** The label wraps at this many characters, in 15 px type of weight 600 with a white outline, lines YORK_LINE apart. */
export const YORK_LABEL_CHARS = 36;
export const YORK_LINE = 18;
/**
 * The mark's arrow, a triangle: its tip YORK_POINTER_REACH from the mark's centre toward where he really lies, its base YORK_POINTER_BASE from
 * the centre and YORK_POINTER_HALF to each side of it.
 */
export const YORK_POINTER_REACH = 22;
export const YORK_POINTER_BASE = 12;
export const YORK_POINTER_HALF = 6;
/**
 * The mark is pinned to the frame's edge but never closer than this to the plot box's own edge. The legend runs under the box and its first
 * row reaches under the south-east corner at the Roman step of the guided run (Bell Beaker, Bronze Age, Iron Age and Roman, the last at x 727 to
 * 842), so a mark on the box's bottom edge put its arrow, which reaches YORK_POINTER_REACH beyond the mark, on the Roman entry (Task 29, fix round
 * 1). Kept this far in, the mark (7.2 and its stroke), the arrow (22) and the words all lie inside the box, at every edge and corner.
 */
export const YORK_EDGE_INSET = 30;

/**
 * The York traveller from data.named (Martiniano et al. 2016; Task 28), drawn only on a Roman-focus PCA and only where he
 * is off the current frame, because his label says "(off this zoomed map)". He is pinned to the frame edge like any clipped
 * point, kept YORK_EDGE_INSET inside the plot box so that the mark, its arrow and its words stay clear of the legend under the box, with a
 * small pointer toward where he really lies, and labelled on the plot-centre side of the marker.
 * Returns null when nothing should be drawn. Reads the first named point: validateNamed accepts any number of them, the data
 * build writes exactly one, and the key is checked too, so nothing else is ever drawn as him.
 */
export function yorkTravellerMark(data: WorkshopData, p: PlotState, features: Features = FEATURES): SVGGElement | null {
  if (!features.yorkTraveller || p.view !== 'pca' || p.focus !== 'Roman') return null;
  const named: NamedPoint | undefined = data.named?.[0];
  if (named?.key !== 'york_traveller') return null;
  const fr = data.frames[p.frame];
  const c = clampToFrame(named, fr);
  if (!c.clipped) return null;
  const sc = makeScale(fr);
  const edge = { x: sc.toX(c.x), y: sc.toY(c.y) };            // where he is pinned on the frame's edge
  const q = {                                                  // where the mark goes: that, but YORK_EDGE_INSET inside the plot box
    x: Math.min(Math.max(edge.x, PCA_VIEW.left + YORK_EDGE_INSET), PCA_VIEW.right - YORK_EDGE_INSET),
    y: Math.min(Math.max(edge.y, PCA_VIEW.top + YORK_EDGE_INSET), PCA_VIEW.bottom - YORK_EDGE_INSET),
  };
  const t = { x: sc.toX(named.x), y: sc.toY(named.y) };
  const len = Math.hypot(t.x - q.x, t.y - q.y) || 1;
  const u = { x: (t.x - q.x) / len, y: (t.y - q.y) / len };

  const g = svgEl('g', { class: 'york-traveller', 'data-named': 'york_traveller', 'data-tip': YORK_TRAVELLER_LABEL });
  g.append(svgEl('path', {
    class: 'york-marker', d: shapePath(PERIOD_SHAPES.Roman, q.x, q.y, YORK_MARKER_R),
    fill: '#FFFFFF', stroke: PERIOD_COLORS.Roman, 'stroke-width': 3,
  }));
  const tip = { x: q.x + u.x * YORK_POINTER_REACH, y: q.y + u.y * YORK_POINTER_REACH };
  const base = { x: q.x + u.x * YORK_POINTER_BASE, y: q.y + u.y * YORK_POINTER_BASE };
  const side = { x: -u.y * YORK_POINTER_HALF, y: u.x * YORK_POINTER_HALF };
  g.append(svgEl('path', {
    class: 'york-pointer',
    d: `M${f1(tip.x)} ${f1(tip.y)}L${f1(base.x + side.x)} ${f1(base.y + side.y)}L${f1(base.x - side.x)} ${f1(base.y - side.y)}Z`,
    fill: PERIOD_COLORS.Roman,
  }));

  const right = q.x > (PCA_VIEW.left + PCA_VIEW.right) / 2;
  const below = q.y > (PCA_VIEW.top + PCA_VIEW.bottom) / 2;
  const lines = wrapText(YORK_TRAVELLER_LABEL, YORK_LABEL_CHARS).length;
  const x = Math.min(Math.max(right ? q.x - 16 : q.x + 16, PCA_VIEW.left + 4), PCA_VIEW.right - 4);
  const yTop = below ? q.y - 16 - (lines - 1) * YORK_LINE : q.y + 26;
  const y = Math.min(Math.max(yTop, PCA_VIEW.top + 16), PCA_VIEW.bottom - 4 - (lines - 1) * YORK_LINE);
  const { el } = textBlock(YORK_TRAVELLER_LABEL, YORK_LABEL_CHARS, x, y, YORK_LINE, {
    class: 'york-label', 'font-size': 15, 'font-weight': '600', fill: INK,
    stroke: '#FFFFFF', 'stroke-width': 4, 'paint-order': 'stroke', 'pointer-events': 'none',
    ...(right ? { 'text-anchor': 'end' } : {}),
  });
  if (right) {
    // textBlock keeps the space between two lines at the end of the first, and a right-anchored line counts it in its width, so those lines
    // would stop one space (about 4 units) short of the last one. The space moves to the front of the next line instead, where a
    // line that ends at the anchor does not show it; the sentence in textContent is the same.
    const lineEls = Array.from(el.querySelectorAll('tspan'));
    lineEls.forEach((t, i) => {
      const text = t.textContent ?? '';
      t.textContent = `${i > 0 ? ' ' : ''}${i < lineEls.length - 1 ? text.trimEnd() : text}`;
    });
  }
  g.append(el);
  return g;
}

export function renderPca(svg: SVGSVGElement, data: WorkshopData, p: PlotState, opts: { animate?: boolean; features?: Features } = {}): void {
  const fr = data.frames[p.frame];
  const sc = makeScale(fr);
  // Only an svg that currently shows a PCA has a frame worth animating from: data-frame can be a stale leftover
  // once the bars or a trait plot have used the same svg. Read both attributes before the markers are cleared below.
  const prevFrameId = svg.getAttribute('data-view') === 'pca' ? svg.getAttribute('data-frame') : null;
  const prev = prevFrameId === 'europe' || prevFrameId === 'britain' ? data.frames[prevFrameId] : undefined;

  clearPlotMarkers(svg); // the bars (ADMIXTURE or consumer) may have used this svg just before
  svg.setAttribute('viewBox', `0 0 ${PCA_VIEW.width} ${PCA_VIEW.height}`);
  // Top-anchored: the caption strip under the svg changes height from step to step, which changes the svg's free height,
  // and a vertically centred plot would jump with it.
  svg.setAttribute('preserveAspectRatio', 'xMidYMin meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', PCA_CAPTION);
  svg.setAttribute('data-view', 'pca');
  svg.setAttribute('data-frame', p.frame);
  if (p.focus !== undefined) svg.setAttribute('data-focus', p.focus);
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
        // pointer-events all: an unfilled path takes the pointer only on its 1.5 px stroke, so without it a ring could
        // not be hovered or tapped (the tip would almost never name it).
        layer.append(svgEl('path', {
          class: c.clipped ? 'pt today-ring clipped' : 'pt today-ring',
          d: shapePath('circle', q.x, q.y, TODAY_RING.r),
          fill: 'none', stroke: TODAY_RING.stroke, 'stroke-width': TODAY_RING.strokeWidth, 'pointer-events': 'all',
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

  // 5b. York traveller (P3, flag yorkTraveller): only on the Roman focus, only where he is off the frame; on top of everything else
  //     in the plot group, so a frame change carries him along with the points.
  const york = yorkTravellerMark(data, p, opts.features ?? FEATURES);
  if (york) world.append(york);

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
        'pointer-events': 'all',
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
  if (opts.animate !== false && prev && prevFrameId !== p.frame && typeof world.animate === 'function' && !prefersReducedMotion()) {
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

// ---- Finale (spec §2.3, P2 flag finaleAnimation): run_pca(period = "all") played live ----
export const FINALE_TIMING = { fadeMs: 250, stepMs: 600, pauseMs: 900 } as const;
/**
 * Britain today's single pulse ring: grows from 20% to full radius while it fades out. Britain today lands on the dense Iron Age
 * cloud (about 140 px across at 1366 x 768), so the ring is a dark line on a white halo, keeps its on-screen width (non-scaling
 * stroke) and ends wider than the cloud; a thin dark ring of radius 60 never leaves the cloud and cannot be seen.
 */
export const FINALE_PULSE = { ms: 600, r: 100, strokeWidth: 3, haloWidth: 8 } as const;

/** When each period layer starts to fade in (ms after the plot is drawn): oldest first, Britain today last. */
export function finaleSchedule(): { layer: PeriodId; delay: number }[] {
  const steps = ANCIENT.map((layer, i) => ({ layer, delay: i * FINALE_TIMING.stepMs }));
  const lastEnd = (ANCIENT.length - 1) * FINALE_TIMING.stepMs + FINALE_TIMING.fadeMs;
  steps.push({ layer: 'Today', delay: lastEnd + FINALE_TIMING.pauseMs });
  return steps;
}

/** Whole finale, first fade to the end of the pulse ring (5,350 ms). */
export function finaleTotalMs(): number {
  const s = finaleSchedule();
  return s[s.length - 1]!.delay + Math.max(FINALE_TIMING.fadeMs, FINALE_PULSE.ms);
}

/**
 * Starts the finale on an svg that renderPca has just drawn for focus 'all'. Returns the animations in schedule order, each period
 * layer followed by its legend item (so the legend never lists a period before the plot shows it), then the pulse's white halo and
 * its dark ring last (the ring ends last). Only Web Animations are used: finish() lands on the final frame, and no timer is ever
 * started. Returns [] when the browser cannot animate.
 */
export function animateFinale(svg: SVGSVGElement, data: WorkshopData): Animation[] {
  const out: Animation[] = [];
  const schedule = finaleSchedule();
  /** Invisible until its turn (fill: backwards), then in over fadeMs; back to the element's own opacity once it is over. */
  const fadeIn = (el: Element | null, delay: number): void => {
    if (!el || typeof el.animate !== 'function') return;
    out.push(el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: FINALE_TIMING.fadeMs, delay, fill: 'backwards', easing: 'ease-out',
    }));
  };
  for (const { layer, delay } of schedule) {
    fadeIn(svg.querySelector(`g.layer.period[data-layer="${layer}"]`), delay);
    fadeIn(svg.querySelector(`g.legend-item[data-legend="${layer}"]`), delay);
  }
  const today = data.periods.find((pi) => pi.id === 'Today')?.centre;
  if (today && out.length > 0) {
    const sc = makeScale(data.frames.europe); // focus 'all' always uses the Europe frame
    const circle = (cls: string, stroke: string, width: number): SVGCircleElement => svgEl('circle', {
      class: cls, cx: sc.toX(today.x), cy: sc.toY(today.y), r: FINALE_PULSE.r,
      fill: 'none', stroke, 'stroke-width': width, opacity: '0', 'pointer-events': 'none',
      style: 'transform-box: fill-box; transform-origin: center; vector-effect: non-scaling-stroke',
    });
    // The halo has its own class, so `circle.finale-pulse` still names the ring alone. It lies under the ring and shows on both
    // sides of it, so the dark line reads over the dark markers of the cloud.
    const halo = circle('finale-pulse-halo', '#FFFFFF', FINALE_PULSE.haloWidth);
    const ring = circle('finale-pulse', INK, FINALE_PULSE.strokeWidth);
    (svg.querySelector('g.world') ?? svg).append(halo, ring);
    for (const el of [halo, ring]) {
      if (typeof el.animate !== 'function') continue;
      out.push(el.animate(
        [{ opacity: 1, transform: 'scale(0.2)' }, { opacity: 0, transform: 'scale(1)' }],
        { duration: FINALE_PULSE.ms, delay: schedule[schedule.length - 1]!.delay, easing: 'ease-out' },
      ));
    }
  }
  return out;
}
