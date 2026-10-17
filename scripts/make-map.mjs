// npm run make-map (spec §6, CONTRACT §4.13). Run by hand, never by npm run build. No npm dependency.
// 1. Downloads Natural Earth v5.1.2 land polygons (public domain; "Made with Natural Earth.") into a freshly created,
//    empty, git-ignored assets/geo-raw/, and checks each file's SHA-256 against NE_SHA256 below. The files are untrusted
//    data: they are only hashed and read with JSON.parse; nothing in assets/geo-raw/ is executed, imported or served.
// 2. Clips every ring to the map frame (Sutherland–Hodgman), drops rings under 0.05 square degrees except Orkney, Shetland,
//    the Isle of Man and Malta, simplifies (Douglas–Peucker: 0.05 degrees for Europe, 0.2 for the Old World), projects with
//    the formula of src/plots/map.ts and writes one-decimal SVG paths plus the projection constants to
//    src/generated/map-europe.ts and src/generated/map-oldworld.ts (committed).
// Usage:  node scripts/make-map.mjs --record-sha   first time only: prints the two hashes to paste into NE_SHA256
//         node scripts/make-map.mjs [--clean]      --clean empties assets/geo-raw/ first (it must start empty)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEO_RAW = join(ROOT, 'assets/geo-raw');
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const NETWORK_TIMEOUT_MS = 60_000;

export const MAP_VIEW = { width: 1000, height: 700 };
// Must equal MAP_FRAMES in src/plots/map.ts (pinned by tests/make-map.test.ts).
export const FRAMES = {
  europe: { lonMin: -12, lonMax: 45, latMin: 34, latMax: 72, lon0: 16.5, lat0: 52 },
  oldWorld: { lonMin: -20, lonMax: 145, latMin: -35, latMax: 72, lon0: 62.5, lat0: 30 },
  europeWest: { lonMin: -12, lonMax: 30, latMin: 36, latMax: 66, lon0: 9, lat0: 51 },
};
export const NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/';
// Recorded from the first download (npm run make-map -- --record-sha). Any later change in the files stops the script.
export const NE_SHA256 = {
  'ne_50m_land.geojson': 'e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b',
  'ne_110m_land.geojson': '9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9',
};
export const MIN_RING_AREA = 0.05;
export const ISLAND_TOLERANCE_FACTOR = 0.2;
export const KEEP_ISLANDS = [
  { name: 'Orkney', lonMin: -3.45, lonMax: -2.35, latMin: 58.65, latMax: 59.4 },
  { name: 'Shetland', lonMin: -1.8, lonMax: -0.7, latMin: 59.8, latMax: 60.9 },
  { name: 'Isle of Man', lonMin: -4.85, lonMax: -4.3, latMin: 54.03, latMax: 54.43 },
  { name: 'Malta', lonMin: 14.15, lonMax: 14.6, latMin: 35.75, latMax: 36.1 },
];
export const OUTPUTS = [
  { frame: 'europe', source: 'ne_50m_land.geojson', tolerance: 0.05, file: 'src/generated/map-europe.ts', landName: 'EUROPE_LAND', projName: 'EUROPE_PROJECTION', maxBytes: 80 * 1024 },
  { frame: 'oldWorld', source: 'ne_110m_land.geojson', tolerance: 0.2, file: 'src/generated/map-oldworld.ts', landName: 'OLDWORLD_LAND', projName: 'OLDWORLD_PROJECTION', maxBytes: 25 * 1024 },
];

function fail(msg) {
  console.error(`make-map: ${msg}`);
  process.exit(1);
}

/** Same arithmetic, in the same order, as makeProjection in src/plots/map.ts. */
export function makeProjection(frame) {
  const f = FRAMES[frame];
  const cosLat0 = Math.cos((f.lat0 * Math.PI) / 180);
  const pxMin = (f.lonMin - f.lon0) * cosLat0;
  const w = (f.lonMax - f.lonMin) * cosLat0;
  const h = f.latMax - f.latMin;
  const k = Math.min(MAP_VIEW.width / w, MAP_VIEW.height / h);
  return { frame, k, offX: (MAP_VIEW.width - k * w) / 2, offY: (MAP_VIEW.height - k * h) / 2, pxMin, latMax: f.latMax, lon0: f.lon0, cosLat0 };
}

