// A scratch build of the app with chosen upgrade flags forced ON and their assets recorded as checked, for the layout proofs of the cards'
// upgraded forms and for the instructor's preview of the maps. Until the instructor has checked an asset (npm run visual-check) its
// shipped flag stays false and the committed manifest stays null, so the shipped dist/index.html draws the card's text form and cannot
// show how the upgraded form fits. Two halves, which the layout matrix (e2e/layout.spec.ts) uses together and the map spec and the
// preview use one of:
//   - maps (forceMaps, buildMapApp): the map cards A1, D1, E1, G1, H2, I2, J3, K2 and L3 so far (MAP_CARD_IDS);
//   - pictures (forceImages, buildFormsApp): the image cards B1, C1, E2, F1, G2, H1, I1 and J1 (IMAGE_CARD_IDS), with stand-in pictures
//     of the exact pixel size of each staged photo.
// And the P3 Roman additions (Task 29, buildRomanApp), which are neither: the town inset on the Roman slide F1 (a map, id ROMAN_INSET_ID,
// of a picture card; forceMaps takes it like a map card and turns romanInset on) and the York traveller on the Roman plot (a flag with
// nothing to check, ROMAN_PLOT_FLAG; options.flags), seen with F1's photographs (options.images) beside which the inset has to fit.
//
// This is a test seam, not a feature switch: the changes are made IN MEMORY, while Vite reads four modules, into a fresh temporary
// directory outside the repo: src/features.ts (the flags go true), assets/manifest.json (the maps and the pictures are recorded as
// checked), src/assets.ts (forceImages only: the JPEG glob is replaced by the stand-ins, because the staged photos are never bundled
// until the instructor has checked them and the release task has promoted them) and, only when the caller passes options.a1Labels,
// src/maps.ts (A1_CONFIRMED_LABELS is filled, so A1 is drawn with its eight names before the instructor has confirmed them; the repo's
// list stays empty). No file in the repo is written, the committed flags, the committed visual_check entries and the committed A1 label
// list are untouched, and the shipped build is never built this way. The check stamped into the scratch manifest is a stand-in with a
// fixed date, never an instructor's check. Nothing in assets/raw/ or assets/staged/ is opened: the pixel sizes below were recorded
// when each photo was staged (Tasks 16, 21 and 25), and layout depends on a picture's size and nothing else, so a stand-in lays out
// exactly as the real file.
//
// Written in the subset of TypeScript that Node 24 runs as it is (type stripping), so scripts/preview-maps.ts and plain .mjs scripts
// can import it too: relative imports carry their .ts extension and nothing here needs more than types erased.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { build, type Plugin } from 'vite';
import type { FeatureFlag } from '../src/features.ts';
import type { CardId, MapId } from '../src/types.ts';

/** The repo root: read when a build starts, not when the module loads, so the plugin can be imported anywhere (the unit tests do). */
const repoRoot = (): string => fileURLToPath(new URL('..', import.meta.url));

/** The map cards built so far (Tasks 20, 23, 24 and 27): the card, its flag (`map.<id>`) and its manifest key are all this id. The Roman
 *  inset of F1 (Task 29) is a map of a card that is not itself a map card, so it is not here: see ROMAN_INSET_ID. */
export const MAP_CARD_IDS: readonly MapId[] = ['A1', 'D1', 'E1', 'G1', 'H2', 'I2', 'J3', 'K2', 'L3'];

/** The P3 Roman additions (Task 29). The F1 town inset is a map, but not of a map card: F1 is a picture card (flag images.F1), and the inset
 *  has a flag of its own, romanInset, and a manifest key, maps.F1inset. forceMaps takes this id like any map id and sets both. */
export const ROMAN_INSET_ID: MapId = 'F1inset';
/** The other P3 Roman addition is a point on the Roman plot, the York traveller (flag yorkTraveller). It is not an image or a map, so there
 *  is nothing for the instructor to check in the manifest: it is forced on through ForceOptions.flags. */
export const ROMAN_PLOT_FLAG: FeatureFlag = 'yorkTraveller';

