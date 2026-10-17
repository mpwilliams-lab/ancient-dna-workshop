// In-memory manifests for tests. Nothing here writes assets/manifest.json: only the instructor fills visual_check there.
import { ASSET_MANIFEST, MAP_IDS, type AssetManifest } from '../../src/assetManifest';
import type { ImageUrls } from '../../src/assets';
import type { ImageId, MapId } from '../../src/types';

export const CHECK = { by: 'instructor', at: '2026-10-19T15:00:00-07:00' } as const;

/**
 * A deep copy of the committed manifest as Task 15 shipped it: nothing checked and nothing fetched (every visual_check, thumb_url
 * and raw_sha256 is null). The committed file and src/assets/img change as the instructor checks and promotes images (Task 16
 * and later), so a test whose premise is "nothing is checked or bundled" must use this, with `urls: {}` or an explicit list of
 * files, and never read ASSET_MANIFEST or BUNDLED_IMAGES for that premise.
 */
export function uncheckedManifest(): AssetManifest {
  const m = structuredClone(ASSET_MANIFEST);
  for (const e of m.images) {
    e.visual_check = null;
    e.thumb_url = null;
    e.raw_sha256 = null;
  }
  for (const id of MAP_IDS) m.maps[id] = { visual_check: null };
  return m;
}

/** A deep copy of the committed manifest with every image and map checked, except the ids listed. */
export function checkedManifest(except: readonly string[] = []): AssetManifest {
  const m = structuredClone(ASSET_MANIFEST);
  for (const e of m.images) e.visual_check = except.includes(e.id) ? null : { ...CHECK };
  for (const id of MAP_IDS) m.maps[id] = { visual_check: except.includes(id) ? null : { ...CHECK } };
  return m;
}

/** The opposite selection: a deep copy with ONLY the listed maps and images checked, everything else null
 *  (used by the P3 Tasks 27, 29 and 30; CONTRACT §8 R6). */
export function onlyChecked(maps: readonly MapId[] = [], images: readonly ImageId[] = []): AssetManifest {
  const m = structuredClone(ASSET_MANIFEST);
  for (const e of m.images) e.visual_check = images.includes(e.id) ? { ...CHECK } : null;
  for (const id of MAP_IDS) m.maps[id] = { visual_check: maps.includes(id) ? { ...CHECK } : null };
  return m;
}

/** A stand-in for the inlined files: every manifest image "bundled", except the ids listed. */
export function fakeUrls(except: readonly ImageId[] = []): ImageUrls {
  const out: Partial<Record<ImageId, string>> = {};
  for (const e of ASSET_MANIFEST.images) if (!except.includes(e.id)) out[e.id] = `data:image/jpeg;base64,${e.id}`;
  return out;
}
