// The scratch-build seam of e2e/mapBuild.ts (Task 20): it turns map flags on and records maps as checked IN MEMORY while Vite reads two
// modules (and, for A1, fills the list of confirmed label names in a third, Task 23), so the layout proof can see the map form before
// the instructor's check. These tests pin what it rewrites and, as important, what it leaves alone, because a seam that quietly stops
// working would leave e2e/maps.spec.ts proving the text form. Task 26 adds the pictures half (forceImages), at the end.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { PORTRAIT_HEIGHT, THUMB_WIDTH } from '../scripts/fetch-assets.mjs';
import { CARDS } from '../src/cards';
import { MAP_SPECS_BUILT } from '../src/maps';
import { CARD_IDS } from '../src/types';
import { a1LabelCandidates, forceImages, forceMaps, IMAGE_CARD_IDS, MAP_CARD_IDS, PHOTO_SIZES, standInPicture } from '../e2e/mapBuild';

type Transform = (code: string, id: string) => { code: string; map: null } | null;
const transformOf = (ids?: Parameters<typeof forceMaps>[0], options?: Parameters<typeof forceMaps>[1]): Transform =>
  forceMaps(ids, options).transform as unknown as Transform;

const ROOT = resolve(__dirname, '..');
const featuresTs = readFileSync(resolve(ROOT, 'src/features.ts'), 'utf8');
const manifestJson = readFileSync(resolve(ROOT, 'assets/manifest.json'), 'utf8');
const mapsTs = readFileSync(resolve(ROOT, 'src/maps.ts'), 'utf8');
const FEATURES_ID = '/repo/src/features.ts';
const MANIFEST_ID = '/repo/assets/manifest.json';
const MAPS_ID = '/repo/src/maps.ts';

describe('forceMaps: the flags (src/features.ts)', () => {
  it('covers the nine map cards built so far, and every one is in MAP_SPECS_BUILT (the seam cannot force a map that has no spec)', () => {
    expect([...MAP_CARD_IDS]).toEqual(['A1', 'D1', 'E1', 'G1', 'H2', 'I2', 'J3', 'K2', 'L3']);
    for (const id of MAP_CARD_IDS) expect(MAP_SPECS_BUILT.has(id), id).toBe(true);
    expect([...MAP_SPECS_BUILT].filter((id) => !MAP_CARD_IDS.includes(id)), 'a built map the proofs do not cover').toEqual([]);
  });

  it('sets the map flags to true and changes no other line of the module', () => {
    const out = transformOf()(featuresTs, FEATURES_ID)!.code;
    const before = featuresTs.split('\n');
    const after = out.split('\n');
    expect(after).toHaveLength(before.length);
    const changed = after.map((line, i) => [before[i]!, line] as const).filter(([a, b]) => a !== b);
    for (const [a, b] of changed) expect(b).toBe(a.replace(/false\b/, 'true'));
    for (const id of MAP_CARD_IDS) expect(out).toMatch(new RegExp(`'map\\.${id}': true,`));
    // Any that ships on already is just set again: nothing to turn on, nothing thrown.
    expect(transformOf()(out, FEATURES_ID)!.code).toBe(out);
  });

  it('touches only the flags it is asked for', () => {
    const out = transformOf(['G1'])(featuresTs, FEATURES_ID)!.code;
    expect(out).toMatch(/'map\.G1': true,/);
    const before = featuresTs.split('\n');
    const changed = out.split('\n').filter((line, i) => line !== before[i]);
    expect(changed.length).toBeLessThanOrEqual(1);
    for (const line of changed) expect(line).toMatch(/'map\.G1': true,/);
    const state = (source: string): string | undefined => /'map\.D1': (false|true),/.exec(source)?.[1];
    expect(state(out)).toBe(state(featuresTs));
  });

  it('fails the build when a module no longer has the entry, so the proof can never test the text form by accident', () => {
    expect(() => transformOf()('export const FEATURES = {};', FEATURES_ID)).toThrow(/no 'map\.A1' entry/);
    // (Only the object entry `'map.E1': …`, not the name in the list of flags above it.)
    expect(() => transformOf()(featuresTs.replace(/'map\.E1'(\s*:)/, "'map.E1x'$1"), FEATURES_ID)).toThrow(/no 'map\.E1' entry/);
    expect(() => transformOf()(featuresTs.replace(/'map\.A1'(\s*:)/, "'map.A1x'$1"), FEATURES_ID)).toThrow(/no 'map\.A1' entry/);
  });
});

