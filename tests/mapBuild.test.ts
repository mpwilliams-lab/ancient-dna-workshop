// The scratch-build seam of e2e/mapBuild.ts (Task 20): it turns map flags on and records maps as checked IN MEMORY while Vite reads two
// modules, so the layout proof can see the map form before the instructor's check. These tests pin what it rewrites and, as
// important, what it leaves alone, because a seam that quietly stops working would leave e2e/maps.spec.ts proving the text form.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forceMaps, MAP_CARD_IDS } from '../e2e/mapBuild';

type Transform = (code: string, id: string) => { code: string; map: null } | null;
const transformOf = (ids?: Parameters<typeof forceMaps>[0]): Transform => forceMaps(ids).transform as unknown as Transform;

const ROOT = resolve(__dirname, '..');
const featuresTs = readFileSync(resolve(ROOT, 'src/features.ts'), 'utf8');
const manifestJson = readFileSync(resolve(ROOT, 'assets/manifest.json'), 'utf8');
const FEATURES_ID = '/repo/src/features.ts';
const MANIFEST_ID = '/repo/assets/manifest.json';

describe('forceMaps: the flags (src/features.ts)', () => {
  it('sets the three map flags to true and changes no other line of the module', () => {
    const out = transformOf()(featuresTs, FEATURES_ID)!.code;
    const before = featuresTs.split('\n');
    const after = out.split('\n');
    expect(after).toHaveLength(before.length);
    const changed = after.map((line, i) => [before[i]!, line] as const).filter(([a, b]) => a !== b);
    for (const [a, b] of changed) expect(b).toBe(a.replace(/false\b/, 'true'));
    for (const id of MAP_CARD_IDS) expect(out).toMatch(new RegExp(`'map\\.${id}': true,`));
    // Any of the three that ships on already is just set again: nothing to turn on, nothing thrown.
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
    expect(() => transformOf()('export const FEATURES = {};', FEATURES_ID)).toThrow(/no 'map\.D1' entry/);
    // (Only the object entry `'map.E1': …`, not the name in the list of flags above it.)
    expect(() => transformOf()(featuresTs.replace(/'map\.E1'(\s*:)/, "'map.E1x'$1"), FEATURES_ID)).toThrow(/no 'map\.E1' entry/);
  });
});

describe('forceMaps: the manifest (assets/manifest.json)', () => {
  const original = JSON.parse(manifestJson) as { images: unknown[]; maps: Record<string, { visual_check: unknown }> };
  const out = JSON.parse(transformOf()(manifestJson, MANIFEST_ID)!.code) as typeof original;

  it('records the three maps as checked, with a stand-in check that is never the instructor\'s file', () => {
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
    expect(() => transformOf()(JSON.stringify({ images: [], maps: {} }), MANIFEST_ID)).toThrow(/no maps\.D1/);
  });
});

describe('forceMaps: everything else', () => {
  it('does not touch any other module, and finds the two it rewrites by path on any platform', () => {
    expect(transformOf()('export const x = 1;', '/repo/src/cards.ts')).toBeNull();
    expect(transformOf()('{}', '/repo/tests/fixtures/manifest.json')).toBeNull();
    expect(transformOf()(featuresTs, 'C:\\repo\\src\\features.ts?v=1')).not.toBeNull();
    expect(transformOf()(manifestJson, 'C:\\repo\\assets\\manifest.json')).not.toBeNull();
  });

  it('is a build-time plugin that runs before the others', () => {
    const plugin = forceMaps();
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('pre');
  });
});