export function project(c, lat, lon) {
  return { x: c.offX + c.k * ((lon - c.lon0) * c.cosLat0 - c.pxMin), y: c.offY + c.k * (c.latMax - lat) };
}

/** One decimal, "-0" written as "0" (same as f1 in src/plots/svg.ts). */
export function r1(v) {
  const r = Math.round(v * 10) / 10;
  return (r === 0 ? 0 : r).toString();
}

export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}

export function openRing(coords) {
  const r = coords.map((p) => [Number(p[0]), Number(p[1])]);
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return r;
}

function clipEdge(ring, inside, cross) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i];
    const prev = ring[(i + ring.length - 1) % ring.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(cross(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(cross(prev, cur));
    }
  }
  return out;
}

/** Sutherland–Hodgman: the part of the ring inside the frame box, or [] if fewer than 3 points remain. */
export function clipRing(ring, box) {
  const atLon = (lon) => (a, b) => [lon, a[1] + ((b[1] - a[1]) * (lon - a[0])) / (b[0] - a[0])];
  const atLat = (lat) => (a, b) => [a[0] + ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]), lat];
  let r = ring;
  r = clipEdge(r, (p) => p[0] >= box.lonMin, atLon(box.lonMin));
  if (r.length) r = clipEdge(r, (p) => p[0] <= box.lonMax, atLon(box.lonMax));
  if (r.length) r = clipEdge(r, (p) => p[1] >= box.latMin, atLat(box.latMin));
  if (r.length) r = clipEdge(r, (p) => p[1] <= box.latMax, atLat(box.latMax));
  return r.length >= 3 ? r : [];
}

