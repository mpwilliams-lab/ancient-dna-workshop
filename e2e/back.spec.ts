import { expect, test, type Page } from '@playwright/test';
import { CARDS } from '../src/cards';
import { CARD_HINT, PREDICT_HINT, RESTORED_NOTICE, REVEAL_HINT, cardCounter } from '../src/content';
import { FEATURES } from '../src/features';
import { NEXT_PREFIX, SCRIPT, SCRIPT_STEPS, hintText } from '../src/hints';
import { formatCommand } from '../src/parser';
import { derive, sessionBuildHash } from '../src/replay';
import { screensOf, screenKey } from '../tests/helpers/script';
import { APP_URL, CARD_KEY_GAP_MS, DATA, boxes, cardOpen, covers, freshStart, idle, installBoxes, run, screen, watch } from './helpers';

// e2e asserts only the shipped flag set (spec §10.3).
test.skip(!FEATURES.back, 'the back flag is off in the shipped set');

const hint = (page: Page) => page.locator('#terminal .term-hint');

/** Runs guided step i by typing its hint line, then closes its cards with Continue (Continue is never throttled). */
async function runStep(page: Page, i: number): Promise<void> {
  await run(page, formatCommand(SCRIPT[i]!));
  const ids = SCRIPT_STEPS[i]?.cards?.ids ?? [];
  for (const id of ids) {
    await expect(page.locator('#card-title')).toHaveText(CARDS[id].title);
    await page.locator('#card .card-continue').click();
  }
  await expect(page.locator('#card')).toBeHidden();
}

test('Back walks E3, E2, E1, then the Bronze Age plot (spec §4.5, §4.1 order)', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await expect(page.locator('#back')).toBeDisabled();
  for (let i = 0; i <= 7; i++) await runStep(page, i);

  // The Iron Age bare plot: four period layers, focus Iron Age.
  await expect(page.locator('#plot')).toHaveAttribute('data-view', 'pca');
  await expect(page.locator('#plot svg.plot-svg')).toHaveAttribute('data-focus', 'IronAge');
  await expect(page.locator('#plot g.layer.period')).toHaveCount(4);
  await expect(hint(page)).toHaveText(NEXT_PREFIX + formatCommand(SCRIPT[8]!));
  await expect(page.locator('#back')).toBeEnabled();

  for (const id of ['E3', 'E2', 'E1'] as const) {
    await page.locator('#back').click();
    await expect(page.locator('#card')).toBeVisible();
    await expect(page.locator('#card-title')).toHaveText(CARDS[id].title);
    await expect(hint(page)).toHaveText(CARD_HINT);
    await expect(page.locator('#terminal input')).toBeFocused();
    await expect(page.locator('#plot g.layer.period')).toHaveCount(4);
  }
  await page.locator('#back').click();
  await expect(page.locator('#card')).toBeHidden();
  await expect(page.locator('#plot')).toHaveAttribute('data-view', 'pca');
  await expect(page.locator('#plot svg.plot-svg')).toHaveAttribute('data-focus', 'BronzeAge');
  await expect(page.locator('#plot g.layer.period')).toHaveCount(3);
  await expect(hint(page)).toHaveText(NEXT_PREFIX + formatCommand(SCRIPT[7]!));
  expect(await screen(page)).toEqual({ step: 7, card: 0 });
  // The transcript is cut back to the end of the Bronze Age step: the Iron Age command line is gone.
  await expect(page.locator('#terminal .term-out')).not.toContainText(formatCommand(SCRIPT[7]!));
  expect(w.requests).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('the card Back button steps back too, and Esc after Back fills the undone command', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  for (let i = 0; i <= 3; i++) await runStep(page, i);    // through firstFarmers (B1 closed)
  await page.locator('#back').click();                     // from firstFarmers' bare plot to its only card, B1
  await expect(page.locator('#card-title')).toHaveText(CARDS.B1.title);
  await page.locator('#card .card-back').click();          // from B1 (its first card) to europe's bare plot
  expect(await screen(page)).toEqual({ step: 3, card: 1 });
  await expect(page.locator('#card')).toBeHidden();
  await page.waitForTimeout(CARD_KEY_GAP_MS);              // the repeat guard (spec §5.3) counts from the last card that opened
  await page.locator('#terminal input').press('Escape');
  await expect(page.locator('#terminal input')).toHaveValue(formatCommand(SCRIPT[3]!));
  expect(w.errors).toEqual([]);
});

