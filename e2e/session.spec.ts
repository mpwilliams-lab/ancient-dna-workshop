import { expect, test, type Page } from '@playwright/test';
import { SCRIPT, SCRIPT_STEPS } from '../src/hints';
import { formatCommand } from '../src/parser';
import { CARDS } from '../src/cards';
import { CARD_HINT, cardCounter, CONSUMER_BARS_LOG, RESTORED_NOTICE, REVEAL_HINT } from '../src/content';
import { FEATURES } from '../src/features';
import { consumerRows } from '../src/plots/consumer';
import type { PeriodId } from '../src/types';
import {
  APP_URL, cardOpen, closeAllCards, closeCardWithEnter, consumerBarsShown, DATA, freshStart, hintIndex, idle, layersShown, prompt, run, screen,
  terminalBars, watch,
} from './helpers';

const V2 = 'adna-workshop-session-v2';
const V1 = 'adna-workshop-session-v1';

/** How many times the restored-session notice is on screen (the shell prints it once). */
async function noticeCount(page: Page): Promise<number> {
  return ((await page.locator('#terminal').textContent()) ?? '').split(RESTORED_NOTICE).length - 1;
}

/** Runs SCRIPT[from..to) and closes each step's cards, waiting for the first card of each step that has cards. */
async function runGuided(page: Page, to: number, from = 0): Promise<void> {
  for (let i = from; i < to; i++) {
    await run(page, formatCommand(SCRIPT[i]!));
    const first = SCRIPT_STEPS[i]!.cards?.ids[0];
    if (first) {
      await expect(page.locator(`#card[data-card-id="${first}"]`)).toBeVisible();
      await closeAllCards(page);
    }
  }
}

async function savedSteps(page: Page): Promise<number> {
  return page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return 0;
    try {
      return (JSON.parse(raw) as { steps?: unknown[] }).steps?.length ?? 0;
    } catch {
      return -1;
    }
  }, V2);
}

test('refresh mid-script restores the same screen and plot with the notice once; ?reset clears both keys', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  expect(page.url()).toBe(APP_URL); // ?reset stripped by history.replaceState, also over file://
  await runGuided(page, 4);         // hook, load, Europe (+A1), First farmers (+B1)
  expect(await hintIndex(page)).toBe(4);
  const before = await screen(page);
  expect(before).toEqual({ step: 4, card: 1 });

  await page.reload();
  await idle(page);
  expect(await hintIndex(page)).toBe(4);
  expect(await screen(page)).toEqual(before);
  await expect(page.locator('#terminal')).toContainText(RESTORED_NOTICE);
  expect(await noticeCount(page)).toBe(1);
  await expect(page.locator('#card')).toBeHidden();
  await expect(page.locator('#plot')).toHaveAttribute('data-view', 'pca');
  expect(await layersShown(page)).toEqual(['FirstFarmers']);
  await expect(page.locator('#terminal')).toContainText(formatCommand(SCRIPT[3]!));

  await page.evaluate((key) => sessionStorage.setItem(key, '{"stale": true}'), V1);
  await page.goto(`${APP_URL}?reset`);
  await idle(page);
  expect(page.url()).toBe(APP_URL);
  expect(await hintIndex(page)).toBe(0);
  await expect(page.locator('#terminal')).not.toContainText(RESTORED_NOTICE);
  await expect(prompt(page)).toHaveValue('');
  expect(await page.evaluate((key) => sessionStorage.getItem(key), V1)).toBeNull();
  expect(await savedSteps(page)).toBe(0);

  // The next group's refresh restores their own session, not a second reset.
  await run(page, formatCommand(SCRIPT[0]!));
  await page.reload();
  await idle(page);
  expect(await hintIndex(page)).toBe(1);
  expect(await noticeCount(page)).toBe(1);
  await page.reload();
  await idle(page);
  expect(await noticeCount(page)).toBe(1);
  expect(w.errors).toEqual([]);
});

