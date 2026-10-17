import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { CARDS } from '../src/cards';
import { HLA_REVEAL_LINE, HLA_TEXT_CARD } from '../src/content';
import { FEATURES } from '../src/features';
import { SCRIPT } from '../src/hints';
import { formatCommand } from '../src/parser';
import { consumerRows } from '../src/plots/consumer';
import { PCA_VIEW } from '../src/plots/pca';
import { CARD_IDS, type CardId } from '../src/types';
import { a1LabelCandidates, buildFormsApp, IMAGE_CARD_IDS, MAP_CARD_IDS, PHOTO_SIZES, type FormsApp } from './mapBuild';
import {
  APP_URL, boxes, CARD_FIRST_BODY, centreOf, covers, DATA, expectInViewport, expectNoPageScroll, expectOnTop, focusLayer, idle,
  installBoxes, intersects, layersShown, openTestCard, plotSettled, prompt, run, screen, screenViolations, settle, testUrl, TEST_URL, watch,
  type Rect,
} from './helpers';
import { ALLOWED_FITS, CASES, LAB_STANDARD_CASES, NARROW_CASES, withPage, type Case } from './viewports';

/**
 * The full layout matrix of spec §5.4 (Task 26): every viewport case of e2e/viewports.ts (the 26 of v2.1 and every LAB_VIEWPORTS entry),
 * in Chromium and Edge, over the built file. Each family below runs over all of them:
 *   1. the panes: no page scroll, the prompt, the hint line and the plot on screen while the terminal output overflows; the wrap screen;
 *   2. every card, as shipped (the shipped flag set, the P1 text forms and whatever has been checked and enabled);
 *   3. a card restored by a refresh, and a card opened in the task that closed another (the narrowest cases);
 *   4. the plot panel at the steps that crowd it;
 *   5. the consumer bars;
 *   6. every card again in every upgraded form at once (maps and pictures forced on in a scratch build, e2e/mapBuild.ts), and the
 *      credits panel with all of them in its list.
 * The shipped build draws the text form of every card whose upgrade the instructor has not yet checked, so family 2 alone would prove
 * nothing about the upgrades; family 6 is what says that they fit, before and after the flags flip.
 */

// ---- 1. The panes ----

for (const c of CASES) {
  test(`no page scroll, prompt + hint + plot visible: ${c.name}`, async ({ browser }) => {
    await withPage(browser, c, async (page) => {
      await page.goto(`${APP_URL}?reset`);
      await expect(prompt(page)).toBeVisible();
      // Off-script commands (the hint stays on step 0), so no card opens: this test is about the panes.
      const filler = ['load_genomes()', 'run_pca(period = "all")', 'run_admixture(K = 3)', 'run_pca(period = "Viking")', 'run_pca(period = "AngloSaxon")', 'allele_freq(gene = "LCT")'];
      for (let round = 0; round < 3; round++) {
        for (const cmd of filler) await run(page, cmd, { wait: false });
      }
      await idle(page);
      await expect(page.locator('#card')).toBeHidden();
      // The test only means something if the terminal output really overflowed into its own scroller.
      const scrolled = await page.evaluate(() =>
        [...document.querySelectorAll('#terminal *')].some((e) => {
          const oy = getComputedStyle(e).overflowY;
          return (oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1;
        }),
      );
      expect(scrolled, 'terminal output overflows into an internal scroller').toBe(true);
      await expectNoPageScroll(page);

      await expectInViewport(page, 'prompt', prompt(page));
      await expectInViewport(page, 'hint', page.locator('#terminal').getByText(formatCommand(SCRIPT[0]!)).last());
      const plot = page.locator('#plot');
      await expectInViewport(page, 'plot', plot);
      const pb = (await plot.boundingBox())!;
      expect(pb.width, 'plot width').toBeGreaterThanOrEqual(240);
      expect(pb.height, 'plot height').toBeGreaterThanOrEqual(150);
      // Spec §7: terminal on the left, plot on the right (no case here is narrow or portrait enough to stack).
      const term = (await page.locator('#terminal').boundingBox())!;
      expect(term.x + term.width, 'terminal left of plot').toBeLessThanOrEqual(pb.x + 1);

      // RF5: the Iron Age -> Anglo-Saxon centre shift is at least 25 px on every lab screen and scale.
      await run(page, 'run_pca(period = "IronAge")');
      await run(page, 'run_pca(period = "AngloSaxon")');
      await plotSettled(page);
      const a = await centreOf(page, '#plot .centre[data-centre="IronAge"]');
      const b = await centreOf(page, '#plot .centre[data-centre="AngloSaxon"]');
      expect(Math.hypot(b.x - a.x, b.y - a.y), 'Anglo-Saxon shift').toBeGreaterThanOrEqual(25);

      // Wrap screen: the whole QR is on screen.
      await page.locator('#wrap-open').click();
      await expectInViewport(page, 'QR', page.locator('#wrap-qr svg'));
      await expectInViewport(page, 'wrap Image credits button', page.locator('#wrap-credits'));
      await expectInViewport(page, 'wrap Close', page.locator('#wrap-close'));
      // Credits panel (Task 15, spec §5.2): opens over the wrap screen with focus on its Close button, which is on screen (the
      // list inside scrolls, the page does not); Esc closes the panel only, and the wrap screen is still there.
      await page.locator('#wrap-credits').click();
      await expect(page.locator('#credits')).toBeVisible();
      await expect(page.locator('#credits-close')).toBeFocused();
      await expectInViewport(page, 'credits Close', page.locator('#credits-close'));
      await expectNoPageScroll(page);
      await page.keyboard.press('Escape');
      await expect(page.locator('#credits')).toBeHidden();
      await expect(page.locator('#wrap')).toBeVisible();
      await page.locator('#wrap-close').click();
      await expect(page.locator('#wrap')).toBeHidden();
    });
  });
}

// ---- 2. Every card, as shipped (spec §5.2, §5.4, §10.1 P1 item 7 and P2 item 9) ----
// Cards are opened through the ?test hook (window.__adw.openCard), which changes no session state. openTestCard gives the page two
// animation frames after each open, and each Continue gets them too, so layout, the card view's ResizeObserver refit (its safety net
// for a window resize or a late font) and the style recalculation have all run. The controller sets the hint line to CARD_HINT BEFORE
// it opens a card, so the card is placed correctly at once; e2e/back.spec.ts reads the geometry with no settle at all, after a Back
// through two bare plots and onto a card inside one task, which is where a card opened first and a hint changed after used to go wrong.

interface CardGeometry {
  vw: number; vh: number;
  fit: string | null;
  card: Rect | null; body: (Rect & { overflow: number }) | null;
  hint: Rect | null; prompt: Rect | null;
  hintHit: boolean; promptHit: boolean;
  /** The header bar, and whether "Take this home" and Back (when it ships) can be clicked: nothing covers any part of them. */
  bar: Rect | null; headerHit: boolean;
}

/** Everything the card checks need that is not one element's place on screen, read in one evaluate so the numbers belong to one moment. */
async function cardGeometry(page: Page): Promise<CardGeometry> {
  return page.evaluate((): CardGeometry => {
    const rect = (e: Element | null): Rect | null => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    /** Not covered: what a click at three points down the element's left side would hit is the element or a child of it. */
    const reachable = (e: Element | null): boolean => {
      if (!e) return false;
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const x = r.left + Math.min(r.width / 2, 24);
      return [r.top + 2, r.top + r.height / 2, r.bottom - 2].every((y) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && (hit === e || e.contains(hit));
      });
    };
    const card = document.querySelector<HTMLElement>('#card');
    const body = card?.querySelector<HTMLElement>('.card-body') ?? null;
    const hint = document.querySelector('#terminal .term-hint');
    const promptRow = document.querySelector('#terminal .term-prompt');
    const back = document.querySelector('#back');          // absent when the back flag is off
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      fit: card?.getAttribute('data-fit') ?? null,
      card: rect(card),
      body: body ? { ...rect(body)!, overflow: body.scrollHeight - body.clientHeight } : null,
      hint: rect(hint), prompt: rect(promptRow),
      hintHit: reachable(hint), promptHit: reachable(promptRow),
      bar: rect(document.querySelector('#bar')),
      headerHit: reachable(document.querySelector('#wrap-open')) && (back === null || reachable(back)),
    };
  });
}