describe('forceMaps: the manifest (assets/manifest.json)', () => {
  const original = JSON.parse(manifestJson) as { images: unknown[]; maps: Record<string, { visual_check: unknown }> };
  const out = JSON.parse(transformOf()(manifestJson, MANIFEST_ID)!.code) as typeof original;

  it('records the maps as checked, with a stand-in check that is never the instructor\'s file', () => {
    for (const id of MAP_CARD_IDS) {
      expect(out.maps[id]!.visual_check, id).toEqual({ by: 'instructor', at: '2026-10-19T15:00:00-07:00' });
    }
  });

  it('leaves every other map and every image exactly as committed', () => {
    for (const id of Object.keys(original.maps).filter((k) => !(MAP_CARD_IDS as readonly string[]).includes(k))) {
      expect(out.maps[id], id).toEqual(original.maps[id]);
    }
    expect(out.images).toEqual(original.images);
  });

  it('works on the committed file only in memory: the file on disk is not touched', () => {
    expect(readFileSync(resolve(ROOT, 'assets/manifest.json'), 'utf8')).toBe(manifestJson);
  });

  it('fails the build for a manifest without the map', () => {
    expect(() => transformOf()(JSON.stringify({ images: [], maps: {} }), MANIFEST_ID)).toThrow(/no maps\.A1/);
  });
});

// Task 23. In the repo A1_CONFIRMED_LABELS stays empty until the instructor confirms the eight names (open check 14), so the shipped
// build draws A1 unlabelled. The layout proof (e2e/maps.spec.ts) and the preview must also see it labelled, hence this third rewrite.
describe('forceMaps: the A1 label list (src/maps.ts, with options.a1Labels)', () => {
  const DECLARATION = /export const A1_CONFIRMED_LABELS: readonly string\[\] = \[[^\]]*\];/;

  it('is found in the real module, so the rewrite works on what the build really reads', () => {
    expect(mapsTs).toMatch(DECLARATION);
  });

  it('fills the list with the names given and changes nothing else in the module', () => {
    const out = transformOf(undefined, { a1Labels: ['Czech', 'Sicilian'] })(mapsTs, MAPS_ID)!.code;
    expect(out).toContain('export const A1_CONFIRMED_LABELS: readonly string[] = ["Czech","Sicilian"];');
    expect(out.replace(DECLARATION, '')).toBe(mapsTs.replace(DECLARATION, ''));
    // An empty list is a rewrite too (the unlabelled map, whatever the repo holds).
    expect(transformOf(undefined, { a1Labels: [] })(mapsTs, MAPS_ID)!.code).toContain('A1_CONFIRMED_LABELS: readonly string[] = [];');
  });

  it('works on a list the instructor has already filled (several lines), and sets it again', () => {
    const filled = mapsTs.replace(DECLARATION, 'export const A1_CONFIRMED_LABELS: readonly string[] = [\n  \'Estonian\',\n  \'Lithuanian\',\n];');
    expect(filled).toMatch(/\[\n  'Estonian',\n  'Lithuanian',\n\];/);   // (the module's own comments name the groups too; look at the declaration)
    const out = transformOf(undefined, { a1Labels: ['Czech'] })(filled, MAPS_ID)!.code;
    expect(out.match(DECLARATION)![0]).toBe('export const A1_CONFIRMED_LABELS: readonly string[] = ["Czech"];');
    expect(out).not.toMatch(/\[\n  'Estonian'/);
  });

  it('leaves src/maps.ts alone unless it is asked for labels, and every other module always', () => {
    expect(transformOf()(mapsTs, MAPS_ID)).toBeNull();
    expect(transformOf(undefined, { a1Labels: ['Czech'] })('export const x = 1;', '/repo/src/cards.ts')).toBeNull();
    expect(transformOf(undefined, { a1Labels: ['Czech'] })(mapsTs, '/repo/src/plots/map.ts')).toBeNull();
    // The flags and the manifest are still rewritten in the same plugin.
    expect(transformOf(undefined, { a1Labels: ['Czech'] })(featuresTs, FEATURES_ID)).not.toBeNull();
  });

  it('fails the build when the module no longer has the list, so the proof can never see an unlabelled map by accident', () => {
    expect(() => transformOf(undefined, { a1Labels: ['Czech'] })(mapsTs.replace('A1_CONFIRMED_LABELS', 'A1_NAMES'), MAPS_ID)).toThrow(/no A1_CONFIRMED_LABELS list/);
  });

  it('the candidates are the eight names the data build chose, in europe_pops order, none an isolate', () => {
    expect(a1LabelCandidates(ROOT)).toEqual(['Estonian', 'Lithuanian', 'Czech', 'Hungarian', 'Romanian', 'Serbian', 'South Italian', 'Sicilian']);
  });
});

