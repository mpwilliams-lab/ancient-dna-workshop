// Inlined image files and the readiness rules (spec §7.2, CONTRACT §4.14). Vite inlines every file in src/assets/img/ (JPEG)
// and src/assets/svg/ (own drawings) as a data: URL, so the page makes no request. A third-party photo only reaches
// src/assets/img/ through npm run promote-assets, after the instructor's check.
import type { Card } from './cards';
import type { ImageId, MapId } from './types';
import { FEATURES, type Features } from './features';
import { ASSET_MANIFEST, HIDDEN_WHEN_SHOWN, IMAGE_IDS, type AssetManifest } from './assetManifest';
import { MAP_SPECS_BUILT } from './maps';

export type ImageUrls = Readonly<Partial<Record<ImageId, string>>>;

const JPEGS = import.meta.glob<string>('./assets/img/*.jpg', { query: '?inline', import: 'default', eager: true });
const SVGS = import.meta.glob<string>('./assets/svg/*.svg', { query: '?inline', import: 'default', eager: true });

function byId(files: Record<string, string>): Partial<Record<ImageId, string>> {
  const out: Partial<Record<ImageId, string>> = {};
  for (const [path, url] of Object.entries(files)) {
    const id = /([^/]+)\.(?:jpg|svg)$/.exec(path)?.[1];
    if (id !== undefined && (IMAGE_IDS as readonly string[]).includes(id) && typeof url === 'string') out[id as ImageId] = url;
  }
  return out;
}

export const BUNDLED_IMAGES: ImageUrls = Object.freeze({ ...byId(SVGS), ...byId(JPEGS) });
export const BUNDLED_IMAGE_IDS: ReadonlySet<ImageId> = new Set(Object.keys(BUNDLED_IMAGES) as ImageId[]);

export function imageUrl(id: ImageId, urls: ImageUrls = BUNDLED_IMAGES): string | undefined {
  return urls[id];
}

/** Bundled AND checked by the instructor. */
export function imageReady(id: ImageId, manifest: AssetManifest = ASSET_MANIFEST, urls: ImageUrls = BUNDLED_IMAGES): boolean {
  const e = manifest.images.find((x) => x.id === id);
  const url = urls[id];
  return e !== undefined && e.visual_check !== null && typeof url === 'string' && url !== '';
}

export function mapReady(id: MapId, manifest: AssetManifest = ASSET_MANIFEST): boolean {
  return (manifest.maps[id]?.visual_check ?? null) !== null;
}

/** The map a card draws when upgraded: card.map, or the id in its map.* flag. */
export function cardMapId(card: Card): MapId | undefined {
  if (card.map !== undefined) return card.map;
  return card.feature?.startsWith('map.') ? (card.feature.slice(4) as MapId) : undefined;
}

/** The card is drawn in its upgraded form: flag on (same rule as cardUpgraded), its map built and checked, every non-optional
 *  tile ready. A map whose spec is not built (src/maps.ts MAP_SPECS_BUILT) is never drawn, whatever the flags and checks. */
export function cardShowsUpgrade(
  card: Card, features: Features = FEATURES, manifest: AssetManifest = ASSET_MANIFEST, urls: ImageUrls = BUNDLED_IMAGES,
): boolean {
  if (card.feature === undefined || !features[card.feature]) return false;
  const map = cardMapId(card);
  if (map !== undefined && (!MAP_SPECS_BUILT.has(map) || !mapReady(map, manifest))) return false;
  return (card.tiles ?? []).every((t) => t.optional === true || imageReady(t.image, manifest, urls));
}

/** The tile images on screen in the upgraded form, in tile order ([] in the text form). */
export function shownTileImages(
  card: Card, features: Features = FEATURES, manifest: AssetManifest = ASSET_MANIFEST, urls: ImageUrls = BUNDLED_IMAGES,
): ImageId[] {
  if (!cardShowsUpgrade(card, features, manifest, urls)) return [];
  const ready = (id: ImageId): boolean => imageReady(id, manifest, urls);
  return (card.tiles ?? []).map((t) => t.image).filter((id) => {
    const hider = HIDDEN_WHEN_SHOWN[id];
    return ready(id) && !(hider !== undefined && ready(hider));
  });
}