/**
 * A page on `url` (a build with the ?test hook) with something to put cards over, as in class: the hook's own step run, so that Back has
 * somewhere to go and the header's Back button is live, and then a real PCA under the cards. Neither is the next guided step, so no
 * real card opens.
 */
async function startForCards(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(prompt(page)).toBeVisible();
  await idle(page);
  expect(await page.evaluate(() => typeof window.__adw?.openCard), 'openCard is attached with ?test').toBe('function');
  await run(page, formatCommand(SCRIPT[0]!));          // step 0, the hook: no card; the consumer bars appear
  await run(page, 'run_pca(period = "IronAge")');     // off the script: a real PCA, no card
  await plotSettled(page);
}

/**
 * What spec §5.2 and §5.4 ask of the open card at this viewport: its fit level is one the case allows; the page does not scroll;
 * the title, the first body line and every footer button, the prompt and the hint line are on screen and not covered, and so is the
 * header (Back and "Take this home"). The card never covers the hint line or the prompt row (geometry and a hit test down the element's
 * edge, which sees a 15 px overlap that a hit test at the centre of a two-line hint can miss). Returns the fit level.
 */
async function expectCardFits(page: Page, c: Case, id: CardId): Promise<string> {
  const card = page.locator('#card');
  const g = await cardGeometry(page);
  expect(ALLOWED_FITS[c.fit], `${id} at ${c.name} (rule: ${c.fit}): data-fit is ${g.fit}`).toContain(g.fit);
  if (g.fit !== 'scroll') expect(g.body!.overflow, `${id}: the body overflows at fit ${g.fit}`).toBeLessThanOrEqual(1);
  await expectNoPageScroll(page);

  await expectOnTop(page, `${id} title`, page.locator('#card-title'));
  const first = card.locator(CARD_FIRST_BODY).first();
  await expectOnTop(page, `${id} first body line`, first);
  expect((await first.boundingBox())!.y, `${id}: first body line inside the card body`).toBeLessThan(g.body!.bottom);
  const buttons = card.locator('.card-footer button');
  const n = await buttons.count();
  expect(n, `${id} footer buttons`).toBeGreaterThanOrEqual(1);
  for (let i = 0; i < n; i++) await expectOnTop(page, `${id} footer button ${i}`, buttons.nth(i));

  // Spec §5.2: below 1100 px the card covers both panes down to the hint line, and the prompt row, the hint line and the header stay usable.
  await expectOnTop(page, `${id}: prompt`, prompt(page));
  await expectOnTop(page, `${id}: hint line`, page.locator('#terminal .term-hint'));
  await expectOnTop(page, `${id}: "Take this home"`, page.locator('#wrap-open'));
  if (FEATURES.back) {
    await expectOnTop(page, `${id}: Back`, page.locator('#back'));
    await expect(page.locator('#back'), `${id}: Back is live (a step has run)`).toBeEnabled();
  }
  expect(intersects(g.card!, g.hint!), `${id} at ${c.name}: the card covers the hint line (card bottom ${g.card!.bottom}, hint top ${g.hint!.top})`).toBe(false);
  expect(intersects(g.card!, g.prompt!), `${id} at ${c.name}: the card covers the prompt row`).toBe(false);
  expect(g.hintHit, `${id}: hint line reachable`).toBe(true);
  expect(g.promptHit, `${id}: prompt row reachable`).toBe(true);
  // The header too: the card starts where the panes start, below it, and a click anywhere on Back and "Take this home" reaches them.
  expect(g.card!.top, `${id} at ${c.name}: the card starts below the header (card top ${g.card!.top}, header bottom ${g.bar!.bottom})`).toBeGreaterThanOrEqual(g.bar!.bottom - 0.5);
  expect(g.headerHit, `${id}: Back and "Take this home" reachable at three points down their edge`).toBe(true);
  return g.fit!;
}

/** Continue closes the card and gives the keyboard back to the prompt (spec §5.2). */
async function closeWithContinue(page: Page, id: CardId): Promise<void> {
  const card = page.locator('#card');
  await card.locator('.card-continue').click();
  await expect(card, `${id}: Continue closes the card`).toBeHidden();
  await expect(prompt(page), `${id}: prompt focused after Continue`).toBeFocused();
  await settle(page);
}

/**
 * The header under an open card (spec §5.2, carry-forward from the Task 14 review). "Take this home" opens the wrap screen over the card
 * and closes it again with the card still there and the prompt focused; Back closes the card and steps back one screen.
 */
async function expectHeaderUsable(page: Page, id: CardId): Promise<void> {
  const before = await screen(page);
  await openTestCard(page, id);
  await page.locator('#wrap-open').click();
  await expect(page.locator('#wrap'), `${id}: "Take this home" opens the wrap screen over the card`).toBeVisible();
  await page.locator('#wrap-close').click();
  await expect(page.locator('#wrap')).toBeHidden();
  await expect(page.locator('#card'), `${id}: the card is still there after the wrap screen closes`).toHaveAttribute('data-card-id', id);
  await expect(prompt(page)).toBeFocused();
  if (FEATURES.back) {
    await page.locator('#back').click();
    await expect(page.locator('#card'), `${id}: Back closes the card`).toBeHidden();
    expect((await screen(page)).step, `${id}: Back stepped back one step (the test card is no screen of its own)`).toBe(before.step - 1);
  } else {
    await closeWithContinue(page, id);
  }
}

for (const c of CASES) {
  test(`every card fits, with the prompt, hint line and header usable: ${c.name}`, async ({ browser }) => {
    test.setTimeout(240_000);
    await withPage(browser, c, async (page) => {
      const w = watch(page);
      await startForCards(page, TEST_URL);
      const fits: Record<string, string> = {};
      for (const id of CARD_IDS) {
        await openTestCard(page, id);
        fits[id] = await expectCardFits(page, c, id);
        await closeWithContinue(page, id);
      }
      await expectHeaderUsable(page, 'H2');   // the tightest card (the Task 11 review)
      console.log(`fit levels at ${c.name}: ${JSON.stringify(fits)}`);
      expect(w.requests).toEqual([]);
      expect(w.errors).toEqual([]);
    });
  });
}

// ---- 3. A refresh with a card open, and Back through a bare plot onto a card ----
// A refresh with a card open restores it (spec §4.5). The card opens while the page boots, so what places it above the hint line is
// the hint set first and the card measured against the laid-out page, with the card view's first ResizeObserver report as its safety
// net. The two cases are the narrowest ones where the card covers both panes down to the hint line: a lab screen at 150% and the floor.
// (NARROW_CASES are picked by name and the run stops at load if either name is gone, so this can never quietly run no case.)