describe('forceMaps: everything else', () => {
  it('does not touch any other module, and finds the two it rewrites by path on any platform', () => {
    expect(transformOf()('export const x = 1;', '/repo/src/cards.ts')).toBeNull();
    expect(transformOf()('{}', '/repo/tests/fixtures/manifest.json')).toBeNull();
    expect(transformOf()(featuresTs, 'C:\\repo\\src\\features.ts?v=1')).not.toBeNull();
    expect(transformOf()(manifestJson, 'C:\\repo\\assets\\manifest.json')).not.toBeNull();
    expect(transformOf(undefined, { a1Labels: ['Czech'] })(mapsTs, 'C:\\repo\\src\\maps.ts?v=1')).not.toBeNull();
  });

  it('is a build-time plugin that runs before the others', () => {
    const plugin = forceMaps();
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('pre');
  });
});

// ---- Task 26: the pictures half of the seam (forceImages, buildFormsApp) ----
// The layout matrix (e2e/layout.spec.ts) builds the app with every map AND every picture forced on, so that the 15 upgraded forms are
// proved to fit before the instructor has checked a single one. The pictures are stand-ins of the staged photos' exact pixel sizes; the
// staged files themselves are never opened. These tests pin what forceImages rewrites, that its table of sizes stays complete and
// agrees with the manifest, and that the two halves work together.

const assetsTs = readFileSync(resolve(ROOT, 'src/assets.ts'), 'utf8');
const ASSETS_ID = '/repo/src/assets.ts';
const imagesOf = (ids?: Parameters<typeof forceImages>[0]): Transform => forceImages(ids).transform as unknown as Transform;
const GLOB = /const JPEGS = import\.meta\.glob<string>\([^;]*\);/;
interface ManifestShape { images: { id: string; card: string; kind: string; orientation: string; visual_check: unknown }[]; maps: Record<string, { visual_check: unknown }> }

