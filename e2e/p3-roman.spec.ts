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
import { PCA_VIEW, makeScale } from '../src/plots/pca';
import { buildRomanApp, type MapApp } from './mapBuild';
import {
  APP_URL, DATA, expectNoPageScroll, expectOnTop, idle, intersects, openTestCard, plotSettled, prompt, run, testUrl, watch, type Rect,
} from './helpers';
import { ALLOWED_FITS, CASES, LAB_STANDARD_CASES, withPage, type Case } from './viewports';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = JSON.parse(readFileSync(resolve(ROOT, 'assets/manifest.json'), 'utf8')) as {
  maps: Record<string, { visual_check: unknown }>;
};
const LAB_SIZES = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }] as const;

// ---- 1. The shipped page (skipped while a flag is false) ----

test('the Roman plot shows the York traveller as an edge marker inside the plot', async ({ page }) => {
  test.skip(!FEATURES.yorkTraveller, 'yorkTraveller not shipped');
  await page.goto(`${APP_URL}?reset`);
  await run(page, 'run_pca(period = "Roman")');
  await plotSettled(page);
  const g = page.locator('#plot g.york-traveller');
  await expect(g).toHaveCount(1);
  expect(await g.locator('text.york-label').evaluate((t) => t.textContent)).toBe(YORK_TRAVELLER_LABEL);
  const svgBox = (await page.locator('#plot svg.plot-svg').boundingBox())!;
  const labelBox = (await g.locator('text.york-label').boundingBox())!;
  expect(labelBox.x).toBeGreaterThanOrEqual(svgBox.x);
  expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(svgBox.x + svgBox.width);
  expect(labelBox.y).toBeGreaterThanOrEqual(svgBox.y);
  expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(svgBox.y + svgBox.height);
  await run(page, 'run_pca(period = "IronAge")');
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

  // ---- The York traveller on the Roman plot, at every viewport ----
  for (const c of CASES) {
    test(`the York traveller is an edge marker inside the Roman plot, with its words, at ${c.name}`, async ({ browser }, testInfo) => {
      test.setTimeout(120_000);
      await withPage(browser, c, async (page) => {
        const w = watch(page);
        await page.goto(`${app.url}?reset`);
        await expect(prompt(page)).toBeVisible();
        await idle(page);
        await run(page, 'run_pca(period = "IronAge")');
        await run(page, 'run_pca(period = "Roman")');
        await plotSettled(page);
        const mark = page.locator('#plot g.york-traveller');
        await expect(mark, 'one York mark on the Roman plot').toHaveCount(1);
        expect(await mark.getAttribute('data-named')).toBe('york_traveller');
        expect(await mark.getAttribute('data-tip')).toBe(YORK_TRAVELLER_LABEL);
        expect(await mark.locator('text.york-label').evaluate((t) => t.textContent), 'his words, verbatim').toBe(YORK_TRAVELLER_LABEL);
        expect(await mark.locator('text').count(), 'no other text in the mark').toBe(1);

        const g = await page.evaluate(() => {
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
          const box = svg.getBoundingClientRect();
          return {
            svg: css(svg), scale: Math.min(box.width / svg.viewBox.baseVal.width, box.height / svg.viewBox.baseVal.height),
            marker: { css: css(mk.querySelector('path.york-marker')!), user: user(mk.querySelector('path.york-marker')!) },
            pointer: { css: css(mk.querySelector('path.york-pointer')!), user: user(mk.querySelector('path.york-pointer')!) },
            label: {
              css: css(label), user: user(label), font: parseFloat(getComputedStyle(label).fontSize), lines: label.querySelectorAll('tspan').length,
              // Where each line's last letter ends, in plot units, and the x the lines are anchored at.
              ends: [...label.querySelectorAll('tspan')].map((t) => {
                const last = (t as SVGTSpanElement).getExtentOfChar((t.textContent ?? '').trimEnd().length - 1);
                return last.x + last.width;
              }),
              anchor: Number(label.getAttribute('x')),
            },
          };
        });
        // Inside the plot, in CSS px (what the student sees) and in the plot's own units (the 1000 x 760 drawing).
        for (const part of ['marker', 'pointer', 'label'] as const) {
          expect(inside(g[part].css, g.svg), `${part} lies inside the plot (CSS px)`).toBe(true);
          expect(g[part].user.left >= 0 && g[part].user.right <= PCA_VIEW.width && g[part].user.top >= 0 && g[part].user.bottom <= PCA_VIEW.height, `${part} lies inside the 1000 x 760 drawing`).toBe(true);
        }
        // He is pinned to the corner of the British frame he is off (the real data puts him south-east of it) and the pointer leads away from it.
        const fr = DATA.frames.britain;
        const sc = makeScale(fr);
        const centre = { x: (g.marker.user.left + g.marker.user.right) / 2, y: (g.marker.user.top + g.marker.user.bottom) / 2 };
        expect(Math.abs(centre.x - sc.toX(fr.xmax)), 'the marker sits at the frame\'s east edge').toBeLessThan(0.5);
        expect(Math.abs(centre.y - sc.toY(fr.ymin)), 'the marker sits at the frame\'s south edge').toBeLessThan(0.5);
        const tip = { x: (g.pointer.user.left + g.pointer.user.right) / 2, y: (g.pointer.user.top + g.pointer.user.bottom) / 2 };
        expect(tip.x, 'the pointer leads east').toBeGreaterThan(centre.x);
        expect(tip.y, 'the pointer leads south').toBeGreaterThan(centre.y);
        // His words end above and to the left of the square (they do not cover it) and inside the plot box, clear of the legend below it.
        expect(g.label.user.right, 'the words end left of the square').toBeLessThanOrEqual(g.marker.user.left + 0.5);
        expect(g.label.user.bottom, 'the words end above the plot box\'s bottom edge, clear of the legend').toBeLessThanOrEqual(PCA_VIEW.bottom + 0.5);
        expect(g.label.user.top, 'the words start inside the plot box').toBeGreaterThanOrEqual(PCA_VIEW.top - 0.5);
        expect(g.label.lines, 'in three lines').toBe(3);
        // The three lines are right-aligned: each ends on its last letter at the anchor (a line that kept a trailing space would stop a space short).
        g.label.ends.forEach((end, k) => expect(Math.abs(end - g.label.anchor), `line ${k + 1} of the words ends at the anchor`).toBeLessThan(0.75));
        // A little bigger than a data point: a Roman point is a square of 9 units across, his mark one of 14.4.
        expect(g.marker.user.right - g.marker.user.left, 'the mark is bigger than a data point').toBeGreaterThan(10);
        // Projector legibility, as e2e/layout.spec.ts judges the plots' smallest text: at the lab-standard sizes the words are drawn at 10 device px or more.
        const device = g.label.font * g.scale * c.dsf;
        testInfo.annotations.push({ type: 'projector text size', description: `York words at ${c.name}: ${device.toFixed(1)} device px tall` });
        if (LAB_STANDARD_CASES.includes(c)) expect(device, `the York words are ${device.toFixed(1)} device px tall at ${c.name}`).toBeGreaterThanOrEqual(10);

        // Hovering over the mark (or tapping it) shows the same sentence in the plot's tip.
        await mark.locator('path.york-marker').hover();
        await expect(page.locator('#plot .plot-tip')).toHaveText(YORK_TRAVELLER_LABEL);

        // He is on the Roman plot only: another period in focus, or the Europe view, has no mark.
        await run(page, 'run_pca(period = "AngloSaxon")');
        await expect(page.locator('#plot g.york-traveller')).toHaveCount(0);
        await run(page, 'run_pca(period = "Roman")');
        await expect(page.locator('#plot g.york-traveller')).toHaveCount(1);
        await run(page, 'run_pca(period = "Europe")');
        await expect(page.locator('#plot g.york-traveller')).toHaveCount(0);
        expect(w.requests).toEqual([]);
        expect(w.errors).toEqual([]);
      });
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
