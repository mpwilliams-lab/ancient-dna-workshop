// @vitest-environment jsdom
// Spec §6 map specs (Task 20: D1, E1, G1; Task 23: A1; Task 24: H2, I2, J3). Task 27 appends its own describe blocks to this file.
import { describe, expect, it } from 'vitest';
import { DISTRIBUTION_SCALE_MAX, distributionRows } from '../src/cards';
import { MAP_TEXT } from '../src/content';
import {
  A1_CONFIRMED_LABELS, A1_DOT_R, A1_LABEL_PX, BAND_MAX_ASPECT, BAND_PAD, DISTRIBUTION_LABEL_PX, DISTRIBUTION_MAP_FRAME,
  DISTRIBUTION_MAP_GENE, DOT_LABEL_WIDTH_FACTOR, bandView, distributionSpec, drawingBox, frameBox, labelAt, labelBox, MAP_LABEL_FONT_PX,
  MAP_SPECS_BUILT, mapDataReady, mapSpec, placeDotLabels, placeLabels, specA1, type LabelBox,
} from '../src/maps';
import {
  ARROW_WIDTH, MAP_FRAMES, MAP_VIEW, WIDE_ARROW_WIDTH, arrowReach, catmullRomSegments, dotRadius, makeProjection, project, projectUnits,
  renderMap, type LatLon, type MapSpec, type MapView, type XY,
} from '../src/plots/map';
import { SVG_NS } from '../src/plots/svg';
import type { EuropePop } from '../src/types';
import { FIXTURE, cloneFixture } from './fixtures/fixture';
import { ruleViolations } from './contentRules';
import { labelLayoutViolations, layoutViolations, specDots } from './helpers/mapLayout';
import { mulberry32 } from './helpers/rng';

const ll = (lat: number, lon: number): LatLon => ({ lat, lon });

/** Spec §6 waypoints, copied independently of src/maps.ts. */
const D1_MAIN = [ll(47.5, 38.0), ll(50.5, 21.0), ll(51.4, 11.7), ll(52.7, 5.0), ll(51.17, -1.78)];
const D1_IDEA = [ll(38.7, -9.1), ll(52.0, 5.5)];
const E1_MAIN = [ll(48.7, 6.2), ll(50.73, 1.61), ll(51.33, 1.37)];
const G1_MAIN = [
  [ll(53.6, 8.9), ll(53.5, 4.0), ll(52.9, 0.6), ll(52.41, 0.52)],
  [ll(54.65, 9.8), ll(55.0, 3.0), ll(53.7, -0.3), ll(54.17, -0.6)],
  [ll(55.7, 9.0), ll(53.0, 3.5), ll(51.5, 1.2), ll(51.25, 1.31)],
  [ll(53.2, 5.8), ll(52.8, 3.0), ll(52.9, 0.3), ll(52.2, 0.1)],
];
const G1_FRANCE = [ll(48.85, 2.35), ll(50.73, 1.61), ll(51.13, 1.31)];

/** Where each label belongs (spec §6 and §3): the point it must sit next to. */
const LABEL_HOME: Record<'D1' | 'E1' | 'G1', Record<string, LatLon>> = {
  D1: {
    "Steppe herders' homeland": D1_MAIN[0],
    'Corded Ware people': D1_MAIN[2],
    'Bell Beaker people': D1_MAIN[3],
    Britain: D1_MAIN[4],
    'Pot style probably spread from here, mostly as an idea': D1_IDEA[0],
  },
  E1: {
    France: ll(48.0, 3.0),
    'Kent: earliest newcomers found here': ll(51.33, 1.37),
    'A few at a time over many generations': E1_MAIN[0],
    'Scotland: almost no change': ll(57.0, -4.5),
  },
  G1: {
    'Northern Germany': G1_MAIN[0][0],
    Netherlands: G1_MAIN[3][0],
    Denmark: G1_MAIN[2][0],
    'East Anglia': G1_MAIN[0][3],
    Yorkshire: G1_MAIN[1][3],
    Kent: G1_MAIN[2][3],
    'From France: a smaller share': G1_FRANCE[0],
  },
};

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
}

/** Every label inside the viewBox, no two labels overlapping (estimate at MAP_LABEL_FONT_PX). */
function expectLabelsLaidOut(spec: MapSpec): void {
  const c = makeProjection(MAP_FRAMES[spec.frame]);
  const boxes = (spec.texts ?? []).map((t) => ({ t: t.text, b: labelBox(c, t) }));
  for (const { t, b } of boxes) {
    expect(b.left, `${spec.id} "${t}" left`).toBeGreaterThanOrEqual(0);
    expect(b.right, `${spec.id} "${t}" right`).toBeLessThanOrEqual(MAP_VIEW.width);
    expect(b.top, `${spec.id} "${t}" top`).toBeGreaterThanOrEqual(0);
    expect(b.bottom, `${spec.id} "${t}" bottom`).toBeLessThanOrEqual(MAP_VIEW.height);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(overlaps(boxes[i].b, boxes[j].b), `${spec.id}: "${boxes[i].t}" overlaps "${boxes[j].t}"`).toBe(false);
    }
  }
}

function rendered(spec: MapSpec): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  renderMap(svg, spec);
  return svg;
}

describe('MAP_TEXT (spec §3.2, §3.3, §6 verbatim)', () => {
  it('holds the exact label strings', () => {
    expect(MAP_TEXT.D1).toEqual([
      "Steppe herders' homeland", 'Corded Ware people', 'Bell Beaker people', 'Britain',
      'Pot style probably spread from here, mostly as an idea',
    ]);
    expect(MAP_TEXT.E1).toEqual([
      'France', 'Kent: earliest newcomers found here', 'A few at a time over many generations', 'Scotland: almost no change',
    ]);
    expect(MAP_TEXT.G1).toEqual([
      'Northern Germany', 'Netherlands', 'Denmark', 'East Anglia', 'Yorkshire', 'Kent', 'From France: a smaller share',
    ]);
    expect(MAP_TEXT.F1inset).toEqual(['Newcomers found here', 'Countryside: mostly the same families']);
    for (const id of ['A1', 'H2', 'I2', 'J3', 'K2', 'L3'] as const) expect(MAP_TEXT[id]).toEqual([]);
  });
  it('every map label passes the content rules', () => {
    expect(Object.values(MAP_TEXT).flat().filter((s) => ruleViolations(s).length > 0)).toEqual([]);
  });
});

describe('labelAt', () => {
  it('puts the text exactly dx, dy px from its point on the projected map', () => {
    const c = makeProjection(MAP_FRAMES.europe);
    const at = ll(51.33, 1.37);
    const p = project(c, at.lat, at.lon);
    const t = labelAt('europe', at, 'x', 'start', 16, -9);
    const q = project(c, t.lat, t.lon);
    expect(q.x - p.x).toBeCloseTo(16, 9);
    expect(q.y - p.y).toBeCloseTo(-9, 9);
    expect(t.anchor).toBe('start');
  });
});

