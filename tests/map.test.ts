// @vitest-environment jsdom
// Spec §6 projection, drawing, points and arrows; CONTRACT §4.13 src/plots/map.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARROW_WIDTH, DOT_MAX_RADIUS, MAP_COLOURS, MAP_FRAMES, MAP_VIEW, MIN_VALUE_RADIUS, WIDE_ARROW_WIDTH, ZERO_RING_RADIUS, catmullRomPath,
  catmullRomSegments, dotRadius, frameOutline, makeProjection, mapBase, project, projectUnits, renderMap, roundsToZero, valueColour,
  type MapFrameId, type MapSpec, type MapView,
} from '../src/plots/map';
import { formatCopies } from '../src/cards';
import { EUROPE_LAND } from '../src/generated/map-europe';
import { OLDWORLD_LAND } from '../src/generated/map-oldworld';

const FRAME_IDS: MapFrameId[] = ['europe', 'oldWorld', 'europeWest'];
const svg = (): SVGSVGElement => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(s);
  return s;
};

describe('frames and projection (spec §6)', () => {
  it('has the three frames of §6', () => {
    expect(MAP_FRAMES).toEqual({
      europe: { lonMin: -12, lonMax: 45, latMin: 34, latMax: 72, lon0: 16.5, lat0: 52 },
      oldWorld: { lonMin: -20, lonMax: 145, latMin: -35, latMax: 72, lon0: 62.5, lat0: 30 },
      europeWest: { lonMin: -12, lonMax: 30, latMin: 36, latMax: 66, lon0: 9, lat0: 51 },
    });
    expect(MAP_VIEW).toEqual({ width: 1000, height: 700 });
  });
  it.each(FRAME_IDS)('%s: one uniform scale, aspect kept within 0.5%%, touching one edge pair, centred', (id) => {
    const f = MAP_FRAMES[id];
    const c = makeProjection(f);
    expect(c.frame).toBe(id);
    const tl = project(c, f.latMax, f.lonMin);
    const br = project(c, f.latMin, f.lonMax);
    const w = br.x - tl.x;
    const h = br.y - tl.y;
    const want = ((f.lonMax - f.lonMin) * Math.cos((f.lat0 * Math.PI) / 180)) / (f.latMax - f.latMin);
    expect(Math.abs(w / h / want - 1)).toBeLessThan(0.005);
    const touchesX = Math.abs(w - MAP_VIEW.width) < 1e-9;
    const touchesY = Math.abs(h - MAP_VIEW.height) < 1e-9;
    expect(touchesX || touchesY).toBe(true);
    expect(tl.x).toBeCloseTo((MAP_VIEW.width - w) / 2, 9);
    expect(tl.y).toBeCloseTo((MAP_VIEW.height - h) / 2, 9);
  });
  it('projectUnits takes the §6 projection units used by europe_pops map_x / map_y', () => {
    const c = makeProjection(MAP_FRAMES.europe);
    const lat = 45.1;
    const lon = 10.2;
    const p = project(c, lat, lon);
    const u = projectUnits(c, (lon - 16.5) * Math.cos((52 * Math.PI) / 180), lat);
    expect(u.x).toBeCloseTo(p.x, 9);
    expect(u.y).toBeCloseTo(p.y, 9);
  });
  it('makeProjection refuses a box that is not one of MAP_FRAMES', () => {
    expect(() => makeProjection({ lonMin: 0, lonMax: 1, latMin: 0, latMax: 1, lon0: 0, lat0: 0 })).toThrow();
  });
});

describe('dots (spec §6 points)', () => {
  it('radius = 14 sqrt(value / scaleMax), area-true', () => {
    expect(DOT_MAX_RADIUS).toBe(14);
    expect(dotRadius(100, 100)).toBe(14);
    expect(dotRadius(25, 100)).toBeCloseTo(7, 12);
    expect(dotRadius(2.8, 15)).toBeCloseTo(14 * Math.sqrt(2.8 / 15), 12);
    expect(dotRadius(150, 100)).toBe(14);
  });
  it('a value that rounds to 0 (whole copies per 100; TYK2 to one decimal) is a 3 px hollow ring', () => {
    expect(ZERO_RING_RADIUS).toBe(3);
    expect([roundsToZero(0, 100), roundsToZero(0.4, 100), roundsToZero(0.6, 100)]).toEqual([true, true, false]);
    expect([roundsToZero(0.04, 15), roundsToZero(0.05, 15)]).toEqual([true, false]);
    expect(dotRadius(0.4, 100)).toBe(3);
    expect(dotRadius(0, 15)).toBe(3);
  });
});

