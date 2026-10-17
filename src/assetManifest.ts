// The image and map manifest (spec §7.1–§7.2, CONTRACT §4.14). The data lives in assets/manifest.json so the Node scripts
// (fetch-assets, make-credits, visual-check) read and write it without a build. This module validates it once at load.
// visual_check is filled ONLY by the instructor (npm run visual-check); agents never write it.
// The licence URLs and the Wikimedia hosts a thumbnail may come from live in assets/asset-rules.json, which the fetch script
// reads too, so each is written once.
// Keep this module free of imports from content.ts, cards.ts or anything that imports CSS: vite.config.ts imports it
// through release.ts. Vite reads that config with its own loader, which wants explicit file extensions and JSON import
// attributes in everything the config reaches (otherwise it prints a notice on every build and test run), so the imports of
// this module and of release.ts spell them out.
import rawManifest from '../assets/manifest.json' with { type: 'json' };
import rawRules from '../assets/asset-rules.json' with { type: 'json' };
import type { CardId, ImageId, MapId } from './types.ts';
import { CARD_IDS } from './types.ts';

export type LicenceId = 'CC0' | 'PD' | 'CC BY 2.0' | 'CC BY 3.0' | 'CC BY 4.0' | 'CC BY-SA 2.0' | 'CC BY-SA 3.0' | 'CC BY-SA 4.0' | 'own';
export type AssetOp = 'resize' | 'crop' | 'convert';
export interface VisualCheck { by: 'instructor'; at: string }
export interface ImageEntry {
  id: ImageId; card: CardId; kind: 'photo' | 'own-svg';
  title: string;
  commons_file: string | null;
  file_page: string | null;
  thumb_url: string | null;
  author: string;
  licence: LicenceId;
  licence_url: string | null;
  source: 'Wikimedia Commons' | 'Geograph / Wikimedia Commons' | 'this workshop';
  ops: AssetOp[];
  crop: { x: number; y: number; width: number; height: number } | null;
  orientation: 'landscape' | 'portrait';
  changes: 'resized' | 'cropped and resized' | 'resized, converted to JPEG' | null;
  raw_sha256: string | null;
  fallback: { commons_file: string; author: string; licence: LicenceId } | null;
  visual_check: VisualCheck | null;
}
export interface AssetManifest { version: 1; images: ImageEntry[]; maps: Record<MapId, { visual_check: VisualCheck | null }> }

export const IMAGE_IDS: readonly ImageId[] = [
  'stonehenge', 'avebury', 'ring-of-brodgar', 'thornborough-plan', 'castlerigg',
  'amesbury-archer', 'round-barrow', 'shrewton-beaker',
  'roundhouse', 'maiden-castle', 'battersea-shield',
  'hadrians-wall', 'bignor-medusa', 'hoxne-coins',
  'sutton-hoo-helmet', 'square-headed-brooch', 'west-stow',
  'milk', 'cow', 'melanocyte', 'irises',
  'lactase-scissors', 'tb-relay', 'wheat',
];
export const MAP_IDS: readonly MapId[] = ['A1', 'D1', 'E1', 'G1', 'H2', 'I2', 'J3', 'K2', 'L3', 'F1inset'];
export const LICENCE_IDS: readonly LicenceId[] = ['CC0', 'PD', 'CC BY 2.0', 'CC BY 3.0', 'CC BY 4.0', 'CC BY-SA 2.0', 'CC BY-SA 3.0', 'CC BY-SA 4.0', 'own'];
/** The licence deed for each licence id (no trailing slash); null where the attribution string names none. From assets/asset-rules.json. */
export const LICENCE_URLS: Readonly<Record<LicenceId, string | null>> = rawRules.licence_urls as Record<LicenceId, string | null>;
/** Where a thumbnail or original may be downloaded from: Wikimedia's own media hosts. From assets/asset-rules.json. */
export const MEDIA_PREFIXES: readonly string[] = rawRules.media_prefixes;

/** Spec §3.1 C1: the Shrewton burial tile is hidden whenever the Archer photo shows (at most one human-remains photo). */
export const HIDDEN_WHEN_SHOWN: Readonly<Partial<Record<ImageId, ImageId>>> = { 'shrewton-beaker': 'amesbury-archer' };

/** The Commons file page for a file title, shown as plain text in the credits (never a link). */
export function commonsFilePage(name: string): string {
  return `https://commons.wikimedia.org/wiki/File:${name.replace(/ /g, '_').replace(/'/g, '%27')}`;
}