describe('labelBox', () => {
  it('measures a text at its anchor the way renderMap draws it: start, middle or end, and centred when it has no anchor', () => {
    const c = makeProjection(MAP_FRAMES.europe);
    const at = ll(50, 10);
    const p = project(c, at.lat, at.lon);
    const w = 'abcdefghij'.length * 0.58 * MAP_LABEL_FONT_PX;
    const box = (anchor?: 'start' | 'middle' | 'end'): LabelBox => labelBox(c, { ...at, text: 'abcdefghij', ...(anchor ? { anchor } : {}) });
    expect(box('start').left).toBeCloseTo(p.x, 9);
    expect(box('end').right).toBeCloseTo(p.x, 9);
    expect((box('middle').left + box('middle').right) / 2).toBeCloseTo(p.x, 9);
    expect(box()).toEqual(box('middle'));
    expect(box('start').right - box('start').left).toBeCloseTo(w, 9);
    // Baseline at the point: 0.8 em above it, 0.25 em below.
    expect(box('start').top).toBeCloseTo(p.y - 0.8 * MAP_LABEL_FONT_PX, 9);
    expect(box('start').bottom).toBeCloseTo(p.y + 0.25 * MAP_LABEL_FONT_PX, 9);
    // renderMap draws an anchorless text centred, so the estimate must agree.
    const svg = rendered({ id: 'D1', frame: 'europe', texts: [{ ...at, text: 'abcdefghij' }] });
    expect(svg.querySelector('text.map-label')!.getAttribute('text-anchor')).toBe('middle');
  });
});

describe('mapSpec D1, E1, G1 (spec §6)', () => {
  it('MAP_SPECS_BUILT has the three maps, and mapDataReady agrees', () => {
    for (const id of ['D1', 'E1', 'G1'] as const) {
      expect(MAP_SPECS_BUILT.has(id)).toBe(true);
      expect(mapDataReady(id, FIXTURE)).toBe(true);
    }
  });

  it('D1: one main arrow along the steppe route and one dashed idea arrow from Portugal, on the Europe frame', () => {
    const s = mapSpec('D1', FIXTURE);
    expect(s.id).toBe('D1');
    expect(s.frame).toBe('europe');
    expect(s.arrows).toEqual([
      { waypoints: D1_MAIN, style: 'main' },
      { waypoints: D1_IDEA, style: 'idea' },
    ]);
  });

  it('E1: one wide main arrow from France into Kent', () => {
    const s = mapSpec('E1', FIXTURE);
    expect(s.frame).toBe('europe');
    expect(s.arrows).toEqual([{ waypoints: E1_MAIN, style: 'main', wide: true }]);
  });

  it('G1: four main arrows across the North Sea and one thin dashed arrow from France', () => {
    const s = mapSpec('G1', FIXTURE);
    expect(s.frame).toBe('europe');
    expect(s.arrows).toEqual([
      ...G1_MAIN.map((waypoints) => ({ waypoints, style: 'main' as const })),
      { waypoints: G1_FRANCE, style: 'minor' as const, dashed: true },
    ]);
  });

  for (const id of ['D1', 'E1', 'G1'] as const) {
    it(`${id}: every MAP_TEXT label once, its text within 40 px of its spec point`, () => {
      const s = mapSpec(id, FIXTURE);
      const texts = s.texts ?? [];
      expect(texts.map((t) => t.text).sort()).toEqual([...MAP_TEXT[id]].sort());
      const c = makeProjection(MAP_FRAMES[s.frame]);
      for (const t of texts) {
        const home = LABEL_HOME[id][t.text];
        const a = project(c, home.lat, home.lon);
        // The distance from the point to the label's text box (a label anchored at its start or end sits beside its point
        // and runs away from it, so the anchor is no measure of how far the words are).
        const b = labelBox(c, t);
        const gap = Math.hypot(Math.max(b.left - a.x, 0, a.x - b.right), Math.max(b.top - a.y, 0, a.y - b.bottom));
        expect(gap, `${id} "${t.text}"`).toBeLessThanOrEqual(40);
      }
    });
    it(`${id}: labels stay inside the map and never overlap (estimate at ${MAP_LABEL_FONT_PX} px)`, () => {
      expectLabelsLaidOut(mapSpec(id, FIXTURE));
    });
    it(`${id}: renderMap draws every label`, () => {
      const svg = rendered(mapSpec(id, FIXTURE));
      for (const label of MAP_TEXT[id]) expect(svg.textContent).toContain(label);
    });
  }

  it('a map that is not built yet throws, and mapDataReady says no', () => {
    expect(() => mapSpec('F1inset', FIXTURE)).toThrow(/not built/);
    expect(mapDataReady('F1inset', FIXTURE)).toBe(false);
  });
});

describe('placeLabels', () => {
  it('returns one label per item in input order, inside the map, without overlaps', () => {
    const items = [
      { at: ll(53.3, -8), text: 'Ireland 96', r: 13.7 },
      { at: ll(53.2, -1.8), text: 'United Kingdom 75', r: 12.1 },
      { at: ll(52.4, 5.8), text: 'Netherlands 68', r: 11.5 },
      { at: ll(51.2, 12.4), text: 'Germany 52', r: 10.1 },
    ];
    const texts = placeLabels('europe', items);
    expect(texts.map((t) => t.text)).toEqual(items.map((i) => i.text));
    expectLabelsLaidOut({ id: 'H2', frame: 'europe', texts });
  });
  it('is deterministic', () => {
    const items = [{ at: ll(40.4, -3.7), text: 'Spain 82', r: 12.7 }, { at: ll(43.5, 11), text: 'Tuscany 97', r: 13.8 }];
    expect(placeLabels('oldWorld', items)).toEqual(placeLabels('oldWorld', items));
  });
});

// ---- Band views (Task 20): what a card shows of its frame ----

function bezierAt(s: { from: XY; c1: XY; c2: XY; to: XY }, t: number): XY {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: a * s.from.x + b * s.c1.x + c * s.c2.x + d * s.to.x, y: a * s.from.y + b * s.c1.y + c * s.c2.y + d * s.to.y };
}

/** Points along every arrow of a spec, each with the half stroke the arrow paints around it (viewBox units). Independent of src/maps.ts. */
function arrowDiscs(spec: MapSpec): { x: number; y: number; r: number }[] {
  const c = makeProjection(MAP_FRAMES[spec.frame]);
  return (spec.arrows ?? []).flatMap((a) => {
    const r = (a.wide ? WIDE_ARROW_WIDTH : ARROW_WIDTH[a.style]) / 2;
    const pts = a.waypoints.map((w) => project(c, w.lat, w.lon));
    return catmullRomSegments(pts).flatMap((s) => Array.from({ length: 41 }, (_, i) => ({ ...bezierAt(s, i / 40), r })));
  });
}

