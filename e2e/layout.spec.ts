import { expect, test, type Browser, type Page } from '@playwright/test';
import { SCRIPT } from '../src/hints';
import { formatCommand } from '../src/parser';
import { HLA_REVEAL_LINE, HLA_TEXT_CARD } from '../src/content';
import { CARD_IDS } from '../src/types';
import { APP_URL, centreOf, DATA, focusLayer, idle, layersShown, plotSettled, prompt, run, watch } from './helpers';

/**
 * Spec §5.4 fit rule of a case. 'normal': no card may need dense. 'no-scroll': no card body may overflow (dense and compact are
 * allowed). 'any': spec §5.2's whole order (normal, dense, compact, scroll) is allowed. Every case, whatever its rule, must still
 * show the title, the first body line and every footer button, leave the prompt and the hint line uncovered, and never scroll the page.
 */
type Fit = 'normal' | 'no-scroll' | 'any';
interface Case { name: string; width: number; height: number; dsf: number; fit: Fit }

const SCREENS: [number, number][] = [[1024, 768], [1280, 720], [1280, 1024], [1366, 768], [1920, 1080]];
const SCALES = [1, 1.25, 1.5];
/** The two lab-standard screens of spec §5.4. */
const LAB_STANDARD = new Set(['1366x768', '1920x1080']);
const cases: Case[] = [];
for (const [w, h] of SCREENS) {
  const standard = LAB_STANDARD.has(`${w}x${h}`);
  for (const s of SCALES) {
    const fit: Fit = !standard ? 'any' : s === 1 ? 'normal' : s === 1.25 ? 'no-scroll' : 'any';
    // Spec §8: the same viewport at device scale factor 1, 1.25, 1.5.
    cases.push({ name: `${w}x${h} dsf ${s}`, width: w, height: h, dsf: s, fit });
    // What Windows display scaling really does to a full-screen (F11) Edge window: fewer CSS px.
    if (s !== 1) {
      cases.push({ name: `${w}x${h} @${s * 100}% (CSS ${Math.floor(w / s)}x${Math.floor(h / s)})`, width: Math.floor(w / s), height: Math.floor(h / s), dsf: s, fit });
    }
  }
}
// Floor: the smallest screen at 150% in a normal (not full-screen) Edge window with the taskbar.
cases.push({ name: 'floor 640x360', width: 640, height: 360, dsf: 1.5, fit: 'any' });
if (cases.length !== 26) throw new Error(`layout matrix: expected the 26 viewport cases, built ${cases.length}`);
// Lab resolutions read on Mon 19 Oct, e.g. LAB_VIEWPORTS="1600x900@1.25,1440x900@1"
for (const spec of (process.env.LAB_VIEWPORTS ?? '').split(',').filter(Boolean)) {
  const m = /^(\d+)x(\d+)@([\d.]+)$/.exec(spec.trim());
  if (!m) throw new Error(`bad LAB_VIEWPORTS entry: ${spec}`);
  const [w, h, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
  cases.push({ name: `lab ${w}x${h} @${s * 100}%`, width: Math.floor(w / s), height: Math.floor(h / s), dsf: s, fit: 'no-scroll' });
}

/** Runs `body` in a fresh page at the case's size, and always closes its context. */
async function withPage(browser: Browser, c: Case, body: (page: Page) => Promise<void>): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: c.dsf });
  try {
    await body(await ctx.newPage());
  } finally {
    await ctx.close();
  }
}