for (const c of NARROW_CASES) {
  test(`a card restored by a refresh sits above the hint line and the prompt: ${c.name}`, async ({ browser }) => {
    await withPage(browser, c, async (page) => {
      const w = watch(page);
      await page.goto(`${APP_URL}?reset`);
      await expect(prompt(page)).toBeVisible();
      await idle(page);
      for (const step of SCRIPT.slice(0, 3)) await run(page, formatCommand(step));   // the hook, load_genomes, then Europe: A1 opens
      await expect(page.locator('#card[data-card-id="A1"]')).toHaveCount(1);
      await expect(page.locator('#card[data-card-id="A1"]')).toBeVisible();
      await page.reload();
      await idle(page);
      await expect(page.locator('#card[data-card-id="A1"]')).toHaveCount(1);
      await expect(page.locator('#card[data-card-id="A1"]')).toBeVisible();
      await settle(page);
      const g = await cardGeometry(page);
      expect(g.hint, 'hint line').not.toBeNull();
      expect(intersects(g.card!, g.hint!), `the restored card covers the hint line (card bottom ${g.card!.bottom}, hint top ${g.hint!.top})`).toBe(false);
      expect(intersects(g.card!, g.prompt!), 'the restored card covers the prompt row').toBe(false);
      expect(g.hintHit && g.promptHit, 'hint line and prompt reachable').toBe(true);
      await expectNoPageScroll(page);
      expect(w.errors).toEqual([]);
    });
  });
}

// A card opened in the same task that closed another (carry-forward from the Task 14 review). The hint line is one line as a step hint
// and two as CARD_HINT at these two sizes (20 and 36 px). A card placed against the one-line hint and then followed by CARD_HINT sat
// 15.6 px over it, and a ResizeObserver reports only a size that differs from the last one it reported: it had reported CARD_HINT's
// before the close, so nothing refitted the card, and it stayed there. A human cannot get here (the repeat guard is 400 ms); a script
// can, and so can Back through a bare plot (e2e/back.spec.ts). Read inside the same task, with no settle, and again after the page
// has had its frames: the first says the card is placed right at once, the second that nothing moves it afterwards.
for (const c of NARROW_CASES) {
  test(`a card opened in the task that closed the one before it sits above the hint line and the prompt at once, and stays: ${c.name}`, async ({ browser }) => {
    await withPage(browser, c, async (page) => {
      const w = watch(page);
      await installBoxes(page);
      await page.goto(TEST_URL);
      await expect(prompt(page)).toBeVisible();
      await idle(page);
      await page.evaluate(() => window.__adw!.openCard!('E1'));
      await expect(page.locator('#card[data-card-id="E1"]')).toBeVisible();
      await settle(page);   // the observer has now reported the hint's size with a card open
      const withCard = (await boxes(page)).hintH;
      for (const id of CARD_IDS.filter((x) => x !== 'E1')) {
        const same = await page.evaluate((next) => {
          (document.querySelector('#card .card-continue') as HTMLButtonElement).click();   // closes the card: the step hint, one line
          const stepHintH = window.__boxes!().hintH;
          window.__adw!.openCard!(next);                                                    // and opens the next one in the same task
          return { boxes: window.__boxes!(), stepHintH };
        }, id);
        expect(same.stepHintH, `${id}: the premise, the step hint is shorter than CARD_HINT here`).toBeLessThan(withCard);
        expect(covers(same.boxes).hint, `${id}: the card covers the hint line in the task that opened it`).toBe(false);
        expect(covers(same.boxes).prompt, `${id}: the card covers the prompt row in the task that opened it`).toBe(false);
        await settle(page);
        await page.waitForTimeout(150);
        const later = covers(await boxes(page));
        expect(later.hint, `${id}: the card covers the hint line after the page settled`).toBe(false);
        expect(later.prompt, `${id}: the card covers the prompt row after the page settled`).toBe(false);
      }
      expect(w.requests).toEqual([]);
      expect(w.errors).toEqual([]);
    });
  });
}

// ---- 4. The plot panel at the steps that crowd it (carry-forward from the Task 8 and Task 9 reviews, and the Task 22 observation) ----
// At the 640x360 floor the Today step's caption strip takes 184 of the panel's 332 px (the plot 148 px), the finale's 180 px, and
// the HLA-DQ2 trajectory leaves its plot 80 px under a 103 px reveal line. These checks say that, at every viewport, nothing the
// panel draws is clipped by its overflow:hidden, nothing overlaps, the legend stays inside the plot's own coordinates with its items
// clear of one another, and the plot keeps a usable height. They do not say the text is comfortable to read at the floor: that is
// judged on the lab machine (the lab font, Segoe UI, is not the one measured here).
//
// The panel depends only on the commands run (spec §4.1: refresh replays them), so these commands, which are off the guided
// script and so open no card, give the same panel as guided steps 4-10, 14 and 19 (the same #plot markup, compared once while
// writing this test).
//
// Task 26: the caption strip follows the plot. The svg used to take every pixel the strip left (flex: 1), and the plot, width-limited
// and anchored to its top, left a blank band between the legend and the strip: 106 px at 1366 x 768 and 250 px at 1024 x 768. Now
// the svg takes the height its own proportions give it at the pane's width, so the strip sits right under it and the spare height is
// below the strip. Where the pane is too short for plot and strip the svg still gives up height, and only then, so the plot is no
// smaller than it was; and it stays anchored to the top of the pane, so it never jumps from step to step (the Task 8 fix).

/**
 * The plot's own minimum height, in CSS px. At a size a lab screen can really have (a CSS height of 480 or more) it must stay a
 * useful picture. At the 640x360 floor it is held near what was measured (PCA 148 and 152, the trajectory 80), so a caption that
 * grows by a line is noticed there.
 */
const MIN_PLOT_PX = { lab: 200, floorPca: 120, floorTrait: 64 } as const;

/**
 * What the PCA is drawn at, in CSS px, at the lab-standard sizes (measured 2026-10-17 in Chromium and Edge on macOS: 745 x 566 at
 * 1366 x 768, 1047 x 796 at 1920 x 1080, 596 x 453 at 1092 x 614 and 838 x 637 at 1536 x 864, at every step from the Iron Age to the
 * finale). The pins sit about 6% under, so a change that shrinks the plot at a size the lab is likely to have is noticed. Keyed by the
 * CSS size of the window.
 */
const MIN_PCA_DRAWN: Readonly<Record<string, readonly [width: number, height: number]>> = {
  '1366x768': [700, 530], '1920x1080': [985, 745], '1092x614': [560, 425], '1536x864': [790, 600],
};

/** A box in the plot's own units (the PCA plot is 1000 x 760, the ADMIXTURE and consumer bars 1000 x 700, the trajectory 1000 x 520). */
interface Extent { left: number; right: number; top: number; bottom: number }
interface LegendBox { name: string; row: number; left: number; right: number }
const PCA_BLOCKS = ['svg.plot-svg', 'div.pca-captions'];

interface PanelGeometry {
  panel: Rect & { clipH: number; clipW: number };
  /** The svg's box in CSS px, and the scale its viewBox is drawn at (CSS px per plot unit: meet, so the smaller of the two axes). */
  svg: (Rect & { height: number; width: number; scale: number }) | null;
  /** The font size, in the plot's own units, of the smallest text the svg draws (null if it draws none). */
  smallestText: number | null;
  /** The panel's blocks from top to bottom: the svg and the caption strip, or the trajectory's title, svg and caption lines. */
  blocks: { name: string; rect: Rect; clipH: number }[];
  /** The extent of every legend text. */
  legend: Extent | null;
  /** Each legend heading and item with the row its text sits on, left to right as drawn. */
  legendBoxes: LegendBox[];
}