describe('bandView and drawingBox', () => {
  it('arrowReach is half the arrowhead: 8 for a main arrow, 10.8 for the wide one, 4 for a minor or idea arrow', () => {
    expect(arrowReach({ waypoints: [], style: 'main' })).toBeCloseTo(8, 9);
    expect(arrowReach({ waypoints: [], style: 'main', wide: true })).toBeCloseTo(10.8, 9);
    expect(arrowReach({ waypoints: [], style: 'minor', dashed: true })).toBeCloseTo(4, 9);
    expect(arrowReach({ waypoints: [], style: 'idea' })).toBeCloseTo(4, 9);
  });

  it('drawingBox holds every arrow curve with its arrowhead and every label, and is null for an empty drawing', () => {
    expect(drawingBox({ id: 'D1', frame: 'europe' })).toBeNull();
    const c = makeProjection(MAP_FRAMES.europe);
    for (const id of ['D1', 'E1', 'G1'] as const) {
      const s = mapSpec(id, FIXTURE);
      const box = drawingBox(s)!;
      for (const d of arrowDiscs(s)) {
        expect(d.x - d.r, `${id} arrow left`).toBeGreaterThanOrEqual(box.left - 1e-6);
        expect(d.x + d.r, `${id} arrow right`).toBeLessThanOrEqual(box.right + 1e-6);
        expect(d.y - d.r, `${id} arrow top`).toBeGreaterThanOrEqual(box.top - 1e-6);
        expect(d.y + d.r, `${id} arrow bottom`).toBeLessThanOrEqual(box.bottom + 1e-6);
      }
      for (const t of s.texts ?? []) {
        const b = labelBox(c, t);
        expect([b.left >= box.left, b.right <= box.right, b.top >= box.top, b.bottom <= box.bottom], `${id} "${t.text}"`).toEqual([true, true, true, true]);
      }
    }
  });

  it('a band takes the frame\'s full width, rounded inwards, and the latitudes of the drawing plus the pad', () => {
    const f = frameBox('europe');
    const s: MapSpec = { id: 'D1', frame: 'europe', texts: [{ lat: 50, lon: 10, text: 'x', anchor: 'middle' }] };
    const box = drawingBox(s)!;
    const v = bandView('europe', s, 20, 100);   // an aspect limit nothing reaches: the pad alone decides
    expect(v.x).toBeGreaterThanOrEqual(f.left);
    expect(v.x).toBeLessThan(f.left + 0.1);
    expect(v.x + v.width).toBeLessThanOrEqual(f.right);
    expect(v.x + v.width).toBeGreaterThan(f.right - 0.1);
    expect(v.y).toBeGreaterThanOrEqual(box.top - 20);
    expect(v.y).toBeLessThan(box.top - 20 + 0.1);
    expect(v.y + v.height).toBeLessThanOrEqual(box.bottom + 20);
    expect(v.y + v.height).toBeGreaterThan(box.bottom + 20 - 0.1);
  });

  it('a drawing thinner than the aspect limit gets more of the frame above and below it, equally; the frame edge is never passed', () => {
    const f = frameBox('europe');
    const mid: MapSpec = { id: 'D1', frame: 'europe', texts: [{ lat: 50, lon: 10, text: 'x', anchor: 'middle' }] };
    const v = bandView('europe', mid);
    expect(v.width / v.height).toBeLessThanOrEqual(BAND_MAX_ASPECT + 0.01);
    expect(v.width / v.height).toBeGreaterThan(BAND_MAX_ASPECT - 0.05);
    const box = drawingBox(mid)!;
    expect(box.top - v.y).toBeCloseTo(v.y + v.height - box.bottom, 0);
    const top: MapSpec = { id: 'D1', frame: 'europe', texts: [{ lat: 71.5, lon: 10, text: 'x', anchor: 'middle' }] };
    const vt = bandView('europe', top);
    expect(vt.y).toBe(f.top);
    expect(vt.width / vt.height).toBeLessThanOrEqual(BAND_MAX_ASPECT + 0.01);
    const bottom: MapSpec = { id: 'D1', frame: 'europe', texts: [{ lat: 34.5, lon: 10, text: 'x', anchor: 'middle' }] };
    const vb = bandView('europe', bottom);
    expect(vb.y + vb.height).toBeLessThanOrEqual(f.bottom);
    expect(vb.y + vb.height).toBeGreaterThan(f.bottom - 0.1);
    expect(vb.width / vb.height).toBeLessThanOrEqual(BAND_MAX_ASPECT + 0.01);
  });

  it('an empty drawing, or one taller than the limit, shows the frame\'s own height', () => {
    expect(bandView('europe', { id: 'D1', frame: 'europe' })).toEqual({ x: 176.8, y: 0, width: 646.4, height: 700 });
  });

  for (const id of ['D1', 'E1', 'G1'] as const) {
    it(`${id}: the card shows a band inside its frame that holds every arrow and label with room to spare`, () => {
      const s = mapSpec(id, FIXTURE);
      const v = s.view!;
      const f = frameBox(s.frame);
      expect([v.x >= f.left, v.x + v.width <= f.right, v.y >= f.top, v.y + v.height <= f.bottom], `${id} inside the frame`).toEqual([true, true, true, true]);
      expect(v.width / v.height, `${id} aspect`).toBeLessThanOrEqual(BAND_MAX_ASPECT + 0.01);
      const box = drawingBox(s)!;
      expect(box.top - v.y, `${id} room above`).toBeGreaterThanOrEqual(Math.min(BAND_PAD, box.top - f.top) - 0.1);
      expect(v.y + v.height - box.bottom, `${id} room below`).toBeGreaterThanOrEqual(Math.min(BAND_PAD, f.bottom - box.bottom) - 0.1);
      expect(box.left, `${id} drawing left`).toBeGreaterThanOrEqual(v.x);
      expect(box.right, `${id} drawing right`).toBeLessThanOrEqual(v.x + v.width);
    });
  }
});

describe('the D1, E1 and G1 drawings (Task 20)', () => {
  for (const id of ['D1', 'E1', 'G1'] as const) {
    it(`${id}: every label sits inside the frame, so no part of one is cut off at the edge of the picture`, () => {
      const s = mapSpec(id, FIXTURE);
      const f = frameBox(s.frame);
      const c = makeProjection(MAP_FRAMES[s.frame]);
      for (const t of s.texts ?? []) {
        const b = labelBox(c, t);
        expect([b.left >= f.left, b.right <= f.right], `${id} "${t.text}" (${b.left.toFixed(1)}..${b.right.toFixed(1)} in ${f.left.toFixed(1)}..${f.right.toFixed(1)})`).toEqual([true, true]);
      }
    });
    it(`${id}: no arrow runs through a label (arrow stroke and 3 units of air against the label's box)`, () => {
      const s = mapSpec(id, FIXTURE);
      const c = makeProjection(MAP_FRAMES[s.frame]);
      const discs = arrowDiscs(s);
      for (const t of s.texts ?? []) {
        const b = labelBox(c, t);
        const hit = discs.find((d) => d.x + d.r + 3 > b.left && d.x - d.r - 3 < b.right && d.y + d.r + 3 > b.top && d.y - d.r - 3 < b.bottom);
        expect(hit, `${id} "${t.text}" is crossed by an arrow at ${hit ? `${hit.x.toFixed(0)}, ${hit.y.toFixed(0)}` : ''}`).toBeUndefined();
      }
    });
  }
});

