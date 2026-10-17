// P3 maps K2 and L3 under the shipped flag set (spec §10.3): each opens over the plot through the ?test hook, shows its
// map, fits without `dense` at 1366x768 and 1920x1080 (spec §5.4) and leaves the prompt usable. Skipped while a flag is
// false or its map is unchecked (the card is then its P1 text form, covered by layout.spec.ts). The map form itself, its words and
// its dots at every viewport, is judged on a scratch build with the flags forced on, in e2e/maps.spec.ts and e2e/layout.spec.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { FEATURES } from '../src/features';
import { APP_URL, prompt } from './helpers';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = JSON.parse(readFileSync(resolve(ROOT, 'assets/manifest.json'), 'utf8')) as {
  maps: Record<string, { visual_check: unknown }>;
};
const SIZES = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }] as const;
const MAPS = [{ id: 'K2', flag: 'map.K2' }, { id: 'L3', flag: 'map.L3' }] as const;

for (const size of SIZES) {
  test.describe(`P3 distribution maps at ${size.width}x${size.height} (100%)`, () => {
    test.use({ viewport: size, deviceScaleFactor: 1 });
    for (const m of MAPS) {
      test(`${m.id} shows its map and fits without dense`, async ({ page }) => {
        test.skip(!FEATURES[m.flag] || MANIFEST.maps[m.id]?.visual_check == null, `${m.flag} not shipped or map ${m.id} not checked`);
        await page.goto(`${APP_URL}?test`);
        await page.waitForFunction(() => window.__adw !== undefined && typeof window.__adw.openCard === 'function');
        await page.evaluate((id) => window.__adw!.openCard!(id as never), m.id);
        const card = page.locator('#card');
        await expect(card).toBeVisible();
        await expect(card).toHaveAttribute('data-card-id', m.id);
        await expect(card.locator(`.card-map[data-map="${m.id}"] svg`)).toBeVisible();
        await expect(card.locator('.card-source')).toContainText('Map outline: Made with Natural Earth.');
        await expect(card.locator('.card-credits')).toBeVisible();
        await expect(card).toHaveAttribute('data-fit', 'normal');
        await expect(card.locator('.card-title')).toBeInViewport();
        await expect(card.locator('.card-continue')).toBeInViewport();
        await expect(prompt(page)).toBeVisible();
        await expect(page.locator('.term-hint')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight
          && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      });
    }
  });
}