async function panelGeometry(page: Page): Promise<PanelGeometry> {
  await plotSettled(page);
  return page.evaluate((): PanelGeometry => {
    const rect = (e: Element): Rect => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    const plot = document.querySelector<HTMLElement>('#plot')!;
    const traj = plot.querySelector<HTMLElement>('.traj');
    const stack = traj ? [...traj.children] : [...plot.children];
    // How far an HTML block's content runs past its own box (an svg is fitted by its viewBox and cannot clip its content).
    const clip = (e: Element): number => (e instanceof SVGElement ? 0 : Math.max(e.scrollHeight - e.clientHeight, e.scrollWidth - e.clientWidth));
    const svg = plot.querySelector('svg');
    const texts = [...plot.querySelectorAll<SVGGraphicsElement>('.legend text')];
    let legend: PanelGeometry['legend'] = null;
    for (const t of texts) {
      const b = t.getBBox();
      legend = legend
        ? { left: Math.min(legend.left, b.x), right: Math.max(legend.right, b.x + b.width), top: Math.min(legend.top, b.y), bottom: Math.max(legend.bottom, b.y + b.height) }
        : { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height };
    }
    // The legend's headings and items, each as the box of its own marks and text (the svg root has no transform, so bbox units are plot units).
    const legendBoxes: LegendBox[] = [...plot.querySelectorAll<SVGGraphicsElement>('.legend-heading, .legend-item')].map((e) => {
      const b = e.getBBox();
      const text = e.tagName.toLowerCase() === 'text' ? e : e.querySelector('text');
      return {
        name: e.classList.contains('legend-heading') ? `heading "${e.textContent ?? ''}"` : `item "${e.textContent ?? ''}"`,
        row: Number(text?.getAttribute('y') ?? NaN), left: b.x, right: b.x + b.width,
      };
    });
    const box = svg ? svg.getBoundingClientRect() : null;
    const vb = svg ? svg.viewBox.baseVal : null;
    // The smallest text in the plot's own units (the font-size attribute: the svg root has no transform).
    const sizes = svg ? [...svg.querySelectorAll('text')].map((t) => parseFloat(getComputedStyle(t).fontSize)).filter((n) => n > 0) : [];
    return {
      panel: { ...rect(plot), clipH: plot.scrollHeight - plot.clientHeight, clipW: plot.scrollWidth - plot.clientWidth },
      svg: svg && box && vb
        ? { ...rect(svg), height: box.height, width: box.width, scale: Math.min(box.width / vb.width, box.height / vb.height) }
        : null,
      smallestText: sizes.length > 0 ? Math.min(...sizes) : null,
      blocks: stack.map((e) => ({ name: `${e.tagName.toLowerCase()}.${e.getAttribute('class') ?? ''}`.replace(/\.$/, ''), rect: rect(e), clipH: clip(e) })),
      legend,
      legendBoxes,
    };
  });
}

/**
 * Projector legibility of the plots' text (carry-forward from the Task 9 review: the bar labels drew about 9 CSS px at 1024 x 768 and
 * 6 at 1024 x 768 at 150%). What matters is the size on the glass, in device pixels: the smallest text in a plot (the 14-unit PCA
 * legend, the 16-unit bar labels) times the scale it is drawn at times the device scale factor. At the lab-standard sizes it is
 * 10.4 device px for the legend and 11.9 for the bar labels at 1366 x 768 (the same at 125%, whose CSS pixels are bigger), and 14.7 and
 * 16.8 at 1920 x 1080. This pins that those are not lost; whether 10 px is comfortable on the lab projector is the Mon 19 lab check.
 */
const MIN_TEXT_DEVICE_PX = 10;

function expectTextLegible(g: PanelGeometry, label: string, c: Case): number | null {
  if (g.smallestText === null) return null;
  const device = g.smallestText * g.svg!.scale * c.dsf;
  if (LAB_STANDARD_CASES.includes(c)) {
    expect(device, `${label}: the smallest text (${g.smallestText} units) is drawn ${device.toFixed(1)} device px tall at ${c.name}`).toBeGreaterThanOrEqual(MIN_TEXT_DEVICE_PX);
  }
  return device;
}

function expectPanelHolds(g: PanelGeometry, label: string, c: Case, view: 'pca' | 'bars' | 'trait', blocks: string[]): void {
  const tol = 0.5;
  expect(g.panel.clipH, `${label}: the plot panel clips its content vertically`).toBeLessThanOrEqual(1);
  expect(g.panel.clipW, `${label}: the plot panel clips its content horizontally`).toBeLessThanOrEqual(1);
  expect(g.svg, `${label}: the plot svg`).not.toBeNull();
  const need = c.height >= 480 ? MIN_PLOT_PX.lab : view === 'trait' ? MIN_PLOT_PX.floorTrait : MIN_PLOT_PX.floorPca;
  expect(g.svg!.height, `${label}: the plot keeps at least ${need}px of height`).toBeGreaterThanOrEqual(need);
  expect(g.blocks.map((b) => b.name), `${label}: what the panel is made of`).toEqual(blocks);
  g.blocks.forEach((b, k) => {
    expect(b.rect.top, `${label}: ${b.name} top inside the panel`).toBeGreaterThanOrEqual(g.panel.top - tol);
    expect(b.rect.bottom, `${label}: ${b.name} bottom inside the panel`).toBeLessThanOrEqual(g.panel.bottom + tol);
    expect(b.rect.right, `${label}: ${b.name} right inside the panel`).toBeLessThanOrEqual(g.panel.right + tol);
    expect(b.clipH, `${label}: ${b.name} clips its own content`).toBeLessThanOrEqual(1);
    if (k > 0) expect(b.rect.top, `${label}: ${b.name} starts below ${g.blocks[k - 1]!.name}`).toBeGreaterThanOrEqual(g.blocks[k - 1]!.rect.bottom - tol);
  });
}

/**
 * The PCA's svg is as tall as its own proportions give it at the pane's width, or as the caption strip leaves room if that is less
 * (and only then); it starts at the top of the pane; and the strip starts where it ends. Together: no blank band between the plot and
 * its caption, the plot never moves between steps, and it is as big as the pane allows.
 */
function expectPlotFollowsCaption(g: PanelGeometry, label: string): void {
  const svg = g.svg!;
  const strip = g.blocks.find((b) => b.name === 'div.pca-captions')!.rect;
  const natural = (svg.width * PCA_VIEW.height) / PCA_VIEW.width;
  const room = g.panel.bottom - g.panel.top - (strip.bottom - strip.top);
  expect(svg.top - g.panel.top, `${label}: the plot starts at the top of the pane`).toBeLessThanOrEqual(0.5);
  expect(
    Math.abs(svg.height - Math.min(natural, room)),
    `${label}: the plot is ${svg.height.toFixed(1)} px tall; its proportions give ${natural.toFixed(1)} and the caption strip leaves room for ${room.toFixed(1)}`,
  ).toBeLessThanOrEqual(1);
  expect(Math.abs(strip.top - svg.bottom), `${label}: the caption strip follows the plot (${(strip.top - svg.bottom).toFixed(1)} px between them)`).toBeLessThanOrEqual(1);
}

