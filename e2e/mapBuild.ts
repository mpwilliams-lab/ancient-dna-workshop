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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, type Plugin } from 'vite';
import type { MapId } from '../src/types.ts';

/** The repo root: read when a build starts, not when the module loads, so the plugin can be imported anywhere (the unit tests do). */
const repoRoot = (): string => fileURLToPath(new URL('..', import.meta.url));

/** The map cards built so far (Tasks 20 and 23): the card, its flag (`map.<id>`) and its manifest key are all this id. Tasks 24, 27
 *  and 29 add theirs. */
export const MAP_CARD_IDS: readonly MapId[] = ['A1', 'D1', 'E1', 'G1'];

export interface ForceOptions {
  /** A1 only: the names the scratch build puts in A1_CONFIRMED_LABELS (src/maps.ts), so the map is drawn labelled. In the repo that list
   *  stays empty until the instructor confirms open check 14, and the map ships unlabelled; this is how the layout proof and the preview
   *  see the labelled map before he has. Left out, the list is whatever the repo has. */
  a1Labels?: readonly string[];
}

/** The groups the data build chose for A1 labels (open check 14): the non-isolate `map_label` names of the real data, in europe_pops
 *  order. `root` is the repo root (default: found from this file; the unit tests, whose import.meta.url is not a file, pass theirs). */
export function a1LabelCandidates(root: string = repoRoot()): string[] {
  const data = JSON.parse(readFileSync(join(root, 'src/data/workshop_data.json'), 'utf8')) as {
    europe_pops?: { label: string; isolate: boolean; map_label: boolean }[];
  };
  return (data.europe_pops ?? []).filter((p) => !p.isolate && p.map_label).map((p) => p.label);
}

/** Turns the listed map flags on and records the listed maps as checked while the build reads their modules (and, with
 *  options.a1Labels, fills A1_CONFIRMED_LABELS). A flag that is already on (the instructor has checked the map and the release task
 *  has shipped it), a check that is already recorded and a list that is already filled are simply set again. Fails the build if a
 *  module no longer has the shape this rewrites, so a reformatted features.ts, manifest or maps.ts can never leave the proof
 *  testing the text form or the unlabelled map. */
export function forceMaps(ids: readonly MapId[] = MAP_CARD_IDS, options: ForceOptions = {}): Plugin {
  return {
    name: 'adw-force-maps',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      const file = id.split('?')[0]!.replace(/\\/g, '/');
      if (options.a1Labels !== undefined && file.endsWith('/src/maps.ts')) {
        const list = /(export const A1_CONFIRMED_LABELS: readonly string\[\] = )\[[^\]]*\];/;
        if (!list.test(code)) throw new Error('adw-force-maps: src/maps.ts has no A1_CONFIRMED_LABELS list to fill');
        return { code: code.replace(list, (_all, head: string) => `${head}${JSON.stringify(options.a1Labels)};`), map: null };
      }
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
export async function buildMapApp(ids: readonly MapId[] = MAP_CARD_IDS, options: ForceOptions = {}): Promise<MapApp> {
  const dir = mkdtempSync(join(tmpdir(), 'adw-maps-'));
  try {
    await build({
      root: repoRoot(),
      configFile: join(repoRoot(), 'vite.config.ts'),
      logLevel: 'warn',
      plugins: [forceMaps(ids, options)],
      build: { outDir: dir, emptyOutDir: true },
    });
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return { url: pathToFileURL(join(dir, 'index.html')).href, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
