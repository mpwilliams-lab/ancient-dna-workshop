// In-memory manifests for tests. Nothing here writes assets/manifest.json: only the instructor fills visual_check there.
import { ASSET_MANIFEST, MAP_IDS, type AssetManifest } from '../../src/assetManifest';
import type { ImageUrls } from '../../src/assets';
import type { ImageId, MapId } from '../../src/types';

export const CHECK = { by: 'instructor', at: '2026-10-19T15:00:00-07:00' } as const;

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
