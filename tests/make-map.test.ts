// @vitest-environment node
// Spec §6 build step and tests; CONTRACT §4.13 scripts/make-map.mjs. The geometry helpers run on synthetic rings;
// the generated outlines (committed) are checked for size, projection and content.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FRAMES, KEEP_ISLANDS, MIN_RING_AREA, NE_BASE, NE_SHA256, OUTPUTS, buildLand, clipRing, isKeptIsland,
  makeProjection as scriptProjection, openRing, r1, renderModule, ringArea, ringPath, simplifyRing,
} from '../scripts/make-map.mjs';
import { MAP_FRAMES, makeProjection, project, type MapProjectionConstants } from '../src/plots/map';
import { EUROPE_LAND, EUROPE_PROJECTION } from '../src/generated/map-europe';
import { OLDWORLD_LAND, OLDWORLD_PROJECTION } from '../src/generated/map-oldworld';

type P = [number, number];
const ROOT = resolve(__dirname, '..');
const BOX = { lonMin: -10, lonMax: 10, latMin: -10, latMax: 10, lon0: 0, lat0: 0 };
const square = (h: number, cx = 0, cy = 0): P[] => [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]];
const closed = (r: P[]): P[] => [...r, r[0]!];

/** The rings of one generated path string, in viewBox units. */
function rings(d: string): P[][] {
  return d.split('M').filter(Boolean).map((sub) => {
    const nums = sub.replace(/[LZ]/g, ' ').trim().split(/\s+/).map(Number);
    const pts: P[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!]);
    return pts;
  });
}
function inRing([x, y]: P, ring: P[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Even-odd fill, as the renderer draws it. */
const onLand = (paths: readonly string[], p: { x: number; y: number }): boolean =>
  paths.some((d) => rings(d).filter((r) => inRing([p.x, p.y], r)).length % 2 === 1);
function keptIsland(paths: readonly string[], c: MapProjectionConstants, box: (typeof KEEP_ISLANDS)[number]): boolean {
  const a = project(c, box.latMax, box.lonMin);
  const b = project(c, box.latMin, box.lonMax);
  return paths.some((d) => rings(d).some((r) => r.every(([x, y]) => x >= a.x - 0.1 && x <= b.x + 0.1 && y >= a.y - 0.1 && y <= b.y + 0.1)));
}

describe('make-map geometry helpers', () => {
  it('uses exactly the frames and projection of src/plots/map.ts', () => {
    expect(FRAMES).toEqual(MAP_FRAMES);
    for (const id of ['europe', 'oldWorld', 'europeWest'] as const) expect(scriptProjection(id)).toEqual(makeProjection(MAP_FRAMES[id]));
  });
  it('pins the Natural Earth source and has a recorded SHA-256 for each file', () => {
    expect(NE_BASE).toBe('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/');
    expect(Object.keys(NE_SHA256).sort()).toEqual(['ne_110m_land.geojson', 'ne_50m_land.geojson']);
    for (const v of Object.values(NE_SHA256)) expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(OUTPUTS.map((o) => [o.frame, o.source, o.tolerance, o.file, o.maxBytes])).toEqual([
      ['europe', 'ne_50m_land.geojson', 0.05, 'src/generated/map-europe.ts', 80 * 1024],
      ['oldWorld', 'ne_110m_land.geojson', 0.2, 'src/generated/map-oldworld.ts', 25 * 1024],
    ]);
  });
  it('ringArea is the shoelace area in square degrees; openRing drops the closing point', () => {
    expect(ringArea(square(0.5))).toBeCloseTo(1, 12);
    expect(ringArea(square(20))).toBeCloseTo(1600, 9);
    expect(openRing([[0, 0], [1, 0], [1, 1], [0, 0]])).toEqual([[0, 0], [1, 0], [1, 1]]);
    expect(MIN_RING_AREA).toBe(0.05);
  });
  it('clipRing is Sutherland–Hodgman against the frame box', () => {
    expect(ringArea(clipRing(square(20), BOX))).toBeCloseTo(400, 9);
    expect(clipRing(square(2), BOX)).toEqual(square(2));
    expect(clipRing(square(2, 50, 50), BOX)).toEqual([]);
    const half = clipRing(square(4, 10, 0), BOX);
    expect(ringArea(half)).toBeCloseTo(32, 9);
    for (const [lon, lat] of half) {
      expect(lon).toBeLessThanOrEqual(10);
      expect(Math.abs(lat)).toBeLessThanOrEqual(10);
    }
  });
  it('simplifyRing is Douglas–Peucker on the closed ring: corners kept, points within the tolerance dropped', () => {
    const noisy: P[] = [[0, 0], [1, 0.01], [2, 0], [2, 1], [2, 2], [1, 2.02], [0, 2], [0, 1]];
    expect(simplifyRing(noisy, 0.05)).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]]);
  });
  it('keeps Orkney, Shetland, the Isle of Man and Malta by name; other small rings are not kept', () => {
    expect(KEEP_ISLANDS.map((k) => k.name)).toEqual(['Orkney', 'Shetland', 'Isle of Man', 'Malta']);
    expect(isKeptIsland(square(0.05, -3.0, 59.0))).toBe(true);
    expect(isKeptIsland(square(0.05, -1.25, 60.35))).toBe(true);
    expect(isKeptIsland(square(0.05, -4.55, 54.23))).toBe(true);
    expect(isKeptIsland(square(0.05, 14.4, 35.9))).toBe(true);
    expect(isKeptIsland(square(0.05, 0, 50))).toBe(false);
  });
  it('ringPath writes one-decimal coordinates with the map projection', () => {
    const c = scriptProjection('europe');
    const d = ringPath([[-1.5, 52.5], [10, 52.5], [10, 60]], c);
    const p = project(makeProjection(MAP_FRAMES.europe), 52.5, -1.5);
    expect(d.startsWith(`M${r1(p.x)} ${r1(p.y)}L`)).toBe(true);
    expect(d).toMatch(/^M-?\d+(\.\d)? -?\d+(\.\d)?L(-?\d+(\.\d)? -?\d+(\.\d)? ?)+Z$/);
    expect(ringPath([[0, 50], [0.001, 50], [0.002, 50]], c)).toBe('');       // collapses to fewer than 3 points
  });
  it('buildLand: one path per polygon, holes in the same path, small rings dropped unless named', () => {
    const geo = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [closed(square(5, 10, 50)), closed(square(1, 10, 50))] } },
        { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[closed(square(0.05, 0, 50))], [closed(square(0.05, 14.4, 35.9))]] } },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [closed(square(2, 100, 0))] } },   // outside the frame
      ],
    };
    const paths = buildLand(geo, 'europe', 0.05);
    expect(paths).toHaveLength(2);
    expect(paths[0]!.match(/M/g)).toHaveLength(2);       // outer ring + hole
    expect(paths[1]!.match(/M/g)).toHaveLength(1);       // Malta (the 0.01 deg² rock at 0,50 is dropped)
  });
  it('renderModule writes a typed module with the constants and the paths', () => {
    const src = renderModule(OUTPUTS[0]!, scriptProjection('europe'), ['M0 0L1 0 1 1Z'], 'ab'.repeat(32));
    expect(src).toContain("import type { MapProjectionConstants } from '../plots/map';");
    expect(src).toContain('export const EUROPE_PROJECTION: MapProjectionConstants = {');
    expect(src).toContain('export const EUROPE_LAND: readonly string[] = [\n  "M0 0L1 0 1 1Z",\n];');
    expect(src).toContain('Natural Earth v5.1.2');
  });
});