test('refresh with a card open after Back shows the same card; ?reset clears the session', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  for (let i = 0; i <= 7; i++) await runStep(page, i);
  await page.locator('#back').click();
  await page.locator('#back').click();                     // E2
  await expect(page.locator('#card-title')).toHaveText(CARDS.E2.title);
  await page.reload();
  await idle(page);
  await expect(page.locator('#card-title')).toHaveText(CARDS.E2.title);
  await expect(page.locator('#terminal')).toContainText(RESTORED_NOTICE);
  expect(await screen(page)).toEqual({ step: 8, card: 1 });
  await expect(page.locator('#back')).toBeEnabled();
  await page.goto(`${APP_URL}?reset`);
  await idle(page);
  expect(await screen(page)).toEqual({ step: 0, card: 0 });
  await expect(page.locator('#card')).toBeHidden();
  await expect(page.locator('#back')).toBeDisabled();
  expect(w.errors).toEqual([]);
});

// ---- Back while a log prints, on the real page and the real timers ----

/** What the saved session says is on the terminal's screen: the lines after its last clear(), inputs with the prompt in front. */
async function savedScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('adna-workshop-session-v2')!) as { transcript: { kind: string; text: string }[] };
    const t = s.transcript;
    const start = t.map((e) => e.kind).lastIndexOf('clear') + 1;
    return t.slice(start).filter((e) => e.kind !== 'clear').map((e) => (e.kind === 'input' ? `> ${e.text}` : e.text));
  });
}
/** Clicks Back in the very task that asks whether a log is still printing (a click through the driver takes long enough for a short log to end). */
const backWhilePrinting = (page: Page): Promise<boolean> => page.evaluate(() => {
  const printing = window.__adw!.isPrinting();
  (document.getElementById('back') as HTMLButtonElement).click();
  return printing;
});
const shownScreen = (page: Page): Promise<string[]> =>
  page.locator('#terminal .term-out .term-line:not(.term-line--notice)').evaluateAll((els) => els.map((e) => e.textContent ?? ''));

test('Back while the log still prints flushes it and lands on that step\'s last card; nothing of the log acts afterwards', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await runStep(page, 0);
  await runStep(page, 1);
  await run(page, formatCommand(SCRIPT[2]!), { wait: false });   // europe: a staggered log, then A1
  expect(await backWhilePrinting(page), 'the log was still printing when Back was clicked').toBe(true);
  expect(await page.evaluate(() => window.__adw!.isPrinting())).toBe(false);
  await expect(page.locator('#card[data-card-id="A1"]')).toBeVisible();
  expect(await screen(page)).toEqual({ step: 3, card: 0 });
  expect(await shownScreen(page)).toEqual(await savedScreen(page));      // the whole log is on screen, flushed
  await expect(page.locator('#plot')).toHaveAttribute('data-view', 'pca');
  const plot = await page.locator('#plot').innerHTML();
  // A staggered log takes at most 3 s. Whatever its timers or promise would do after that has been done by now.
  await page.waitForTimeout(3500);
  expect(await screen(page)).toEqual({ step: 3, card: 0 });
  await expect(page.locator('#card')).toHaveAttribute('data-card-id', 'A1');
  await expect(hint(page)).toHaveText(CARD_HINT);
  expect(await page.locator('#plot').innerHTML()).toBe(plot);
  expect(await shownScreen(page)).toEqual(await savedScreen(page));
  expect(w.errors).toEqual([]);
});

