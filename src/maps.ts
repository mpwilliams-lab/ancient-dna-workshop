// Per-card map specs (spec §6). Every label string comes from content.ts (MAP_TEXT, TRAIT_MAP_LABELS) or from the
// JSON (europe_pops[].label), so the content scan covers it. Coordinates are lat/lon; src/plots/map.ts projects them.
import { MAP_TEXT } from './content';
import {
  MAP_FRAMES, MAP_LABEL_FONT_PX, MAP_VIEW, arrowReach, catmullRomSegments, makeProjection, project, projectUnits,
  type CurveSegment, type LatLon, type MapFrameId, type MapLink, type MapProjectionConstants, type MapSpec, type MapText, type MapView,
  type XY,
} from './plots/map';
import type { MapId, WorkshopData } from './types';

/** The font size renderMap gives a MapText (one constant, defined in src/plots/map.ts by Task 19; CONTRACT §8 R5) and the
 *  average character width in em: the estimate used to place labels and to test that they never overlap. */
export { MAP_LABEL_FONT_PX };
export const MAP_LABEL_CHAR_EM = 0.58;

/** Maps whose spec exists. A card is upgraded to its map only if its id is here (assets.ts cardShowsUpgrade), so an
 *  unbuilt map is never drawn, whatever the flags. Tasks 24, 27 and 29 add their ids. */
export const MAP_SPECS_BUILT: ReadonlySet<MapId> = new Set<MapId>(['A1', 'D1', 'E1', 'G1']);

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

export interface PlaceOptions {
  /** The window the map shows: a label outside it would be cut off, so it costs as much as one outside the viewBox. Default: the
   *  whole 1000 x 700 map space. */
  within?: MapView;
  /** Font size the labels are drawn at (MapSpec.labelPx). Default MAP_LABEL_FONT_PX. */
  fontPx?: number;
}

/**
 * Greedy, deterministic label placement for data-driven maps (A1, distribution maps). Biggest dots first (ties keep input
 * order); each label takes the first of its eight candidate places with the lowest cost, where cost = 10 x overlap with
 * labels already placed + overlap with every dot and obstacle + 1e6 if it leaves the viewBox (or options.within, when the map
 * shows only a window of it). Returns labels in input order.
 */
