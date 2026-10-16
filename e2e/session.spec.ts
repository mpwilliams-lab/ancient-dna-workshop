import { expect, test, type Page } from '@playwright/test';
import { SCRIPT } from '../src/hints';
import { formatCommand } from '../src/parser';
import { RESTORED_NOTICE } from '../src/content';
import { APP_URL, freshStart, hintIndex, idle, prompt, run, watch } from './helpers';

/** How many times the restored-session notice is on screen (the shell prints it once; the Controller never does). */
async function noticeCount(page: Page): Promise<number> {
  return ((await page.locator('#terminal').textContent()) ?? '').split(RESTORED_NOTICE).length - 1;
}

test('refresh restores the session with the notice; ?reset clears it and is removed from the URL', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  expect(page.url()).toBe(APP_URL); // ?reset stripped by history.replaceState, also over file://
  for (const step of SCRIPT.slice(0, 3)) await run(page, formatCommand(step));
  expect(await hintIndex(page)).toBe(3);

  await page.reload();
  await idle(page);
  expect(await hintIndex(page)).toBe(3);
  await expect(page.locator('#terminal')).toContainText(RESTORED_NOTICE);
  expect(await noticeCount(page)).toBe(1);
  await expect(page.locator('#plot svg').first()).toBeVisible();
  await expect(page.locator('#terminal')).toContainText(formatCommand(SCRIPT[2]));

  await page.goto(`${APP_URL}?reset`);
  await idle(page);
  expect(page.url()).toBe(APP_URL);
  expect(await hintIndex(page)).toBe(0);
  await expect(page.locator('#terminal')).not.toContainText(RESTORED_NOTICE);
  await expect(prompt(page)).toHaveValue('');

  // The next group's refresh restores their own session, not a second reset.
  await run(page, formatCommand(SCRIPT[0]));
  await page.reload();
  await idle(page);
  expect(await hintIndex(page)).toBe(1);
  await expect(page.locator('#terminal')).toContainText(RESTORED_NOTICE);
  expect(await noticeCount(page)).toBe(1);

  // A second refresh still shows one notice: the old one is not saved and replayed.
  await page.reload();
  await idle(page);
  await expect(page.locator('#terminal')).toContainText(RESTORED_NOTICE);
  expect(await noticeCount(page)).toBe(1);
  expect(w.errors).toEqual([]);
});

test('blocked sessionStorage never crashes the app', async ({ page }) => {
  const w = watch(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await freshStart(page);
  for (const step of SCRIPT.slice(0, 3)) await run(page, formatCommand(step));
  expect(await hintIndex(page)).toBe(3);
  expect(await page.evaluate(() => window.__adw!.storage)).toBe(false);
  await page.reload();
  await idle(page);
  expect(await hintIndex(page)).toBe(0);
  expect(w.errors).toEqual([]);
});

test('corrupt saved session: no crash, no notice, fresh start', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  for (const step of SCRIPT.slice(0, 2)) await run(page, formatCommand(step));
  await page.evaluate(() => {
    for (let i = 0; i < sessionStorage.length; i++) sessionStorage.setItem(sessionStorage.key(i)!, '{"history": [oops');
  });
  await page.reload();
  await idle(page);
  expect(await hintIndex(page)).toBe(0);
  await expect(page.locator('#terminal')).not.toContainText(RESTORED_NOTICE);
  expect(w.errors).toEqual([]);
});