test('refresh with a card open shows the same card again (spec §4.5)', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  const admix1 = SCRIPT_STEPS.findIndex((s) => s.id === 'admix1');   // after: D1, D2
  await runGuided(page, admix1);
  await run(page, formatCommand(SCRIPT[admix1]!));
  await expect(page.locator('#card[data-card-id="D1"]')).toBeVisible();
  await closeCardWithEnter(page);
  await expect(page.locator('#card[data-card-id="D2"]')).toBeVisible();
  expect(await screen(page)).toEqual({ step: admix1 + 1, card: 1 });

  await page.reload();
  await idle(page);
  const card = page.locator('#card[data-card-id="D2"]');
  await expect(card).toBeVisible();
  await expect(card.locator('#card-title')).toHaveText(CARDS.D2.title);
  await expect(card.locator('.card-counter')).toHaveText(cardCounter(2, 2));
  await expect(page.locator('#terminal .term-hint')).toHaveText(CARD_HINT);
  expect(await cardOpen(page)).toBe('D2');
  expect(await noticeCount(page)).toBe(1);

  await closeCardWithEnter(page);
  await expect(page.locator('#card')).toBeHidden();
  expect(await hintIndex(page)).toBe(admix1 + 1);
  await expect(page.locator('#terminal .term-hint')).toHaveText(`Next: ${formatCommand(SCRIPT[admix1 + 1]!)}`);
  expect(w.errors).toEqual([]);
});

test('refresh (and Back, when it ships) bring the consumer bars back: at the hook and at the Iron Age test (Task 18, RF1)', async ({ page }) => {
  test.skip(!FEATURES.consumerBars, 'the consumerBars flag is off in the shipped set');
  const w = watch(page);
  await freshStart(page);
  const rows = (person: PeriodId | 'me'): string[] => consumerRows(DATA, person).map((r) => `${r.label} ${r.pct}%`);

  await run(page, formatCommand(SCRIPT[0]!));                         // the hook: the made-up customer
  expect(await consumerBarsShown(page)).toEqual(rows('me'));
  await page.reload();
  await idle(page);
  await expect(page.locator('#plot')).toHaveAttribute('data-view', 'consumer');
  expect(await consumerBarsShown(page)).toEqual(rows('me'));
  expect(await terminalBars(page)).toEqual(rows('me'));                // the log came back with the bars
  await expect(page.locator('#terminal')).toContainText(CONSUMER_BARS_LOG);

  const ironAgeTest = SCRIPT.findIndex((c) => c.name === 'ancestry_test' && c.person === 'IronAge');
  await runGuided(page, ironAgeTest, 1);                              // load_genomes up to the Iron Age map, every card closed
  await run(page, formatCommand(SCRIPT[ironAgeTest]!));
  expect(await consumerBarsShown(page)).toEqual(rows('IronAge'));
  await page.reload();
  await idle(page);
  await expect(page.locator('#plot svg.plot-svg')).toHaveAttribute('data-person', 'IronAge');
  expect(await consumerBarsShown(page)).toEqual(rows('IronAge'));
  await expect(page.locator('#terminal .term-hint')).toHaveText(REVEAL_HINT);   // the hint beat that follows the test came back too

  await run(page, formatCommand(SCRIPT[ironAgeTest + 1]!));           // the reveal map replaces the bars
  await expect(page.locator('#plot')).toHaveAttribute('data-view', 'pca');
  if (FEATURES.back) {
    await page.locator('#back').click();                              // and Back puts them back
    await expect(page.locator('#plot')).toHaveAttribute('data-view', 'consumer');
    expect(await consumerBarsShown(page)).toEqual(rows('IronAge'));
    await page.reload();
    await idle(page);
    expect(await consumerBarsShown(page)).toEqual(rows('IronAge'));
  }
  expect(w.errors).toEqual([]);
});

test('a v1 session left in storage is ignored and removed on load', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await page.evaluate((key) => {
    sessionStorage.clear();
    sessionStorage.setItem(key, JSON.stringify({
      history: ['run_pca(period = "Today")'],
      transcript: [{ kind: 'input', text: 'run_pca(period = "Today")' }],
      hintIndex: 3,
      plot: { view: 'pca', layers: ['Today'], frame: 'europe', showNorthSea: false, admixShown: [], admixNew: [] },
    }));
  }, V1);
  await page.reload();
  await idle(page);
  expect(await hintIndex(page)).toBe(0);
  await expect(page.locator('#terminal')).not.toContainText(RESTORED_NOTICE);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), V1)).toBeNull();
  expect(w.errors).toEqual([]);
});

test('blocked sessionStorage never crashes the app', async ({ page }) => {
  const w = watch(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await freshStart(page);
  await runGuided(page, 3);
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
  await runGuided(page, 2);
  await page.evaluate(() => {
    for (let i = 0; i < sessionStorage.length; i++) sessionStorage.setItem(sessionStorage.key(i)!, '{"history": [oops');
  });
  await page.reload();
  await idle(page);
  expect(await hintIndex(page)).toBe(0);
  await expect(page.locator('#terminal')).not.toContainText(RESTORED_NOTICE);
  await expect(page.locator('#card')).toBeHidden();
  expect(w.errors).toEqual([]);
});
