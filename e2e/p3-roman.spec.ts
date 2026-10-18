// P3 Roman additions (spec §3.3 F1 "P3 additions", §10.3): the York traveller on the Roman plot (flag yorkTraveller) and the town inset on
// the Roman slide F1 (flag romanInset). Two kinds of test:
//
//   1. Under the SHIPPED flag set (dist/index.html): each one is checked on the page the students get, once its flag ships (the inset also needs
//      the instructor's check of its map). Until then these tests are skipped, and the fallbacks are covered by guided.spec.ts, layout.spec.ts
//      and the false-path vitest of each flag (tests/features.test.ts).
//   2. In a scratch build with both flags forced on, in memory (e2e/mapBuild.ts buildRomanApp: the inset's map recorded as checked, F1's three
//      photographs as stand-ins of their exact sizes), which says what each does at every viewport of e2e/viewports.ts before either flag ships.
//
// The measurement that keeps romanInset false (Task 29): F1 carries the most text of the photo cards and has about 3 px to spare at 1366 x 768
// with its three photographs at 15vh (src/style.css). The inset, one more tile in their row, with its key and its credit line, needs about 150
// px more there, so the card leaves `normal` and drops to `compact`, which hides the pictures and the inset. At 1920 x 1080 it fits with
// 245 px to spare. The inset fits at normal where the window is tall enough for its width (about 1600 x 900 and up). The tests below pin both
// facts: FIT_VERDICT says where the inset may not fit, and the shipped-build test (part 1) fails if the flag ships while it does not.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { MAP_SOURCE_SUFFIX, MAP_TEXT, YORK_TRAVELLER_LABEL } from '../src/content';
import { FEATURES } from '../src/features';
import { PCA_VIEW, YORK_EDGE_INSET, YORK_POINTER_BASE, YORK_POINTER_HALF, YORK_POINTER_REACH, makeScale } from '../src/plots/pca';
import { playGuided } from './guidedPlay';
import { buildRomanApp, type MapApp } from './mapBuild';
import {
  APP_URL, DATA, expectNoPageScroll, expectOnTop, freshStart, idle, intersects, openTestCard, plotSettled, prompt, run, settle, testUrl, watch,
  type Rect,
} from './helpers';
import { ALLOWED_FITS, CASES, LAB_STANDARD_CASES, withPage, type Case } from './viewports';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = JSON.parse(readFileSync(resolve(ROOT, 'assets/manifest.json'), 'utf8')) as {
  maps: Record<string, { visual_check: unknown }>;
};
const LAB_SIZES = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }] as const;

// ---- 1. The shipped page (skipped while a flag is false) ----

test('the Roman plot shows the York traveller as a mark inside the plot box, clear of the legend, at the Roman step of the guided run', async ({ page }) => {
  test.skip(!FEATURES.yorkTraveller, 'yorkTraveller not shipped');
  await freshStart(page);
  await playGuided(page, 'roman');                 // the way a class reaches the Roman step: every earlier layer, and every earlier legend entry
  await plotSettled(page);
  const g = page.locator('#plot g.york-traveller');
  await expect(g).toHaveCount(1);
  expect(await g.locator('text.york-label').evaluate((t) => t.textContent)).toBe(YORK_TRAVELLER_LABEL);
  expectYorkPlaced(await readYork(page), 'the shipped page at the Roman step');
  await run(page, 'run_pca(period = "Viking")');   // off the script: another period in focus has no mark
  await expect(page.locator('#plot g.york-traveller')).toHaveCount(0);
});