export function placeLabels(
  frame: MapFrameId, items: readonly LabelItem[], obstacles: readonly Obstacle[] = [], options: PlaceOptions = {},
): MapText[] {
  const c = projectionOf(frame);
  const f = options.fontPx ?? MAP_LABEL_FONT_PX;
  const room = options.within ?? { x: 0, y: 0, width: MAP_VIEW.width, height: MAP_VIEW.height };
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
      const box = labelBox(c, t, f);
      let cost = 0;
      for (const b of placed) cost += 10 * overlapArea(box, b);
      for (const d of discs) cost += overlapArea(box, d);
      if (box.left < room.x || box.right > room.x + room.width || box.top < room.y || box.bottom > room.y + room.height) cost += 1e6;
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

/** The smallest box that holds every arrow (curve, stroke and arrowhead), both ends of every link (a dot of radius A1_DOT_R) and
 *  every text label of a spec, in viewBox units; null when it draws none of them. Text is the estimate of labelBox. */
export function drawingBox(spec: MapSpec): LabelBox | null {
  const c = projectionOf(spec.frame);
  const boxes: LabelBox[] = [];
  for (const a of spec.arrows ?? []) {
    const r = arrowReach(a);
    for (const p of curvePoints(a.waypoints.map((w) => project(c, w.lat, w.lon)))) {
      boxes.push({ left: p.x - r, right: p.x + r, top: p.y - r, bottom: p.y + r });
    }
  }
  for (const l of spec.links ?? []) {
    for (const p of [project(c, l.from.lat, l.from.lon), projectUnits(c, l.to.ux, l.to.uy)]) {
      boxes.push({ left: p.x - A1_DOT_R, right: p.x + A1_DOT_R, top: p.y - A1_DOT_R, bottom: p.y + A1_DOT_R });
    }
  }
  for (const t of spec.texts ?? []) boxes.push(labelBox(c, t, spec.labelPx));
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

// ---- A1: genes mirror geography (spec §3.1, §6, §8; an original drawing inspired by Novembre et al. 2008) ----
/** Radius used to keep A1 labels clear of the dots (renderMap draws its link dots about this size). */
export const A1_DOT_R = 5;
/**
 * Open check 14: the names of the groups A1 may label, copied here only once the instructor has confirmed them. They are the
 * `map_label` groups of the data build, in europe_pops order (north to south): Estonian, Lithuanian, Czech, Hungarian, Romanian,
 * Serbian, South Italian, Sicilian. Empty = the map ships unlabelled (spec §11, plan O8). A group is labelled only if the build
 * chose it (`map_label`) AND its name is in this list, so the list can never label anything the data does not.
 */
export const A1_CONFIRMED_LABELS: readonly string[] = [];
/**
 * The size of A1's labels in map units (the other maps use MAP_LABEL_FONT_PX = 20). A1 is a nearly square drawing (about 1.2 : 1)
 * in a card slot that is short and wide, so it is drawn smaller than the arrow maps: at 1366 x 768 the picture is about 0.65 px
 * to a map unit, and a 20-unit label would be 13 px tall. At 24 it is 15.6 px there and 21.8 px at 1920 x 1080.
 */
export const A1_LABEL_PX = 24;

/**
 * A1 for the given confirmed names (mapSpec passes A1_CONFIRMED_LABELS; the tests pass their own). One link per non-isolate group,
 * from a grey dot where the group lives to a blue dot where its DNA puts it, and no separate points, so no dot is drawn twice.
 * Isolates (Basque, Saami, Sardinian ...) are left off: their DNA has drifted from their neighbours' (the card says so).
 *
 * The window: the frame's full width and the latitudes of the dots plus BAND_PAD (bandView). The Europe frame runs to 72 N and no
 * group lives north of 60.4 N, so showing all of it would spend more than a quarter of the card's map height on empty Arctic sea
 * and draw the dots and labels that much smaller (this is a height-limited picture). The window is cut from the dots alone, never
 * from the labels, which are placed inside it, so a card has the same shape and size with the map labelled or not. It is widened
 * (never narrowed) just enough to keep a dot whole: the fit puts the North Spanish dot on the frame's western edge.
 */
export function specA1(data: WorkshopData, confirmed: readonly string[] = A1_CONFIRMED_LABELS): MapSpec {
  const c = projectionOf('europe');
  const pops = (data.europe_pops ?? []).filter((p) => !p.isolate);
  // map_x = (lon - lon0) cos(lat0) and map_y = lat (spec §6), so the DNA place in degrees is exact.
  const genetic = (p: { map_x: number; map_y: number }): LatLon => ({ lat: p.map_y, lon: c.lon0 + p.map_x / c.cosLat0 });
  const links: MapLink[] = pops.map((p) => ({ from: { lat: p.lat, lon: p.lon }, to: { ux: p.map_x, uy: p.map_y } }));
  const dots: MapSpec = { id: 'A1', frame: 'europe', links };
  const view = a1View(dots);
  // Labels sit at the DNA dot (the dot placed by DNA, as in Novembre et al. 2008), clear of every true and DNA dot.
  const named = pops.filter((p) => p.map_label && confirmed.includes(p.label));
  const obstacles = pops.flatMap((p) => [{ at: { lat: p.lat, lon: p.lon }, r: A1_DOT_R }, { at: genetic(p), r: A1_DOT_R }]);
  const texts = placeLabels('europe', named.map((p) => ({ at: genetic(p), text: p.label, r: A1_DOT_R })), obstacles, { within: view, fontPx: A1_LABEL_PX });
  return { ...dots, view, texts, labelPx: A1_LABEL_PX };
}

/** bandView of the dots, widened on either side only as far as a dot needs. */
function a1View(dots: MapSpec): MapView {
  const band = bandView(dots.frame, dots);
  const box = drawingBox(dots);
  if (box === null) return band;
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  const left = Math.min(band.x, Math.floor(box.left * 10) / 10);
  const right = Math.max(band.x + band.width, Math.ceil(box.right * 10) / 10);
  return { ...band, x: left, width: r1(right - left) };
}

/** The map for a card (CONTRACT §4.13). Throws for a map whose spec is not built yet (see MAP_SPECS_BUILT). */
export function mapSpec(id: MapId, data: WorkshopData): MapSpec {
  switch (id) {
    case 'A1':
      return specA1(data);
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

/** True when the map's spec is built and the data it needs is present (A1 needs europe_pops and europe_fit: its source line is
 *  never drawn without the fit). */
export function mapDataReady(id: MapId, data: WorkshopData): boolean {
  if (!MAP_SPECS_BUILT.has(id)) return false;
  if (id === 'A1') return (data.europe_pops?.length ?? 0) > 0 && data.europe_fit !== undefined;
  return true;
}