test('Back while a step without cards prints drops its log and its plot; the next command then draws only its own plot', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  for (let i = 0; i <= 5; i++) await runStep(page, i);     // through admix1: bars, D1 and D2 closed
  await run(page, formatCommand(SCRIPT[6]!), { wait: false });   // bronzeAge: no cards; its log prints, its plot waits
  expect(await backWhilePrinting(page), 'the log was still printing when Back was clicked').toBe(true);
  expect(await screen(page)).toEqual({ step: 6, card: 2 });
  await expect(page.locator('#plot')).toHaveAttribute('data-view', 'admixture');
  expect(await shownScreen(page)).toEqual(await savedScreen(page));
  await expect(page.locator('#terminal .term-out')).not.toContainText(formatCommand(SCRIPT[6]!));
  await page.waitForTimeout(3500);                         // the cancelled log's plot must not arrive late
  await expect(page.locator('#plot')).toHaveAttribute('data-view', 'admixture');
  expect(await screen(page)).toEqual({ step: 6, card: 2 });
  await run(page, 'run_pca(period = "Viking")');
  await expect(page.locator('#plot')).toHaveAttribute('data-view', 'pca');
  await expect(page.locator('#plot g.layer.period[data-layer="Viking"]')).toHaveCount(1);
  await expect(page.locator('#plot g.layer.period[data-layer="BronzeAge"]')).toHaveCount(0);
  expect(w.errors).toEqual([]);
});

/** The screens of the whole script in the order a student meets them: the start, then each step's cards and its bare plot. */
const SCREENS = screensOf(SCRIPT_STEPS.map((st) => st.cards?.ids ?? []));

// ---- Cards opened by Back sit above the hint line (carry-forward from the Task 14 review) ----

const KEY = 'adna-workshop-session-v2';

/** A saved session with the first n guided steps run and the cursor on card `card` of step n (default: its bare plot). */
function seededSession(n: number, card?: number): string {
  const steps = SCRIPT.slice(0, n).map((c, i) => ({ cmd: formatCommand(c), endSeq: i + 1 }));
  const cards = n > 0 ? (SCRIPT_STEPS[n - 1]!.cards?.ids.length ?? 0) : 0;
  return JSON.stringify({
    version: 2, build: sessionBuildHash(), history: steps.map((s) => s.cmd),
    transcript: steps.map((s, i) => ({ seq: i + 1, kind: 'output', text: s.cmd })),
    steps, cursor: { step: n, card: card ?? cards }, nextSeq: n + 1,
  });
}

/** Loads the page with that session, as after a refresh. */
async function loadSeeded(page: Page, n: number, card?: number): Promise<void> {
  await page.goto(`${APP_URL}?reset`);
  await idle(page);
  await page.evaluate(([key, session]) => sessionStorage.setItem(key!, session!), [KEY, seededSession(n, card)]);
  await page.goto(APP_URL);
  await idle(page);
}

const NARROW = { name: '1024x768 at 150% (CSS 682x512)', width: 682, height: 512, dsf: 1.5 };
const FLOOR = { name: 'floor 640x360', width: 640, height: 360, dsf: 1.5 };