for (const size of LAB_SIZES) {
  test.describe(`F1 with its town inset at ${size.width}x${size.height} (100%)`, () => {
    test.use({ viewport: size, deviceScaleFactor: 1 });
    test('shows the inset and fits without dense', async ({ page }) => {
      test.skip(!FEATURES.romanInset || MANIFEST.maps.F1inset?.visual_check == null, 'romanInset not shipped or inset not checked');
      await page.goto(`${APP_URL}?test`);
      await page.waitForFunction(() => window.__adw !== undefined && typeof window.__adw.openCard === 'function');
      await page.evaluate(() => window.__adw!.openCard!('F1'));
      const card = page.locator('#card');
      await expect(card).toHaveAttribute('data-card-id', 'F1');
      await expect(card.locator('.card-inset[data-map="F1inset"] svg')).toBeVisible();
      await expect(card).toHaveAttribute('data-fit', 'normal');
      await expect(card.locator('.card-continue')).toBeInViewport();
      await expect(prompt(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
    });
  });
}

// ---- 2. The scratch build with both flags forced on ----

/** Where the inset does not fit F1 at the normal level, by viewport case (measured in Chromium and Edge on macOS, Task 29; see the header). */
const FIT_VERDICT: Readonly<Record<string, string>> = {
  '1366x768 dsf 1': 'F1 with its three photographs has about 3 px to spare here; the inset, its key and its credit line need about 150 more',
};

interface Box { left: number; right: number; top: number; bottom: number }
interface InsetGeometry {
  fit: string | null;
  vw: number; vh: number;
  card: Rect; body: Rect & { overflow: number };
  inset: null | {
    display: string; tile: Rect; svg: Rect; key: Rect; keyItems: string[]; sizeCss: [number, number];
    towns: Rect[]; countries: Rect[]; texts: number;
  };
  photoTops: number[]; photoDisplays: string[]; photoTiles: Rect[]; row: Rect | null;
  source: null | { display: string; text: string; rect: Rect };
  hint: Rect; promptRow: Rect;
}

async function insetGeometry(page: Page): Promise<InsetGeometry> {
  return page.evaluate((): InsetGeometry => {
    const rect = (e: Element): Rect => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    const card = document.querySelector<HTMLElement>('#card')!;
    const body = card.querySelector<HTMLElement>('.card-body')!;
    const tile = card.querySelector<HTMLElement>('.card-inset');
    const svg = tile?.querySelector<SVGSVGElement>('svg.inset-svg') ?? null;
    const src = card.querySelector<HTMLElement>('.card-source');
    return {
      fit: card.getAttribute('data-fit'),
      vw: window.innerWidth, vh: window.innerHeight,
      card: rect(card), body: { ...rect(body), overflow: body.scrollHeight - body.clientHeight },
      inset: tile && svg ? {
        display: getComputedStyle(tile).display, tile: rect(tile), svg: rect(svg),
        key: rect(tile.querySelector('figcaption.inset-key')!),
        keyItems: [...tile.querySelectorAll('.inset-key-item')].map((i) => i.textContent ?? ''),
        sizeCss: [svg.getBoundingClientRect().width, svg.getBoundingClientRect().height],
        towns: [...svg.querySelectorAll('circle.inset-town')].map(rect),
        countries: [...svg.querySelectorAll('circle.inset-country')].map(rect),
        texts: svg.querySelectorAll('text').length,
      } : null,
      photoTops: [...card.querySelectorAll('.card-tile[data-image]')].map((t) => t.getBoundingClientRect().top),
      photoDisplays: [...card.querySelectorAll('.card-tile[data-image] img')].map((i) => getComputedStyle(i).display),
      photoTiles: [...card.querySelectorAll('.card-tile[data-image]')].map(rect),
      row: ((): Rect | null => {
        const r = card.querySelector('.card-tiles');
        return r ? rect(r) : null;
      })(),
      source: src ? { display: getComputedStyle(src).display, text: src.textContent ?? '', rect: rect(src) } : null,
      hint: rect(document.querySelector('#terminal .term-hint')!),
      promptRow: rect(document.querySelector('#terminal .term-prompt')!),
    };
  });
}

/** What §5.2 and §5.4 ask of any open card at any viewport, apart from its fit level: the page does not scroll, the title, the first line of
 *  the body and every footer button are on screen and not covered, and the card leaves the prompt and the hint line (and the header) usable. */
async function expectCardUsable(page: Page, g: InsetGeometry, label: string): Promise<void> {
  const card = page.locator('#card');
  if (g.fit !== 'scroll') expect(g.body.overflow, `${label}: the body overflows at fit ${g.fit}`).toBeLessThanOrEqual(1);
  await expectNoPageScroll(page);
  await expectOnTop(page, `${label}: title`, page.locator('#card-title'));
  await expectOnTop(page, `${label}: first body line`, card.locator('.card-column > :not(h3)').first());
  const buttons = card.locator('.card-footer button');
  const n = await buttons.count();
  expect(n, `${label}: footer buttons`).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < n; i++) await expectOnTop(page, `${label}: footer button ${i}`, buttons.nth(i));
  await expectOnTop(page, `${label}: prompt`, prompt(page));
  await expectOnTop(page, `${label}: hint line`, page.locator('#terminal .term-hint'));
  await expectOnTop(page, `${label}: "Take this home"`, page.locator('#wrap-open'));
  if (FEATURES.back) await expectOnTop(page, `${label}: Back`, page.locator('#back'));
  expect(intersects(g.card, g.hint), `${label}: the card covers the hint line`).toBe(false);
  expect(intersects(g.card, g.promptRow), `${label}: the card covers the prompt row`).toBe(false);
}

const inside = (inner: Rect, outer: Rect, slack = 0.5): boolean =>
  inner.left >= outer.left - slack && inner.right <= outer.right + slack && inner.top >= outer.top - slack && inner.bottom <= outer.bottom + slack;
const overlap = (a: Box, b: Box): boolean => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** The York mark as the page draws it, in CSS px and in the plot's own units (the 1000 x 760 drawing), and every legend entry in plot units. */
interface YorkGeometry {
  svg: Rect; scale: number;
  marker: { css: Rect; user: Box };
  /** The three corners of the arrow, tip first, in plot units. */
  pointer: { css: Rect; user: Box; corners: [number, number][] };
  label: { css: Rect; user: Box; font: number; lines: number; ends: number[]; anchor: number };
  legend: { key: string; box: Box }[];
}

async function readYork(page: Page): Promise<YorkGeometry> {
  return page.evaluate((): YorkGeometry => {
    const svg = document.querySelector<SVGSVGElement>('#plot svg.plot-svg')!;
    const mk = svg.querySelector<SVGGElement>('g.york-traveller')!;
    const css = (e: Element): Rect => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    const user = (e: Element): Box => {
      const b = (e as SVGGraphicsElement).getBBox();
      return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height };
    };
    const label = mk.querySelector('text.york-label')!;
    const pointer = mk.querySelector('path.york-pointer')!;
    const box = svg.getBoundingClientRect();
    return {
      svg: css(svg), scale: Math.min(box.width / svg.viewBox.baseVal.width, box.height / svg.viewBox.baseVal.height),
      marker: { css: css(mk.querySelector('path.york-marker')!), user: user(mk.querySelector('path.york-marker')!) },
      pointer: {
        css: css(pointer), user: user(pointer),
        corners: [...(pointer.getAttribute('d') ?? '').matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]),
      },
      label: {
        css: css(label), user: user(label), font: parseFloat(getComputedStyle(label).fontSize), lines: label.querySelectorAll('tspan').length,
        // Where each line's last letter ends, in plot units, and the x the lines are anchored at.
        ends: [...label.querySelectorAll('tspan')].map((t) => {
          const last = (t as SVGTSpanElement).getExtentOfChar((t.textContent ?? '').trimEnd().length - 1);
          return last.x + last.width;
        }),
        anchor: Number(label.getAttribute('x')),
      },
      legend: [...svg.querySelectorAll('g.legend-item')].map((e) => ({ key: e.getAttribute('data-legend') ?? '', box: user(e) })),
    };
  });
}

