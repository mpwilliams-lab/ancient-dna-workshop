// @vitest-environment node
// Spec §7.2 visual-check gate and size budgets; CONTRACT §4.14 uncheckedAssets / check-release / releaseWarnings.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSET_MANIFEST, MAP_IDS } from '../src/assetManifest';
import { ALL_OFF, ALL_ON, FEATURE_FLAGS, withFeatures } from '../src/features';
import {
  IMAGE_MAX_BYTES, IMAGES_TOTAL_MAX_BYTES, PAGE_MAX_BYTES, checkRelease, imageFlag, mapFlag, uncheckedAssets,
} from '../src/release';
import makeConfig, { releaseWarnings } from '../vite.config';
import { checkedManifest } from './helpers/assetEnv';

const ROOT = resolve(__dirname, '..');
const VITE = resolve(ROOT, 'node_modules/vite/bin/vite.js');
const EVERY_ID = new Set(ASSET_MANIFEST.images.map((e) => e.id));

describe('uncheckedAssets', () => {
  it('reports nothing while every flag is off', () => {
    expect(uncheckedAssets(ALL_OFF, ASSET_MANIFEST, new Set())).toEqual([]);
  });
  it('one line per enabled card, naming each image without a check, in manifest order', () => {
    expect(uncheckedAssets(withFeatures({ 'images.B1': true }, ALL_OFF), ASSET_MANIFEST, null)).toEqual([
      'B1 (images.B1): stonehenge: no visual check; avebury: no visual check; ring-of-brodgar: no visual check; thornborough-plan: no visual check; castlerigg: no visual check',
    ]);
  });
  it('a checked image whose file is not bundled is still reported; the Shrewton photo is skipped (it can never show)', () => {
    expect(uncheckedAssets(withFeatures({ 'images.C1': true }, ALL_OFF), checkedManifest(), new Set(['amesbury-archer']))).toEqual([
      'C1 (images.C1): round-barrow: no bundled file (src/assets/img/round-barrow.jpg)',
    ]);
    expect(uncheckedAssets(withFeatures({ 'images.B1': true }, ALL_OFF), checkedManifest(), new Set(['stonehenge', 'avebury', 'ring-of-brodgar', 'castlerigg']))).toEqual([
      'B1 (images.B1): thornborough-plan: no bundled file (src/assets/svg/thornborough-plan.svg)',
    ]);
  });
  it('maps: one line per enabled map without a check; the F1 inset belongs to F1 under romanInset', () => {
    expect(uncheckedAssets(withFeatures({ 'map.D1': true, romanInset: true }, ALL_OFF), ASSET_MANIFEST, null)).toEqual([
      'D1 (map.D1): map D1: no visual check',
      'F1 (romanInset): map F1inset: no visual check',
    ]);
  });
  it('everything checked and bundled with every flag on: nothing to report', () => {
    expect(uncheckedAssets(ALL_ON, checkedManifest(), EVERY_ID)).toEqual([]);
  });
  it('every manifest image and map maps to a real flag', () => {
    for (const e of ASSET_MANIFEST.images) expect(FEATURE_FLAGS, e.id).toContain(imageFlag(e));
    for (const id of MAP_IDS) expect(FEATURE_FLAGS, id).toContain(mapFlag(id));
  });
  it('fails for one unchecked image among checked ones, whichever flag it sits under: an enabled card is never shipped half checked', () => {
    for (const e of ASSET_MANIFEST.images) {
      if (e.id === 'shrewton-beaker') continue;      // can never show beside the Archer photo; skipped by design
      const flag = imageFlag(e)!;
      const lines = uncheckedAssets(withFeatures({ [flag]: true }, ALL_OFF), checkedManifest([e.id]), EVERY_ID);
      expect(lines, e.id).toEqual([`${e.card} (${flag}): ${e.id}: no visual check`]);
    }
    for (const id of MAP_IDS) {
      const lines = uncheckedAssets(withFeatures({ [mapFlag(id)]: true }, ALL_OFF), checkedManifest([id]), EVERY_ID);
      expect(lines, id).toEqual([`${id === 'F1inset' ? 'F1' : id} (${mapFlag(id)}): map ${id}: no visual check`]);
    }
  });
  it('a flag that is off is never reported, however unchecked its assets are', () => {
    expect(uncheckedAssets(withFeatures({ 'images.E2': true }, ALL_OFF), checkedManifest(['stonehenge', 'D1', 'milk']), EVERY_ID)).toEqual([]);
  });
});

