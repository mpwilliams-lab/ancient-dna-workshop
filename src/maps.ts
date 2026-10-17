// Per-card map specs (spec §6). Every label string comes from content.ts (MAP_TEXT, TRAIT_MAP_LABELS) or from the
// JSON (europe_pops[].label), so the content scan covers it. Coordinates are lat/lon; src/plots/map.ts projects them.
import { MAP_TEXT } from './content';
import {
  MAP_FRAMES, MAP_LABEL_FONT_PX, MAP_VIEW, arrowReach, catmullRomSegments, makeProjection, project,
  type CurveSegment, type LatLon, type MapFrameId, type MapProjectionConstants, type MapSpec, type MapText, type MapView, type XY,
} from './plots/map';
import type { MapId, WorkshopData } from './types';

/** The font size renderMap gives a MapText (one constant, defined in src/plots/map.ts by Task 19; CONTRACT §8 R5) and the
 *  average character width in em: the estimate used to place labels and to test that they never overlap. */
export { MAP_LABEL_FONT_PX };
export const MAP_LABEL_CHAR_EM = 0.58;

/** Maps whose spec exists. A card is upgraded to its map only if its id is here (assets.ts cardShowsUpgrade), so an
 *  unbuilt map is never drawn, whatever the flags. Tasks 23, 24, 27 and 29 add their ids. */
export const MAP_SPECS_BUILT: ReadonlySet<MapId> = new Set<MapId>(['D1', 'E1', 'G1']);

type Anchor = 'start' | 'middle' | 'end';
const ll = (lat: number, lon: number): LatLon => ({ lat, lon });

const projections = new Map<MapFrameId, MapProjectionConstants>();
function projectionOf(frame: MapFrameId): MapProjectionConstants {
  let c = projections.get(frame);
  if (!c) {
    c = makeProjection(MAP_FRAMES[frame]);
    projections.set(frame, c);
  }
  return c;
}

/** A label whose anchor point sits (dx, dy) px from `at` on the projected map. The projection is linear in lat and
 *  lon, so the pixel offset converts to degrees exactly. */
export function labelAt(frame: MapFrameId, at: LatLon, text: string, anchor: Anchor, dx: number, dy: number): MapText {
  const c = projectionOf(frame);
  return { lat: at.lat - dy / c.k, lon: at.lon + dx / (c.k * c.cosLat0), text, anchor };
}

export interface LabelBox { left: number; right: number; top: number; bottom: number }

/** Estimated box of a label in viewBox px (baseline at the projected point). A text with no anchor is drawn centred (renderMap). */
export function labelBox(c: MapProjectionConstants, t: MapText, fontPx: number = MAP_LABEL_FONT_PX): LabelBox {
  const p = project(c, t.lat, t.lon);
  const w = t.text.length * MAP_LABEL_CHAR_EM * fontPx;
  const a = t.anchor ?? 'middle';
  const left = a === 'start' ? p.x : a === 'end' ? p.x - w : p.x - w / 2;
  return { left, right: left + w, top: p.y - 0.8 * fontPx, bottom: p.y + 0.25 * fontPx };
}

export interface LabelItem { at: LatLon; text: string; r: number }
export interface Obstacle { at: LatLon; r: number }

function overlapArea(a: LabelBox, b: LabelBox): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Eight places around a dot of radius r: right, left, above, below, then the four diagonals. */
function candidates(r: number, f: number): { anchor: Anchor; dx: number; dy: number }[] {
  return [
    { anchor: 'start', dx: r + 4, dy: f * 0.3 },
    { anchor: 'end', dx: -(r + 4), dy: f * 0.3 },
    { anchor: 'middle', dx: 0, dy: -(r + 4) },
    { anchor: 'middle', dx: 0, dy: r + f * 0.9 },
    { anchor: 'start', dx: r * 0.7, dy: -(r * 0.7 + 2) },
    { anchor: 'end', dx: -r * 0.7, dy: -(r * 0.7 + 2) },
    { anchor: 'start', dx: r * 0.7, dy: r * 0.7 + f * 0.8 },
    { anchor: 'end', dx: -r * 0.7, dy: r * 0.7 + f * 0.8 },
  ];
}

/**
 * Greedy, deterministic label placement for data-driven maps (A1, distribution maps). Biggest dots first (ties keep input
 * order); each label takes the first of its eight candidate places with the lowest cost, where cost = 10 x overlap with
 * labels already placed + overlap with every dot and obstacle + 1e6 if it leaves the viewBox. Returns labels in input order.
 */