// ---- A1: genes mirror geography (Task 23, spec §3.1, §6, §8; Novembre et al. 2008) ----

describe('mapSpec(A1): genes mirror geography (Task 23, spec §3.1, §6, §8)', () => {
  const pops = FIXTURE.europe_pops ?? [];
  const fitted = pops.filter((p) => !p.isolate);
  /** The eight groups the data build labels (open check 14), in europe_pops order: what A1_CONFIRMED_LABELS holds once he confirms. */
  const EIGHT = fitted.filter((p) => p.map_label).map((p) => p.label);
  const c = makeProjection(MAP_FRAMES.europe);
  const trueAt = (p: EuropePop): XY => project(c, p.lat, p.lon);
  const geneticAt = (p: EuropePop): XY => project(c, p.map_y, c.lon0 + p.map_x / c.cosLat0);
  /** Both ends of every link: the 52 dots, as discs of the radius the label placer keeps clear. */
  const discs = (): LabelBox[] => fitted.flatMap((p) => [trueAt(p), geneticAt(p)]).map((d) => ({ left: d.x - A1_DOT_R, right: d.x + A1_DOT_R, top: d.y - A1_DOT_R, bottom: d.y + A1_DOT_R }));
  const within = (b: LabelBox, v: MapView): boolean => b.left >= v.x && b.right <= v.x + v.width && b.top >= v.y && b.bottom <= v.y + v.height;

  it('the fixture carries the 35 populations, 26 non-isolates and 8 map labels', () => {
    expect(pops).toHaveLength(35);
    expect(fitted).toHaveLength(26);
    expect(pops.filter((p) => p.map_label)).toHaveLength(8);
    expect(pops.filter((p) => p.map_label && p.isolate)).toHaveLength(0);
    expect(FIXTURE.europe_fit?.n_pops).toBe(26);
    expect(FIXTURE.europe_fit?.n_people).toBe(fitted.reduce((s, p) => s + p.n, 0));
  });

  it('one 1 px link per non-isolate population (isolates left off), on the Europe frame, no separate points', () => {
    const s = mapSpec('A1', FIXTURE);
    expect(s.id).toBe('A1');
    expect(s.frame).toBe('europe');
    expect(s.points ?? []).toHaveLength(0);
    expect(s.arrows ?? []).toHaveLength(0);
    expect(s.links).toEqual(fitted.map((p) => ({ from: { lat: p.lat, lon: p.lon }, to: { ux: p.map_x, uy: p.map_y } })));
    for (const iso of pops.filter((p) => p.isolate)) {
      expect(s.links!.some((l) => l.from.lat === iso.lat && l.from.lon === iso.lon), `${iso.label} is left off`).toBe(false);
    }
  });

  it('labels only map_label groups whose names are confirmed (open check 14); none before that', () => {
    const s = mapSpec('A1', FIXTURE);
    const expected = fitted.filter((p) => p.map_label && A1_CONFIRMED_LABELS.includes(p.label)).map((p) => p.label);
    expect((s.texts ?? []).map((t) => t.text)).toEqual(expected);
    if (A1_CONFIRMED_LABELS.length > 0) expect(expected).toHaveLength(8);
  });

  it('the confirmation list is the only switch, and a name unlocks its group only if the data build chose it for a label', () => {
    expect(EIGHT).toEqual(['Estonian', 'Lithuanian', 'Czech', 'Hungarian', 'Romanian', 'Serbian', 'South Italian', 'Sicilian']);
    expect(specA1(FIXTURE, []).texts).toEqual([]);
    expect((specA1(FIXTURE, EIGHT).texts ?? []).map((t) => t.text)).toEqual(EIGHT);
    expect((specA1(FIXTURE, ['Czech']).texts ?? []).map((t) => t.text)).toEqual(['Czech']);
    // A fitted group the build did not choose, an isolate and a name the data does not have stay unlabelled, confirmed or not.
    expect(specA1(FIXTURE, ['Spanish', 'Basque', 'Saami', 'Atlantis']).texts).toEqual([]);
    // The list says which names are confirmed; it never reorders or repeats a label.
    expect((specA1(FIXTURE, [...EIGHT].reverse().concat(EIGHT)).texts ?? []).map((t) => t.text)).toEqual(EIGHT);
  });

  it('a label sits next to its genetic dot (the lat/lon conversion agrees with projectUnits)', () => {
    const s = specA1(FIXTURE, EIGHT);
    expect(s.texts).toHaveLength(8);
    for (const t of s.texts ?? []) {
      const p = fitted.find((q) => q.label === t.text)!;
      const dot = projectUnits(c, p.map_x, p.map_y);
      const viaDegrees = geneticAt(p);
      expect(viaDegrees.x).toBeCloseTo(dot.x, 6);
      expect(viaDegrees.y).toBeCloseTo(dot.y, 6);
      // From the dot's centre to the label's text box (a label anchored at its start or end runs away from the dot).
      const b = labelBox(c, t, s.labelPx);
      const gap = Math.hypot(Math.max(b.left - dot.x, 0, dot.x - b.right), Math.max(b.top - dot.y, 0, dot.y - b.bottom));
      expect(gap, t.text).toBeLessThanOrEqual(A1_DOT_R + 8);
    }
  });

  it('with every candidate name confirmed, the 8 labels lie inside the window and overlap neither each other nor any dot centre', () => {
    const s = specA1(FIXTURE, EIGHT);
    const v = s.view!;
    const boxes = (s.texts ?? []).map((t) => ({ t: t.text, b: labelBox(c, t, s.labelPx) }));
    expect(boxes).toHaveLength(8);
    for (const { t, b } of boxes) expect(within(b, v), `${t} inside the window`).toBe(true);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i]!.b, boxes[j]!.b), `"${boxes[i]!.t}" overlaps "${boxes[j]!.t}"`).toBe(false);
      }
    }
    const centres = fitted.flatMap((p) => [trueAt(p), geneticAt(p)]);
    for (const { t, b } of boxes) {
      const hit = centres.find((d) => d.x > b.left && d.x < b.right && d.y > b.top && d.y < b.bottom);
      expect(hit, `"${t}" covers a dot's centre at ${hit ? `${hit.x.toFixed(0)}, ${hit.y.toFixed(0)}` : ''}`).toBeUndefined();
    }
  });

  it('every population label passes the content rules, and no group ID is drawn anywhere on the map', () => {
    expect(pops.map((p) => p.label).filter((l) => ruleViolations(l).length > 0)).toEqual([]);
    const html = rendered(specA1(FIXTURE, EIGHT)).outerHTML;
    for (const p of pops.filter((q) => q.id !== q.label)) expect(html, p.id).not.toContain(p.id);
    expect(pops.filter((p) => p.id !== p.label).length, 'the check above would be empty').toBeGreaterThan(5);
  });

  it('A1 is built, and needs europe_pops and europe_fit', () => {
    expect(MAP_SPECS_BUILT.has('A1')).toBe(true);
    expect(mapDataReady('A1', FIXTURE)).toBe(true);
    const noPops = structuredClone(FIXTURE);
    delete noPops.europe_pops;
    expect(mapDataReady('A1', noPops)).toBe(false);
    const noFit = structuredClone(FIXTURE);
    delete noFit.europe_fit;
    expect(mapDataReady('A1', noFit)).toBe(false);
    const empty = structuredClone(FIXTURE);
    empty.europe_pops = [];
    expect(mapDataReady('A1', empty)).toBe(false);
    const bare = structuredClone(FIXTURE);
    delete bare.europe_pops;
    delete bare.europe_fit;
    expect(mapDataReady('A1', bare)).toBe(false);
  });

  it('renderMap draws 26 links, each a grey dot at the true place, a blue dot at the DNA place and a 1 px line', () => {
    const svg = rendered(mapSpec('A1', FIXTURE));
    const links = [...svg.querySelectorAll('g.map-link')];
    expect(links).toHaveLength(26);
    for (const g of links) {
      expect(g.querySelectorAll('line')).toHaveLength(1);
      expect(g.querySelectorAll('circle.map-dot--true')).toHaveLength(1);
      expect(g.querySelectorAll('circle.map-dot--genetic')).toHaveLength(1);
      expect(g.querySelector('line')!.getAttribute('stroke-width')).toBe('1');
    }
    expect(svg.querySelectorAll('circle.map-dot--value, circle.map-dot--zero, path.map-arrow')).toHaveLength(0);
    // The window and the label placer keep A1_DOT_R clear round every dot: the renderer must not draw a dot bigger than that.
    for (const dot of svg.querySelectorAll('g.map-link circle')) expect(Number(dot.getAttribute('r'))).toBeLessThanOrEqual(A1_DOT_R);
  });

  it('the window holds all 52 dots whole and is cut from the frame\'s empty north, whatever the labels', () => {
    const s = specA1(FIXTURE, []);
    const v = s.view!;
    expect(v).toBeDefined();
    for (const d of discs()) expect(within(d, v), `dot at ${d.left + A1_DOT_R}, ${d.top + A1_DOT_R}`).toBe(true);
    const f = frameBox('europe');
    expect(v.y).toBeGreaterThanOrEqual(f.top);
    expect(v.y + v.height).toBeLessThanOrEqual(f.bottom);
    expect(v.height, 'a window onto the frame, not the whole frame').toBeLessThan(f.bottom - f.top);
    expect(v.y, 'the empty north (Lapland, the Arctic sea) is left out').toBeGreaterThan(f.top + 100);
    // The frame's full width (as bandView: rounded inwards to 0.1), widened (never narrowed) only where a dot would otherwise be cut off.
    expect(v.x).toBeLessThan(f.left + 0.1);
    expect(v.x + v.width).toBeGreaterThan(f.right - 0.1);
    expect(v.x).toBeGreaterThan(f.left - 2 * A1_DOT_R);
    expect(v.x + v.width).toBeLessThan(f.right + 2 * A1_DOT_R);
    // The room round the dots is BAND_PAD where the frame has it.
    const box = drawingBox(s)!;
    expect(box.top - v.y).toBeGreaterThanOrEqual(Math.min(BAND_PAD, box.top - f.top) - 0.1);
    expect(v.y + v.height - box.bottom).toBeGreaterThanOrEqual(Math.min(BAND_PAD, f.bottom - box.bottom) - 0.1);
    expect(v.width / v.height).toBeLessThanOrEqual(BAND_MAX_ASPECT);
    // The labels are placed inside this window; they never move it, so the card's layout is the same with or without them.
    expect(specA1(FIXTURE, EIGHT).view).toEqual(v);
    expect(mapSpec('A1', FIXTURE).view).toEqual(v);
  });

  it('drawingBox holds both ends of every link, with the dot radius', () => {
    const box = drawingBox(specA1(FIXTURE, []))!;
    for (const d of discs()) {
      expect(d.left).toBeGreaterThanOrEqual(box.left - 1e-6);
      expect(d.right).toBeLessThanOrEqual(box.right + 1e-6);
      expect(d.top).toBeGreaterThanOrEqual(box.top - 1e-6);
      expect(d.bottom).toBeLessThanOrEqual(box.bottom + 1e-6);
    }
    // ... and it is tight: some dot touches each side.
    const ds = discs();
    expect(Math.min(...ds.map((d) => d.left))).toBeCloseTo(box.left, 6);
    expect(Math.max(...ds.map((d) => d.right))).toBeCloseTo(box.right, 6);
    expect(Math.min(...ds.map((d) => d.top))).toBeCloseTo(box.top, 6);
    expect(Math.max(...ds.map((d) => d.bottom))).toBeCloseTo(box.bottom, 6);
  });

  it('placeLabels keeps every label inside the window it is given (default: the whole 1000 x 700 map space)', () => {
    const view: MapView = { x: 100, y: 100, width: 300, height: 200 };
    const at = (x: number, y: number): LatLon => ({ lat: c.latMax - (y - c.offY) / c.k, lon: c.lon0 + ((x - c.offX) / c.k + c.pxMin) / c.cosLat0 });
    const items = [{ at: at(385, 200), text: 'Edge', r: A1_DOT_R }];
    const free = placeLabels('europe', items);
    const bounded = placeLabels('europe', items, [], { within: view });
    expect(within(labelBox(c, free[0]!), view), 'unbounded, the label runs out of the window').toBe(false);
    expect(within(labelBox(c, bounded[0]!), view), 'bounded, it takes another side of its dot').toBe(true);
    expect(placeLabels('europe', items, [], {})).toEqual(free);
    expect(placeLabels('europe', items, [], { within: undefined })).toEqual(free);
  });

  it('placeLabels measures with the font size it is given: a word that fits beside its dot at 20 takes the other side at 30 when a neighbour is in the way', () => {
    const at = (x: number, y: number): LatLon => ({ lat: c.latMax - (y - c.offY) / c.k, lon: c.lon0 + ((x - c.offX) / c.k + c.pxMin) / c.cosLat0 });
    const items = [{ at: at(400, 300), text: 'Lithuanian', r: A1_DOT_R }];
    const obstacles = [{ at: at(560, 300), r: A1_DOT_R }];                       // 160 units to the right of the dot
    const neighbour: LabelBox = { left: 555, right: 565, top: 295, bottom: 305 };
    const placed = (fontPx: number): { anchor?: string; clear: boolean } => {
      const t = placeLabels('europe', items, obstacles, { fontPx })[0]!;
      return { anchor: t.anchor, clear: !overlaps(labelBox(c, t, fontPx), neighbour) };
    };
    expect(placed(20)).toEqual({ anchor: 'start', clear: true });                // 116 units wide: fits to the right of its dot
    expect(placed(30)).toEqual({ anchor: 'end', clear: true });                  // 174 wide: would cover the neighbour, so it goes left
    // The estimate itself scales with the font.
    const w = (fontPx: number): number => { const b = labelBox(c, placeLabels('europe', items, [], { fontPx })[0]!, fontPx); return b.right - b.left; };
    expect(w(30) / w(20)).toBeCloseTo(1.5, 6);
  });

  it('A1 labels are larger than the arrow maps\' (A1_LABEL_PX), so they stay readable in a picture drawn at about 0.65 on the card', () => {
    expect(A1_LABEL_PX).toBeGreaterThan(MAP_LABEL_FONT_PX);
    for (const s of [specA1(FIXTURE, []), specA1(FIXTURE, EIGHT), mapSpec('A1', FIXTURE)]) expect(s.labelPx).toBe(A1_LABEL_PX);
    const svg = rendered(specA1(FIXTURE, EIGHT));
    const texts = [...svg.querySelectorAll('text.map-label')];
    expect(texts).toHaveLength(8);
    for (const t of texts) expect(Number(t.getAttribute('font-size'))).toBe(A1_LABEL_PX);
    // The arrow maps are unchanged: no labelPx, the shared 20.
    for (const id of ['D1', 'E1', 'G1'] as const) {
      expect(mapSpec(id, FIXTURE).labelPx, id).toBeUndefined();
      for (const t of [...rendered(mapSpec(id, FIXTURE)).querySelectorAll('text.map-label')]) expect(Number(t.getAttribute('font-size')), id).toBe(MAP_LABEL_FONT_PX);
    }
  });
});