export class ManifestError extends Error {
  constructor(path: string, problem: string) {
    super(`assets/manifest.json invalid at ${path}: ${problem}`);
    this.name = 'ManifestError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const OPS: readonly AssetOp[] = ['resize', 'crop', 'convert'];
const isCcBy = (l: LicenceId): boolean => l.startsWith('CC BY');
const isShareAlike = (l: LicenceId): boolean => l.startsWith('CC BY-SA');

function str(v: unknown, path: string, nullable = false): string | null {
  if (v === null && nullable) return null;
  if (typeof v !== 'string' || v.trim() === '') throw new ManifestError(path, 'expected a non-empty string');
  return v;
}
function oneOf<T extends string>(v: unknown, list: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new ManifestError(path, `expected one of ${list.join(', ')}`);
  return v as T;
}
function check(v: unknown, path: string): VisualCheck | null {
  if (v === null) return null;
  if (!isObj(v) || v.by !== 'instructor' || typeof v.at !== 'string' || !ISO.test(v.at) || Number.isNaN(Date.parse(v.at))) {
    throw new ManifestError(path, 'visual_check must be null or { by: "instructor", at: <ISO-8601 with offset> }');
  }
  return { by: 'instructor', at: v.at };
}
function expectedChanges(licence: LicenceId, ops: readonly AssetOp[]): ImageEntry['changes'] {
  if (!isCcBy(licence)) return null;
  if (ops.includes('crop')) return 'cropped and resized';
  if (ops.includes('convert')) return 'resized, converted to JPEG';
  return 'resized';
}

function toEntry(v: unknown, i: number, seen: Set<string>): ImageEntry {
  const p = `images[${i}]`;
  if (!isObj(v)) throw new ManifestError(p, 'expected an object');
  const id = oneOf(v.id, IMAGE_IDS, `${p}.id`);
  if (seen.has(id)) throw new ManifestError(`${p}.id`, `duplicate id ${id}`);
  seen.add(id);
  const card = oneOf(v.card, CARD_IDS, `${p}.card`);
  const kind = oneOf(v.kind, ['photo', 'own-svg'] as const, `${p}.kind`);
  const title = str(v.title, `${p}.title`)!;
  const licence = oneOf(v.licence, LICENCE_IDS, `${p}.licence`);
  if ((kind === 'own-svg') !== (licence === 'own')) throw new ManifestError(`${p}.licence`, 'own drawings and only own drawings use "own"');
  const commons_file = str(v.commons_file, `${p}.commons_file`, kind === 'own-svg');
  if (kind === 'photo' && commons_file === null) throw new ManifestError(`${p}.commons_file`, 'a photo needs its Commons file');
  if (kind === 'own-svg' && commons_file !== null) throw new ManifestError(`${p}.commons_file`, 'an own drawing has no Commons file');
  const file_page = commons_file === null ? null : commonsFilePage(commons_file);
  if (v.file_page !== file_page) throw new ManifestError(`${p}.file_page`, `expected ${JSON.stringify(file_page)}`);
  const thumb_url = str(v.thumb_url, `${p}.thumb_url`, true);
  if (thumb_url !== null && (kind !== 'photo' || !MEDIA_PREFIXES.some((prefix) => thumb_url.startsWith(prefix)))) {
    throw new ManifestError(`${p}.thumb_url`, `thumbnails come only from ${MEDIA_PREFIXES.join(' or ')}`);
  }
  const author = str(v.author, `${p}.author`)!;
  if (v.licence_url !== LICENCE_URLS[licence]) throw new ManifestError(`${p}.licence_url`, `expected ${JSON.stringify(LICENCE_URLS[licence])} (no trailing slash)`);
  const wantSource = kind === 'own-svg' ? 'this workshop' : /geograph\.org\.uk/.test(commons_file ?? '') ? 'Geograph / Wikimedia Commons' : 'Wikimedia Commons';
  if (v.source !== wantSource) throw new ManifestError(`${p}.source`, `expected "${wantSource}"`);
  if (!Array.isArray(v.ops)) throw new ManifestError(`${p}.ops`, 'expected an array');
  const ops = v.ops.map((o, k) => oneOf(o, OPS, `${p}.ops[${k}]`));
  if (new Set(ops).size !== ops.length) throw new ManifestError(`${p}.ops`, 'duplicate op');
  if (kind === 'photo' && !ops.includes('resize')) throw new ManifestError(`${p}.ops`, 'every photo is resized');
  if (kind === 'own-svg' && ops.length > 0) throw new ManifestError(`${p}.ops`, 'own drawings are not processed');
  if (isShareAlike(licence) && (ops.length !== 1 || ops[0] !== 'resize')) {
    throw new ManifestError(`${p}.ops`, 'CC BY-SA images are resized only: never cropped, overlaid or annotated (spec §7.1)');
  }
  let crop: ImageEntry['crop'] = null;
  if (v.crop !== null) {
    const c = v.crop;
    const ints = isObj(c) && ['x', 'y', 'width', 'height'].every((k) => Number.isInteger(c[k]) && (c[k] as number) >= 0);
    if (!ints || (c as Obj).width === 0 || (c as Obj).height === 0) throw new ManifestError(`${p}.crop`, 'expected null or whole-pixel { x, y, width, height }');
    if (!ops.includes('crop')) throw new ManifestError(`${p}.crop`, 'a crop box needs the crop op');
    crop = { x: (c as Obj).x as number, y: (c as Obj).y as number, width: (c as Obj).width as number, height: (c as Obj).height as number };
  }
  const orientation = oneOf(v.orientation, ['landscape', 'portrait'] as const, `${p}.orientation`);
  const changes = expectedChanges(licence, ops);
  if (v.changes !== changes) throw new ManifestError(`${p}.changes`, `expected ${JSON.stringify(changes)}`);
  const raw_sha256 = v.raw_sha256 === null ? null : typeof v.raw_sha256 === 'string' && /^[0-9a-f]{64}$/.test(v.raw_sha256) ? v.raw_sha256 : null;
  if (v.raw_sha256 !== raw_sha256) throw new ManifestError(`${p}.raw_sha256`, 'expected null or 64 lower-case hex digits');
  let fallback: ImageEntry['fallback'] = null;
  if (v.fallback !== null) {
    if (!isObj(v.fallback)) throw new ManifestError(`${p}.fallback`, 'expected null or an object');
    fallback = {
      commons_file: str(v.fallback.commons_file, `${p}.fallback.commons_file`)!,
      author: str(v.fallback.author, `${p}.fallback.author`)!,
      licence: oneOf(v.fallback.licence, LICENCE_IDS.filter((l) => l !== 'own'), `${p}.fallback.licence`),
    };
  }
  return {
    id, card, kind, title, commons_file, file_page, thumb_url, author, licence, licence_url: LICENCE_URLS[licence],
    source: wantSource, ops, crop, orientation, changes, raw_sha256, fallback, visual_check: check(v.visual_check, `${p}.visual_check`),
  };
}

/** Validates the manifest shape and every licence rule of spec §7.1–§7.2. Throws ManifestError on the first problem. */
export function parseManifest(raw: unknown): AssetManifest {
  if (!isObj(raw)) throw new ManifestError('(root)', 'expected an object');
  if (raw.version !== 1) throw new ManifestError('version', 'expected 1');
  if (!Array.isArray(raw.images)) throw new ManifestError('images', 'expected an array');
  const seen = new Set<string>();
  const images = raw.images.map((e, i) => toEntry(e, i, seen));
  if (!isObj(raw.maps)) throw new ManifestError('maps', 'expected an object');
  const keys = Object.keys(raw.maps).sort();
  if (keys.join(',') !== [...MAP_IDS].sort().join(',')) throw new ManifestError('maps', `expected exactly ${MAP_IDS.join(', ')}`);
  const maps = {} as Record<MapId, { visual_check: VisualCheck | null }>;
  for (const id of MAP_IDS) {
    const m = (raw.maps as Obj)[id];
    if (!isObj(m)) throw new ManifestError(`maps.${id}`, 'expected { visual_check }');
    maps[id] = { visual_check: check(m.visual_check, `maps.${id}.visual_check`) };
  }
  return { version: 1, images, maps };
}

export const ASSET_MANIFEST: AssetManifest = parseManifest(rawManifest);

/** Spec §7.2 attribution format (also used by CREDITS.md through scripts/make-credits.mjs; tests/credits.test.ts pins both). */
export function attributionString(e: ImageEntry): string {
  if (e.licence === 'own') return e.author;
  if (e.licence === 'CC0' || e.licence === 'PD') return `Photo: ${e.author} (${e.licence === 'CC0' ? 'CC0' : 'public domain'}), via ${e.source}`;
  return `"${e.title}" by ${e.author}, ${e.licence} (${(e.licence_url ?? '').replace(/^https:\/\//, '')}), via ${e.source}; ${e.changes}`;
}