export function placeLabels(frame: MapFrameId, items: readonly LabelItem[], obstacles: readonly Obstacle[] = []): MapText[] {
  const c = projectionOf(frame);
  const f = MAP_LABEL_FONT_PX;
  const discs: LabelBox[] = [...items, ...obstacles].map((o) => {
    const p = project(c, o.at.lat, o.at.lon);
    return { left: p.x - o.r, right: p.x + o.r, top: p.y - o.r, bottom: p.y + o.r };
  });
  const order = items.map((_, i) => i).sort((a, b) => items[b].r - items[a].r || a - b);
  const placed: LabelBox[] = [];
  const out: MapText[] = new Array<MapText>(items.length);
  for (const i of order) {
    const it = items[i];
    let best: { t: MapText; box: LabelBox; cost: number } | null = null;
    for (const cand of candidates(it.r, f)) {
      const t = labelAt(frame, it.at, it.text, cand.anchor, cand.dx, cand.dy);
      const box = labelBox(c, t);
      let cost = 0;
      for (const b of placed) cost += 10 * overlapArea(box, b);
      for (const d of discs) cost += overlapArea(box, d);
      if (box.left < 0 || box.right > MAP_VIEW.width || box.top < 0 || box.bottom > MAP_VIEW.height) cost += 1e6;
      if (best === null || cost < best.cost) best = { t, box, cost };
    }
    placed.push(best!.box);
    out[i] = best!.t;
  }
  return out;
}

/** The frame's box on the 1000 x 700 map space: the sea rectangle renderMap draws and the edge of the land outline. */
export function frameBox(frame: MapFrameId): LabelBox {
  const c = projectionOf(frame);
  const f = MAP_FRAMES[frame];
  return {
    left: c.offX, right: c.offX + c.k * (f.lonMax - f.lonMin) * c.cosLat0,
    top: c.offY, bottom: c.offY + c.k * (f.latMax - f.latMin),
  };
}

function bezierAt(s: CurveSegment, t: number): XY {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: a * s.from.x + b * s.c1.x + c * s.c2.x + d * s.to.x, y: a * s.from.y + b * s.c1.y + c * s.c2.y + d * s.to.y };
}

/** Where an arrow's curve runs: every Bézier of it sampled 17 times. */
function curvePoints(pts: readonly XY[]): XY[] {
  return catmullRomSegments(pts).flatMap((s) => Array.from({ length: 17 }, (_, i) => bezierAt(s, i / 16)));
}

/** The smallest box that holds every arrow (curve, stroke and arrowhead) and every text label of a spec, in viewBox units; null
 *  when it draws neither. Text is the estimate of labelBox. */
export function drawingBox(spec: MapSpec): LabelBox | null {
  const c = projectionOf(spec.frame);
  const boxes: LabelBox[] = [];
  for (const a of spec.arrows ?? []) {
    const r = arrowReach(a);
    for (const p of curvePoints(a.waypoints.map((w) => project(c, w.lat, w.lon)))) {
      boxes.push({ left: p.x - r, right: p.x + r, top: p.y - r, bottom: p.y + r });
    }
  }
  for (const t of spec.texts ?? []) boxes.push(labelBox(c, t));
  if (boxes.length === 0) return null;
  return boxes.reduce((u, b) => ({
    left: Math.min(u.left, b.left), right: Math.max(u.right, b.right), top: Math.min(u.top, b.top), bottom: Math.max(u.bottom, b.bottom),
  }));
}

/** Margin around the drawing in a band view, in viewBox units. */
export const BAND_PAD = 16;
/** The widest (thinnest) a band may be, as width : height. A drawing that fills a thinner band gets more of the frame above and
 *  below it, so the map is a picture of a region and not a strip. */
export const BAND_MAX_ASPECT = 2.2;

/**
 * The window a card shows for a map whose drawing fills only part of its frame: the frame's full width and the band of latitudes
 * that holds the drawing (arrows and labels) plus BAND_PAD, made taller where needed so it is no thinner than BAND_MAX_ASPECT, never
 * beyond the frame. Same projection and outline as the whole frame, so nothing moves; the card just does not spend its height on
 * Scandinavia or the Sahara. At 1366 x 768 a card has about 300 px for its map: the whole frame's 700 units would be drawn at a scale
 * of 0.42 and a 20-unit label would be 8 px tall. Rounded inwards to 0.1, so the window is always inside the frame.
 */
export function bandView(frame: MapFrameId, spec: MapSpec, pad: number = BAND_PAD, maxAspect: number = BAND_MAX_ASPECT): MapView {
  const f = frameBox(frame);
  const box = drawingBox(spec);
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  const x = Math.ceil(f.left * 10) / 10;
  const right = Math.floor(f.right * 10) / 10;
  let top = box === null ? f.top : Math.max(f.top, box.top - pad);
  let bottom = box === null ? f.bottom : Math.min(f.bottom, box.bottom + pad);
  const more = (right - x) / maxAspect - (bottom - top);
  if (more > 0) {
    top -= more / 2;
    bottom += more / 2;
    if (top < f.top) [top, bottom] = [f.top, bottom + (f.top - top)];
    if (bottom > f.bottom) [top, bottom] = [Math.max(f.top, top - (bottom - f.bottom)), f.bottom];
  }
  top = Math.ceil(top * 10) / 10;
  bottom = Math.floor(bottom * 10) / 10;
  return { x, y: top, width: r1(right - x), height: r1(bottom - top) };
}