for (const c of [NARROW, FLOOR]) {
  test(`Back through two bare plots and onto a card, with no frame between the clicks, leaves the card above the hint line and the prompt: ${c.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: c.dsf });
    try {
      const page = await ctx.newPage();
      const w = watch(page);
      await installBoxes(page);
      await loadSeeded(page, 8, 2);                         // after a refresh: E3 of Iron Age's E1-E3 is open
      await expect(page.locator('#card[data-card-id="E3"]')).toBeVisible();
      await page.waitForTimeout(300);                       // the page's ResizeObserver has reported the hint with a card open (two lines)
      const withCard = (await boxes(page)).hintH;
      // E2, E1, Bronze Age's plot, admix1's plot, D2: the card closes at the third click and opens again at the fifth, in one task.
      const now = await page.evaluate(() => {
        const back = document.getElementById('back') as HTMLButtonElement;
        for (let i = 0; i < 3; i++) back.click();                    // E2, E1, Bronze Age's plot: no card is open now
        const stepHintH = window.__boxes!().hintH;
        for (let i = 0; i < 2; i++) back.click();                    // admix1's plot, then D2 opens
        return { id: window.__adw!.cardOpen(), boxes: window.__boxes!(), stepHintH };
      });
      expect(now.stepHintH, 'the premise: the step hint is shorter than CARD_HINT at this size').toBeLessThan(withCard);
      expect(now.id).toBe('D2');
      expect(covers(now.boxes).hint, 'the card covers the hint line in the task that opened it').toBe(false);
      expect(covers(now.boxes).prompt, 'the card covers the prompt row in the task that opened it').toBe(false);
      await page.waitForTimeout(300);
      expect(await cardOpen(page)).toBe('D2');
      expect(covers(await boxes(page)), 'the card covers the hint line or the prompt row after the page settled').toEqual({ hint: false, prompt: false });
      expect(await screen(page)).toEqual({ step: 6, card: 1 });
      expect(w.errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

// ---- The header Back button at the lab sizes and below (spec §4.3, §5.2) ----

const HEADER_VIEWPORTS = [
  FLOOR, NARROW,
  { name: '1366x768', width: 1366, height: 768, dsf: 1 },
  { name: '1920x1080', width: 1920, height: 1080, dsf: 1 },
  { name: 'stacked 480x800', width: 480, height: 800, dsf: 1 },
];

for (const c of HEADER_VIEWPORTS) {
  test(`the header holds the title, Back and "Take this home" side by side, on screen and clickable under an open card: ${c.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: c.dsf });
    try {
      const page = await ctx.newPage();
      const w = watch(page);
      await loadSeeded(page, 3, 0);                          // europe's A1 is open: the card covers the plot column or both panes
      await expect(page.locator('#card[data-card-id="A1"]')).toBeVisible();
      const g = await page.evaluate(() => {
        const rect = (q: string) => {
          const r = document.querySelector(q)!.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        const reachable = (q: string): boolean => {
          const el = document.querySelector(q)!;
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit === el || el.contains(hit);
        };
        return {
          vw: window.innerWidth, vh: window.innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
          title: rect('#app-title'), back: rect('#back'), wrap: rect('#wrap-open'), bar: rect('#bar'),
          backReachable: reachable('#back'), wrapReachable: reachable('#wrap-open'),
          order: [...document.querySelectorAll('#bar > *')].map((e) => e.id),
        };
      });
      expect(g.order, 'the title, then Back, then "Take this home"').toEqual(['app-title', 'back', 'wrap-open']);
      for (const [name, b] of [['Back', g.back], ['Take this home', g.wrap]] as const) {
        expect(b.left, `${name} left`).toBeGreaterThanOrEqual(0);
        expect(b.right, `${name} right`).toBeLessThanOrEqual(g.vw + 0.5);
        expect(b.top, `${name} top`).toBeGreaterThanOrEqual(g.bar.top - 0.5);
        expect(b.bottom, `${name} bottom`).toBeLessThanOrEqual(g.bar.bottom + 0.5);
      }
      expect(g.title.right, 'the title ends before Back begins').toBeLessThanOrEqual(g.back.left + 0.5);
      expect(g.back.right, 'Back ends before "Take this home" begins').toBeLessThanOrEqual(g.wrap.left + 0.5);
      expect(g.wrap.left - g.back.right, 'Back sits right beside "Take this home" (the title keeps the left edge)').toBeLessThanOrEqual(16);
      expect(g.backReachable, 'a click on Back reaches it with a card open').toBe(true);
      expect(g.wrapReachable, 'a click on "Take this home" reaches it with a card open').toBe(true);
      expect(g.sw, 'page width').toBeLessThanOrEqual(g.vw);
      expect(g.sh, 'page height').toBeLessThanOrEqual(g.vh);
      await page.locator('#back').click();                   // and it works from there: A1's step has no card before it
      expect(await screen(page)).toEqual({ step: 2, card: 0 });
      expect(w.errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

// ---- Every screen of the whole script, on real data and the real layout (spec §4.5 tests 1 and 2) ----

test('Back walks every screen of the whole script, from a session saved at its end: the right card, hint, plot and terminal at each', async ({ page }) => {
  test.setTimeout(240_000);
  const w = watch(page);
  await installBoxes(page);
  await loadSeeded(page, SCRIPT.length);                    // as after a refresh at the end of step 19
  const steps = SCRIPT.map((c) => ({ cmd: formatCommand(c) }));
  const screens = SCREENS;
  expect(screens).toHaveLength(1 + SCRIPT.length + SCRIPT_STEPS.reduce((n, st) => n + (st.cards?.ids.length ?? 0), 0));

  for (let at = screens.length - 1; at >= 0; at--) {
    const { step, card } = screens[at]!;
    if (at < screens.length - 1) await page.locator((await cardOpen(page)) !== null ? '#card .card-back' : '#back').click();
    const label = `screen ${at} (step ${step}, card ${card})`;
    expect(await screen(page), label).toEqual({ step, card });
    const d = derive(DATA, steps, step);
    const ids = step > 0 ? d.cardsFor[step - 1]! : [];
    const id = card < ids.length ? ids[card]! : null;
    expect(await cardOpen(page), label).toBe(id);
    if (id !== null) {
      await expect(page.locator(`#card[data-card-id="${id}"]`), label).toBeVisible();
      await expect(page.locator('#card-title'), label).toHaveText(CARDS[id].title);
      await expect(page.locator('#card .card-counter'), label).toHaveText(cardCounter(card + 1, ids.length));
      await expect(hint(page), label).toHaveText(CARD_HINT);
      await expect(page.locator('#card .card-back'), label).toBeVisible();
    } else {
      await expect(page.locator('#card'), label).toBeHidden();
      await expect(hint(page), label).toHaveText(hintText(d.hintIndex, d.lastRan, d.extrasTick));
      // the two beats that depend on the command run last come back with Back: Predict after First farmers, Reveal after the Iron Age test
      if (step === 4) await expect(hint(page), label).toHaveText(PREDICT_HINT);
      if (step === 9) await expect(hint(page), label).toHaveText(REVEAL_HINT);
    }
    // the plot is the one the commands so far draw
    await expect(page.locator('#plot'), label).toHaveAttribute('data-view', d.plot.view);
    if (d.plot.view === 'pca') {
      const layers = await page.locator('#plot g.layer.period').evaluateAll((els) => els.map((e) => e.getAttribute('data-layer')).sort());
      expect(layers, `${label}: period layers`).toEqual([...d.plot.layers].sort());
      if (d.plot.focus !== undefined) await expect(page.locator('#plot svg.plot-svg'), label).toHaveAttribute('data-focus', d.plot.focus);
    }
    if (d.plot.view === 'trait') await expect(page.locator('#plot .traj'), label).toHaveAttribute('data-gene', d.plot.gene!);
    // the terminal shows what the saved session says, which Back cut to the end of this step
    expect(await shownScreen(page), `${label}: terminal lines`).toEqual(await savedScreen(page));
    expect((await shownScreen(page)).length, `${label}: one saved line per step so far`).toBe(step);
    // and the page is whole
    const geo = await page.evaluate(() => ({
      sh: document.documentElement.scrollHeight, ih: window.innerHeight, sw: document.documentElement.scrollWidth, iw: window.innerWidth,
      boxes: window.__boxes!(), back: (document.getElementById('back') as HTMLButtonElement).disabled,
    }));
    expect(geo.sh, `${label}: page height`).toBeLessThanOrEqual(geo.ih);
    expect(geo.sw, `${label}: page width`).toBeLessThanOrEqual(geo.iw);
    expect(covers(geo.boxes), `${label}: the card covers the hint line or the prompt`).toEqual({ hint: false, prompt: false });
    expect(geo.back, `${label}: Back is disabled on the first screen only`).toBe(step === 0);
    await expect(page.locator('#terminal input'), label).toBeFocused();
  }
  await expect(page.locator('#back')).toBeDisabled();
  expect(w.requests).toEqual([]);
  expect(w.errors).toEqual([]);
});

// ---- The log stays in view, on a REAL session (review fix round 1) ----
// The Predict hint (the plot of step 4) and the Reveal hint (the plot of step 9) are two lines where CARD_HINT and the step hints around
// them are one, at the lab sizes. A Back drew the log, which scrolls it to its end, and only then set the hint: the taller hint shrank
// the log's box after that, and 15 to 33 px of its last line sat below it. The walk above uses a session seeded with one line per step,
// whose log never overflows its box, so it cannot see this. This one types the whole script, so the logs are the real ones, and looks at
// the last line of the log at every screen on the way forward and again on the way back.

const LOG_VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768, dsf: 1 },
  { name: '1024x768', width: 1024, height: 768, dsf: 1 },
  NARROW,
];

/** How far the last line of the log ends below the log's box (CSS px; 0 or less when it is all in view), and whether the log overflows. */
const logView = (page: Page): Promise<{ below: number; overflows: boolean }> => page.evaluate(() => {
  const out = document.querySelector('#terminal .term-out')!;
  const last = [...out.querySelectorAll('.term-line')].pop();
  return {
    below: last ? last.getBoundingClientRect().bottom - out.getBoundingClientRect().bottom : 0,
    overflows: out.scrollHeight > out.clientHeight + 1,
  };
});

for (const c of LOG_VIEWPORTS) {
  test(`a real session, forward and then back through every screen: the last line of the log is never cut off: ${c.name}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: c.dsf });
    try {
      const page = await ctx.newPage();
      const w = watch(page);
      await freshStart(page);
      const overflowing = new Set<string>();
      const look = async (way: string, key: string): Promise<void> => {
        const v = await logView(page);
        expect(v.below, `${way}, screen ${key}: the last line of the log ends ${v.below.toFixed(1)} px below its box`).toBeLessThanOrEqual(2);
        if (v.overflows) overflowing.add(`${way} ${key}`);
      };

      // Below 1100 px a card covers both panes, the log with them. At 682 x 512 CARD_HINT is two lines where the step hint is one, so with
      // a card open the log's box is 17 px shorter than its last scroll, in the live run too: nobody sees it (the card is over it) and it is
      // gone when the card closes. Back is held to the strict reading at every screen; the way forward looks at a card screen only where
      // the card leaves the log in view.
      const logUnderCard = c.width < 1100;

      // forward: every command really typed, every card clicked through
      await look('forward', '0.0');
      for (let i = 0; i < SCRIPT.length; i++) {
        await run(page, formatCommand(SCRIPT[i]!));
        const ids = SCRIPT_STEPS[i]?.cards?.ids ?? [];
        for (let j = 0; j < ids.length; j++) {
          await expect(page.locator('#card-title')).toHaveText(CARDS[ids[j]!].title);
          if (!logUnderCard) await look('forward', `${i + 1}.${j}`);
          await page.locator('#card .card-continue').click();
        }
        await expect(page.locator('#card')).toBeHidden();
        await look('forward', `${i + 1}.${ids.length}`);
      }

      // back: through every screen, with the header button on a bare plot and the card's own on a card
      for (let at = SCREENS.length - 2; at >= 0; at--) {
        await page.locator((await cardOpen(page)) !== null ? '#card .card-back' : '#back').click();
        expect(await screen(page)).toEqual(SCREENS[at]);
        await look('back', screenKey(SCREENS[at]!));
      }

      // the test means something only if the logs really overflow at the screens whose hint is taller than the one before
      for (const key of ['4.1', '9.0']) {
        expect(overflowing.has(`forward ${key}`), `the log overflows its box at ${key} on the way forward`).toBe(true);
        expect(overflowing.has(`back ${key}`), `the log overflows its box at ${key} on the way back`).toBe(true);
      }
      expect(overflowing.has('back 4.0'), 'and at a card screen on the way back (B1 over the Predict plot)').toBe(true);
      expect(w.requests).toEqual([]);
      expect(w.errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
