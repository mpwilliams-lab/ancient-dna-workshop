// Per-card map specs (spec §6). Every label string comes from content.ts (MAP_TEXT, TRAIT_MAP_LABELS) or from the
// JSON (europe_pops[].label), so the content scan covers it. Coordinates are lat/lon; src/plots/map.ts projects them.
import { DISTRIBUTION_SCALE_MAX, distributionRows } from './cards';
import { MAP_TEXT } from './content';
import {
  MAP_FRAMES, MAP_LABEL_FONT_PX, MAP_VIEW, arrowReach, catmullRomSegments, dotRadius, makeProjection, project, projectUnits,
  type CurveSegment, type LatLon, type MapFrameId, type MapLink, type MapPoint, type MapProjectionConstants, type MapSpec, type MapText,
  type MapView, type XY,
} from './plots/map';
import type { GeneId, MapId, WorkshopData } from './types';

/** The font size renderMap gives a MapText (one constant, defined in src/plots/map.ts by Task 19; CONTRACT §8 R5) and the
 *  average character width in em: the estimate used to place labels and to test that they never overlap. */
export { MAP_LABEL_FONT_PX };
export const MAP_LABEL_CHAR_EM = 0.58;

/** Maps whose spec exists. A card is upgraded to its map only if its id is here (assets.ts cardShowsUpgrade), so an
 *  unbuilt map is never drawn, whatever the flags. Tasks 27 and 29 add their ids. */
export const MAP_SPECS_BUILT: ReadonlySet<MapId> = new Set<MapId>(['A1', 'D1', 'E1', 'G1', 'H2', 'I2', 'J3']);

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