// ---- Distribution maps H2, I2, J3 (Task 24, spec §3.4, §6): dots sized by copies in every 100, labelled "<place> <copies>" ----

/** The slack the placer keeps for a font that draws wider than labelBox's estimate: every check below draws every word this much wider.
 *  A literal, not DOT_LABEL_WIDTH_FACTOR, so that lowering the constant fails the checks instead of loosening them. */
const WIDER = 1.08;

describe('placeDotLabels (Task 24): a clear place for every label, or none', () => {
  it('keeps at least 8% of slack for a font that draws wider than estimated (browsers measured so far: 0.9 to 1.0 of the estimate)', () => {
    expect(DOT_LABEL_WIDTH_FACTOR).toBeGreaterThanOrEqual(WIDER);
  });

  const c = makeProjection(MAP_FRAMES.europe);
  const at = (x: number, y: number): LatLon => ({ lat: c.latMax - (y - c.offY) / c.k, lon: c.lon0 + ((x - c.offX) / c.k + c.pxMin) / c.cosLat0 });
  const ROOM: MapView = { x: 100, y: 100, width: 800, height: 450 };
  type Item = { at: LatLon; text: string; r: number };
  const dotsOf = (items: readonly Item[]) => items.map((it) => ({ ...project(c, it.at.lat, it.at.lon), r: it.r }));
  const place = (items: readonly Item[], room: MapView = ROOM, fontPx = 20): ReturnType<typeof placeDotLabels> => placeDotLabels('europe', items, room, fontPx);
  /** Clear even when every word draws 8% wider than the estimate (the slack the placer keeps for a font wider than measured; pinned below). */
  const violations = (items: readonly Item[], texts: NonNullable<ReturnType<typeof placeDotLabels>>, room: MapView = ROOM, fontPx = 20): string[] =>
    labelLayoutViolations(c, room, fontPx, dotsOf(items), texts, WIDER);
  /** NW Europe on the Europe frame as H2 draws it: Ireland, the UK, the Netherlands, Germany and Poland, five dots in a row about 75 apart
   *  whose labels are two to three times as wide as the gaps. */
  const CHAIN: Item[] = [
    { at: at(222, 344), text: 'Ireland 96', r: 13.7 }, { at: at(292, 346), text: 'United Kingdom 75', r: 12.1 },
    { at: at(379, 361), text: 'Netherlands 68', r: 11.5 }, { at: at(454, 383), text: 'Germany 52', r: 10.1 }, { at: at(529, 370), text: 'Poland 37', r: 8.5 },
  ];

  it('two dots 40 apart: both labels are placed, in input order, clear of each other and of both dots', () => {
    const items: Item[] = [{ at: at(400, 300), text: 'Alpha 50', r: 12 }, { at: at(440, 300), text: 'Beta 40', r: 12 }];
    const texts = place(items)!;
    expect(texts).not.toBeNull();
    expect(texts.map((t) => t.text)).toEqual(['Alpha 50', 'Beta 40']);
    expect(violations(items, texts)).toEqual([]);
  });

  it('a row of five dots with labels wider than the gaps between them (the NW corner of H2): all five clear, at 20 and at 24', () => {
    const room: MapView = { x: 40, y: 150, width: 900, height: 400 };
    for (const fontPx of [20, 24]) {
      const texts = place(CHAIN, room, fontPx);
      expect(texts, `font ${fontPx}`).not.toBeNull();
      expect(violations(CHAIN, texts!, room, fontPx), `font ${fontPx}`).toEqual([]);
    }
  });

  it('keeps the slack for a font that draws wider than estimated: a label that would just fit beside its dot does not take the place', () => {
    // Beta is at the room's east edge, so its label can only go west; Alpha's cheapest place is east. At the estimate the two words fit in
    // the 194 units between the dots with 5 to spare (Alpha's 92.8 wide from 314.6, Beta's 81.2 wide ending at 494); drawn 8% wider
    // they would overlap. So the placer must give one of them another place (violations() draws every word that much wider).
    const room: MapView = { x: 100, y: 150, width: 470, height: 300 };
    const items: Item[] = [{ at: at(300, 300), text: 'Alpha 50', r: 12 }, { at: at(508, 300), text: 'Beta 40', r: 12 }];
    const texts = place(items, room)!;
    expect(texts).not.toBeNull();
    expect(violations(items, texts, room)).toEqual([]);
  });

  it('a label beside its dot is anchored at the edge nearest the dot, so its gap does not depend on how wide the text really draws', () => {
    const room: MapView = { x: 40, y: 150, width: 900, height: 400 };
    const texts = place(CHAIN, room)!;
    const dots = dotsOf(CHAIN);
    texts.forEach((t, i) => {
      const b = labelBox(c, t, 20);
      if (t.anchor === 'start') expect(b.left, t.text).toBeGreaterThanOrEqual(dots[i]!.x);
      else if (t.anchor === 'end') expect(b.right, t.text).toBeLessThanOrEqual(dots[i]!.x);
      else expect([b.left < dots[i]!.x, b.right > dots[i]!.x], t.text).toEqual([true, true]);
    });
  });

  it('keeps every label inside the room it is given, even when the room is tight to the dots', () => {
    const items: Item[] = [{ at: at(130, 130), text: 'Corner 10', r: 6 }];
    const texts = place(items)!;
    expect(texts).not.toBeNull();
    expect(violations(items, texts)).toEqual([]);
  });

  it('is deterministic, and does not change its input', () => {
    const copy = structuredClone(CHAIN);
    const room: MapView = { x: 40, y: 150, width: 900, height: 400 };
    expect(place(CHAIN, room)).toEqual(place(CHAIN, room));
    expect(CHAIN).toEqual(copy);
  });

  it('gives null, never a bad layout, when there is no clear one: a label wider than the room, or two dots on one spot', () => {
    expect(place([{ at: at(400, 300), text: 'x'.repeat(100), r: 8 }])).toBeNull();
    expect(place([{ at: at(400, 300), text: 'Alpha 50', r: 8 }, { at: at(400, 300), text: 'Beta 40', r: 8 }])).toBeNull();
  });

  it('places nothing for no items', () => {
    expect(place([])).toEqual([]);
  });

  // The placer's own rules, on scenes nobody chose: a layout it returns is clear (with every word wider than the estimate by the slack it
  // keeps), whatever the dots, and most of these scenes have one.
  it('fixed-seed property: on 60 random scenes of 5 to 12 dots, every layout it returns is clear, and most scenes get one', () => {
    const rand = mulberry32(2410);
    const room: MapView = { x: 60, y: 120, width: 880, height: 480 };
    const words = ['Ireland', 'Netherlands', 'Spain', 'United Kingdom', 'Pakistan', 'Bangladesh', 'Greece', 'Finland', 'Tuscany'];
    let found = 0;
    for (let n = 0; n < 60; n++) {
      const items: Item[] = Array.from({ length: 5 + Math.floor(rand() * 8) }, () => ({
        at: at(150 + rand() * 700, 200 + rand() * 300),
        text: `${words[Math.floor(rand() * words.length)]!} ${Math.floor(rand() * 100)}`,
        r: 4 + rand() * 11,
      }));
      const texts = place(items, room, 22);
      if (texts === null) continue;
      found++;
      expect(violations(items, texts, room, 22), `scene ${n}`).toEqual([]);
    }
    expect(found).toBeGreaterThan(35);
  });

  // A big dot with a small one 22 to 42 units from it (a small dot's label may sit nearer its own dot than the big one while still lying
  // over the big dot's edge, so "nearest to its own dot" alone does not keep it off): in a room only a little larger than the pair.
  it('fixed-seed property: a small dot beside a big one, in 200 tight rooms: its label never covers the big dot', () => {
    const rand = mulberry32(77);
    let found = 0;
    for (let n = 0; n < 200; n++) {
      const th = rand() * 2 * Math.PI;
      const gap = 22 + rand() * 20;
      const room: MapView = { x: 300 + rand() * 60, y: 200 + rand() * 60, width: 160 + rand() * 120, height: 90 + rand() * 80 };
      const [bx, by] = [room.x + room.width / 2, room.y + room.height / 2];
      const items: Item[] = [
        { at: at(bx, by), text: 'Big 90', r: 12 + rand() * 4 },
        { at: at(bx + gap * Math.cos(th), by + gap * Math.sin(th)), text: 'Small 3', r: 4 + rand() * 2 },
      ];
      const texts = place(items, room);
      if (texts === null) continue;
      found++;
      expect(violations(items, texts, room), `scene ${n}`).toEqual([]);
    }
    expect(found).toBeGreaterThan(100);
  });
});