/** The cards with photographs or drawings (Tasks 16, 21 and 25): the card and its flag (`images.<id>`) are this id; its pictures are the
 *  manifest entries whose `card` is this id. */
export const IMAGE_CARD_IDS: readonly CardId[] = ['B1', 'C1', 'E2', 'F1', 'G2', 'H1', 'I1', 'J1'];

/**
 * Pixel size [width, height] of every staged photo, i.e. of the file the instructor checks and promote-assets would bundle (read with
 * `sips -g pixelWidth -g pixelHeight` when each was staged: B1 and C1 photos 2026-10-17 04:15, E2, F1 and G2 2026-10-17 (Bignor re-staged
 * at its own 540 x 405 after fix round 1), H1 and I1 2026-10-17 13:59). Not in this table: Shrewton (an optional tile that is never
 * fetched; the Archer photo hides it anyway), and the two own drawings, thornborough-plan and irises, which are real files in
 * src/assets/svg and are bundled as they are. If the instructor rejects a photo and a fallback is staged in its place, its size changes
 * here too (tests/mapBuild.test.ts keeps this table complete, not exact).
 */
export const PHOTO_SIZES: Readonly<Record<string, readonly [width: number, height: number]>> = {
  stonehenge: [900, 599], avebury: [900, 670], 'ring-of-brodgar': [900, 300], castlerigg: [900, 600],
  'amesbury-archer': [900, 675], 'round-barrow': [900, 675],
  roundhouse: [900, 600], 'maiden-castle': [900, 763], 'battersea-shield': [274, 600],
  'hadrians-wall': [900, 598], 'bignor-medusa': [540, 405], 'hoxne-coins': [592, 600],
  'sutton-hoo-helmet': [345, 600], 'square-headed-brooch': [553, 600], 'west-stow': [900, 600],
  milk: [900, 600], cow: [900, 601], melanocyte: [900, 720],
};

/** The stamp a scratch manifest records for a check: a stand-in with a fixed date, never an instructor's file. */
const STAND_IN_CHECK = { by: 'instructor', at: '2026-10-19T15:00:00-07:00' };

export interface ForceOptions {
  /** A1 only: the names the scratch build puts in A1_CONFIRMED_LABELS (src/maps.ts), so the map is drawn labelled. In the repo that list
   *  stays empty until the instructor confirms open check 14, and the map ships unlabelled; this is how the layout proof and the preview
   *  see the labelled map before he has. Left out, the list is whatever the repo has. */
  a1Labels?: readonly string[];
  /** Further flags to turn on that have no asset to record as checked: the York traveller (ROMAN_PLOT_FLAG), a point on the Roman plot. */
  flags?: readonly FeatureFlag[];
  /** Cards whose pictures are forced on as well, with stand-ins of the staged photos (forceImages), for the builds made by mapPlugins and
   *  buildMapApp: F1's, so that its inset is seen in the row of three photographs it has to fit beside. */
  images?: readonly CardId[];
}

/** The flag that draws a map: `map.<id>`, and romanInset for the F1 inset (the mapping of mapFlag in src/release.ts). */
const flagOfMap = (map: MapId): FeatureFlag => (map === 'F1inset' ? 'romanInset' : (`map.${map}` as FeatureFlag));

/** The entry of a flag in the FEATURES literal of src/features.ts. A key with a dot is quoted (`'map.A1': false`), the others are bare words
 *  (`back: true`); the array of flag names above the literal has them all quoted and followed by a comma, so only the literal matches. */
function featureEntry(flag: string): RegExp {
  const key = flag.includes('.') ? `'${flag.replace(/\./g, '\\.')}'` : `\\b${flag}`;
  return new RegExp(`(${key}\\s*:\\s*)(?:false|true)\\b`);
}

/** The groups the data build chose for A1 labels (open check 14): the non-isolate `map_label` names of the real data, in europe_pops
 *  order. `root` is the repo root (default: found from this file; the unit tests, whose import.meta.url is not a file, pass theirs). */
