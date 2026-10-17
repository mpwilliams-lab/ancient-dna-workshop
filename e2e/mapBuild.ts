// A scratch build of the app with chosen map flags forced ON and those maps recorded as checked, for the layout proof of the map cards
// (Task 20) and for the instructor's preview of them. Until the instructor has checked a map (npm run visual-check -- D1 E1 G1) its
// shipped flag stays false and the committed manifest stays null, so the shipped dist/index.html draws the card's text form and cannot
// show how the map form fits.
//
// This is a test seam, not a feature switch: the two changes are made IN MEMORY while Vite reads src/features.ts and
// assets/manifest.json, into a fresh temporary directory outside the repo. No file in the repo is written, the committed flags and
// the committed visual_check entries are untouched, and the shipped build is never built this way. The check stamped into the
// scratch manifest is a stand-in with a fixed date, never an instructor's check.
//
// Written in the subset of TypeScript that Node 24 runs as it is (type stripping), so scripts/preview-maps.ts and plain .mjs scripts
// can import it too: relative imports carry their .ts extension and nothing here needs more than types erased.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, type Plugin } from 'vite';
import type { MapId } from '../src/types.ts';

/** The repo root: read when a build starts, not when the module loads, so the plugin can be imported anywhere (the unit tests do). */
const repoRoot = (): string => fileURLToPath(new URL('..', import.meta.url));

/** The three map cards of Task 20: the card, its flag (`map.<id>`) and its manifest key are all this id. Tasks 23, 24 and 27 add theirs. */
export const MAP_CARD_IDS: readonly MapId[] = ['D1', 'E1', 'G1'];

/** Turns the listed map flags on and records the listed maps as checked while the build reads their modules. A flag that is already
 *  on (the instructor has checked the map and the release task has shipped it) and a check that is already recorded are simply
 *  set again. Fails the build if a module no longer has the shape this rewrites, so a reformatted features.ts or manifest can never
 *  leave the proof testing the text form. */
export function forceMaps(ids: readonly MapId[] = MAP_CARD_IDS): Plugin {
  return {
    name: 'adw-force-maps',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      const file = id.split('?')[0]!.replace(/\\/g, '/');
      if (file.endsWith('/src/features.ts')) {
        let out = code;
        for (const map of ids) {
          const entry = new RegExp(`('map\\.${map}'\\s*:\\s*)(?:false|true)\\b`);
          if (!entry.test(out)) throw new Error(`adw-force-maps: src/features.ts has no 'map.${map}' entry to turn on`);
          out = out.replace(entry, '$1true');
        }
        return { code: out, map: null };
      }
      if (file.endsWith('/assets/manifest.json')) {
        const manifest = JSON.parse(code) as { maps: Record<string, { visual_check: unknown }> };
        for (const map of ids) {
          if (manifest.maps[map] === undefined) throw new Error(`adw-force-maps: assets/manifest.json has no maps.${map}`);
          manifest.maps[map] = { visual_check: { by: 'instructor', at: '2026-10-19T15:00:00-07:00' } };
        }
        return { code: JSON.stringify(manifest), map: null };
      }
      return null;
    },
  };
}

export interface MapApp {
  /** file:// URL of the built page. */
  url: string;
  /** Deletes the temporary directory. */
  cleanup(): void;
}

/** Builds the app (real data, shipped everything else) into a new temporary directory. Takes a few seconds at most. */
export async function buildMapApp(ids: readonly MapId[] = MAP_CARD_IDS): Promise<MapApp> {
  const dir = mkdtempSync(join(tmpdir(), 'adw-maps-'));
  try {
    await build({
      root: repoRoot(),
      configFile: join(repoRoot(), 'vite.config.ts'),
      logLevel: 'warn',
      plugins: [forceMaps(ids)],
      build: { outDir: dir, emptyOutDir: true },
    });
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return { url: pathToFileURL(join(dir, 'index.html')).href, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