/** The spec with the band view of its own drawing (see bandView). */
function withBand(spec: MapSpec): MapSpec {
  return { ...spec, view: bandView(spec.frame, spec) };
}

// ---- D1: where the newcomers' steppe ancestry came from (spec §3.2, §6) ----
const D1_MAIN: LatLon[] = [ll(47.5, 38.0), ll(50.5, 21.0), ll(51.4, 11.7), ll(52.7, 5.0), ll(51.17, -1.78)];
const D1_IDEA: LatLon[] = [ll(38.7, -9.1), ll(52.0, 5.5)];

function specD1(): MapSpec {
  const [homeland, corded, beaker, britain, idea] = MAP_TEXT.D1;
  return withBand({
    id: 'D1',
    frame: 'europe',
    arrows: [
      { waypoints: D1_MAIN, style: 'main' },
      { waypoints: D1_IDEA, style: 'idea' },
    ],
    texts: [
      labelAt('europe', D1_MAIN[0], homeland, 'end', 70, 30),
      labelAt('europe', D1_MAIN[2], corded, 'start', 4, -12),
      labelAt('europe', D1_MAIN[3], beaker, 'middle', 0, -14),
      labelAt('europe', D1_MAIN[4], britain, 'end', -12, -10),
      labelAt('europe', D1_IDEA[0], idea, 'start', -20, 30),
    ],
  });
}

// ---- E1: a quieter migration, France to southern Britain (spec §3.2, §6) ----
const E1_MAIN: LatLon[] = [ll(48.7, 6.2), ll(50.73, 1.61), ll(51.33, 1.37)];

function specE1(): MapSpec {
  const [france, kent, along, scotland] = MAP_TEXT.E1;
  return withBand({
    id: 'E1',
    frame: 'europe',
    arrows: [{ waypoints: E1_MAIN, style: 'main', wide: true }],
    texts: [
      labelAt('europe', ll(48.0, 3.0), france, 'end', -10, 6),
      labelAt('europe', ll(51.33, 1.37), kent, 'start', 16, 0),
      labelAt('europe', E1_MAIN[0], along, 'start', 0, 28),
      labelAt('europe', ll(57.0, -4.5), scotland, 'start', -68, 6),
    ],
  });
}

// ---- G1: across the North Sea (spec §3.3, §6) ----
const G1_MAIN: LatLon[][] = [
  [ll(53.6, 8.9), ll(53.5, 4.0), ll(52.9, 0.6), ll(52.41, 0.52)], //   northern Germany -> East Anglia
  [ll(54.65, 9.8), ll(55.0, 3.0), ll(53.7, -0.3), ll(54.17, -0.6)], // Jutland -> Yorkshire
  [ll(55.7, 9.0), ll(53.0, 3.5), ll(51.5, 1.2), ll(51.25, 1.31)], //   Denmark -> Kent
  [ll(53.2, 5.8), ll(52.8, 3.0), ll(52.9, 0.3), ll(52.2, 0.1)], //     Netherlands -> East Anglia
];
const G1_FRANCE: LatLon[] = [ll(48.85, 2.35), ll(50.73, 1.61), ll(51.13, 1.31)];

function specG1(): MapSpec {
  const [germany, netherlands, denmark, eastAnglia, yorkshire, kent, france] = MAP_TEXT.G1;
  return withBand({
    id: 'G1',
    frame: 'europe',
    arrows: [
      ...G1_MAIN.map((waypoints) => ({ waypoints, style: 'main' as const })),
      { waypoints: G1_FRANCE, style: 'minor', dashed: true }, // "minor dashed" (spec §6); Task 19's dashed flag
    ],
    texts: [
      labelAt('europe', G1_MAIN[0][0], germany, 'start', 12, 18),
      labelAt('europe', G1_MAIN[3][0], netherlands, 'start', 0, 36),
      labelAt('europe', G1_MAIN[2][0], denmark, 'start', 12, 6),
      labelAt('europe', G1_MAIN[0][3], eastAnglia, 'end', -14, 6),
      labelAt('europe', G1_MAIN[1][3], yorkshire, 'end', -14, 6),
      labelAt('europe', G1_MAIN[2][3], kent, 'end', -14, 20),
      labelAt('europe', G1_FRANCE[0], france, 'start', 12, 6),
    ],
  });
}

/** The map for a card (CONTRACT §4.13). Throws for a map whose spec is not built yet (see MAP_SPECS_BUILT). */
export function mapSpec(id: MapId, data: WorkshopData): MapSpec {
  void data; // D1, E1 and G1 are fixed drawings; A1 and the distribution maps (Tasks 23, 24) read the data
  switch (id) {
    case 'D1':
      return specD1();
    case 'E1':
      return specE1();
    case 'G1':
      return specG1();
    default:
      throw new Error(`mapSpec: map ${id} is not built yet`);
  }
}

/** True when the map's spec is built and the data it needs is present (A1 needs europe_pops: Task 23). */
export function mapDataReady(id: MapId, data: WorkshopData): boolean {
  if (!MAP_SPECS_BUILT.has(id)) return false;
  void data;
  return true;
}