/** The PCA at the lab-standard sizes is as big as it was measured (see MIN_PCA_DRAWN), whatever the step. Returns what it is drawn at. */
function expectPcaDrawnBig(g: PanelGeometry, label: string, c: Case): { width: number; height: number } {
  const drawn = { width: PCA_VIEW.width * g.svg!.scale, height: PCA_VIEW.height * g.svg!.scale };
  const min = MIN_PCA_DRAWN[`${c.width}x${c.height}`];
  if (min !== undefined) {
    expect(drawn.width, `${label}: the PCA is drawn ${drawn.width.toFixed(0)} x ${drawn.height.toFixed(0)} px at ${c.name}`).toBeGreaterThanOrEqual(min[0]);
    expect(drawn.height, `${label}: the PCA is drawn ${drawn.width.toFixed(0)} x ${drawn.height.toFixed(0)} px at ${c.name}`).toBeGreaterThanOrEqual(min[1]);
  }
  return drawn;
}

/**
 * The legend is laid out from character-width estimates, so a wider font could push it past the plot's edge or run one item into
 * the next. Looked at on the real text: inside the 1000 x 760 plot, and each item starting after the one before it on its row.
 */
function expectLegendClear(g: PanelGeometry, label: string): void {
  expect(g.legend, `${label}: legend`).not.toBeNull();
  expect(g.legend!.left, `${label}: legend left`).toBeGreaterThanOrEqual(0);
  expect(g.legend!.right, `${label}: legend right edge (the plot is 1000 units wide)`).toBeLessThanOrEqual(1000);
  expect(g.legend!.bottom, `${label}: legend bottom (the plot is 760 units tall)`).toBeLessThanOrEqual(760);
  expect(g.legendBoxes.length, `${label}: legend headings and items`).toBeGreaterThanOrEqual(4);
  const rows = new Map<number, LegendBox[]>();
  for (const b of g.legendBoxes) rows.set(b.row, [...(rows.get(b.row) ?? []), b]);
  for (const [row, boxes] of rows) {
    boxes.sort((a, b) => a.left - b.left);
    boxes.forEach((b, k) => {
      if (k > 0) expect(b.left, `${label}: legend row ${row}: ${b.name} starts before ${boxes[k - 1]!.name} ends`).toBeGreaterThanOrEqual(boxes[k - 1]!.right - 0.5);
    });
  }
}

interface BarsGeometry { labels: Extent[]; pct: Extent[]; takeaway: Extent | null }

/** The text of the ADMIXTURE bars, as drawn: each bar's label and steppe percent from left to right, and the takeaway under them. */
async function barsGeometry(page: Page): Promise<BarsGeometry> {
  return page.evaluate((): BarsGeometry => {
    const ext = (e: Element): Extent => {
      const b = (e as SVGGraphicsElement).getBBox();
      return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height };
    };
    const svg = document.querySelector('#plot svg')!;
    const byLeft = (a: Extent, b: Extent): number => a.left - b.left;
    const takeaway = svg.querySelector('.admix-takeaway');
    return {
      labels: [...svg.querySelectorAll('.bar-label')].map(ext).sort(byLeft),
      pct: [...svg.querySelectorAll('.steppe-pct')].map(ext).sort(byLeft),
      takeaway: takeaway ? ext(takeaway) : null,
    };
  });
}

/**
 * Eight bars and the four-line Anglo-Saxon takeaway: the bar labels wrap on character-width estimates, and the four-line First farmers
 * label sits about 6 units above the takeaway (Task 9 review). Looked at on the real text: every label and percent inside the plot,
 * none running into its neighbour, and every label clear of the takeaway.
 */
function expectBarsClear(g: BarsGeometry, label: string): void {
  expect(g.labels.length, `${label}: bar labels`).toBe(8);
  expect(g.pct.length, `${label}: steppe percents`).toBe(8);
  expect(g.takeaway, `${label}: the Anglo-Saxon takeaway`).not.toBeNull();
  for (const [name, list] of [['bar label', g.labels], ['steppe percent', g.pct]] as const) {
    list.forEach((e, k) => {
      expect(e.left, `${label}: ${name} ${k} left edge`).toBeGreaterThanOrEqual(0);
      expect(e.right, `${label}: ${name} ${k} right edge (the plot is 1000 units wide)`).toBeLessThanOrEqual(1000);
      if (k > 0) expect(e.left, `${label}: ${name} ${k} starts before ${name} ${k - 1} ends`).toBeGreaterThanOrEqual(list[k - 1]!.right);
    });
  }
  g.labels.forEach((l, k) => expect(l.bottom, `${label}: bar label ${k} runs into the takeaway`).toBeLessThanOrEqual(g.takeaway!.top));
  expect(g.takeaway!.right, `${label}: takeaway right edge`).toBeLessThanOrEqual(1000);
  expect(g.takeaway!.bottom, `${label}: takeaway bottom (the bars plot is 700 units tall)`).toBeLessThanOrEqual(700);
}

/** The bars (ADMIXTURE and consumer) are drawn as big as the pane's width allows at the lab-standard sizes: their text is only as legible as this scale. */
function expectBarsFillWidth(g: PanelGeometry, label: string, c: Case): void {
  if (!LAB_STANDARD_CASES.includes(c)) return;
  const wide = (g.panel.right - g.panel.left) / 1000;
  expect(g.svg!.scale, `${label}: the bars are drawn at ${g.svg!.scale.toFixed(3)} px per unit; the pane is ${wide.toFixed(3)} wide`).toBeGreaterThanOrEqual(0.97 * wide);
}