/**
 * Where the York mark must be, read off the page at the Roman step of the guided run (Task 29 fix round 1: the mark and its arrow lie inside
 * the plot box and touch no legend entry). The checks are in plot units wherever they can be, so they hold at every viewport.
 */
function expectYorkPlaced(g: YorkGeometry, where: string): void {
  // Inside the plot, in CSS px (what the student sees) and in the plot's own units, and inside the plot box (the legend starts under it).
  for (const part of ['marker', 'pointer', 'label'] as const) {
    expect(inside(g[part].css, g.svg), `${where}: the ${part} lies inside the plot (CSS px)`).toBe(true);
    const u = g[part].user;
    expect(u.left >= PCA_VIEW.left - 0.5 && u.right <= PCA_VIEW.right + 0.5 && u.top >= PCA_VIEW.top - 0.5 && u.bottom <= PCA_VIEW.bottom + 0.5, `${where}: the ${part} lies inside the plot box (left ${u.left.toFixed(1)}, right ${u.right.toFixed(1)}, top ${u.top.toFixed(1)}, bottom ${u.bottom.toFixed(1)})`).toBe(true);
  }
  // He is pinned to the corner of the British frame he is off (the real data puts him south-east of it), kept YORK_EDGE_INSET inside the plot box.
  const fr = DATA.frames.britain;
  const sc = makeScale(fr);
  const centre = { x: (g.marker.user.left + g.marker.user.right) / 2, y: (g.marker.user.top + g.marker.user.bottom) / 2 };
  const want = {
    x: clamp(sc.toX(fr.xmax), PCA_VIEW.left + YORK_EDGE_INSET, PCA_VIEW.right - YORK_EDGE_INSET),
    y: clamp(sc.toY(fr.ymin), PCA_VIEW.top + YORK_EDGE_INSET, PCA_VIEW.bottom - YORK_EDGE_INSET),
  };
  expect(Math.abs(centre.x - want.x), `${where}: the mark is at the frame's east edge (x ${centre.x.toFixed(1)}, want ${want.x.toFixed(1)})`).toBeLessThan(0.5);
  expect(Math.abs(centre.y - want.y), `${where}: the mark is at the frame's south edge, ${YORK_EDGE_INSET} inside the plot box (y ${centre.y.toFixed(1)}, want ${want.y.toFixed(1)})`).toBeLessThan(0.5);
  // The arrow: its tip YORK_POINTER_REACH from the mark's centre, its base YORK_POINTER_BASE away and 2 x YORK_POINTER_HALF wide, leading east and south.
  const [tip, b1, b2] = g.pointer.corners as [[number, number], [number, number], [number, number]];
  expect(g.pointer.corners, `${where}: the arrow is a triangle`).toHaveLength(3);
  expect(Math.hypot(tip[0] - centre.x, tip[1] - centre.y), `${where}: the arrow's tip is ${YORK_POINTER_REACH} from the mark`).toBeCloseTo(YORK_POINTER_REACH, 0);
  expect(Math.hypot((b1[0] + b2[0]) / 2 - centre.x, (b1[1] + b2[1]) / 2 - centre.y), `${where}: the arrow's base is ${YORK_POINTER_BASE} from the mark`).toBeCloseTo(YORK_POINTER_BASE, 0);
  expect(Math.hypot(b1[0] - b2[0], b1[1] - b2[1]) / 2, `${where}: the arrow's base is ${2 * YORK_POINTER_HALF} wide`).toBeCloseTo(YORK_POINTER_HALF, 0);
  expect(tip[0], `${where}: the arrow leads east`).toBeGreaterThan(centre.x);
  expect(tip[1], `${where}: the arrow leads south`).toBeGreaterThan(centre.y);
  // His words end above and to the left of the square (they do not cover it), in three lines, each ending on its last letter at the anchor.
  expect(g.label.user.right, `${where}: the words end left of the square`).toBeLessThanOrEqual(g.marker.user.left + 0.5);
  expect(g.label.user.bottom, `${where}: the words end above the square`).toBeLessThanOrEqual(g.marker.user.top + 0.5);
  expect(g.label.lines, `${where}: in three lines`).toBe(3);
  g.label.ends.forEach((end, k) => expect(Math.abs(end - g.label.anchor), `${where}: line ${k + 1} of the words ends at the anchor`).toBeLessThan(0.75));
  // A little bigger than a data point: a Roman point is a square of 9 units across, his mark one of 14.4.
  expect(g.marker.user.right - g.marker.user.left, `${where}: the mark is bigger than a data point`).toBeGreaterThan(10);
  // The legend is the class's, not a shortcut's: Bell Beaker, Bronze Age, Iron Age and Roman along its first row (the First farmers have no point in
  // the British frame, so the legend leaves them out), and nothing of the mark touches any of its entries.
  const keys = g.legend.map((e) => e.key);
  for (const key of ['BellBeaker', 'BronzeAge', 'IronAge', 'Roman']) expect(keys, `${where}: the legend at the Roman step of the guided run`).toContain(key);
  for (const item of g.legend) {
    expect(item.box.top, `${where}: the legend entry ${item.key} starts under the plot box`).toBeGreaterThan(PCA_VIEW.bottom);
    for (const part of ['marker', 'pointer', 'label'] as const) {
      expect(overlap(g[part].user, item.box), `${where}: the ${part} lies over the legend entry ${item.key}`).toBe(false);
    }
  }
}

