// @vitest-environment jsdom
// Spec §6 map specs (Task 20: D1, E1, G1). Tasks 23, 24 and 27 append their own describe blocks to this file.
import { describe, expect, it } from 'vitest';
import { MAP_TEXT } from '../src/content';
import {
  BAND_MAX_ASPECT, BAND_PAD, bandView, drawingBox, frameBox, labelAt, labelBox, MAP_LABEL_FONT_PX, MAP_SPECS_BUILT, mapDataReady,
  mapSpec, placeLabels, type LabelBox,
} from '../src/maps';
import {
  ARROW_WIDTH, MAP_FRAMES, MAP_VIEW, WIDE_ARROW_WIDTH, arrowReach, catmullRomSegments, makeProjection, project, renderMap,
  type LatLon, type MapSpec, type XY,
} from '../src/plots/map';
import { SVG_NS } from '../src/plots/svg';
import { FIXTURE } from './fixtures/fixture';
import { ruleViolations } from './contentRules';

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