describe('distribution maps H2, I2, J3 (Task 24, spec §3.4, §6)', () => {
  const IDS = ['H2', 'I2', 'J3'] as const;
  const hasCoords = (r: { lat?: number; lon?: number }): boolean => r.lat !== undefined && r.lon !== undefined;

  it('genes and frames: H2 LCT on the Europe frame, I2 SLC45A2 and J3 HERC2 on the Old World frame', () => {
    expect(DISTRIBUTION_MAP_GENE).toEqual({ H2: 'LCT', I2: 'SLC45A2', J3: 'HERC2', K2: 'TYK2', L3: 'HLA-DQ2' });
    expect(DISTRIBUTION_MAP_FRAME).toEqual({ H2: 'europe', I2: 'oldWorld', J3: 'oldWorld', K2: 'oldWorld', L3: 'europeWest' });
  });

  it('dot radius is area-true on the 0-100 scale (above the floor of 4: tests/map.test.ts)', () => {
    expect(dotRadius(75, 100)).toBeCloseTo(14 * Math.sqrt(0.75), 9);
    expect(dotRadius(100, 100)).toBeCloseTo(14, 9);
  });

  it('every map has its label size, no smaller than the arrow maps\' (a picture drawn small on its card asks for larger words)', () => {
    expect(Object.keys(DISTRIBUTION_LABEL_PX).sort()).toEqual(['H2', 'I2', 'J3', 'K2', 'L3']);
    for (const id of IDS) expect(DISTRIBUTION_LABEL_PX[id], id).toBeGreaterThanOrEqual(MAP_LABEL_FONT_PX);
  });

  for (const id of IDS) {
    const gene = DISTRIBUTION_MAP_GENE[id];
    const placed = (data = FIXTURE) => distributionRows(data, gene).filter(hasCoords);

    it(`${id}: one dot per row with coordinates, value = copies in every 100 straight from trait_maps, scale 0-${DISTRIBUTION_SCALE_MAX[gene]}`, () => {
      const s = mapSpec(id, FIXTURE);
      expect(s.id).toBe(id);
      expect(s.frame).toBe(DISTRIBUTION_MAP_FRAME[id]);
      expect(s.scaleMax).toBe(DISTRIBUTION_SCALE_MAX[gene]);
      expect(s.labelPx).toBe(DISTRIBUTION_LABEL_PX[id]);
      const rows = placed();
      expect(s.points).toHaveLength(rows.length);
      expect(rows.length, 'the fixture has rows to draw').toBeGreaterThanOrEqual(10);
      const raw = new Map(FIXTURE.trait_maps[gene].map((r) => [r.label_key, r.value]));
      s.points!.forEach((p, i) => {
        expect(p.lat).toBe(rows[i]!.lat);
        expect(p.lon).toBe(rows[i]!.lon);
        expect(p.value).toBeCloseTo(raw.get(rows[i]!.key)! * 100, 9);
        expect(p.role).toBe('value');
      });
      expect(s.arrows ?? []).toHaveLength(0);
    });

    it(`${id}: the side list is the rows without coordinates, with the same labels and numbers as the value list`, () => {
      const s = mapSpec(id, FIXTURE);
      const side = distributionRows(FIXTURE, gene).filter((r) => !hasCoords(r));
      expect(s.sideList ?? []).toEqual(side.map((r) => ({ label: r.label, display: r.display })));
      expect((s.sideList ?? []).length === 0, 'H2 has none; I2 and J3 have the Middle East').toBe(id === 'H2');
    });

    it(`${id}: one label per dot, "<place> <copies>", the numbers the value list prints`, () => {
      const s = mapSpec(id, FIXTURE);
      expect((s.texts ?? []).map((t) => t.text)).toEqual(placed().map((r) => `${r.label} ${r.display}`));
      for (const t of s.texts ?? []) expect(ruleViolations(t.text), t.text).toEqual([]);
    });

    it(`${id}: every label and dot lies in the window, no label overlaps another or covers a dot, and each is nearest its own dot, as estimated and with every word 8% wider`, () => {
      expect(layoutViolations(mapSpec(id, FIXTURE))).toEqual([]);
      expect(layoutViolations(mapSpec(id, FIXTURE), WIDER)).toEqual([]);
    });

    it(`${id}: the window is inside the frame's height and the map space, and no thinner than the card's slot wants`, () => {
      const s = mapSpec(id, FIXTURE);
      const v = s.view!;
      const f = frameBox(s.frame);
      expect(v).toBeDefined();
      expect([v.y >= f.top, v.y + v.height <= f.bottom, v.x >= 0, v.x + v.width <= MAP_VIEW.width]).toEqual([true, true, true, true]);
      expect(v.width / v.height).toBeLessThanOrEqual(BAND_MAX_ASPECT + 0.01);
      // The window is a window onto the frame, cut to the drawing: it does not spend the card's height on the empty Arctic or the Southern Ocean.
      expect(v.height).toBeLessThan(f.bottom - f.top);
    });

    it(`${id}: built, data ready, and renderMap draws every label and every dot`, () => {
      expect(MAP_SPECS_BUILT.has(id)).toBe(true);
      expect(mapDataReady(id, FIXTURE)).toBe(true);
      const s = mapSpec(id, FIXTURE);
      const svg = rendered(s);
      for (const t of s.texts ?? []) expect(svg.textContent).toContain(t.text);
      expect(svg.querySelectorAll('circle.map-dot--value, circle.map-dot--zero')).toHaveLength(placed().length);
      for (const t of svg.querySelectorAll('text.map-label')) expect(Number(t.getAttribute('font-size'))).toBe(DISTRIBUTION_LABEL_PX[id]);
      expect(svg.getAttribute('viewBox')).toBe(`${s.view!.x} ${s.view!.y} ${s.view!.width} ${s.view!.height}`);
    });

    it(`${id}: the dots follow the dot rule: a number that prints 0 is the hollow ring, any other number a filled dot of at least 4`, () => {
      const svg = rendered(mapSpec(id, FIXTURE));
      const rows = placed();
      const zeros = rows.filter((r) => r.display === '0').length;
      expect(svg.querySelectorAll('circle.map-dot--zero')).toHaveLength(zeros);
      expect(svg.querySelectorAll('circle.map-dot--value')).toHaveLength(rows.length - zeros);
      for (const dot of svg.querySelectorAll('circle.map-dot--value')) expect(Number(dot.getAttribute('r'))).toBeGreaterThanOrEqual(4);
      for (const ring of svg.querySelectorAll('circle.map-dot--zero')) expect(ring.getAttribute('fill')).toBe('none');
    });

    it(`${id}: the spec follows the rows of the data, not their order in the JSON or their allele counts (rows are ordered by TRAIT_MAP_ORDER)`, () => {
      const d = cloneFixture();
      d.trait_maps[gene] = d.trait_maps[gene].map((r) => ({ ...r, allele_count: 99999 })).reverse();
      expect(distributionSpec(id, d)).toEqual(distributionSpec(id, FIXTURE));
    });

    it(`${id}: draws only the rows that are present, and still lays them out clear`, () => {
      const d = cloneFixture();
      d.trait_maps[gene] = d.trait_maps[gene].filter((_, i) => i % 3 !== 1);
      const s = distributionSpec(id, d);
      const rows = placed(d);
      expect(rows.length).toBeLessThan(placed().length);
      expect((s.texts ?? []).map((t) => t.text)).toEqual(rows.map((r) => `${r.label} ${r.display}`));
      expect(layoutViolations(s)).toEqual([]);
    });
  }

  it('a thin drawing (a few rows side by side) gets more of the frame above and below it, equally, never past the frame: the picture is not a strip', () => {
    const d = cloneFixture();
    d.trait_maps.SLC45A2 = d.trait_maps.SLC45A2.filter((r) => r.label_key === '1kg:IBS' || r.label_key === '1kg:TSI');
    const s = distributionSpec('I2', d);
    const f = frameBox('oldWorld');
    const box = drawingBox(s)!;
    const v = s.view!;
    expect(box.right - box.left, 'the drawing is wider than tall').toBeGreaterThan(2.2 * (box.bottom - box.top));
    expect(v.width / v.height).toBeLessThanOrEqual(BAND_MAX_ASPECT + 0.01);
    expect(v.width / v.height).toBeGreaterThan(BAND_MAX_ASPECT - 0.05);
    expect(box.top - v.y).toBeCloseTo(v.y + v.height - box.bottom, 0);
    expect([v.y >= f.top, v.y + v.height <= f.bottom]).toEqual([true, true]);
    expect(layoutViolations(s)).toEqual([]);
  });

  it('dots at the north and south edges of the frame keep the window inside the frame, and their labels clear', () => {
    const d = cloneFixture();
    d.trait_maps.LCT = d.trait_maps.LCT.map((r) => (r.label_key === 'country:Norway' ? { ...r, lat: 70.9 } : r.label_key === 'country:Greece' ? { ...r, lat: 35.0 } : r));
    const s = distributionSpec('H2', d);
    const f = frameBox('europe');
    expect(s.view!.y).toBeGreaterThanOrEqual(f.top);
    expect(s.view!.y + s.view!.height).toBeLessThanOrEqual(f.bottom);
    expect(layoutViolations(s)).toEqual([]);
  });

  it('a gene with no rows that have coordinates is not data-ready, and its spec is empty, not an error', () => {
    const d = cloneFixture();
    d.trait_maps.LCT = d.trait_maps.LCT.map(({ lat: _lat, lon: _lon, ...rest }) => rest);
    expect(mapDataReady('H2', d)).toBe(false);
    const none = distributionSpec('H2', d);
    expect([none.points, none.texts]).toEqual([[], []]);
    d.trait_maps.LCT = [];
    expect(mapDataReady('H2', d)).toBe(false);
    expect(distributionSpec('H2', d).points).toEqual([]);
  });

  it('K2 and L3 are not built yet (Task 27): their specs throw and they are not data-ready, whatever the data', () => {
    for (const id of ['K2', 'L3'] as const) {
      expect(MAP_SPECS_BUILT.has(id), id).toBe(false);
      expect(() => mapSpec(id, FIXTURE), id).toThrow(/not built/);
      expect(mapDataReady(id, FIXTURE), id).toBe(false);
    }
  });

  it('drawingBox holds every value dot with its radius, as it holds arrows, links and labels', () => {
    const s: MapSpec = { ...mapSpec('I2', FIXTURE), texts: [] };
    const box = drawingBox(s)!;
    const dots = specDots(s);
    expect(dots.length).toBeGreaterThan(5);
    for (const d of dots) {
      expect(d.x - d.r).toBeGreaterThanOrEqual(box.left - 1e-6);
      expect(d.x + d.r).toBeLessThanOrEqual(box.right + 1e-6);
      expect(d.y - d.r).toBeGreaterThanOrEqual(box.top - 1e-6);
      expect(d.y + d.r).toBeLessThanOrEqual(box.bottom + 1e-6);
    }
    // ... and it is tight: some dot touches each side.
    expect(Math.min(...dots.map((d) => d.x - d.r))).toBeGreaterThan(box.left - 2);
    expect(Math.max(...dots.map((d) => d.y + d.r))).toBeGreaterThan(box.bottom - 2);
  });
});