/** Two animation frames: layout, the card view's ResizeObserver refit and the style recalculation have all run. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

for (const c of cases) {
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

      const m = await page.evaluate(() => ({
        sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth,
        bh: document.body.scrollHeight, bw: document.body.scrollWidth,
        ih: window.innerHeight, iw: window.innerWidth,
      }));
      expect(m.sh, 'page height').toBeLessThanOrEqual(m.ih);
      expect(m.bh, 'body height').toBeLessThanOrEqual(m.ih);
      expect(m.sw, 'page width').toBeLessThanOrEqual(m.iw);
      expect(m.bw, 'body width').toBeLessThanOrEqual(m.iw);

      const inView = (label: string, box: { x: number; y: number; width: number; height: number } | null): void => {
        expect(box, `${label} box`).not.toBeNull();
        expect(box!.height, `${label} height`).toBeGreaterThan(0);
        expect(box!.y, `${label} top`).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height, `${label} bottom`).toBeLessThanOrEqual(c.height + 0.5);
        expect(box!.x + box!.width, `${label} right`).toBeLessThanOrEqual(c.width + 0.5);
      };
      inView('prompt', await prompt(page).boundingBox());
      const hint = page.locator('#terminal').getByText(formatCommand(SCRIPT[0]!)).last();
      inView('hint', await hint.boundingBox());
      const plot = await page.locator('#plot').boundingBox();
      inView('plot', plot);
      expect(plot!.width, 'plot width').toBeGreaterThanOrEqual(240);
      expect(plot!.height, 'plot height').toBeGreaterThanOrEqual(150);
      // Spec §7: terminal on the left, plot on the right (no case here is narrow or portrait enough to stack).
      const term = await page.locator('#terminal').boundingBox();
      expect(term!.x + term!.width, 'terminal left of plot').toBeLessThanOrEqual(plot!.x + 1);

      // RF5: the Iron Age -> Anglo-Saxon centre shift is at least 25 px on every lab screen and scale.
      await run(page, 'run_pca(period = "IronAge")');
      await run(page, 'run_pca(period = "AngloSaxon")');
      await plotSettled(page);
      const a = await centreOf(page, '#plot .centre[data-centre="IronAge"]');
      const b = await centreOf(page, '#plot .centre[data-centre="AngloSaxon"]');
      expect(Math.hypot(b.x - a.x, b.y - a.y), 'Anglo-Saxon shift').toBeGreaterThanOrEqual(25);

      // Wrap screen: the whole QR is on screen.
      await page.locator('#wrap-open').click();
      inView('QR', await page.locator('#wrap-qr svg').boundingBox());
      inView('wrap Image credits button', await page.locator('#wrap-credits').boundingBox());
      inView('wrap Close', await page.locator('#wrap-close').boundingBox());
      // Credits panel (Task 15, spec §5.2): opens over the wrap screen with focus on its Close button, which is on screen (the
      // list inside scrolls, the page does not); Esc closes the panel only, and the wrap screen is still there.
      await page.locator('#wrap-credits').click();
      await expect(page.locator('#credits')).toBeVisible();
      await expect(page.locator('#credits-close')).toBeFocused();
      inView('credits Close', await page.locator('#credits-close').boundingBox());
      const open = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, ih: window.innerHeight, iw: window.innerWidth }));
      expect(open.sh, 'page height with the credits panel open').toBeLessThanOrEqual(open.ih);
      expect(open.sw, 'page width with the credits panel open').toBeLessThanOrEqual(open.iw);
      await page.keyboard.press('Escape');
      await expect(page.locator('#credits')).toBeHidden();
      await expect(page.locator('#wrap')).toBeVisible();
      await page.locator('#wrap-close').click();
      await expect(page.locator('#wrap')).toBeHidden();
    });
  });
}

// ---- P1 card layout (spec §5.2, §5.4, §10.1 P1 item 7): every card, every viewport case. ----
// Cards are opened through the ?test hook (window.__adw.openCard), which changes no session state. After each open and each
// Continue the page gets two animation frames: the controller sets the hint line to CARD_HINT right after it opens the card, and
// the card view re-places itself above the hint from its ResizeObserver, which reports at the next frame. A human cannot close a
// card and open the next one inside a single frame (the repeat guard is 400 ms); a script can, and would read a stale position.

interface Rect { top: number; bottom: number; left: number; right: number }
interface CardGeometry {
  vw: number; vh: number; sh: number; sw: number;
  fit: string | null;
  card: Rect | null; body: (Rect & { overflow: number }) | null; title: Rect | null; first: Rect | null; buttons: Rect[];
  hint: Rect | null; prompt: Rect | null;
  hintHit: boolean; promptHit: boolean;
}

const intersects = (a: Rect, b: Rect): boolean =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

/** Everything the card checks need, read in one evaluate so the numbers belong to one moment. */
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
    const first = card?.querySelector('.card-tile, .card-bullets > li, .card-column li, .card-values > li, .card-lines > li') ?? null;
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth,
      fit: card?.getAttribute('data-fit') ?? null,
      card: rect(card),
      body: body ? { ...rect(body)!, overflow: body.scrollHeight - body.clientHeight } : null,
      title: rect(card?.querySelector('#card-title') ?? null),
      first: rect(first),
      buttons: [...(card?.querySelectorAll('.card-footer button') ?? [])].map((b) => rect(b)!),
      hint: rect(hint), prompt: rect(promptRow),
      hintHit: reachable(hint), promptHit: reachable(promptRow),
    };
  });
}

