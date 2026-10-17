import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, type Page } from '@playwright/test';
import type { WorkshopData } from '../src/types';
import { ruleViolations } from '../tests/contentRules';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The page under test: dist/index.html, or the exported offline copy when APP_FILE is set. */
export const APP_URL = pathToFileURL(resolve(process.env.APP_FILE ?? resolve(ROOT, 'dist/index.html'))).href;
export const PAGES_URL = 'https://mpwilliams-lab.github.io/ancient-dna-workshop/';
export const DATA: WorkshopData = JSON.parse(readFileSync(resolve(ROOT, 'src/data/workshop_data.json'), 'utf8'));

export interface Watch { requests: string[]; errors: string[] }

/** Records every non-local request and every page error / console error. */
export function watch(page: Page, allowedPrefix?: string): Watch {
  const w: Watch = { requests: [], errors: [] };
  page.on('request', (r) => {
    const u = r.url();
    const local = /^(file|data|blob|about):/.test(u);
    if (allowedPrefix ? !u.startsWith(allowedPrefix) && !local : !local) w.requests.push(u);
  });
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') w.errors.push(`console: ${m.text()}`);
  });
  return w;
}

export function prompt(page: Page) {
  return page.locator('#terminal').locator('input, textarea').first();
}

export async function idle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__adw !== undefined && !window.__adw.isPrinting());
}

/**
 * Waits until nothing in the plot is still animating (the 0.5 s frame change between the Europe and British views),
 * so a marker's position is final before it is measured. Polled on a timer, not on animation frames.
 */
export async function plotSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (document.querySelector('#plot')?.getAnimations({ subtree: true }) ?? []).every((a) => a.playState !== 'running'),
    null,
    { polling: 50 },
  );
}

/** Types a command key by key, presses Enter and waits for its log (and plot action) to finish. */
export async function run(page: Page, cmd: string, opts: { wait?: boolean; typeDelay?: number } = {}): Promise<void> {
  const p = prompt(page);
  await p.click();
  await p.pressSequentially(cmd, { delay: opts.typeDelay ?? 0 });
  await p.press('Enter');
  if (opts.wait !== false) await idle(page);
}

export async function hintIndex(page: Page): Promise<number> {
  return page.evaluate(() => window.__adw!.hintIndex());
}

export async function freshStart(page: Page): Promise<void> {
  await page.goto(`${APP_URL}?reset`);
  await expect(prompt(page)).toBeVisible();
  await idle(page);
}

/** Box of the element's centre in CSS px. */
export async function centreOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  // A missing marker (the renderer lost its data-centre attribute) fails in 10 s, not after the 120 s test timeout.
  const box = await page.locator(selector).first().boundingBox({ timeout: 10_000 });
  if (!box) throw new Error(`${selector} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Spec §6: scans the text the built page has put in the DOM (terminal lines, hint, prompt row, SVG
 * labels, cards, wrap screen; hidden elements included) and returns every rule violation as
 * "<rule>: <text>". Each SVG <text> is scanned whole (its <tspan> lines joined), and every other
 * element that holds its own text is scanned as one string, so a sentence is never split mid-check.
 */
export async function screenViolations(page: Page): Promise<string[]> {
  const texts = await page.evaluate(() => {
    const seen = new Set<Element>();
    const out: string[] = [];
    for (const e of [...document.querySelectorAll('body *')]) {
      const tag = e.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || e.closest('script, style')) continue;
      const unit = e.closest('text') ?? e;
      if (seen.has(unit)) continue;
      const ownText = unit.tagName.toLowerCase() === 'text'
        || [...unit.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      if (!ownText) continue;
      seen.add(unit);
      const s = (unit.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (s) out.push(s);
    }
    return out;
  });
  return texts.flatMap((s) => ruleViolations(s).map((v) => `${v}: ${s}`));
}

/**
 * Spec §5.3 repeat guard: Enter or Esc within 400 ms of a card opening (or of the previous advance) is ignored.
 * Tests wait a little longer than that before pressing a key on a card. Continue clicks are never throttled.
 */
export const CARD_KEY_GAP_MS = 450;

/** Advances one card the way a student does: a blank Enter in the prompt, after the repeat guard. */
export async function closeCardWithEnter(page: Page): Promise<void> {
  await page.waitForTimeout(CARD_KEY_GAP_MS);
  await prompt(page).press('Enter');
}

/** Closes every open card with blank Enters (at most 5 presses). */
export async function closeAllCards(page: Page): Promise<void> {
  for (let i = 0; i < 5 && (await page.locator('#card').isVisible()); i++) await closeCardWithEnter(page);
  await expect(page.locator('#card')).toBeHidden();
}

/** The session cursor (step, card), from the read-only test hook. */
export async function screen(page: Page): Promise<{ step: number; card: number }> {
  return page.evaluate(() => window.__adw!.screen());
}

/** The id of the open card, or null. */
export async function cardOpen(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__adw!.cardOpen());
}

/** The data-layer ids of the PCA period layers on screen (one per PlotState.layers entry, CONTRACT §4.12). */
export async function layersShown(page: Page): Promise<string[]> {
  return page.locator('#plot g.layer.period').evaluateAll((els) => els.map((e) => e.getAttribute('data-layer') ?? ''));
}

/** The data-layer id of the focus layer, or null when no layer is in focus (Europe, all). */
export async function focusLayer(page: Page): Promise<string | null> {
  return page.locator('#plot g.layer.period[data-focus="true"]').evaluateAll((els) => (els.length === 1 ? els[0]!.getAttribute('data-layer') : els.length === 0 ? null : 'MORE THAN ONE'));
}
