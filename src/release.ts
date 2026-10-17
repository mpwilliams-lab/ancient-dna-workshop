// The release gate (spec §7.2, §10.3; CONTRACT §4.14). Pure over the manifest, so vite.config.ts can import it.
// Used by scripts/check-release.ts (exit 1 on any line) and by the releaseWarnings() Vite plugin (prints, never fails).
// vite.config.ts reaches this file, so its imports carry explicit .ts extensions (see src/assetManifest.ts).
import { FEATURE_FLAGS, FEATURES, type FeatureFlag, type Features } from './features.ts';
import { ASSET_MANIFEST, HIDDEN_WHEN_SHOWN, MAP_IDS, type AssetManifest, type ImageEntry } from './assetManifest.ts';
import { CARD_IDS, type CardId, type ImageId, type MapId } from './types.ts';

export const IMAGE_MAX_BYTES = 160 * 1024;
export const IMAGES_TOTAL_MAX_BYTES = Math.round(2.2 * 1024 * 1024);
export const PAGE_MAX_BYTES = Math.round(3.5 * 1024 * 1024);

const CARTOONS: ReadonlySet<ImageId> = new Set<ImageId>(['lactase-scissors', 'tb-relay', 'wheat']);

/** The flag that puts this image on screen: images.<card>, or cartoons for the P3 drawings. */
export function imageFlag(e: ImageEntry): FeatureFlag | null {
  if (CARTOONS.has(e.id)) return 'cartoons';
  const f = `images.${e.card}`;
  return (FEATURE_FLAGS as readonly string[]).includes(f) ? (f as FeatureFlag) : null;
}

export function mapFlag(id: MapId): FeatureFlag {
  return id === 'F1inset' ? 'romanInset' : (`map.${id}` as FeatureFlag);
}

function mapCard(id: MapId): CardId {
  return id === 'F1inset' ? 'F1' : id;
}

/**
 * One line per card whose flag is on and that would show an image or map without the instructor's check, or an image whose
 * file is not bundled (only checked when `bundled` is given). Images that can never show (HIDDEN_WHEN_SHOWN) are skipped.
 */
export function uncheckedAssets(
  features: Features = FEATURES, manifest: AssetManifest = ASSET_MANIFEST, bundled: ReadonlySet<string> | null = null,
): string[] {
  const byCard = new Map<CardId, { flags: FeatureFlag[]; problems: string[] }>();
  const add = (card: CardId, flag: FeatureFlag, problem: string): void => {
    const v = byCard.get(card) ?? { flags: [], problems: [] };
    if (!v.flags.includes(flag)) v.flags.push(flag);
    v.problems.push(problem);
    byCard.set(card, v);
  };
  for (const e of manifest.images) {
    const flag = imageFlag(e);
    if (flag === null || !features[flag] || HIDDEN_WHEN_SHOWN[e.id] !== undefined) continue;
    if (e.visual_check === null) add(e.card, flag, `${e.id}: no visual check`);
    if (bundled !== null && !bundled.has(e.id)) {
      const file = e.kind === 'own-svg' ? `src/assets/svg/${e.id}.svg` : `src/assets/img/${e.id}.jpg`;
      add(e.card, flag, `${e.id}: no bundled file (${file})`);
    }
  }
  for (const id of MAP_IDS) {
    const flag = mapFlag(id);
    if (features[flag] && manifest.maps[id].visual_check === null) add(mapCard(id), flag, `map ${id}: no visual check`);
  }
  return CARD_IDS.filter((c) => byCard.has(c)).map((c) => {
    const v = byCard.get(c)!;
    return `${c} (${v.flags.join(', ')}): ${v.problems.join('; ')}`;
  });
}

/** What `npm run check-release` prints and whether it fails: the whole decision, as data, so tests need no build. */
export interface ReleaseReport { ok: boolean; stdout: string[]; stderr: string[] }

export function checkRelease(
  features: Features = FEATURES, manifest: AssetManifest = ASSET_MANIFEST, bundled: ReadonlySet<string> | null = null,
): ReleaseReport {
  const problems = uncheckedAssets(features, manifest, bundled);
  if (problems.length > 0) {
    return {
      ok: false,
      stdout: [],
      stderr: [
        'check-release: FAILED. These cards are switched on but would show an unchecked or missing image or map:',
        ...problems.map((p) => `  ${p}`),
        'Fix: the instructor checks the item (npm run visual-check -- <id>) and it is promoted, or its flag goes back to false in src/features.ts.',
      ],
    };
  }
  const on = FEATURE_FLAGS.filter((f) => features[f]);
  return { ok: true, stdout: [`check-release: ok (${on.length} flag(s) on: ${on.join(', ') || 'none'})`], stderr: [] };
}