describe('checkRelease (what npm run check-release prints and decides)', () => {
  it('passes, naming the flags that are on, when every enabled card has checked and bundled assets', () => {
    expect(checkRelease(ALL_OFF, ASSET_MANIFEST, new Set())).toEqual({ ok: true, stdout: ['check-release: ok (0 flag(s) on: none)'], stderr: [] });
    expect(checkRelease(withFeatures({ 'images.B1': true, 'map.D1': true }, ALL_OFF), checkedManifest(), EVERY_ID)).toEqual({
      ok: true, stdout: ['check-release: ok (2 flag(s) on: map.D1, images.B1)'], stderr: [],
    });
  });
  it('FAILS while any asset of an enabled card is unchecked, listing every one, and says how to fix it', () => {
    const r = checkRelease(withFeatures({ 'images.B1': true, 'map.D1': true }, ALL_OFF), checkedManifest(['stonehenge', 'D1']), EVERY_ID);
    expect(r.ok).toBe(false);
    expect(r.stdout).toEqual([]);
    expect(r.stderr).toEqual([
      'check-release: FAILED. These cards are switched on but would show an unchecked or missing image or map:',
      '  B1 (images.B1): stonehenge: no visual check',
      '  D1 (map.D1): map D1: no visual check',
      'Fix: the instructor checks the item (npm run visual-check -- <id>) and it is promoted, or its flag goes back to false in src/features.ts.',
    ]);
  });
  it('FAILS for a checked image whose file is not bundled', () => {
    const r = checkRelease(withFeatures({ 'images.H1': true }, ALL_OFF), checkedManifest(), new Set(['milk']));
    expect(r.ok).toBe(false);
    expect(r.stderr[1]).toBe('  H1 (images.H1): cow: no bundled file (src/assets/img/cow.jpg)');
  });
  it('the real CLI, built the way npm run check-release builds it, passes on the shipped flags', () => {
    const out = mkdtempSync(join(tmpdir(), 'check-release-'));
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (key === 'NODE_ENV' || key.startsWith('VITEST')) delete env[key];
    const built = spawnSync(process.execPath, [VITE, 'build', '--ssr', 'scripts/check-release.ts', '--outDir', out, '--emptyOutDir'], { cwd: ROOT, env, encoding: 'utf8' });
    expect(built.status, `${built.stdout}\n${built.stderr}`).toBe(0);
    const run = spawnSync(process.execPath, [join(out, 'check-release.js')], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/^check-release: ok \(/);
  }, 60_000);
});

describe('size budgets (spec §7.2)', () => {
  it('are 160 KB per image, 2.2 MB for all images and 3.5 MB for the page', () => {
    expect(IMAGE_MAX_BYTES).toBe(160 * 1024);
    expect(IMAGES_TOTAL_MAX_BYTES).toBe(Math.round(2.2 * 1024 * 1024));
    expect(PAGE_MAX_BYTES).toBe(Math.round(3.5 * 1024 * 1024));
  });
});

describe('vite.config.ts', () => {
  it('registers the release-warnings plugin for builds (it prints warnings and never fails the build)', () => {
    const c = (makeConfig as any)({ command: 'build', mode: 'test' });
    const names = (c.plugins as unknown[]).flat(Infinity).map((p: any) => p?.name);
    expect(names).toContain('release-warnings');
  });
});

describe('releaseWarnings() (spec §7.2: npm run build warns, check-release fails)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const start = (plugin: Plugin): void => (plugin as unknown as { buildStart: () => void }).buildStart();
  /** The warnings a build prints for these flags, this manifest and these bundled files (by default every image is bundled). */
  const run = (features = ALL_OFF, manifest = ASSET_MANIFEST, bundled: ReadonlySet<string> = EVERY_ID): string[] => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => start(releaseWarnings(features, manifest, () => bundled))).not.toThrow();
    return warn.mock.calls.map((c) => String(c[0]));
  };
  it('prints nothing while every flag is off (the shipped state)', () => {
    expect(run()).toEqual([]);
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {});
    start(releaseWarnings());   // the real flags, manifest and folders
    expect(quiet).not.toHaveBeenCalled();
  });
  it('prints one line per enabled card with an unchecked image or map, and says the card shows its text form; it never throws', () => {
    expect(run(withFeatures({ 'images.B1': true, 'map.D1': true }, ALL_OFF))).toEqual([
      '[release-warnings] B1 (images.B1): stonehenge: no visual check; avebury: no visual check; ring-of-brodgar: no visual check; thornborough-plan: no visual check; castlerigg: no visual check. That card shows its text form until this is fixed.',
      '[release-warnings] D1 (map.D1): map D1: no visual check. That card shows its text form until this is fixed.',
    ]);
  });
  it('also reports a checked image whose file is not in src/assets (the folders it is given are the ones it reads)', () => {
    expect(run(withFeatures({ 'images.H1': true }, ALL_OFF), checkedManifest(), new Set(['milk']))).toEqual([
      '[release-warnings] H1 (images.H1): cow: no bundled file (src/assets/img/cow.jpg). That card shows its text form until this is fixed.',
    ]);
  });
  it('is applied to builds only', () => {
    expect((releaseWarnings() as { apply: string }).apply).toBe('build');
  });
});

describe('visual_check belongs to the instructor alone (spec §7.2, CONTRACT §6)', () => {
  const MANIFEST_FILE = resolve(ROOT, 'assets/manifest.json');
  it('npm run visual-check refuses to run without an interactive terminal, and leaves the manifest as it was', () => {
    const before = readFileSync(MANIFEST_FILE, 'utf8');
    const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts/visual-check.mjs'), 'stonehenge'], { encoding: 'utf8', input: 'yes\nyes\n' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('run this yourself in a terminal');
    expect(readFileSync(MANIFEST_FILE, 'utf8')).toBe(before);
  });
});
