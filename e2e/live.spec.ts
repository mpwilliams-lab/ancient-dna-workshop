import { expect, test } from '@playwright/test';
import { SCRIPT } from '../src/hints';
import { formatCommand } from '../src/parser';
import { hintIndex, idle, PAGES_URL, prompt, run, watch } from './helpers';

// Run with: LIVE=1 npx playwright test
test('live GitHub Pages smoke: loads, runs three guided steps, makes no third-party requests', async ({ page }) => {
  const w = watch(page, PAGES_URL);
  const res = await page.goto(`${PAGES_URL}?reset`);
  expect(res?.status()).toBe(200);
  await expect(prompt(page)).toBeVisible();
  await idle(page);
  for (const step of SCRIPT.slice(0, 3)) await run(page, formatCommand(step));
  expect(await hintIndex(page)).toBe(3);
  await expect(page.locator('#plot svg').first()).toBeVisible();
  expect(w.requests).toEqual([]);
  expect(w.errors).toEqual([]);
});
