// Test-only helpers for cards in a chosen asset state. Manifests come from tests/helpers/assetEnv.ts (Task 15): in-memory copies,
// never assets/manifest.json, whose visual_check only the instructor fills (spec §7.2).
import type { AssetManifest } from '../../src/assetManifest';
import type { ImageUrls } from '../../src/assets';
import { mountCardView, type CardRenderContext } from '../../src/cardView';
import { FEATURES, withFeatures, type FeatureFlag, type Features } from '../../src/features';
import type { CardId, WorkshopData } from '../../src/types';
import { fakeUrls } from './assetEnv';
import { loadIndexHtml } from './shellEnv';

/** One flag set to a value on top of `base` (default: the shipped FEATURES). */
export function flagSet(flag: FeatureFlag, value: boolean, base: Features = FEATURES): Features {
  return withFeatures(Object.fromEntries([[flag, value]]) as Partial<Record<FeatureFlag, boolean>>, base);
}

export function cardCtx(
  data: WorkshopData, features: Features, manifest: AssetManifest, over: Partial<CardRenderContext> = {},
): CardRenderContext {
  return {
    data, features, index: 0, count: 1, placement: 'after', showBack: false, manifest, imageUrls: fakeUrls(), ...over,
  };
}

/** Opens one card through mountCardView (body AND footer) in a fresh index.html; returns #card. */
export function openOnCard(
  id: CardId, data: WorkshopData, features: Features, manifest: AssetManifest, urls: ImageUrls = fakeUrls(),
): HTMLElement {
  loadIndexHtml();
  const root = document.getElementById('card')!;
  const view = mountCardView(root, data, { onContinue() {}, onBack() {}, onCredits() {} }, features, { manifest, urls });
  view.open(id, 0, 1, 'after');
  return root;
}