for (const c of cases) {
  test(`every card fits, with the prompt and hint line usable: ${c.name}`, async ({ browser }) => {
    test.setTimeout(240_000);
    await withPage(browser, c, async (page) => {
      const w = watch(page);
      await page.goto(`${APP_URL}?test&reset`);
      await expect(prompt(page)).toBeVisible();
      await idle(page);
      expect(await page.evaluate(() => typeof window.__adw?.openCard), 'openCard is attached with ?test').toBe('function');
      const allowed = c.fit === 'normal' ? ['normal'] : c.fit === 'no-scroll' ? ['normal', 'dense', 'compact'] : ['normal', 'dense', 'compact', 'scroll'];

      for (const id of CARD_IDS) {
        await page.evaluate((cid) => window.__adw!.openCard!(cid), id);
        const card = page.locator(`#card[data-card-id="${id}"]`);
        await expect(card, id).toBeVisible();
        await settle(page);
        const g = await cardGeometry(page);

        expect(allowed, `${id} at ${c.name} (rule: ${c.fit}): data-fit is ${g.fit}`).toContain(g.fit);
        if (g.fit !== 'scroll') expect(g.body!.overflow, `${id}: the body overflows at fit ${g.fit}`).toBeLessThanOrEqual(1);
        expect(g.sh, `${id}: page height`).toBeLessThanOrEqual(g.vh);
        expect(g.sw, `${id}: page width`).toBeLessThanOrEqual(g.vw);

        const onScreen = (label: string, r: Rect | null): void => {
          expect(r, `${id}: ${label}`).not.toBeNull();
          expect(r!.bottom - r!.top, `${id}: ${label} height`).toBeGreaterThan(0);
          expect(r!.top, `${id}: ${label} top`).toBeGreaterThanOrEqual(-0.5);
          expect(r!.bottom, `${id}: ${label} bottom`).toBeLessThanOrEqual(g.vh + 0.5);
          expect(r!.left, `${id}: ${label} left`).toBeGreaterThanOrEqual(-0.5);
          expect(r!.right, `${id}: ${label} right`).toBeLessThanOrEqual(g.vw + 0.5);
        };
        onScreen('card', g.card);
        onScreen('title', g.title);
        onScreen('first item', g.first);
        expect(g.first!.top, `${id}: first item inside the card body`).toBeLessThan(g.body!.bottom);
        expect(g.buttons.length, `${id}: footer buttons`).toBeGreaterThanOrEqual(1);
        g.buttons.forEach((b, k) => onScreen(`footer button ${k}`, b));

        // Spec §5.2: the card never covers the prompt or the hint line. Both the geometry and a hit test, at every viewport.
        onScreen('hint line', g.hint);
        onScreen('prompt row', g.prompt);
        expect(intersects(g.card!, g.hint!), `${id} at ${c.name}: the card covers the hint line (card bottom ${g.card!.bottom}, hint top ${g.hint!.top})`).toBe(false);
        expect(intersects(g.card!, g.prompt!), `${id} at ${c.name}: the card covers the prompt row`).toBe(false);
        expect(g.hintHit, `${id}: hint line reachable`).toBe(true);
        expect(g.promptHit, `${id}: prompt row reachable`).toBe(true);

        await card.locator('.card-continue').click();
        await expect(page.locator('#card')).toBeHidden();
        expect(await page.evaluate(() => document.activeElement === document.querySelector('#terminal .term-input')), `${id}: prompt focused after Continue`).toBe(true);
        await settle(page);
      }
      expect(w.requests).toEqual([]);
      expect(w.errors).toEqual([]);
    });
  });
}