describe('forceImages: the flags (src/features.ts)', () => {
  it('covers exactly the cards that have an images.* flag, and the module has an entry for each', () => {
    const flagged = CARD_IDS.filter((id) => CARDS[id].feature === `images.${id}`);
    expect([...IMAGE_CARD_IDS]).toEqual(flagged);
    expect(flagged).toEqual(['B1', 'C1', 'E2', 'F1', 'G2', 'H1', 'I1', 'J1']);
    for (const id of IMAGE_CARD_IDS) expect(featuresTs, id).toMatch(new RegExp(`'images\\.${id}': (false|true),`));
  });

  it('sets the image flags to true and changes no other line of the module', () => {
    const out = imagesOf()(featuresTs, FEATURES_ID)!.code;
    const before = featuresTs.split('\n');
    const after = out.split('\n');
    expect(after).toHaveLength(before.length);
    const changed = after.map((line, i) => [before[i]!, line] as const).filter(([a, b]) => a !== b);
    for (const [a, b] of changed) expect(b).toBe(a.replace(/false\b/, 'true'));
    for (const id of IMAGE_CARD_IDS) expect(out).toMatch(new RegExp(`'images\\.${id}': true,`));
    // Any that ships on already is just set again: nothing to turn on, nothing thrown.
    expect(imagesOf()(out, FEATURES_ID)!.code).toBe(out);
  });

  it('touches only the cards it is asked for, and no map flag', () => {
    const out = imagesOf(['H1'])(featuresTs, FEATURES_ID)!.code;
    expect(out).toMatch(/'images\.H1': true,/);
    const before = featuresTs.split('\n');
    const changed = out.split('\n').filter((line, i) => line !== before[i]);
    expect(changed.length).toBeLessThanOrEqual(1);
    for (const line of changed) expect(line).toMatch(/'images\.H1': true,/);
    // No map flag is touched: its lines are the committed ones, whichever of them the release step has switched on (this used to say
    // "none is true", which holds only until the first map ships: the flip of map.K2 and map.L3 would have failed it).
    const mapFlagLines = (source: string): string[] => source.split('\n').filter((line) => /'map\.[A-Z0-9]+'\s*:/.test(line));
    expect(mapFlagLines(featuresTs).length, 'the nine map flags').toBe(9);
    expect(mapFlagLines(imagesOf()(featuresTs, FEATURES_ID)!.code)).toEqual(mapFlagLines(featuresTs));
  });

  it('fails the build when a module no longer has the entry, so the proof can never test the text form by accident', () => {
    expect(() => imagesOf()('export const FEATURES = {};', FEATURES_ID)).toThrow(/no 'images\.B1' entry/);
    expect(() => imagesOf()(featuresTs.replace(/'images\.J1'(\s*:)/, "'images.J1x'$1"), FEATURES_ID)).toThrow(/no 'images\.J1' entry/);
  });
});

describe('forceImages: the manifest (assets/manifest.json)', () => {
  const original = JSON.parse(manifestJson) as ManifestShape;
  const out = JSON.parse(imagesOf()(manifestJson, MANIFEST_ID)!.code) as ManifestShape;
  const stamp = { by: 'instructor', at: '2026-10-19T15:00:00-07:00' };

  it('records every picture of the forced cards as checked, with a stand-in check that is never the instructor\'s file', () => {
    const mine = out.images.filter((e) => (IMAGE_CARD_IDS as readonly string[]).includes(e.card));
    expect(mine.length, 'the manifest has the pictures of all eight cards').toBeGreaterThanOrEqual(18);
    for (const e of mine) expect(e.visual_check, e.id).toEqual(stamp);
  });

  it('leaves the maps, and the pictures of cards it is not asked for, exactly as committed', () => {
    expect(out.maps).toEqual(original.maps);
    const only = JSON.parse(imagesOf(['H1'])(manifestJson, MANIFEST_ID)!.code) as ManifestShape;
    for (const e of only.images) {
      const was = original.images.find((x) => x.id === e.id)!;
      expect(e.visual_check, e.id).toEqual(e.card === 'H1' ? stamp : was.visual_check);
    }
  });

  it('works on the committed file only in memory: the file on disk is not touched', () => {
    expect(readFileSync(resolve(ROOT, 'assets/manifest.json'), 'utf8')).toBe(manifestJson);
  });

  it('fails the build for a manifest without the pictures of a card', () => {
    expect(() => imagesOf()(JSON.stringify({ images: [], maps: {} }), MANIFEST_ID)).toThrow(/no image for card B1/);
  });
});

