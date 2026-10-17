// The scratch-build seam of e2e/mapBuild.ts (Task 20): it turns map flags on and records maps as checked IN MEMORY while Vite reads two
// modules (and, for A1, fills the list of confirmed label names in a third, Task 23), so the layout proof can see the map form before
// the instructor's check. These tests pin what it rewrites and, as important, what it leaves alone, because a seam that quietly stops
// working would leave e2e/maps.spec.ts proving the text form.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { a1LabelCandidates, forceMaps, MAP_CARD_IDS } from '../e2e/mapBuild';

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
  it('covers the four map cards built so far', () => {
    expect([...MAP_CARD_IDS]).toEqual(['A1', 'D1', 'E1', 'G1']);
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