// A refresh with a card open restores it (spec §4.5). The restore opens the card before the controller sets CARD_HINT, so here the
// card view's first ResizeObserver report, not a later change of the hint line, has to place it above the hint. The two cases are the
// narrowest ones where the card covers both panes down to the hint line: a lab screen at 150% and the floor.
for (const c of cases.filter((k) => k.name.includes('CSS 682x512') || k.name.startsWith('floor'))) {
  test(`a card restored by a refresh sits above the hint line and the prompt: ${c.name}`, async ({ browser }) => {
    await withPage(browser, c, async (page) => {
      const w = watch(page);
      await page.goto(`${APP_URL}?reset`);
      await expect(prompt(page)).toBeVisible();
      await idle(page);
      for (const step of SCRIPT.slice(0, 3)) await run(page, formatCommand(step));   // the hook, load_genomes, then Europe: A1 opens
      await expect(page.locator('#card[data-card-id="A1"]')).toBeVisible();
      await page.reload();
      await idle(page);
      await expect(page.locator('#card[data-card-id="A1"]')).toBeVisible();
      await settle(page);
      const g = await cardGeometry(page);
      expect(g.hint, 'hint line').not.toBeNull();
      expect(intersects(g.card!, g.hint!), `the restored card covers the hint line (card bottom ${g.card!.bottom}, hint top ${g.hint!.top})`).toBe(false);
      expect(intersects(g.card!, g.prompt!), 'the restored card covers the prompt row').toBe(false);
      expect(g.hintHit && g.promptHit, 'hint line and prompt reachable').toBe(true);
      expect(g.sh, 'page height').toBeLessThanOrEqual(g.vh);
      expect(w.errors).toEqual([]);
    });
  });
}

// ---- The plot panel at the steps that crowd it (carry-forward from the Task 8 and Task 9 reviews). ----
// At the 640x360 floor the Today step's caption strip takes 184 of the panel's 332 px (the plot 148 px), the finale's 180 px, and
// the HLA-DQ2 trajectory leaves its plot 80 px under a 103 px reveal line. These checks say that, at every viewport, nothing the
// panel draws is clipped by its overflow:hidden, nothing overlaps, the legend stays inside the plot's own coordinates with its items
// clear of one another, and the plot keeps a usable height. They do not say the text is comfortable to read at the floor: that is
// judged on the lab machine (the lab font, Segoe UI, is not the one measured here).
//
// The panel depends only on the commands run (spec §4.1: refresh replays them), so these commands, which are off the guided
// script and so open no card, give the same panel as guided steps 4-10, 14 and 19 (the same #plot markup, compared once while
// writing this test).

/**
 * The plot's own minimum height, in CSS px. At a size a lab screen can really have (a CSS height of 480 or more) it must stay a
 * useful picture. At the 640x360 floor it is held near what was measured (PCA 148 and 152, the trajectory 80), so a caption that
 * grows by a line is noticed there.
 */
const MIN_PLOT_PX = { lab: 200, floorPca: 120, floorTrait: 64 } as const;

/** A box in the plot's own units (the PCA plot is 1000 x 760, the ADMIXTURE bars 1000 x 700, the trajectory 1000 x 520). */
interface Extent { left: number; right: number; top: number; bottom: number }
interface LegendBox { name: string; row: number; left: number; right: number }
const PCA_BLOCKS = ['svg.plot-svg', 'div.pca-captions'];

interface PanelGeometry {
  panel: Rect & { clipH: number; clipW: number };
  svg: (Rect & { height: number }) | null;
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
    return {
      panel: { ...rect(plot), clipH: plot.scrollHeight - plot.clientHeight, clipW: plot.scrollWidth - plot.clientWidth },
      svg: svg ? { ...rect(svg), height: svg.getBoundingClientRect().height } : null,
      blocks: stack.map((e) => ({ name: `${e.tagName.toLowerCase()}.${e.getAttribute('class') ?? ''}`.replace(/\.$/, ''), rect: rect(e), clipH: clip(e) })),
      legend,
      legendBoxes,
    };
  });
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

for (const c of cases) {
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

      // Step 14: the finale, every period at once.
      await run(page, 'run_pca(period = "all")');
      await plotSettled(page);
      expect((await layersShown(page)).length, 'finale layers').toBe(8);
      expect(await focusLayer(page), 'finale focus').toBeNull();
      const finale = await panelGeometry(page);
      if (c.height <= 512) console.log(`${c.name}: finale plot ${finale.svg!.height.toFixed(0)} px of ${(finale.panel.bottom - finale.panel.top).toFixed(0)}`);
      expectPanelHolds(finale, 'finale', c, 'pca', PCA_BLOCKS);
      expectLegendClear(finale, 'finale');

      // The bars with all eight periods run and the takeaway under them (the extras' last run_admixture(K = 3)).
      await run(page, 'run_admixture(K = 3)');
      await expect(page.locator('#plot')).toHaveAttribute('data-view', 'admixture');
      await plotSettled(page);
      expectPanelHolds(await panelGeometry(page), 'ADMIXTURE bars', c, 'bars', ['svg.plot-svg']);
      expectBarsClear(await barsGeometry(page), 'ADMIXTURE bars');

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