function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker on an open polyline (first and last points always kept). Iterative, so long coasts cannot overflow the stack. */
export function simplifyLine(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i], pts[s], pts[e]);
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (idx !== -1 && max > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/** Douglas–Peucker on a closed ring: split at its first point and the point farthest from it, simplify both halves, rejoin. */
export function simplifyRing(ring, tol) {
  if (ring.length <= 3) return ring.slice();
  let far = 1;
  let best = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplifyLine(ring.slice(0, far + 1), tol);
  const b = simplifyLine([...ring.slice(far), ring[0]], tol);
  return [...a, ...b.slice(1, -1)];
}

export function isKeptIsland(ring) {
  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  for (const [lon, lat] of ring) {
    lonMin = Math.min(lonMin, lon); lonMax = Math.max(lonMax, lon);
    latMin = Math.min(latMin, lat); latMax = Math.max(latMax, lat);
  }
  const cx = (lonMin + lonMax) / 2;
  const cy = (latMin + latMax) / 2;
  return KEEP_ISLANDS.some((b) => cx >= b.lonMin && cx <= b.lonMax && cy >= b.latMin && cy <= b.latMax);
}

/** Every polygon (an array of rings: outer, then holes) in a FeatureCollection of Polygon / MultiPolygon features. */
export function polygonsOf(geojson) {
  const out = [];
  for (const f of geojson?.features ?? []) {
    const g = f?.geometry;
    if (g?.type === 'Polygon') out.push(g.coordinates);
    else if (g?.type === 'MultiPolygon') out.push(...g.coordinates);
  }
  return out;
}

/** "M x y L x y x y … Z" in projected, one-decimal units; '' if fewer than 3 distinct points survive the rounding. */
export function ringPath(ring, c) {
  const pts = [];
  for (const [lon, lat] of ring) {
    const p = project(c, lat, lon);
    const s = `${r1(p.x)} ${r1(p.y)}`;
    if (pts[pts.length - 1] !== s) pts.push(s);
  }
  if (pts.length > 1 && pts[0] === pts[pts.length - 1]) pts.pop();
  if (new Set(pts).size < 3) return '';
  return `M${pts[0]}L${pts.slice(1).join(' ')}Z`;
}

/** One path string per polygon that survives: its outer ring, then its holes, as subpaths (drawn with fill-rule evenodd). */
export function buildLand(geojson, frame, tol) {
  const box = FRAMES[frame];
  const c = makeProjection(frame);
  const paths = [];
  for (const poly of polygonsOf(geojson)) {
    const parts = [];
    for (let i = 0; i < poly.length; i++) {
      if (i > 0 && parts.length === 0) break;            // the outer ring was dropped: drop its holes too
      const clipped = clipRing(openRing(poly[i]), box);
      if (clipped.length < 3) continue;
      const island = isKeptIsland(clipped);
      if (ringArea(clipped) < MIN_RING_AREA && !island) continue;
      let simple = simplifyRing(clipped, island ? tol * ISLAND_TOLERANCE_FACTOR : tol);
      if (simple.length < 3) simple = clipped;
      const d = ringPath(simple, c);
      if (d) parts.push(d);
      else if (i === 0) break;
    }
    if (parts.length) paths.push(parts.join(''));
  }
  return paths;
}

export function renderModule(out, c, paths, sha) {
  const f = FRAMES[out.frame];
  return [
    `// Generated by scripts/make-map.mjs from Natural Earth v5.1.2 ${out.source} (public domain; "Made with Natural Earth.").`,
    `// Source SHA-256 ${sha}. Frame ${out.frame}: lon ${f.lonMin}..${f.lonMax}, lat ${f.latMin}..${f.latMax}, tolerance ${out.tolerance} degrees.`,
    '// Do not edit by hand: run npm run make-map.',
    "import type { MapProjectionConstants } from '../plots/map';",
    '',
    `export const ${out.projName}: MapProjectionConstants = ${JSON.stringify(c)};`,
    '',
    `export const ${out.landName}: readonly string[] = [`,
    ...paths.map((d) => `  ${JSON.stringify(d)},`),
    '];',
    '',
  ].join('\n');
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
  if (!res.ok) fail(`HTTP ${res.status} from ${url}`);
  if (!res.url.startsWith('https://raw.githubusercontent.com/')) fail(`${url} was redirected to ${res.url}`);
  const declared = Number(res.headers.get('content-length'));
  if (declared > MAX_DOWNLOAD_BYTES) fail(`${url} declares ${declared} bytes, over the ${MAX_DOWNLOAD_BYTES}-byte cap`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD_BYTES) fail(`${url} is ${buf.length} bytes, over the ${MAX_DOWNLOAD_BYTES}-byte cap`);
  return buf;
}

async function main(argv) {
  const clean = argv.includes('--clean');
  const record = argv.includes('--record-sha');
  if (existsSync(GEO_RAW) && readdirSync(GEO_RAW).length > 0) {
    if (!clean) fail('assets/geo-raw/ is not empty. Downloads always go into a fresh, empty folder: rerun with --clean.');
    rmSync(GEO_RAW, { recursive: true, force: true });
  }
  mkdirSync(GEO_RAW, { recursive: true });
  const shas = {};
  for (const name of new Set(OUTPUTS.map((o) => o.source))) {
    const buf = await download(NE_BASE + name);
    const sha = createHash('sha256').update(buf).digest('hex');
    writeFileSync(join(GEO_RAW, name), buf);
    shas[name] = sha;
    if (record) {
      console.log(`  '${name}': '${sha}',`);
      continue;
    }
    if (!NE_SHA256[name]) fail(`no recorded SHA-256 for ${name}. Run with --record-sha, paste the hashes into NE_SHA256, then run with --clean.`);
    if (NE_SHA256[name] !== sha) fail(`${name}: SHA-256 ${sha} does not match the recorded ${NE_SHA256[name]}. Do not use this file; stop and ask.`);
  }
  if (record) {
    console.log('make-map: paste the lines above into NE_SHA256 in scripts/make-map.mjs, then run npm run make-map -- --clean');
    return;
  }
  for (const out of OUTPUTS) {
    const geo = JSON.parse(readFileSync(join(GEO_RAW, out.source), 'utf8'));
    const paths = buildLand(geo, out.frame, out.tolerance);
    const src = renderModule(out, makeProjection(out.frame), paths, shas[out.source]);
    const bytes = Buffer.byteLength(src);
    if (bytes > out.maxBytes) fail(`${out.file} would be ${bytes} bytes, over its ${out.maxBytes}-byte budget (spec §6)`);
    writeFileSync(join(ROOT, out.file), src);
    console.log(`make-map: ${out.file}: ${paths.length} land paths, ${bytes} bytes`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => fail(err?.message ?? String(err)));
}