describe('generated outlines (src/generated, committed)', () => {
  it('stay within their size budgets (Europe <= 80 KB, Old World <= 25 KB)', () => {
    expect(statSync(resolve(ROOT, 'src/generated/map-europe.ts')).size).toBeLessThanOrEqual(80 * 1024);
    expect(statSync(resolve(ROOT, 'src/generated/map-oldworld.ts')).size).toBeLessThanOrEqual(25 * 1024);
    expect(readFileSync(resolve(ROOT, 'src/generated/map-europe.ts'), 'utf8')).toContain('Do not edit by hand');
  });
  it('carry the projection constants of makeProjection, within 1e-9', () => {
    const pairs: [MapProjectionConstants, 'europe' | 'oldWorld'][] = [[EUROPE_PROJECTION, 'europe'], [OLDWORLD_PROJECTION, 'oldWorld']];
    for (const [c, f] of pairs) {
      const want = makeProjection(MAP_FRAMES[f]);
      expect(c.frame).toBe(f);
      for (const k of ['k', 'offX', 'offY', 'pxMin', 'latMax', 'lon0', 'cosLat0'] as const) expect(Math.abs(c[k] - want[k]), `${f}.${k}`).toBeLessThan(1e-9);
    }
  });
  it('Britain (52.5, -1.5) lands on land in both frames; the North Sea (55, 3) does not', () => {
    expect(onLand(EUROPE_LAND, project(EUROPE_PROJECTION, 52.5, -1.5))).toBe(true);
    expect(onLand(OLDWORLD_LAND, project(OLDWORLD_PROJECTION, 52.5, -1.5))).toBe(true);
    expect(onLand(EUROPE_LAND, project(EUROPE_PROJECTION, 55, 3))).toBe(false);
  });
  it('the Europe outline keeps Orkney, Shetland, the Isle of Man and Malta', () => {
    for (const box of KEEP_ISLANDS) expect(keptIsland(EUROPE_LAND, EUROPE_PROJECTION, box), box.name).toBe(true);
  });
  it('every coordinate has at most one decimal and stays inside the viewBox (allowing for the frame box edge)', () => {
    for (const d of [...EUROPE_LAND, ...OLDWORLD_LAND]) {
      expect(d).not.toMatch(/\d\.\d\d/);
      for (const r of rings(d)) for (const [x, y] of r) {
        expect(x).toBeGreaterThanOrEqual(-0.05);
        expect(x).toBeLessThanOrEqual(1000.05);
        expect(y).toBeGreaterThanOrEqual(-0.05);
        expect(y).toBeLessThanOrEqual(700.05);
      }
    }
  });
});