// ---- Task 24 (controller ruling after the Task 19 review): a small number must read as present, not weaker than zero ----
describe('the dot rule: a value that does not round to 0 is never drawn smaller than "zero" (Task 24)', () => {
  /** WCAG 2.x contrast ratio of two #rrggbb colours. */
  const luminance = (hex: string): number => {
    const channel = (i: number): number => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  const css = readFileSync(resolve(__dirname, '../src/style.css'), 'utf8');
  const token = (name: string): string => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
    if (!m) throw new Error(`style.css has no --${name} colour`);
    return m[1]!;
  };

  it('the smallest filled dot is 4, strictly larger than the 3 px zero ring', () => {
    expect(MIN_VALUE_RADIUS).toBe(4);
    expect(MIN_VALUE_RADIUS).toBeGreaterThan(ZERO_RING_RADIUS);
    expect(dotRadius(0.6, 100)).toBe(MIN_VALUE_RADIUS);       // 1 copy in every 100, once rounded: the smallest number the cards print
    expect(dotRadius(0.4, 100)).toBe(ZERO_RING_RADIUS);       // prints 0
  });

  it('every whole number of copies from 1 to 100 draws a dot bigger than the zero ring, and the number it prints is not 0', () => {
    for (let n = 1; n <= 100; n++) {
      expect(dotRadius(n, 100), `${n} in 100`).toBeGreaterThan(ZERO_RING_RADIUS);
      expect(dotRadius(n, 100), `${n} in 100`).toBeGreaterThanOrEqual(MIN_VALUE_RADIUS);
      expect(formatCopies('LCT', n / 100), `${n} in 100`).toBe(String(n));
    }
  });

  it('a share the data really holds that prints 1 (Kenya 0.5, China 1.5 in 100) is a dot, and one that prints 0 is the ring', () => {
    expect(dotRadius(0.505, 100)).toBe(MIN_VALUE_RADIUS);
    expect(dotRadius(1.456, 100)).toBe(MIN_VALUE_RADIUS);
    expect(dotRadius(0, 100)).toBe(ZERO_RING_RADIUS);
  });

  it('above the floor the area-true formula is unchanged: 14 sqrt(value / scale), capped at the scale', () => {
    // 14 sqrt(v / 100) reaches 4 at v = 8.16: below that the floor decides, above it the formula does.
    expect(dotRadius(8, 100)).toBe(MIN_VALUE_RADIUS);
    expect(dotRadius(9, 100)).toBeCloseTo(14 * Math.sqrt(0.09), 12);
    expect(dotRadius(25, 100)).toBeCloseTo(7, 12);
    expect(dotRadius(75, 100)).toBeCloseTo(14 * Math.sqrt(0.75), 12);
    expect(dotRadius(100, 100)).toBe(14);
    expect(dotRadius(150, 100)).toBe(14);
  });

  it('a bigger value never draws a smaller dot (the floor flattens the smallest values, it never reorders them)', () => {
    for (const scale of [100, 15]) {
      let previous = 0;
      for (let i = 0; i <= scale * 10; i++) {
        const r = dotRadius(i / 10, scale);
        expect(r, `${i / 10} on 0-${scale}`).toBeGreaterThanOrEqual(previous);
        previous = r;
      }
    }
  });

  it('on the TYK2 scale (0-15, one decimal) the same rule holds: 0.1 in 100 is a dot of 4, 0.04 is the ring', () => {
    expect(dotRadius(0.05, 15)).toBe(MIN_VALUE_RADIUS);
    expect(dotRadius(0.1, 15)).toBe(MIN_VALUE_RADIUS);
    expect(dotRadius(0.04, 15)).toBe(ZERO_RING_RADIUS);
    expect(dotRadius(2.7, 15)).toBeCloseTo(14 * Math.sqrt(2.7 / 15), 12);
  });

  it('renderMap draws a 1-copy value as a filled dot of 4 and a 0 as the hollow ring of 3', () => {
    const s = svg();
    renderMap(s, { id: 'I2', frame: 'oldWorld', scaleMax: 100, points: [
      { lat: 0.6, lon: 34.8, value: 0.505, role: 'value' }, { lat: 35.7, lon: 139.7, value: 0, role: 'value' }, { lat: 52.5, lon: -1.5, value: 97.8, role: 'value' },
    ] });
    const dots = [...s.querySelectorAll('circle.map-dot')];
    // (the svg writes a number to one decimal)
    expect(dots.map((d) => [d.getAttribute('class'), d.getAttribute('r'), d.getAttribute('fill') === 'none'])).toEqual([
      ['map-dot map-dot--value', '4', false], ['map-dot map-dot--zero', '3', true], ['map-dot map-dot--value', String(Math.round(dotRadius(97.8, 100) * 10) / 10), false],
    ]);
    // As drawn, strokes included (a stroke is centred on the circle's edge): the smallest dot still reaches further out than the ring.
    const reach = (d: Element): number => Number(d.getAttribute('r')) + Number(d.getAttribute('stroke-width')) / 2;
    expect(reach(dots[0]!)).toBeGreaterThan(reach(dots[1]!));
  });

  it('MAP_COLOURS holds the map colours (spec §6), with the light end of the value scale and the grey of A1\'s "where the group lives" dots and lines darkened for land (Task 24)', () => {
    expect(MAP_COLOURS).toEqual({
      arrow: '#9B2226', ink: '#1A1A1A', halo: '#FFFFFF', trueDot: '#707070', geneticDot: '#0072B2', link: '#707070',
      ring: '#08519C', low: '#3182BD', high: '#08306B',
    });
  });

  it('valueColour runs from the low colour to the high one by the square root of the share of the scale, and clamps', () => {
    expect(valueColour(0, 100)).toBe('#3182BD');
    expect(valueColour(100, 100)).toBe('#08306B');
    expect(valueColour(25, 100)).toBe('#1D5994');             // t = 0.5: (49+8)/2, (130+48)/2, (189+107)/2 rounded
    expect(valueColour(7.5, 15)).toBe(valueColour(50, 100));  // the share of the scale decides, not the scale
    expect(valueColour(-5, 100)).toBe(valueColour(0, 100));
    expect(valueColour(250, 100)).toBe(valueColour(100, 100));
    expect(valueColour(40, 100)).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('the lightest colour a dot can have is at least 3:1 against the land (--map-land) and against the card background, at every value', () => {
    const land = token('map-land');
    const sea = token('card-bg');
    expect(contrast(MAP_COLOURS.low, land)).toBeGreaterThanOrEqual(3);
    expect(contrast(MAP_COLOURS.low, sea)).toBeGreaterThanOrEqual(3);
    for (const scale of [100, 15]) {
      for (let i = 0; i <= 150; i++) {
        const c = valueColour((i / 150) * scale, scale);
        expect(contrast(c, land), `${c} (${i}/150 of 0-${scale}) on land`).toBeGreaterThanOrEqual(3);
        expect(contrast(c, sea), `${c} on the sea`).toBeGreaterThanOrEqual(3);
      }
    }
    // The zero ring is drawn in its own colour: it too must show on land.
    expect(contrast(MAP_COLOURS.ring, land)).toBeGreaterThanOrEqual(3);
  });

  it('the check bites: the pale blue the scale started from was 1.1:1 against the land', () => {
    expect(contrast('#C6DBEF', token('map-land'))).toBeLessThan(1.2);
  });

  // Task 23 review, done after Task 24: A1's grey "where the group lives" dots and link lines were #8C8C8C, 2.6:1 against the land, so
  // the lines and the small dots faded into it at projector size. #707070 is 3.8:1 against the land and 4.7:1 against the card background.
  it('A1\'s grey dots and link lines, as drawn, are #707070: at least 3:1 against the land and against the card background; the blue DNA dots are unchanged', () => {
    const land = token('map-land');
    const sea = token('card-bg');
    const s = svg();
    renderMap(s, { id: 'A1', frame: 'europe', links: [{ from: { lat: 60, lon: 10 }, to: { ux: 0, uy: 50 } }] });
    const grey = s.querySelector('g.map-link circle.map-dot--true')!.getAttribute('fill')!;
    const line = s.querySelector('g.map-link line')!.getAttribute('stroke')!;
    const blue = s.querySelector('g.map-link circle.map-dot--genetic')!.getAttribute('fill')!;
    expect([grey, line, blue]).toEqual(['#707070', '#707070', '#0072B2']);
    for (const [what, colour] of [['grey dot', grey], ['link line', line], ['blue DNA dot', blue]] as const) {
      expect(contrast(colour, land), `${what} ${colour} on the land`).toBeGreaterThanOrEqual(3);
      expect(contrast(colour, sea), `${what} ${colour} on the sea`).toBeGreaterThanOrEqual(3);
    }
  });

  it('the check bites: the grey the dots and lines started from (#8C8C8C) was 2.6:1 against the land', () => {
    expect(contrast('#8C8C8C', token('map-land'))).toBeLessThan(3);
    expect(contrast('#8C8C8C', token('map-land'))).toBeGreaterThan(2.5);
  });
});

describe('catmullRomPath', () => {
  it('starts at the first point, ends at the last, one cubic per segment', () => {
    expect(catmullRomPath([])).toBe('');
    expect(catmullRomPath([{ x: 10, y: 20 }])).toBe('M10 20');
    expect(catmullRomPath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe('M0 0L10 0');
    const d = catmullRomPath([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }, { x: 30, y: 5 }]);
    expect(d.startsWith('M0 0C')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(3);
    expect(d.endsWith(' 30 5')).toBe(true);
  });
  it('a straight run of points stays straight', () => {
    // Control points: p1 + (p2 - p0) / 6 and p2 - (p3 - p1) / 6, with the end points repeated at both ends.
    expect(catmullRomPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])).toBe('M0 0C1.7 0 6.7 0 10 0C13.3 0 18.3 0 20 0');
  });
});

describe('renderMap (spec §6 drawing)', () => {
  const spec: MapSpec = {
    id: 'D1',
    frame: 'europe',
    arrows: [
      { waypoints: [{ lat: 47.5, lon: 38.0 }, { lat: 50.5, lon: 21.0 }, { lat: 51.4, lon: 11.7 }, { lat: 52.7, lon: 5.0 }, { lat: 51.17, lon: -1.78 }], style: 'main', label: { text: 'Start here', at: 0, dx: 6, dy: -8 } },
      { waypoints: [{ lat: 38.7, lon: -9.1 }, { lat: 52.0, lon: 5.5 }], style: 'idea' },
      { waypoints: [{ lat: 48.7, lon: 6.2 }, { lat: 50.73, lon: 1.61 }, { lat: 51.33, lon: 1.37 }], style: 'main', wide: true },
      { waypoints: [{ lat: 48.85, lon: 2.35 }, { lat: 50.73, lon: 1.61 }, { lat: 51.13, lon: 1.31 }], style: 'minor', dashed: true },
    ],
    texts: [{ lat: 57.0, lon: -4.5, text: 'A place name', anchor: 'start' }],
    points: [
      { lat: 52.5, lon: -1.5, value: 75, label: 'Britain' },
      { lat: 61.0, lon: 25.0, value: 0.2 },
      { lat: 45.0, lon: 10.0, role: 'marker' },
    ],
    links: [{ from: { lat: 60, lon: 10 }, to: { ux: 0, uy: 50 } }],
    scaleMax: 100,
  };

  it('draws the frame, sea, land (no borders) and frame outline in a 1000 x 700 viewBox', () => {
    const s = svg();
    renderMap(s, spec);
    expect(s.getAttribute('viewBox')).toBe('0 0 1000 700');
    expect(s.classList.contains('map-svg')).toBe(true);
    expect([s.getAttribute('data-map'), s.getAttribute('data-frame')]).toEqual(['D1', 'europe']);
    expect(s.querySelectorAll('g.map-land path')).toHaveLength(EUROPE_LAND.length);
    expect(s.querySelector('g.map-land path')!.getAttribute('fill-rule')).toBe('evenodd');
    expect(s.querySelectorAll('rect.map-sea')).toHaveLength(1);
    expect(s.querySelectorAll('rect.map-frame')).toHaveLength(1);
  });
  it('one path per arrow, each with an arrowhead marker that exists; styles and dashes as §6', () => {
    const s = svg();
    renderMap(s, spec);
    const arrows = [...s.querySelectorAll('path.map-arrow')];
    expect(arrows).toHaveLength(spec.arrows!.length);
    for (const a of arrows) {
      const id = /^url\(#(.+)\)$/.exec(a.getAttribute('marker-end') ?? '')?.[1];
      expect(id && s.querySelector(`marker[id="${id}"]`)).toBeTruthy();
    }
    expect(arrows.map((a) => Number(a.getAttribute('stroke-width')))).toEqual([ARROW_WIDTH.main, ARROW_WIDTH.idea, WIDE_ARROW_WIDTH, ARROW_WIDTH.minor]);
    expect(arrows.map((a) => a.hasAttribute('stroke-dasharray'))).toEqual([false, true, false, true]);
    expect([ARROW_WIDTH.main, ARROW_WIDTH.minor, ARROW_WIDTH.idea]).toEqual([5, 2.5, 2.5]);
  });
  it('labels carry a halo (paint-order: stroke); arrow labels sit at their waypoint plus the offset', () => {
    const s = svg();
    renderMap(s, spec);
    const labels = [...s.querySelectorAll('text.map-label')];
    expect(labels.map((t) => t.textContent)).toEqual(['Start here', 'Britain', 'A place name']);
    for (const t of labels) expect(t.getAttribute('paint-order')).toBe('stroke');
    const c = mapBase('europe').projection;
    const start = project(c, 47.5, 38.0);
    expect(Number(labels[0]!.getAttribute('x'))).toBeCloseTo(start.x + 6, 0);
    expect(Number(labels[0]!.getAttribute('y'))).toBeCloseTo(start.y - 8, 0);
  });
  it('a map can ask for larger labels (MapSpec.labelPx, Task 23): every label (arrow, point, text) takes the size and a halo of a fifth of it; the default stays 20 and 4', () => {
    const plain = svg();
    renderMap(plain, spec);
    const sizes = (s: SVGSVGElement): string[][] => [...s.querySelectorAll('text.map-label')].map((t) => [t.getAttribute('font-size')!, t.getAttribute('stroke-width')!]);
    expect(sizes(plain)).toEqual([['20', '4'], ['20', '4'], ['20', '4']]);
    const big = svg();
    renderMap(big, { ...spec, labelPx: 30 });
    expect(sizes(big)).toEqual([['30', '6'], ['30', '6'], ['30', '6']]);
  });
  it('value dots are area-true; a value that rounds to 0 is a hollow 3 px ring; markers and links draw', () => {
    const s = svg();
    renderMap(s, spec);
    const full = s.querySelector('circle.map-dot--value')!;
    expect(Number(full.getAttribute('r'))).toBeCloseTo(dotRadius(75, 100), 1);
    const zero = s.querySelector('circle.map-dot--zero')!;
    expect([zero.getAttribute('r'), zero.getAttribute('fill')]).toEqual(['3', 'none']);
    expect(s.querySelectorAll('circle.map-dot--marker')).toHaveLength(1);
    expect(s.querySelectorAll('g.map-link line')).toHaveLength(1);
    expect(s.querySelectorAll('g.map-link circle.map-dot--true')).toHaveLength(1);
    expect(s.querySelectorAll('g.map-link circle.map-dot--genetic')).toHaveLength(1);
  });
  it('the Old World frame uses its own outline; the Europe-west outline is not generated until Task 27', () => {
    const s = svg();
    renderMap(s, { id: 'I2', frame: 'oldWorld' });
    expect(s.querySelectorAll('g.map-land path')).toHaveLength(OLDWORLD_LAND.length);
    const w = svg();
    renderMap(w, { id: 'L3', frame: 'europeWest' });
    expect(w.querySelectorAll('g.map-land path')).toHaveLength(0);
    expect(mapBase('europeWest').projection).toEqual(makeProjection(MAP_FRAMES.europeWest));
  });
  it('renders again into the same svg without leftovers', () => {
    const s = svg();
    renderMap(s, spec);
    renderMap(s, { id: 'E1', frame: 'europe' });
    expect(s.querySelectorAll('path.map-arrow, text.map-label, circle')).toHaveLength(0);
    expect(s.getAttribute('data-map')).toBe('E1');
  });
});

describe('catmullRomSegments', () => {
  it('gives one cubic per segment, joined end to end, and the same numbers catmullRomPath writes', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }, { x: 30, y: 5 }];
    const segs = catmullRomSegments(pts);
    expect(segs).toHaveLength(3);
    segs.forEach((s, i) => {
      expect(s.from).toEqual(pts[i]);
      expect(s.to).toEqual(pts[i + 1]);
    });
    const round = (v: number): string => String(Math.round(v * 10) / 10);
    const d = catmullRomPath(pts);
    const fromSegments = `M${round(pts[0]!.x)} ${round(pts[0]!.y)}${segs.map((s) => `C${round(s.c1.x)} ${round(s.c1.y)} ${round(s.c2.x)} ${round(s.c2.y)} ${round(s.to.x)} ${round(s.to.y)}`).join('')}`;
    expect(d).toBe(fromSegments);
  });
  it('gives none for fewer than two points', () => {
    expect(catmullRomSegments([])).toEqual([]);
    expect(catmullRomSegments([{ x: 1, y: 2 }])).toEqual([]);
  });
});