describe('forceImages: the bundled pictures (src/assets.ts)', () => {
  it('finds the JPEG glob in the real module, so the rewrite works on what the build really reads', () => {
    expect(assetsTs).toMatch(GLOB);
  });

  it('replaces the glob by one stand-in per staged photo, each a PNG of that photo\'s exact pixel size, and changes nothing else in the module', () => {
    const out = imagesOf()(assetsTs, ASSETS_ID)!.code;
    expect(out.replace(/const JPEGS: Record<string, string> = .*;/, '')).toBe(assetsTs.replace(GLOB, ''));
    const table = JSON.parse(/const JPEGS: Record<string, string> = (.*);/.exec(out)![1]!) as Record<string, string>;
    expect(Object.keys(table).sort()).toEqual(Object.keys(PHOTO_SIZES).map((id) => `./assets/img/${id}.jpg`).sort());
    for (const [id, [w, h]] of Object.entries(PHOTO_SIZES)) {
      const url = table[`./assets/img/${id}.jpg`]!;
      expect(url.startsWith('data:image/png;base64,'), id).toBe(true);
      const png = PNG.sync.read(Buffer.from(url.slice('data:image/png;base64,'.length), 'base64'));
      expect([png.width, png.height], id).toEqual([w, h]);
    }
  });

  it('fails the build when the module no longer has the glob, so the proof can never see the text form by accident', () => {
    expect(() => imagesOf()(assetsTs.replace('const JPEGS', 'const PICTURES'), ASSETS_ID)).toThrow(/no longer has the JPEGS glob/);
  });

  it('leaves every other module alone, and finds the three it rewrites by path on any platform', () => {
    expect(imagesOf()('export const x = 1;', '/repo/src/cards.ts')).toBeNull();
    expect(imagesOf()(assetsTs, '/repo/src/plots/map.ts')).toBeNull();
    expect(imagesOf()(featuresTs, 'C:\\repo\\src\\features.ts?v=1')).not.toBeNull();
    expect(imagesOf()(manifestJson, 'C:\\repo\\assets\\manifest.json')).not.toBeNull();
    expect(imagesOf()(assetsTs, 'C:\\repo\\src\\assets.ts?v=1')).not.toBeNull();
  });

  it('is a build-time plugin that runs before the others', () => {
    const plugin = forceImages();
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('pre');
  });
});

describe('PHOTO_SIZES: the stand-ins\' table', () => {
  const manifest = JSON.parse(manifestJson) as ManifestShape;
  const photos = manifest.images.filter((e) => e.kind === 'photo');

  it('has every third-party photo of the manifest except Shrewton (an optional tile that is never fetched), and nothing else', () => {
    expect(Object.keys(PHOTO_SIZES).sort()).toEqual(photos.map((e) => e.id).filter((id) => id !== 'shrewton-beaker').sort());
  });

  it('agrees with the manifest on every photo\'s orientation and with the staging limits (landscape at most 900 wide, portrait at most 600 tall)', () => {
    for (const e of photos) {
      const size = PHOTO_SIZES[e.id];
      if (size === undefined) continue;
      const [w, h] = size;
      expect(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0, e.id).toBe(true);
      if (e.orientation === 'landscape') expect([w >= h, w <= THUMB_WIDTH], `${e.id} (landscape)`).toEqual([true, true]);
      else expect([h > w, h <= PORTRAIT_HEIGHT], `${e.id} (portrait)`).toEqual([true, true]);
    }
  });

  it('standInPicture is a real PNG of the size asked for, with the dark frame that shows a picture drawn whole', () => {
    const png = PNG.sync.read(Buffer.from(standInPicture(30, 20).slice('data:image/png;base64,'.length), 'base64'));
    expect([png.width, png.height]).toEqual([30, 20]);
    expect(png.data[0]).toBe(40);                              // the corner is frame
    expect(png.data[(10 * 30 + 15) * 4]).toBeGreaterThan(40);  // the middle is not
  });
});

describe('forceMaps and forceImages together (the build the layout matrix uses)', () => {
  it('turn the nine map flags and the eight image flags on, and nothing else, whichever runs first', () => {
    const both = imagesOf()(transformOf()(featuresTs, FEATURES_ID)!.code, FEATURES_ID)!.code;
    const reverse = transformOf()(imagesOf()(featuresTs, FEATURES_ID)!.code, FEATURES_ID)!.code;
    expect(reverse).toBe(both);
    const on = [...both.matchAll(/'([a-zA-Z0-9.]+)': true,/g)].map((m) => m[1]!);
    expect(on.sort()).toEqual([...MAP_CARD_IDS.map((m) => `map.${m}`), ...IMAGE_CARD_IDS.map((i) => `images.${i}`)].sort());
  });

  it('record the maps and the pictures as checked in the same manifest', () => {
    const out = JSON.parse(imagesOf()(transformOf()(manifestJson, MANIFEST_ID)!.code, MANIFEST_ID)!.code) as ManifestShape;
    for (const id of MAP_CARD_IDS) expect(out.maps[id]!.visual_check, id).not.toBeNull();
    for (const e of out.images) expect(e.visual_check, e.id).not.toBeNull();
  });
});