export function a1LabelCandidates(root: string = repoRoot()): string[] {
  const data = JSON.parse(readFileSync(join(root, 'src/data/workshop_data.json'), 'utf8')) as {
    europe_pops?: { label: string; isolate: boolean; map_label: boolean }[];
  };
  return (data.europe_pops ?? []).filter((p) => !p.isolate && p.map_label).map((p) => p.label);
}

/** The path of a module a plugin is asked about, with any query dropped and Windows slashes made forward. */
const pathOf = (id: string): string => id.split('?')[0]!.replace(/\\/g, '/');

/** Turns the listed map flags on and records the listed maps as checked while the build reads their modules (and, with
 *  options.a1Labels, fills A1_CONFIRMED_LABELS; with options.flags, turns those flags on too). A flag that is already on (the instructor
 *  has checked the map and the release task has shipped it), a check that is already recorded and a list that is already filled are
 *  simply set again. The F1 inset's id (ROMAN_INSET_ID) turns romanInset on. Fails the build if a module no longer has the shape this
 *  rewrites, so a reformatted features.ts, manifest or maps.ts can never leave the proof testing the text form or the unlabelled map. */
export function forceMaps(ids: readonly MapId[] = MAP_CARD_IDS, options: ForceOptions = {}): Plugin {
  return {
    name: 'adw-force-maps',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      const file = pathOf(id);
      if (options.a1Labels !== undefined && file.endsWith('/src/maps.ts')) {
        const list = /(export const A1_CONFIRMED_LABELS: readonly string\[\] = )\[[^\]]*\];/;
        if (!list.test(code)) throw new Error('adw-force-maps: src/maps.ts has no A1_CONFIRMED_LABELS list to fill');
        return { code: code.replace(list, (_all, head: string) => `${head}${JSON.stringify(options.a1Labels)};`), map: null };
      }
      if (file.endsWith('/src/features.ts')) {
        let out = code;
        for (const flag of [...ids.map(flagOfMap), ...(options.flags ?? [])]) {
          const entry = featureEntry(flag);
          if (!entry.test(out)) throw new Error(`adw-force-maps: src/features.ts has no '${flag}' entry to turn on`);
          out = out.replace(entry, '$1true');
        }
        return { code: out, map: null };
      }
      if (file.endsWith('/assets/manifest.json')) {
        const manifest = JSON.parse(code) as { maps: Record<string, { visual_check: unknown }> };
        for (const map of ids) {
          if (manifest.maps[map] === undefined) throw new Error(`adw-force-maps: assets/manifest.json has no maps.${map}`);
          manifest.maps[map] = { visual_check: STAND_IN_CHECK };
        }
        return { code: JSON.stringify(manifest), map: null };
      }
      return null;
    },
  };
}

/** A solid grey picture of the given size with a dark frame on all four edges and both diagonals, as a PNG data: URL, so a screenshot
 *  shows at a glance whether a picture is drawn whole and in its own proportions. */