test.describe('the P3 Roman additions in a scratch build (both flags forced on, in memory)', () => {
  let app: MapApp;
  test.beforeAll(async () => {
    app = await buildRomanApp();
  });
  test.afterAll(() => {
    app?.cleanup();
  });

  test('the scratch build forces on yorkTraveller, romanInset and F1\'s photographs and no other flag', async ({ page }) => {
    await page.goto(testUrl(app.url));
    await expect(prompt(page)).toBeVisible();
    await idle(page);
    const features = await page.evaluate(() => ({ ...window.__adw!.features }));
    expect(features).toEqual({ ...FEATURES, yorkTraveller: true, romanInset: true, 'images.F1': true });
  });

  // ---- The York traveller on the Roman plot, at every viewport, at the Roman step of the guided run ----
  // The step is reached the way a class reaches it (playGuided: every hinted command typed, every card closed), because what the plot and its
  // legend hold there depends on it: a shortcut (the Iron Age, then the Roman period) left the legend two entries short, and the arrow's landing
  // on the Roman entry went unseen (Task 29, fix round 1). A browser context has one device scale factor, so there is one test for each: the
  // guided run is played once in it, from a fresh session, and the window is then resized through every viewport case of that scale (e2e/
  // viewports.ts), each judged on that page. Playing the run 26 times would add minutes to the suite and nothing to what is checked.
  for (const dsf of [...new Set(CASES.map((c) => c.dsf))]) {
    const cases = CASES.filter((c) => c.dsf === dsf);
    test(`the York traveller is a mark inside the Roman plot box, clear of the legend, with its words, at every viewport of device scale ${dsf}`, async ({ browser }, testInfo) => {
      test.setTimeout(300_000);
      const context = await browser.newContext({ viewport: { width: cases[0]!.width, height: cases[0]!.height }, deviceScaleFactor: dsf });
      try {
        const page = await context.newPage();
        const w = watch(page);
        await page.goto(`${app.url}?reset`);
        await expect(prompt(page)).toBeVisible();
        await idle(page);
        await playGuided(page, 'roman');
        await plotSettled(page);
        const mark = page.locator('#plot g.york-traveller');
        await expect(mark, 'one York mark on the Roman plot').toHaveCount(1);
        expect(await mark.getAttribute('data-named')).toBe('york_traveller');
        expect(await mark.getAttribute('data-tip')).toBe(YORK_TRAVELLER_LABEL);
        expect(await mark.locator('text.york-label').evaluate((t) => t.textContent), 'his words, verbatim').toBe(YORK_TRAVELLER_LABEL);
        expect(await mark.locator('text').count(), 'no other text in the mark').toBe(1);

        for (const c of cases) {
          await page.setViewportSize({ width: c.width, height: c.height });
          await settle(page);
          await plotSettled(page);
          const g = await readYork(page);
          expectYorkPlaced(g, c.name);

          // Projector legibility, as e2e/layout.spec.ts judges the plots' smallest text: at the lab-standard sizes the words are drawn at 10 device px or more.
          const device = g.label.font * g.scale * c.dsf;
          testInfo.annotations.push({ type: 'projector text size', description: `York words at ${c.name}: ${device.toFixed(1)} device px tall` });
          if (LAB_STANDARD_CASES.includes(c)) expect(device, `the York words are ${device.toFixed(1)} device px tall at ${c.name}`).toBeGreaterThanOrEqual(10);

          // Hovering over the mark (or tapping it) shows the same sentence in the plot's tip, and leaving the plot clears it.
          await mark.locator('path.york-marker').hover();
          await expect(page.locator('#plot .plot-tip'), `${c.name}: the tip`).toHaveText(YORK_TRAVELLER_LABEL);
          await page.mouse.move(0, 0);
          await expect(page.locator('#plot .plot-tip'), `${c.name}: the tip after the pointer leaves`).toHaveText('');
        }

        // He is on the Roman plot only: another period in focus, or the Europe view, has no mark. (Off the script now: the hint is at the next step,
        // the Anglo-Saxon period, so these three commands open no card; the Viking period is not a guided step at all.)
        await run(page, 'run_pca(period = "Viking")');
        await expect(page.locator('#plot g.york-traveller')).toHaveCount(0);
        await run(page, 'run_pca(period = "Roman")');
        await expect(page.locator('#plot g.york-traveller')).toHaveCount(1);
        await run(page, 'run_pca(period = "Europe")');
        await expect(page.locator('#plot g.york-traveller')).toHaveCount(0);
        expect(w.requests).toEqual([]);
        expect(w.errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  // ---- F1 with its town inset, at every viewport ----
  for (const c of CASES) {
    test(`F1 with its town inset is a usable card, and obeys the layout rule of the viewport except where FIT_VERDICT says it cannot: ${c.name}`, async ({ browser }, testInfo) => {
      test.setTimeout(120_000);
      await withPage(browser, c, async (page) => {
        const w = watch(page);
        await page.goto(testUrl(app.url));
        await expect(prompt(page)).toBeVisible();
        await idle(page);
        await openTestCard(page, 'F1');
        const g = await insetGeometry(page);
        expect(g.inset, 'the inset tile is in the card (a card at compact hides it, it does not remove it)').not.toBeNull();
        const where = `F1 with the inset at ${c.name} (fit ${g.fit})`;
        const verdict = FIT_VERDICT[c.name];
        if (verdict === undefined) {
          expect(ALLOWED_FITS[c.fit], `${where}: the rule of this viewport is ${c.fit}`).toContain(g.fit);
        } else {
          expect(g.fit, `${where}: ${verdict}, so the card drops below normal; romanInset stays false until this changes (src/style.css, e2e/p3-roman.spec.ts)`).not.toBe('normal');
        }
        await expectCardUsable(page, g, where);
        testInfo.annotations.push({ type: 'F1 with the inset', description: `${c.name}: fit ${g.fit}; inset ${g.inset!.sizeCss.map(Math.round).join(' x ')} px; body overflow at this level ${g.body.overflow.toFixed(0)} px` });

        const shown = g.fit === 'normal' || g.fit === 'dense';
        const s = g.source!;
        if (!shown) {
          // compact (and scroll, which keeps its rules) hide every optional tile, the inset among them, and the credit line goes with it.
          expect(g.inset!.display, `${where}: the inset is hidden with the other optional tiles`).toBe('none');
          expect(s.display, `${where}: and so is the Natural Earth credit that is only there for it`).toBe('none');
          expect(g.photoDisplays.every((d) => d === 'none'), `${where}: compact hides the pictures too`).toBe(true);
        } else {
          const i = g.inset!;
          expect(s.text, `${where}: the source line`).toBe(MAP_SOURCE_SUFFIX);
          expect(s.display).not.toBe('none');
          expect(i.display).not.toBe('none');
          expect(i.texts, 'no text inside the inset map: the words are the key under it').toBe(0);
          expect(i.keyItems, 'the key holds the two approved labels').toEqual([...MAP_TEXT.F1inset]);
          // It is one more tile in the row of the three photographs: beside them, not under them.
          expect(g.photoTops, 'the three photographs').toHaveLength(3);
          for (const top of g.photoTops) expect(Math.abs(top - i.tile.top), `${where}: the inset starts at the top of the photographs' row`).toBeLessThanOrEqual(1);
          // After them, in a row of four equal columns that fill the row.
          expect(Math.abs(i.tile.right - g.row!.right), `${where}: the inset's tile ends where the row ends`).toBeLessThanOrEqual(1.5);
          expect(Math.abs(g.photoTiles[0]!.left - g.row!.left), `${where}: the first photograph starts where the row starts`).toBeLessThanOrEqual(1.5);
          for (const t of g.photoTiles) {
            expect(t.right, `${where}: the inset comes after every photograph`).toBeLessThanOrEqual(i.tile.left + 1);
            expect(Math.abs((t.right - t.left) - (i.tile.right - i.tile.left)), `${where}: the four tiles are equally wide`).toBeLessThanOrEqual(1.5);
          }
          // Whole inside the card body and its own tile; at most as tall as a picture may be (spec §5.2: min(26vh, 230px)).
          expect(inside(i.svg, i.tile), `${where}: the map is inside its tile`).toBe(true);
          expect(inside(i.key, i.tile), `${where}: the key is inside its tile`).toBe(true);
          expect(inside(i.tile, g.card), `${where}: the tile is inside the card`).toBe(true);
          expect(i.tile.bottom, `${where}: the tile ends inside the card body`).toBeLessThanOrEqual(g.body.bottom + 0.5);
          expect(i.sizeCss[1], `${where}: the map is at most min(26vh, 230px) tall`).toBeLessThanOrEqual(Math.min(0.26 * g.vh, 230) + 0.5);
          expect(i.sizeCss[1], `${where}: and is drawn, not collapsed`).toBeGreaterThanOrEqual(60);
          // Seven markers, six filled and one hollow, each whole inside the map's own box.
          expect([i.towns.length, i.countries.length], `${where}: six towns and one countryside marker`).toEqual([6, 1]);
          for (const m of [...i.towns, ...i.countries]) expect(inside(m, i.svg, 0.6), `${where}: a marker lies inside the map`).toBe(true);
          expect(s.rect.bottom, `${where}: the source line is inside the card body`).toBeLessThanOrEqual(g.body.bottom + 0.5);
        }
        // Whatever the level, the credits button is offered (F1's photographs are upgraded in this build) and no link appears.
        expect(await page.locator('#card .card-credits').count()).toBe(1);
        expect(await page.locator('#card a[href]').count(), 'no link in the card (credits URLs are plain text)').toBe(0);
        expect(w.requests).toEqual([]);
        expect(w.errors).toEqual([]);
      });
    });
  }

  // ---- The two lab-standard screens, said plainly ----
  const labCase = (name: string): Case => LAB_STANDARD_CASES.find((c) => c.name === name)!;
  test('at 1920 x 1080 the inset fits beside the three photographs at the normal level, with room to spare', async ({ browser }) => {
    const c = labCase('1920x1080 dsf 1');
    await withPage(browser, c, async (page) => {
      await page.goto(testUrl(app.url));
      await expect(prompt(page)).toBeVisible();
      await idle(page);
      await openTestCard(page, 'F1');
      const g = await insetGeometry(page);
      expect(g.fit).toBe('normal');
      expect(g.inset!.display).not.toBe('none');
      expect(g.inset!.sizeCss[1], 'the map is as tall as a picture may be here: min(26vh, 230px)').toBeCloseTo(Math.min(0.26 * 1080, 230), 0);
      // The card keeps real room at this size: more than the key and its credit line need (the dense step was not needed).
      expect(g.body.overflow).toBeLessThanOrEqual(1);
    });
  });

  test('at 1366 x 768 the inset does not fit beside the three photographs: the card drops to compact, which is why romanInset stays false', async ({ browser }) => {
    const c = labCase('1366x768 dsf 1');
    expect(FIT_VERDICT[c.name], 'the verdict this test pins').toBeDefined();
    await withPage(browser, c, async (page) => {
      await page.goto(testUrl(app.url));
      await expect(prompt(page)).toBeVisible();
      await idle(page);
      await openTestCard(page, 'F1');
      const g = await insetGeometry(page);
      expect(g.fit, 'F1 with the inset at 1366 x 768').not.toBe('normal');
      expect(['compact', 'scroll']).toContain(g.fit);
      expect(g.inset!.display, 'the inset is among the optional tiles compact hides').toBe('none');
      // (Without the inset the same card, photographs and all, is normal here with about 3 px to spare: e2e/layout.spec.ts pins F1 in the
      // all-forms build at this size.)
    });
  });
});