/** The smallest box that holds every arrow (curve, stroke and arrowhead), both ends of every link (a dot of radius A1_DOT_R), every
 *  value dot (its radius and the unit its stroke reaches beyond it) and every text label of a spec, in viewBox units; null when it draws
 *  none of them. Text is the estimate of labelBox. */
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
  for (const p of spec.points ?? []) {
    if (p.value === undefined || (p.role ?? 'value') !== 'value') continue;
    const q = project(c, p.lat, p.lon);
    const r = dotRadius(p.value, spec.scaleMax ?? 100) + 1;
    boxes.push({ left: q.x - r, right: q.x + r, top: q.y - r, bottom: q.y + r });
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

// ---- Dot labels (Task 24): a clear place for every label of a map of numbered dots, or none ----

/** Air kept between a label and any dot or other label, in map units. */
const DOT_LABEL_AIR = 2;
/** A label is at least this much nearer to its own dot than to any other, so nobody can read it as another dot's number. */
const OWN_DOT_MARGIN = 5;
/** The search stops after this many tries and keeps the best clear layout it has found (null if it has found none). */
const DOT_LABEL_SEARCH_LIMIT = 400_000;
/** Where a label may sit round its dot, as a direction (x to the right, y down) and what it costs: beside the dot first, then slanting
 *  above or below it, then straight above or below. */
const DOT_LABEL_DIRECTIONS: readonly (readonly [ux: number, uy: number, cost: number])[] = [
  [1, 0, 0], [-1, 0, 1], [0.9239, -0.3827, 1.5], [0.9239, 0.3827, 1.8], [-0.9239, -0.3827, 2.5], [-0.9239, 0.3827, 2.8],
  [0.7071, -0.7071, 2], [0.7071, 0.7071, 2.5], [-0.7071, -0.7071, 3], [-0.7071, 0.7071, 3.5],
  [0, -1, 3], [0, 1, 3.5], [0.3827, -0.9239, 3], [-0.3827, -0.9239, 3.5], [0.3827, 0.9239, 3.2], [-0.3827, 0.9239, 3.8],
];
/** How much farther than its nearest clear place a label may sit, in map units, each step costing more. */
const DOT_LABEL_STEPS: readonly number[] = [0, 6, 14, 24];
/** The placer keeps clear of a word this much wider than labelBox's estimate (0.58 em a character, measured at 0.9 to 1.0 of it in the
 *  browsers the project has; Segoe UI on the lab machine is not measured), so a font that draws wider still leaves the words apart. */
export const DOT_LABEL_WIDTH_FACTOR = 1.08;

function distanceToBox(x: number, y: number, b: LabelBox): number {
  return Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
}

interface DotLabelPlace { text: MapText; box: LabelBox; cost: number }

/**
 * Every place the label of item i may take: round its dot in the 16 directions, at the nearest distance where the box clears the dot
 * and at the next steps, inside the room, covering no dot (its own included), and with no other dot as near to it as its own is.
 * Cheapest first. A label to the right of its dot's centre line is anchored at its left edge, one to the left at its right edge, so its
 * gap to the dot does not change with how wide the text really draws; one above or below is centred.
 */
function dotLabelPlaces(
  frame: MapFrameId, c: MapProjectionConstants, items: readonly LabelItem[], i: number, fontPx: number, room: MapView,
): DotLabelPlace[] {
  const it = items[i]!;
  const centres = items.map((o) => project(c, o.at.lat, o.at.lon));
  const p = centres[i]!;
  const w = it.text.length * MAP_LABEL_CHAR_EM * fontPx * DOT_LABEL_WIDTH_FACTOR;
  const h = 1.05 * fontPx;     // labelBox: 0.8 em above the baseline, 0.25 em below it
  const out: DotLabelPlace[] = [];
  for (const [ux, uy, direction] of DOT_LABEL_DIRECTIONS) {
    const boxAt = (rho: number): LabelBox => {
      const x = p.x + rho * ux;
      const y = p.y + rho * uy;
      return { left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 };
    };
    let rho = 0;
    while (rho < 1000 && distanceToBox(p.x, p.y, boxAt(rho)) < it.r + DOT_LABEL_AIR) rho += 1;
    for (const extra of DOT_LABEL_STEPS) {
      const box = boxAt(rho + extra);
      if (box.left < room.x || box.right > room.x + room.width || box.top < room.y || box.bottom > room.y + room.height) continue;
      if (centres.some((q, k) => distanceToBox(q.x, q.y, box) < items[k]!.r + DOT_LABEL_AIR)) continue;
      const own = distanceToBox(p.x, p.y, box);
      if (centres.some((q, k) => k !== i && distanceToBox(q.x, q.y, box) < own + OWN_DOT_MARGIN)) continue;
      const anchor: Anchor = box.left >= p.x ? 'start' : box.right <= p.x ? 'end' : 'middle';
      const x = anchor === 'start' ? box.left : anchor === 'end' ? box.right : (box.left + box.right) / 2;
      out.push({
        text: labelAt(frame, it.at, it.text, anchor, x - p.x, box.top + 0.8 * fontPx - p.y), box, cost: 2 * direction + extra / 2,
      });
    }
  }
  return out.sort((a, b) => a.cost - b.cost);
}

/**
 * The labels of a map of numbered dots, in input order, laid out so that all of these hold: every label lies inside `room`; no label
 * overlaps another or covers a dot; each label is nearer to its own dot than to any other. Null when no such layout exists (or none was
 * found in DOT_LABEL_SEARCH_LIMIT tries): the caller decides what to draw then. Unlike placeLabels, which takes the first cheapest
 * place for each dot in turn and may leave a label on another dot's number, this searches: dots with the fewest places first, each
 * place tried cheapest first, backing out of a choice that leaves a later dot nowhere to go, and keeping the cheapest layout found.
 * Deterministic. Item `r` is the dot's drawn radius, its stroke included.
 */
export function placeDotLabels(frame: MapFrameId, items: readonly LabelItem[], room: MapView, fontPx: number): MapText[] | null {
  const c = projectionOf(frame);
  const places = items.map((_, i) => dotLabelPlaces(frame, c, items, i, fontPx, room));
  if (places.some((p) => p.length === 0)) return null;
  const order = items.map((_, i) => i).sort((a, b) => places[a]!.length - places[b]!.length || items[b]!.r - items[a]!.r || a - b);
  const chosen: DotLabelPlace[] = [];
  const best: { cost: number; picks: DotLabelPlace[] } = { cost: Infinity, picks: [] };
  let tries = 0;
  const search = (depth: number, cost: number): void => {
    if (depth === order.length) {
      best.cost = cost;
      best.picks = chosen.slice();
      return;
    }
    const i = order[depth]!;
    for (const place of places[i]!) {
      if (++tries > DOT_LABEL_SEARCH_LIMIT) return;
      if (cost + place.cost >= best.cost) break;    // the rest of this dot's places cost more still
      const b = place.box;
      let clash = false;
      for (let q = 0; q < depth && !clash; q++) {
        const o = chosen[q]!.box;
        clash = Math.min(b.right, o.right) - Math.max(b.left, o.left) > -DOT_LABEL_AIR
          && Math.min(b.bottom, o.bottom) - Math.max(b.top, o.top) > -DOT_LABEL_AIR;
      }
      if (clash) continue;
      chosen[depth] = place;
      search(depth + 1, cost + place.cost);
    }
  };
  search(0, 0);
  if (best.cost === Infinity) return null;
  const texts: MapText[] = new Array<MapText>(items.length);
  order.forEach((i, depth) => {
    texts[i] = best.picks[depth]!.text;
  });
  return texts;
}

// ---- Distribution maps (spec §3.4, §6): dots sized by copies in every 100, labelled "<place> <copies>" ----
export type DistributionMapId = 'H2' | 'I2' | 'J3' | 'K2' | 'L3';
export const DISTRIBUTION_MAP_GENE: Readonly<Record<DistributionMapId, GeneId>> = {
  H2: 'LCT', I2: 'SLC45A2', J3: 'HERC2', K2: 'TYK2', L3: 'HLA-DQ2',
};
export const DISTRIBUTION_MAP_FRAME: Readonly<Record<DistributionMapId, MapFrameId>> = {
  H2: 'europe', I2: 'oldWorld', J3: 'oldWorld', K2: 'oldWorld', L3: 'europeWest',
};
/**
 * The size of each distribution map's labels in map units (the arrow maps use MAP_LABEL_FONT_PX = 20; A1 uses A1_LABEL_PX). These
 * pictures are drawn small on a card: the window is cut to the dots and their labels, and at 1366 x 768 the card leaves it about 300 px,
 * so 20 units would be 11 px (H2, whose window is the tallest) to 13 px. H2's 26 and the others' 24 give 14.4 to 16 px there, the least
 * that e2e/maps.spec.ts accepts (14); 26 is about the most the twenty labels of H2 can have and still all lie clear of each other and of
 * the dots (28 cannot be laid out). Task 27 sets K2 and L3 when it builds them.
 */
export const DISTRIBUTION_LABEL_PX: Readonly<Record<DistributionMapId, number>> = { H2: 26, I2: 24, J3: 24, K2: 24, L3: 24 };
const isDistributionMap = (id: MapId): id is DistributionMapId => id in DISTRIBUTION_MAP_GENE;
const hasCoordinates = (r: { lat?: number; lon?: number }): boolean => r.lat !== undefined && r.lon !== undefined;

/** How far a label may hang out of the frame's box to the west or east: Ireland and Portugal (H2) and Spain (I2, J3) sit near the
 *  frame's west edge, and a label placed beside them runs off it. The window is cut round the labels, so nothing is cut off. */
const LABEL_OVERHANG = 150;
/** Room above and below the outermost dots, in em of the label size, in which a label may sit. */
const LABEL_HEADROOM_EM = 2.5;

/** The window a distribution map shows: its drawing (dots and labels) plus BAND_PAD, inside the frame vertically, and no thinner than
 *  BAND_MAX_ASPECT (a thinner drawing gets more of the frame above and below it, as bandView does). */
function dotMapView(frame: MapFrameId, box: LabelBox): MapView {
  const f = frameBox(frame);
  const left = Math.max(0, Math.floor((box.left - BAND_PAD) * 10) / 10);
  const right = Math.min(MAP_VIEW.width, Math.ceil((box.right + BAND_PAD) * 10) / 10);
  let top = Math.max(f.top, box.top - BAND_PAD);
  let bottom = Math.min(f.bottom, box.bottom + BAND_PAD);
  const more = (right - left) / BAND_MAX_ASPECT - (bottom - top);
  if (more > 0) {
    top -= more / 2;
    bottom += more / 2;
    if (top < f.top) [top, bottom] = [f.top, bottom + (f.top - top)];
    if (bottom > f.bottom) [top, bottom] = [Math.max(f.top, top - (bottom - f.bottom)), f.bottom];
  }
  top = Math.ceil(top * 10) / 10;
  bottom = Math.floor(bottom * 10) / 10;
  return { x: left, y: top, width: Math.round((right - left) * 10) / 10, height: Math.round((bottom - top) * 10) / 10 };
}

/**
 * H2, I2, J3 (and K2, L3 once Task 27 builds them): one dot for every row of trait_maps[gene] that has coordinates, drawn from the rows
 * distributionRows gives, in its order (biggest first, so a small dot is never hidden under a big one), so the spec never depends on the
 * order of the rows in the JSON. A dot's value is the row's `value` x 100, copies in every 100 (not rounded, and never taken from
 * allele_count), on the gene's scale (DISTRIBUTION_SCALE_MAX). Its label is "<place> <number>", the number the value list prints. Rows
 * without coordinates (the gnomAD groups) are not drawn: they are the side list the card shows beside the picture.
 *
 * The labels are placed by placeDotLabels (no label over another label or a dot, each nearest its own dot); the window is cut to what
 * is drawn. If no clear layout exists this returns the greedy placeLabels' instead, so it never throws, but mapDataReady says no for
 * such data (Task 26): a card does not draw a map whose numbers overlap, it keeps its value bars. The tests on the shipped data say
 * the case does not occur there (tests/maps.test.ts on the fixture, REAL_DATA on the real rows, e2e/maps.spec.ts in the browser).
 */
export function distributionSpec(id: DistributionMapId, data: WorkshopData): MapSpec {
  return distributionLayout(id, data).spec;
}

/** A distribution map's spec and whether its labels are laid out clear: placeDotLabels found a place for every one (false for a map with
 *  no row that has coordinates, and for one that only the greedy placer could label). */
function distributionLayout(id: DistributionMapId, data: WorkshopData): { spec: MapSpec; clear: boolean } {
  const gene = DISTRIBUTION_MAP_GENE[id];
  const frame = DISTRIBUTION_MAP_FRAME[id];
  const scaleMax = DISTRIBUTION_SCALE_MAX[gene];
  const labelPx = DISTRIBUTION_LABEL_PX[id];
  const freq = new Map((data.trait_maps?.[gene] ?? []).map((r) => [r.label_key, r.value]));
  const rows = distributionRows(data, gene);
  const placed = rows.filter(hasCoordinates);
  const points: MapPoint[] = placed.map((r) => ({
    lat: r.lat as number, lon: r.lon as number, value: (freq.get(r.key) ?? 0) * 100, role: 'value',
  }));
  const sideList = rows.filter((r) => !hasCoordinates(r)).map((r) => ({ label: r.label, display: r.display }));
  const base: MapSpec = { id, frame, points, texts: [], scaleMax, labelPx, ...(sideList.length > 0 ? { sideList } : {}) };
  if (placed.length === 0) return { spec: base, clear: false };

  const c = projectionOf(frame);
  const f = frameBox(frame);
  const items: LabelItem[] = placed.map((r, i) => ({
    at: { lat: r.lat as number, lon: r.lon as number }, text: `${r.label} ${r.display}`, r: dotRadius(points[i]!.value as number, scaleMax) + 1,
  }));
  const ys = items.map((it) => project(c, it.at.lat, it.at.lon).y);
  const headroom = LABEL_HEADROOM_EM * labelPx;
  const top = Math.max(f.top, Math.min(...ys) - headroom);
  const bottom = Math.min(f.bottom, Math.max(...ys) + headroom);
  const left = Math.max(0, f.left - LABEL_OVERHANG);
  const right = Math.min(MAP_VIEW.width, f.right + LABEL_OVERHANG);
  const room: MapView = { x: left, y: top, width: right - left, height: bottom - top };
  const found = placeDotLabels(frame, items, room, labelPx);
  const texts = found ?? placeLabels(frame, items, [], { within: room, fontPx: labelPx });
  const spec: MapSpec = { ...base, texts };
  return { spec: { ...spec, view: dotMapView(frame, drawingBox(spec) as LabelBox) }, clear: found !== null };
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
    case 'H2':
    case 'I2':
    case 'J3':
      return distributionSpec(id, data);
    default:
      throw new Error(`mapSpec: map ${id} is not built yet`);
  }
}

/** True when the map's spec is built and the data it needs is present (A1 needs europe_pops and europe_fit: its source line is
 *  never drawn without the fit; a distribution map needs at least one row with coordinates AND a clear place for every one of its
 *  labels, Task 26: otherwise the card keeps its value bars, which say the same numbers without overlapping). */
export function mapDataReady(id: MapId, data: WorkshopData): boolean {
  if (!MAP_SPECS_BUILT.has(id)) return false;
  if (id === 'A1') return (data.europe_pops?.length ?? 0) > 0 && data.europe_fit !== undefined;
  if (isDistributionMap(id)) return distributionLayout(id, data).clear;
  return true;
}