for (const c of CASES) {
  test(`the plot panel holds at the Today step, the finale, the full ADMIXTURE bars and HLA-DQ2: ${c.name}`, async ({ browser }) => {
    test.setTimeout(180_000);
    await withPage(browser, c, async (page) => {
      const w = watch(page);
      await page.goto(`${APP_URL}?reset`);
      await expect(prompt(page)).toBeVisible();
      await idle(page);
      // Guided steps 4-7 and 8: the four earlier periods the reveal sits beside.
      for (const period of ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge']) await run(page, `run_pca(period = "${period}")`, { wait: false });
      await idle(page);
      await plotSettled(page);
      // The shortest caption strip (the two chips and one caption), the one the Today step's is compared with below.
      const ironAge = await panelGeometry(page);
      expectPanelHolds(ironAge, 'Iron Age step', c, 'pca', PCA_BLOCKS);
      expectPlotFollowsCaption(ironAge, 'Iron Age step');
      expectPcaDrawnBig(ironAge, 'Iron Age step', c);

      // Step 10: Britain today is drawn for the first time, in focus, beside the four earlier layers.
      await run(page, 'run_pca(period = "Today")');
      await expect(page.locator('#plot')).toHaveAttribute('data-view', 'pca');
      await plotSettled(page);
      expect(await layersShown(page), 'Today layers').toEqual(['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Today']);
      expect(await focusLayer(page), 'Today focus').toBe('Today');
      const today = await panelGeometry(page);
      if (c.height <= 512) console.log(`${c.name}: Today plot ${today.svg!.height.toFixed(0)} px of ${(today.panel.bottom - today.panel.top).toFixed(0)}`);
      expectPanelHolds(today, 'Today step', c, 'pca', PCA_BLOCKS);
      expectLegendClear(today, 'Today step');
      expectPlotFollowsCaption(today, 'Today step');
      const drawn = expectPcaDrawnBig(today, 'Today step', c);
      const legible = expectTextLegible(today, 'Today step', c);
      if (LAB_STANDARD_CASES.includes(c)) {
        console.log(`${c.name}: PCA drawn ${drawn.width.toFixed(0)} x ${drawn.height.toFixed(0)} px (${today.svg!.scale.toFixed(3)} px per unit), the pane ${(today.panel.right - today.panel.left).toFixed(0)} x ${(today.panel.bottom - today.panel.top).toFixed(0)}, smallest text ${legible!.toFixed(1)} device px`);
      }
      // A caption strip that grows from step to step never moves or resizes a plot that has room (Task 8: no vertical jump).
      if (ironAge.svg!.height >= (ironAge.svg!.width * PCA_VIEW.height) / PCA_VIEW.width - 1 && today.svg!.height >= (today.svg!.width * PCA_VIEW.height) / PCA_VIEW.width - 1) {
        expect(today.svg!.height, 'the plot has the same size at the Iron Age and Today steps, whatever the caption strip needs').toBeCloseTo(ironAge.svg!.height, 0);
        expect(today.svg!.top, 'the plot has the same place at the Iron Age and Today steps').toBeCloseTo(ironAge.svg!.top, 0);
      }

      // Step 14: the finale, every period at once.
      await run(page, 'run_pca(period = "all")');
      await plotSettled(page);
      expect((await layersShown(page)).length, 'finale layers').toBe(8);
      expect(await focusLayer(page), 'finale focus').toBeNull();
      const finale = await panelGeometry(page);
      if (c.height <= 512) console.log(`${c.name}: finale plot ${finale.svg!.height.toFixed(0)} px of ${(finale.panel.bottom - finale.panel.top).toFixed(0)}`);
      expectPanelHolds(finale, 'finale', c, 'pca', PCA_BLOCKS);
      expectLegendClear(finale, 'finale');
      expectPlotFollowsCaption(finale, 'finale');
      expectPcaDrawnBig(finale, 'finale', c);

      // The bars with all eight periods run and the takeaway under them (the extras' last run_admixture(K = 3)).
      await run(page, 'run_admixture(K = 3)');
      await expect(page.locator('#plot')).toHaveAttribute('data-view', 'admixture');
      await plotSettled(page);
      const bars = await panelGeometry(page);
      expectPanelHolds(bars, 'ADMIXTURE bars', c, 'bars', ['svg.plot-svg']);
      expectBarsClear(await barsGeometry(page), 'ADMIXTURE bars');
      expectBarsFillWidth(bars, 'ADMIXTURE bars', c);
      const barText = expectTextLegible(bars, 'ADMIXTURE bars', c);
      if (LAB_STANDARD_CASES.includes(c)) console.log(`${c.name}: ADMIXTURE bars drawn at ${bars.svg!.scale.toFixed(3)} px per unit, smallest text ${barText!.toFixed(1)} device px`);

      // Step 19: HLA-DQ2, the trajectory with the reveal line under its caption.
      await run(page, 'allele_freq(gene = "HLA-DQ2")');
      await expect(page.locator('#plot')).toHaveAttribute('data-view', 'trait');
      if (DATA.traits.find((t) => t.gene === 'HLA-DQ2')!.source === 'text') {
        await expect(page.locator('#plot')).toContainText(HLA_TEXT_CARD);   // the text card has no trajectory, so nothing to crowd
      } else {
        await expect(page.locator('#plot .traj-reveal')).toHaveText(HLA_REVEAL_LINE);
        const hla = await panelGeometry(page);
        if (c.height <= 512) console.log(`${c.name}: HLA-DQ2 plot ${hla.svg!.height.toFixed(0)} px of ${(hla.panel.bottom - hla.panel.top).toFixed(0)}`);
        expectPanelHolds(hla, 'HLA-DQ2', c, 'trait', ['h3.traj-title', 'svg.traj-svg', 'p.traj-caption', 'p.traj-reveal', 'p.traj-source']);
      }
      expect(w.requests).toEqual([]);
      expect(w.errors).toEqual([]);
    });
  });
}

// ---- 5. The consumer bars ----

interface ConsumerGeometry {
  title: Extent; subtitle: Extent; note: Extent;
  rows: { label: Extent; track: Extent; pct: Extent }[];
}

/** The text and the tracks of the consumer bars, as drawn, in the plot's own units (the svg root has no transform). */
async function consumerGeometry(page: Page): Promise<ConsumerGeometry> {
  return page.evaluate((): ConsumerGeometry => {
    const ext = (e: Element | null): Extent => {
      if (!e) throw new Error('a part of the consumer bars is missing');
      const b = (e as SVGGraphicsElement).getBBox();
      return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height };
    };
    const svg = document.querySelector('#plot svg[data-view="consumer"]')!;
    return {
      title: ext(svg.querySelector('.consumer-title')),
      subtitle: ext(svg.querySelector('.consumer-subtitle')),
      note: ext(svg.querySelector('.consumer-note')),
      rows: [...svg.querySelectorAll('g.consumer-bar')].map((g) => ({
        label: ext(g.querySelector('.consumer-label')), track: ext(g.querySelector('.consumer-track')), pct: ext(g.querySelector('.consumer-pct')),
      })),
    };
  });
}

/**
 * The consumer bars are laid out on character-width estimates too (the title wraps at 60 characters, the labels sit right-aligned
 * in a 190-unit column), so a wider font could push a line past the edge or a label into its bar. Looked at on the real text: every
 * text inside the 1000 x 700 plot, each label ending before its bar and each percent starting after it, and the title, subtitle,
 * bars and note in reading order without touching.
 */
function expectConsumerClear(g: ConsumerGeometry, label: string, rows: number): void {
  expect(g.rows.length, `${label}: bars`).toBe(rows);
  const inside = (name: string, e: Extent): void => {
    expect(e.left, `${label}: ${name} left edge`).toBeGreaterThanOrEqual(0);
    expect(e.right, `${label}: ${name} right edge (the plot is 1000 units wide)`).toBeLessThanOrEqual(1000);
    expect(e.top, `${label}: ${name} top`).toBeGreaterThanOrEqual(0);
    expect(e.bottom, `${label}: ${name} bottom (the bars plot is 700 units tall)`).toBeLessThanOrEqual(700);
  };
  inside('title', g.title);
  inside('subtitle', g.subtitle);
  inside('note', g.note);
  expect(g.subtitle.top, `${label}: the subtitle starts below the title`).toBeGreaterThanOrEqual(g.title.bottom - 1);
  g.rows.forEach((r, k) => {
    inside(`label ${k}`, r.label);
    inside(`bar ${k}`, r.track);
    inside(`percent ${k}`, r.pct);
    expect(r.label.right, `${label}: label ${k} ends before its bar`).toBeLessThanOrEqual(r.track.left);
    expect(r.pct.left, `${label}: percent ${k} starts after its bar`).toBeGreaterThanOrEqual(r.track.right);
    if (k === 0) expect(r.track.top, `${label}: the first bar starts below the subtitle`).toBeGreaterThanOrEqual(g.subtitle.bottom);
    else expect(r.track.top, `${label}: bar ${k} starts below bar ${k - 1}`).toBeGreaterThanOrEqual(g.rows[k - 1]!.track.bottom);
  });
  expect(g.note.top, `${label}: the note starts below the last bar`).toBeGreaterThanOrEqual(g.rows.at(-1)!.track.bottom);
}