describe('a window (MapSpec.view) and the frame outline (Task 20)', () => {
  const FULL: MapView = { x: 0, y: 0, width: MAP_VIEW.width, height: MAP_VIEW.height };
  const europe = makeProjection(MAP_FRAMES.europe);
  const boxW = europe.k * (MAP_FRAMES.europe.lonMax - MAP_FRAMES.europe.lonMin) * europe.cosLat0;
  const boxH = europe.k * (MAP_FRAMES.europe.latMax - MAP_FRAMES.europe.latMin);
  const rect = (s: SVGSVGElement, selector: string): MapView => {
    const r = s.querySelector(selector)!;
    return { x: Number(r.getAttribute('x')), y: Number(r.getAttribute('y')), width: Number(r.getAttribute('width')), height: Number(r.getAttribute('height')) };
  };

  it('no view: the viewBox is the whole 1000 x 700 map space and nothing is clipped', () => {
    const s = svg();
    renderMap(s, { id: 'D1', frame: 'europe' });
    expect(s.getAttribute('viewBox')).toBe('0 0 1000 700');
    expect(s.querySelector('g.map-window')).toBeNull();
    expect(s.querySelector('clipPath')).toBeNull();
  });

  it('a view becomes the viewBox, and everything drawn is clipped to it, so a box taller than the window never shows the rest of the frame', () => {
    const s = svg();
    const view: MapView = { x: 176.8, y: 250.4, width: 646.4, height: 227.8 };
    renderMap(s, { id: 'E1', frame: 'europe', view, arrows: [{ waypoints: [{ lat: 50, lon: 2 }, { lat: 51, lon: 1 }], style: 'main' }], texts: [{ lat: 52, lon: 0, text: 'x' }] });
    expect(s.getAttribute('viewBox')).toBe('176.8 250.4 646.4 227.8');
    const clip = s.querySelector('clipPath')!;
    const g = s.querySelector('g.map-window')!;
    expect(g.getAttribute('clip-path')).toBe(`url(#${clip.id})`);
    expect(clip.id).toBe('map-E1-view');
    for (const sel of ['rect.map-sea', 'g.map-land', 'g.map-links', 'g.map-arrows', 'g.map-points', 'g.map-labels']) {
      expect(g.querySelector(sel), sel).not.toBeNull();
    }
    expect(s.querySelectorAll('defs > marker').length).toBeGreaterThan(0);
    expect(s.querySelector('defs')!.parentElement).toBe(s);
  });

  it('the clip is exactly the window, and the frame outline on the window\'s edge is drawn above it, so its outer half is not cut off', () => {
    const s = svg();
    const view: MapView = { x: 176.8, y: 250.4, width: 646.4, height: 227.8 };
    renderMap(s, { id: 'E1', frame: 'europe', view });
    expect(rect(s, 'clipPath rect')).toEqual(view);
    const group = s.querySelector('g.map-window')!;
    const outline = s.querySelector('rect.map-frame')!;
    expect(outline.parentElement).toBe(s);
    expect(group.contains(outline)).toBe(false);
    expect(group.compareDocumentPosition(outline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // It lies on the window's own edge, not inside it.
    expect(rect(s, 'rect.map-frame')).toEqual(view);
  });

  it('the frame outline is the frame\'s box where the view shows all of it, and the view\'s edge where it cuts through the box', () => {
    const whole = frameOutline(europe, boxW, boxH, FULL);
    expect([whole.x, whole.y, whole.width, whole.height]).toEqual([europe.offX, europe.offY, boxW, boxH]);
    const band: MapView = { x: europe.offX, y: 250, width: boxW, height: 230 };
    expect(frameOutline(europe, boxW, boxH, band)).toEqual(band);
    const wide: MapView = { x: 100, y: 250, width: 800, height: 230 };
    const w = frameOutline(europe, boxW, boxH, wide);
    expect([w.x, w.width, w.y, w.height]).toEqual([europe.offX, boxW, 250, 230]);
    const s = svg();
    renderMap(s, { id: 'D1', frame: 'europe' });
    const drawn = rect(s, 'rect.map-frame');
    expect([drawn.x, drawn.y, drawn.width, drawn.height].map((v) => Math.round(v * 10) / 10)).toEqual([europe.offX, europe.offY, boxW, boxH].map((v) => Math.round(v * 10) / 10));
  });
});
