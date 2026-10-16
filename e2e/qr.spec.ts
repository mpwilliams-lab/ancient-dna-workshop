import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { freshStart, PAGES_URL } from './helpers';

test('the wrap QR code decodes to the Pages URL', async ({ page }) => {
  await freshStart(page);
  await page.locator('#wrap-open').click();
  await expect(page.locator('#wrap')).toBeVisible();
  await expect(page.locator('#wrap-url')).toHaveText(PAGES_URL);
  const png = PNG.sync.read(await page.locator('#wrap-qr svg').screenshot());
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(code?.data).toBe(PAGES_URL);
});
