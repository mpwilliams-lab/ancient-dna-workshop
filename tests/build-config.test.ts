// @vitest-environment node
// Build settings that keep the page self-contained and keep fixture builds out of dist/.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import makeConfig from '../vite.config';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VITE = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

/**
 * The config for a mode. 'serve' is used throughout so the production case does not depend on
 * src/data/workshop_data.json existing (only a production *build* throws when it is missing).
 */
function configFor(mode: string): any {
  return (makeConfig as any)({ command: 'serve', mode });
}

describe('vite.config.ts', () => {
  it.each([
    ['test', 'dist-fixture', /tests[\\/]fixtures[\\/]data\.fixture\.json$/],
    ['fixture', 'dist-fixture', /tests[\\/]fixtures[\\/]data\.fixture\.json$/],
    ['production', 'dist', /src[\\/]data[\\/]workshop_data\.json$/],
  ])('mode %s: output folder %s, and the data file that goes with it', (mode, outDir, dataFile) => {
    const c = configFor(mode);
    expect(c.build.outDir).toBe(outDir);
    expect(c.resolve.alias['@workshop-data']).toMatch(dataFile);
  });

  it.each(['test', 'fixture', 'production'])('mode %s: the module-preload helper is off (its polyfill calls fetch())', (mode) => {
    expect(configFor(mode).build.modulePreload).toBe(false);
  });
});

describe('a fixture build', () => {
  it('is a single file that makes no network calls (never fetch())', () => {
    const out = mkdtempSync(join(tmpdir(), 'fixture-build-'));
    // Same command as `npm run build:fixture`, but into a temp folder and without Vitest's own environment.
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (key === 'NODE_ENV' || key.startsWith('VITEST')) delete env[key];
    const r = spawnSync(process.execPath, [VITE, 'build', '--mode', 'fixture', '--outDir', out, '--emptyOutDir'], { cwd: ROOT, env, encoding: 'utf8' });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    expect(html).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|modulepreload/);
  }, 60_000);
});