export function standInPicture(width: number, height: number): string {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const frame = x < 4 || y < 4 || x >= width - 4 || y >= height - 4;
      const diagonal = Math.abs(y - (x * height) / width) < 2 || Math.abs(y - height + (x * height) / width) < 2;
      const v = frame ? 40 : diagonal ? 90 : 205;
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v + (frame ? 0 : 20);
      png.data[i + 3] = 255;
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

/** Turns the image flags of the listed cards on, records every picture of those cards as checked, and bundles stand-in pictures of
 *  the staged photos' exact sizes in place of src/assets/img/*.jpg (the own drawings in src/assets/svg are the real files). Fails the
 *  build if a module no longer has the shape this rewrites, so a reformatted features.ts, manifest or assets.ts can never leave the
 *  proof testing the text form. */
export function forceImages(ids: readonly CardId[] = IMAGE_CARD_IDS): Plugin {
  return {
    name: 'adw-force-images',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      const file = pathOf(id);
      if (file.endsWith('/src/features.ts')) {
        let out = code;
        for (const card of ids) {
          const entry = new RegExp(`('images\\.${card}'\\s*:\\s*)(?:false|true)\\b`);
          if (!entry.test(out)) throw new Error(`adw-force-images: src/features.ts has no 'images.${card}' entry to turn on`);
          out = out.replace(entry, '$1true');
        }
        return { code: out, map: null };
      }
      if (file.endsWith('/assets/manifest.json')) {
        const manifest = JSON.parse(code) as { images: { id: string; card: string; visual_check: unknown }[] };
        for (const card of ids) {
          const mine = manifest.images.filter((e) => e.card === card);
          if (mine.length === 0) throw new Error(`adw-force-images: assets/manifest.json has no image for card ${card}`);
          for (const e of mine) e.visual_check = STAND_IN_CHECK;
        }
        return { code: JSON.stringify(manifest), map: null };
      }
      if (file.endsWith('/src/assets.ts')) {
        const glob = /const JPEGS = import\.meta\.glob<string>\([^;]*\);/;
        if (!glob.test(code)) throw new Error('adw-force-images: src/assets.ts no longer has the JPEGS glob this rewrites');
        const files: Record<string, string> = {};
        for (const [name, [width, height]] of Object.entries(PHOTO_SIZES)) files[`./assets/img/${name}.jpg`] = standInPicture(width, height);
        return { code: code.replace(glob, () => `const JPEGS: Record<string, string> = ${JSON.stringify(files)};`), map: null };
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
/** The same shape for the build with the pictures forced on as well. */
export type FormsApp = MapApp;

/** Builds the app (real data, shipped everything else but what the plugins force) into a new temporary directory. Takes a few seconds at most. */
async function buildInto(plugins: Plugin[], prefix: string): Promise<MapApp> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    await build({
      root: repoRoot(),
      configFile: join(repoRoot(), 'vite.config.ts'),
      logLevel: 'warn',
      plugins,
      build: { outDir: dir, emptyOutDir: true },
    });
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return { url: pathToFileURL(join(dir, 'index.html')).href, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The plugins of a map build: forceMaps, and forceImages for the cards in options.images. */
export function mapPlugins(ids: readonly MapId[] = MAP_CARD_IDS, options: ForceOptions = {}): Plugin[] {
  const images = options.images ?? [];
  return [forceMaps(ids, options), ...(images.length > 0 ? [forceImages(images)] : [])];
}

/** The app with the listed map flags forced on (real data, shipped everything else). */
export function buildMapApp(ids: readonly MapId[] = MAP_CARD_IDS, options: ForceOptions = {}): Promise<MapApp> {
  return buildInto(mapPlugins(ids, options), 'adw-maps-');
}

/** The app with every upgraded form forced on: the nine built maps and the pictures of all eight image cards (real data). Of the 23 cards
 *  17 are drawn in their upgraded form (A1 B1 C1 D1 E1 E2 F1 G1 G2 H1 H2 I1 I2 J1 J3 K2 L3); the other six (D2 E3 J2 K1 L1 L2) have no
 *  upgrade built, so they stay as they ship. */
export function buildFormsApp(options: ForceOptions = {}): Promise<FormsApp> {
  return buildInto([forceMaps(MAP_CARD_IDS, options), forceImages()], 'adw-forms-');
}

/** The options of the Roman build: the York traveller on, and F1's photographs, because the inset is one more tile in the row they fill. */
export const ROMAN_OPTIONS: ForceOptions = { flags: [ROMAN_PLOT_FLAG], images: ['F1'] };

/** The app with the P3 Roman additions forced on (Task 29), to see them where they must fit: the York traveller on the Roman plot, the F1
 *  town inset and F1's photographs (stand-ins). Real data, shipped everything else. It is not part of buildFormsApp: the inset does not fit
 *  F1 beside its photographs at 1366 x 768 (it takes the card to `compact`), so the all-forms matrix would fail there; the Roman proofs
 *  (e2e/p3-roman.spec.ts) say what fits where. Once the inset fits at both lab-standard screens it joins buildFormsApp. */
export function buildRomanApp(): Promise<MapApp> {
  return buildMapApp([ROMAN_INSET_ID], ROMAN_OPTIONS);
}