for (const c of CASES) {
  test(`the consumer bars fit the plot panel with every text in view (Task 18): ${c.name}`, async ({ browser }) => {
    test.skip(!FEATURES.consumerBars, 'the consumerBars flag is off in the shipped set');
    test.setTimeout(120_000);
    await withPage(browser, c, async (page) => {
      const w = watch(page);
      await page.goto(`${APP_URL}?reset`);
      await expect(prompt(page)).toBeVisible();
      await idle(page);
      // The hook (the longest one-line heading, two bars), the longest title (two lines), and the most bars (five).
      for (const person of ['me', 'FirstFarmers', 'AngloSaxon'] as const) {
        await run(page, `ancestry_test(person = "${person}")`);
        await expect(page.locator('#plot')).toHaveAttribute('data-view', 'consumer');
        await expect(page.locator('#plot svg.plot-svg')).toHaveAttribute('data-person', person);
        const label = `consumer bars (${person})`;
        const g = await panelGeometry(page);
        expectPanelHolds(g, label, c, 'bars', ['svg.plot-svg']);
        expectBarsFillWidth(g, label, c);
        expectTextLegible(g, label, c);
        expectConsumerClear(await consumerGeometry(page), label, consumerRows(DATA, person).length);
      }
      expect(w.requests).toEqual([]);
      expect(w.errors).toEqual([]);
    });
  });
}

// ---- 6. Every upgraded form at once (spec §5.2, §5.4, §10.3; Task 26) ----
// The shipped build draws a card's text form until the instructor has checked its maps and pictures and the release task has enabled
// the flag, so the matrix above is silent about how an upgrade fits. This one is built the way e2e/mapBuild.ts builds the map proof,
// extended to the pictures: every map flag and every image flag forced on, every map and picture recorded as checked, and stand-in
// pictures of the staged photos' exact sizes bundled, all in memory and in a temporary directory, the repo untouched. 15 of the 23
// cards then draw an upgrade (the other eight have none built). It asks what the matrix asks of every card, and also that each card
// really is in the form it should be in, that every picture is decoded and drawn whole (object-fit: contain, never above the spec's
// height cap) and that the credits panel, with every image and map of the build in its list, still fits. The words and dots on the maps
// are judged in e2e/maps.spec.ts, which runs the same viewports.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The own drawings in src/assets/svg (bundled as they are, in this build and in the shipped one). */
const SVG_IMAGE_IDS = readdirSync(`${ROOT}src/assets/svg`).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -'.svg'.length));
/** Every picture this build bundles: the stand-ins for the staged photos, and the two own drawings. */
const BUNDLED = new Set<string>([...Object.keys(PHOTO_SIZES), ...SVG_IMAGE_IDS]);
/** The flags this build forces on. */
const FORCED = new Set<string>([...MAP_CARD_IDS.map((m) => `map.${m}`), ...IMAGE_CARD_IDS.map((i) => `images.${i}`)]);

interface ExpectedForm { upgraded: boolean; map: boolean; pictures: string[] }

/** What this build draws for a card, worked out from the card's definition: the upgrade when its flag is forced on and its map is built or
 *  every one of its non-optional pictures is bundled; of its pictures the ones that are bundled (an optional tile without a file is left out). */
function expectedForm(id: CardId): ExpectedForm {
  const card = CARDS[id];
  const on = card.feature !== undefined && FORCED.has(card.feature);
  const tiles = card.tiles ?? [];
  const mapBuilt = card.map !== undefined && (MAP_CARD_IDS as readonly string[]).includes(card.map);
  const picturesReady = tiles.length > 0 && tiles.every((t) => t.optional === true || BUNDLED.has(t.image));
  const upgraded = on && (card.map !== undefined ? mapBuilt : picturesReady);
  return {
    upgraded,
    map: upgraded && card.map !== undefined,
    pictures: upgraded && card.map === undefined ? tiles.filter((t) => BUNDLED.has(t.image)).map((t) => t.image) : [],
  };
}

interface PictureGeometry { id: string | null; src: string; natural: [number, number]; box: Rect; shown: string; fit: string }

/** The pictures of the open card, as the page draws them. */
async function pictures(page: Page): Promise<{ form: string | null; pictures: PictureGeometry[] }> {
  return page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('#card .card-tiles');
    const imgs = [...document.querySelectorAll<HTMLImageElement>('#card .card-tile img')].map((img) => {
      const r = img.getBoundingClientRect();
      const cs = getComputedStyle(img);
      return {
        id: img.closest('.card-tile')?.getAttribute('data-image') ?? null,
        src: img.getAttribute('src') ?? '',
        natural: [img.naturalWidth, img.naturalHeight] as [number, number],
        box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        shown: cs.display,
        fit: cs.objectFit,
      };
    });
    return { form: row?.getAttribute('data-form') ?? null, pictures: imgs };
  });
}

/** The open card is in the form this build should draw for it, and what it draws there is whole, decoded and within spec §5.2's caps. */
async function expectFormShown(page: Page, c: Case, id: CardId, fit: string): Promise<void> {
  const form = expectedForm(id);
  const card = page.locator('#card');
  expect(await card.locator('.card-credits').count(), `${id}: Image credits is offered in the upgraded form and only there`).toBe(form.upgraded ? 1 : 0);
  expect(await card.locator('.card-map').count(), `${id}: a map in the card exactly when it is a map card in its upgraded form`).toBe(form.map ? 1 : 0);
  const g = await pictures(page);
  if ((CARDS[id].tiles ?? []).length > 0) expect(g.form, `${id}: the tile row is in the ${form.upgraded ? 'picture' : 'text'} form`).toBe(form.upgraded ? 'images' : 'text');
  expect(g.pictures.map((p) => p.id), `${id}: the pictures on the card, in tile order`).toEqual(form.pictures);
  const cardBox = (await card.boundingBox())!;
  for (const p of g.pictures) {
    expect(p.src.startsWith('data:image/'), `${id}/${p.id}: the picture is inlined`).toBe(true);
    expect(p.natural[0] > 0 && p.natural[1] > 0, `${id}/${p.id}: the picture is decoded`).toBe(true);
    const size = PHOTO_SIZES[p.id!];
    if (size !== undefined) expect(p.natural, `${id}/${p.id}: the stand-in has the staged photo's size`).toEqual([...size]);
    expect(p.fit, `${id}/${p.id}: object-fit (a picture is shown whole, never cut)`).toBe('contain');
    // Only the compact fit level hides the pictures (spec §5.2); every other level shows every one of them.
    expect(p.shown === 'none', `${id}/${p.id}: hidden exactly at compact (fit ${fit})`).toBe(fit === 'compact' || fit === 'scroll');
    if (p.shown === 'none') continue;
    const [w, h] = [p.box.right - p.box.left, p.box.bottom - p.box.top];
    expect(w > 0 && h > 0, `${id}/${p.id}: the picture has a box`).toBe(true);
    expect(h, `${id}/${p.id}: the picture is at most min(26vh, 230px) tall`).toBeLessThanOrEqual(Math.min(0.26 * c.height, 230) + 0.5);
    expect(p.box.left, `${id}/${p.id}: the picture is inside the card (left)`).toBeGreaterThanOrEqual(cardBox.x - 0.5);
    expect(p.box.right, `${id}/${p.id}: the picture is inside the card (right)`).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
  }
}

test.describe('every upgraded form at once (all flags forced on, in memory)', () => {
  let app: FormsApp;
  test.beforeAll(async () => {
    app = await buildFormsApp({ a1Labels: a1LabelCandidates() });
  });
  test.afterAll(() => {
    app?.cleanup();
  });

  test('the scratch build forces on the map and image flags and no others, and 15 cards draw an upgrade', async ({ page }) => {
    await page.goto(testUrl(app.url));
    await expect(prompt(page)).toBeVisible();
    await idle(page);
    const features = await page.evaluate(() => ({ ...window.__adw!.features }));
    expect(features).toEqual({ ...FEATURES, ...Object.fromEntries([...FORCED].map((f) => [f, true])) });
    expect(CARD_IDS.filter((id) => expectedForm(id).upgraded).sort()).toEqual(['A1', 'B1', 'C1', 'D1', 'E1', 'E2', 'F1', 'G1', 'G2', 'H1', 'H2', 'I1', 'I2', 'J1', 'J3']);
    // The stand-ins are every staged photo, and every one is a card tile; so is each own drawing.
    const tileImages = new Set(Object.values(CARDS).flatMap((card) => (card.tiles ?? []).map((t) => t.image)));
    for (const id of BUNDLED) expect(tileImages.has(id as never), `${id} is the picture of a card tile`).toBe(true);
  });

  for (const c of CASES) {
    test(`every card in every upgraded form fits, whole and decoded, with the prompt, hint line and header usable: ${c.name}`, async ({ browser }) => {
      test.setTimeout(240_000);
      await withPage(browser, c, async (page) => {
        const w = watch(page);
        await startForCards(page, testUrl(app.url));
        const fits: Record<string, string> = {};
        for (const id of CARD_IDS) {
          await openTestCard(page, id);
          fits[id] = await expectCardFits(page, c, id);
          await expectFormShown(page, c, id, fits[id]!);
          expect(await page.locator('#card a[href]').count(), `${id}: no link in the card (credits URLs are plain text)`).toBe(0);
          await closeWithContinue(page, id);
        }
        await expectHeaderUsable(page, 'F1');   // a picture card with three pictures, the tallest of the lot
        console.log(`fit levels at ${c.name} with every upgrade on: ${JSON.stringify(fits)}`);
        expect(w.requests).toEqual([]);
        expect(w.errors).toEqual([]);
      });
    });
  }

  // The credits panel lists EVERY image and map in the build (spec §5.2): here 15 groups, 18 photographs, 2 drawings and 7 maps. It is
  // a dialog above the page, and its list (not the page) scrolls; the title, the footer and the Close button stay on screen at every viewport.
  async function expectCreditsFit(page: Page, label: string): Promise<void> {
    await expect(page.locator('#credits'), `${label}: the credits panel is open`).toBeVisible();
    await expect(page.locator('#credits-close'), `${label}: focus is on Close`).toBeFocused();
    await expectNoPageScroll(page);
    const g = await page.evaluate(() => {
      const rect = (q: string): { top: number; bottom: number; left: number; right: number } => {
        const r = document.querySelector(q)!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      const list = document.querySelector<HTMLElement>('#credits-list')!;
      const lines = [...list.querySelectorAll<HTMLElement>('.credits-group:last-child > p')];
      list.scrollTop = list.scrollHeight;
      const last = lines.at(-1)!.getBoundingClientRect();
      return {
        vw: window.innerWidth, vh: window.innerHeight,
        card: rect('.credits-card'), list: rect('#credits-list'),
        atEnd: list.scrollTop + list.clientHeight >= list.scrollHeight - 1,
        lastLine: { top: last.top, bottom: last.bottom },
        groups: list.querySelectorAll('.credits-group').length,
        links: document.querySelectorAll('#credits a[href]').length,
      };
    });
    expect(g.groups, `${label}: one group for each card that has an upgrade in this build`).toBe(CARD_IDS.filter((id) => expectedForm(id).upgraded).length);
    expect(g.links, `${label}: no link in the credits (URLs are plain text)`).toBe(0);
    expect([g.card.left >= -0.5, g.card.right <= g.vw + 0.5, g.card.top >= -0.5, g.card.bottom <= g.vh + 0.5], `${label}: the panel is inside the window`).toEqual([true, true, true, true]);
    expect(g.list.bottom - g.list.top, `${label}: the list has room to read`).toBeGreaterThanOrEqual(36);
    // The list scrolls inside the panel; at its end the last line of the last group is whole inside it.
    expect(g.atEnd, `${label}: the list scrolls to its end`).toBe(true);
    // (A pixel of give: a list scrolled at a device scale factor of 1.5 rests on a device pixel, not on the fraction of a CSS px.)
    expect(g.lastLine.top, `${label}: the last credit line, scrolled to, is inside the list (top)`).toBeGreaterThanOrEqual(g.list.top - 1);
    expect(g.lastLine.bottom, `${label}: the last credit line, scrolled to, is inside the list (bottom)`).toBeLessThanOrEqual(g.list.bottom + 1);
    for (const [name, q] of [['title', '#credits-title'], ['footer', '#credits-footer'], ['Close', '#credits-close']] as const) {
      await expectOnTop(page, `${label}: credits ${name}`, page.locator(q));
    }
  }

  // The visible-text rule scan of spec §5.4 (e2e/guided.spec.ts runs it on the shipped build) on the forms the shipped build cannot show
  // yet: every card with its pictures or its map, and the credits panel it opens. The attribution strings are the real manifest's, the
  // pictures stand-ins; a rule violation in a caption, a map label or a credit line shows here before the flag flips.
  test('every card in its upgraded form passes the content rules, and so does the credits panel it opens', async ({ page }) => {
    const w = watch(page);
    await page.goto(testUrl(app.url));
    await idle(page);
    for (const id of CARD_IDS) {
      await openTestCard(page, id);
      expect(await screenViolations(page), `card ${id}`).toEqual([]);
      if (expectedForm(id).upgraded) {
        await page.locator('#card .card-credits').click();
        await expect(page.locator('#credits')).toBeVisible();
        expect(await screenViolations(page), `credits opened from ${id}`).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(page.locator('#credits')).toBeHidden();
        await expect(page.locator('#card'), 'Esc closed the credits panel, not the card').toHaveAttribute('data-card-id', id);
      }
      await page.locator('#card .card-continue').click();
      await expect(page.locator('#card')).toBeHidden();
    }
    expect(w.requests).toEqual([]);
    expect(w.errors).toEqual([]);
  });

  for (const c of CASES) {
    test(`the credits panel, with every image and map in its list, fits and closes on Esc without closing the card or the wrap screen: ${c.name}`, async ({ browser }) => {
      test.setTimeout(120_000);
      await withPage(browser, c, async (page) => {
        const w = watch(page);
        await startForCards(page, testUrl(app.url));
        // From a card: H1 is an upgraded card whose footer has the Image credits button.
        await openTestCard(page, 'H1');
        await page.locator('#card .card-credits').click();
        await expectCreditsFit(page, 'from card H1');
        await page.keyboard.press('Escape');
        await expect(page.locator('#credits')).toBeHidden();
        await expect(page.locator('#card'), 'Esc closed the panel, not the card').toHaveAttribute('data-card-id', 'H1');
        await expect(prompt(page)).toBeFocused();
        await closeWithContinue(page, 'H1');
        // From the wrap screen.
        await page.locator('#wrap-open').click();
        await page.locator('#wrap-credits').click();
        await expectCreditsFit(page, 'from the wrap screen');
        await page.keyboard.press('Escape');
        await expect(page.locator('#credits')).toBeHidden();
        await expect(page.locator('#wrap'), 'Esc closed the panel, not the wrap screen').toBeVisible();
        await page.locator('#wrap-close').click();
        await expect(page.locator('#wrap')).toBeHidden();
        expect(w.requests).toEqual([]);
        expect(w.errors).toEqual([]);
      });
    });
  }
});
