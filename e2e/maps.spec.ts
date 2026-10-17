import { expect, test, type Browser, type Page } from '@playwright/test';
import { CARDS } from '../src/cards';
import { MAP_TEXT } from '../src/content';
import { FEATURES } from '../src/features';
import { A1_CONFIRMED_LABELS } from '../src/maps';
import type { CardId } from '../src/types';
import { a1LabelCandidates, buildMapApp, type MapApp } from './mapBuild';
import { idle, intersects, prompt, screenViolations, watch, type Rect } from './helpers';

/**
 * The map cards A1 (Task 23), D1, E1 and G1 (Task 20) in their MAP form. The shipped build draws their text form until the instructor
 * has checked the maps, so this spec builds its own copy of the app with the four map flags forced on and the four maps recorded as
 * checked, and A1's label list filled with the eight names the data build chose (e2e/mapBuild.ts: an in-memory change while Vite reads
 * three modules, into a temporary directory; nothing in the repo is written and the shipped flags and the empty A1 list stay as
 * committed). It then asks what spec §5.2 and §5.4 ask of every card, of these four: no page scroll, title, first bullet and every
 * footer button on screen, the prompt and hint line uncovered, and no `dense` at the lab-standard screens at 100% (`normal`); plus what
 * only a map can get wrong: a label cut off or overlapped, a picture too small to read, rule violations in the map text, and for A1 a
 * dot cut off by its window or hidden under a word. A1's window does not depend on its labels (src/maps.ts specA1), so the card is the
 * same size with the map labelled or not, and the labelled build proves both.
 *
 * The viewport matrix is the one e2e/layout.spec.ts uses (26 cases plus LAB_VIEWPORTS); keep the two in step.
 */
type Fit = 'normal' | 'no-scroll' | 'any';
interface Case { name: string; width: number; height: number; dsf: number; fit: Fit }

const SCREENS: [number, number][] = [[1024, 768], [1280, 720], [1280, 1024], [1366, 768], [1920, 1080]];
const SCALES = [1, 1.25, 1.5];
const LAB_STANDARD = new Set(['1366x768', '1920x1080']);
const cases: Case[] = [];
for (const [w, h] of SCREENS) {
  const standard = LAB_STANDARD.has(`${w}x${h}`);
  for (const s of SCALES) {
    const fit: Fit = !standard ? 'any' : s === 1 ? 'normal' : s === 1.25 ? 'no-scroll' : 'any';
    cases.push({ name: `${w}x${h} dsf ${s}`, width: w, height: h, dsf: s, fit });
    if (s !== 1) cases.push({ name: `${w}x${h} @${s * 100}% (CSS ${Math.floor(w / s)}x${Math.floor(h / s)})`, width: Math.floor(w / s), height: Math.floor(h / s), dsf: s, fit });
  }
}
cases.push({ name: 'floor 640x360', width: 640, height: 360, dsf: 1.5, fit: 'any' });
if (cases.length !== 26) throw new Error(`layout matrix: expected the 26 viewport cases, built ${cases.length}`);
for (const spec of (process.env.LAB_VIEWPORTS ?? '').split(',').filter(Boolean)) {
  const m = /^(\d+)x(\d+)@([\d.]+)$/.exec(spec.trim());
  if (!m) throw new Error(`bad LAB_VIEWPORTS entry: ${spec}`);
  const [w, h, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
  cases.push({ name: `lab ${w}x${h} @${s * 100}%`, width: Math.floor(w / s), height: Math.floor(h / s), dsf: s, fit: 'no-scroll' });
}

/** The map cards built so far, in card order (Tasks 24 and 27 draw their own checks for theirs). */
const IDS = ['A1', 'D1', 'E1', 'G1'] as const satisfies readonly CardId[];
type MapCardId = (typeof IDS)[number];

/** The words each map must carry: the approved text, and for A1 the eight groups the data build chose (the build forces them in). */
const LABELS = a1LabelCandidates();
const expectedLabels = (id: MapCardId): string[] => (id === 'A1' ? [...LABELS] : [...MAP_TEXT[id]]);

/** A label in the picture must be at least this many CSS px tall at the lab-standard screens at 100% (spec §5.2 body text is 19 px). */
const MIN_LABEL_PX = 14;
/** No card may leave its map smaller than this (CSS px of height) at a screen whose fit rule is 'normal' or 'no-scroll'. */
const MIN_MAP_PX = 150;
/** A1 is 26 pairs of dots: at the lab-standard screens at 100% its picture must be drawn at no less than this many CSS px to a map unit,
 *  so a grey dot (4 units) is at least 4.8 px across and a DNA dot (5 units) at least 6 px (Task 23: legible at 1366 x 768). */
const MIN_A1_SCALE = 0.6;

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

interface Box { left: number; right: number; top: number; bottom: number }
interface MapGeometry {
  vw: number; vh: number; sh: number; sw: number;
  fit: string | null;
  card: Rect | null; body: (Rect & { overflow: number }) | null; title: Rect | null; first: Rect | null; buttons: Rect[];
  hint: Rect | null; prompt: Rect | null; hintHit: boolean; promptHit: boolean;
  map: null | {
    id: string | null; slot: Rect; svg: Rect; viewBox: Box; scale: number; sizeCss: [number, number];
    /** box: getBBox (the line box, which reaches above and below the letters); glyphs: the real width of the word and the height from
     *  0.8 em above its baseline to 0.25 em below it, the extent src/maps.ts labelBox estimates. */
    labels: MapLabel[]; arrows: Box[];
    /** A1: the dots (grey = the true place, blue = where the DNA puts the group) in map units, and how many links and lines were drawn. */
    dots: { kind: string; cx: number; cy: number; r: number; px: number }[]; links: number; lines: number;
  };
}
interface MapLabel { text: string; box: Box; glyphs: Box; fontPx: number }

/** Everything the checks need, read in one evaluate so the numbers belong to one moment. */
async function geometry(page: Page): Promise<MapGeometry> {
  return page.evaluate((): MapGeometry => {
    const rect = (e: Element | null): Rect | null => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
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
    const first = card?.querySelector('.card-bullets > li, .card-values > li, .card-lines > li') ?? null;
    const slot = card?.querySelector<HTMLElement>('.card-map') ?? null;
    const svg = slot?.querySelector<SVGSVGElement>('svg.map-svg') ?? null;
    let map: MapGeometry['map'] = null;
    if (slot && svg) {
      const vb = svg.viewBox.baseVal;
      const r = svg.getBoundingClientRect();
      const box = (b: DOMRect): Box => ({ left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height });
      map = {
        id: slot.getAttribute('data-map'),
        slot: rect(slot)!, svg: rect(svg)!,
        viewBox: { left: vb.x, right: vb.x + vb.width, top: vb.y, bottom: vb.y + vb.height },
        scale: Math.min(r.width / vb.width, r.height / vb.height),
        sizeCss: [Math.round(r.width), Math.round(r.height)],
        labels: [...svg.querySelectorAll<SVGTextElement>('text.map-label')].map((t) => {
          const b = t.getBBox();
          const f = Number(t.getAttribute('font-size'));
          const y = Number(t.getAttribute('y'));
          return {
            text: t.textContent ?? '', box: box(b), fontPx: f,
            glyphs: { left: b.x, right: b.x + b.width, top: y - 0.8 * f, bottom: y + 0.25 * f },
          };
        }),
        arrows: [...svg.querySelectorAll<SVGGraphicsElement>('path.map-arrow')].map((p) => box(p.getBBox())),
        dots: [...svg.querySelectorAll<SVGCircleElement>('circle.map-dot--true, circle.map-dot--genetic')].map((e) => ({
          kind: e.classList.contains('map-dot--true') ? 'true' : 'genetic',
          cx: Number(e.getAttribute('cx')), cy: Number(e.getAttribute('cy')), r: Number(e.getAttribute('r')),
          px: e.getBoundingClientRect().width,
        })),
        links: svg.querySelectorAll('g.map-link').length,
        lines: svg.querySelectorAll('g.map-link line').length,
      };
    }
    const hint = document.querySelector('#terminal .term-hint');
    const promptRow = document.querySelector('#terminal .term-prompt');
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
      map,
    };
  });
}

const overlaps = (a: Box, b: Box): boolean =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.01 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.01;

test.describe('map cards in their map form', () => {
  let app: MapApp;
  test.beforeAll(async () => {
    expect(LABELS, 'the data build chose eight groups to name on A1').toHaveLength(8);
    app = await buildMapApp(IDS, { a1Labels: LABELS });
  });
  test.afterAll(() => {
    app?.cleanup();
  });

  test('the scratch build differs from the shipped flags in the four map flags only', async ({ page }) => {
    await page.goto(`${app.url}?test&reset`);
    await expect(prompt(page)).toBeVisible();
    await idle(page);
    const features = await page.evaluate(() => ({ ...window.__adw!.features }));
    expect(features).toEqual({ ...FEATURES, 'map.A1': true, 'map.D1': true, 'map.E1': true, 'map.G1': true });
  });

  for (const c of cases) {
    test(`A1, D1, E1 and G1 show their map and fit: ${c.name}`, async ({ browser }, testInfo) => {
      test.setTimeout(240_000);
      await withPage(browser, c, async (page) => {
        const w = watch(page);
        await page.goto(`${app.url}?test&reset`);
        await expect(prompt(page)).toBeVisible();
        await idle(page);
        const allowed = c.fit === 'normal' ? ['normal'] : c.fit === 'no-scroll' ? ['normal', 'dense', 'compact'] : ['normal', 'dense', 'compact', 'scroll'];

        for (const id of IDS) {
          await page.evaluate((cid: CardId) => window.__adw!.openCard!(cid), id);
          await expect(page.locator(`#card[data-card-id="${id}"]`), id).toBeVisible();
          await settle(page);
          const g = await geometry(page);

          // The fit rule of this viewport (spec §5.4), and the checks every card has to pass at every viewport.
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
          onScreen('first bullet', g.first);
          expect(g.first!.top, `${id}: first bullet inside the card body`).toBeLessThan(g.body!.bottom);
          expect(g.buttons.length, `${id}: footer buttons`).toBeGreaterThanOrEqual(2);
          g.buttons.forEach((b, k) => onScreen(`footer button ${k}`, b));
          expect(await page.locator('#card .card-credits').count(), `${id}: Image credits is offered with the map`).toBe(1);
          onScreen('hint line', g.hint);
          onScreen('prompt row', g.prompt);
          expect(intersects(g.card!, g.hint!), `${id} at ${c.name}: the card covers the hint line`).toBe(false);
          expect(intersects(g.card!, g.prompt!), `${id} at ${c.name}: the card covers the prompt row`).toBe(false);
          expect(g.hintHit, `${id}: hint line reachable`).toBe(true);
          expect(g.promptHit, `${id}: prompt row reachable`).toBe(true);

          // The map itself.
          const m = g.map;
          expect(m, `${id}: the map form is shown (a card map in the body)`).not.toBeNull();
          expect(m!.id).toBe(id);
          expect(await page.locator('#card .card-source').textContent(), `${id}: the source line names Natural Earth`).toContain('Map outline: Made with Natural Earth.');
          expect(m!.svg.bottom - m!.svg.top, `${id}: the picture has a height`).toBeGreaterThan(0);
          // It is inside the card body, whole.
          expect(m!.svg.top, `${id}: map top`).toBeGreaterThanOrEqual(g.body!.top - 0.5);
          expect(m!.svg.bottom, `${id}: map bottom`).toBeLessThanOrEqual(g.body!.bottom + 0.5);
          expect(m!.svg.left, `${id}: map left`).toBeGreaterThanOrEqual(g.card!.left - 0.5);
          expect(m!.svg.right, `${id}: map right`).toBeLessThanOrEqual(g.card!.right + 0.5);
          // Spec §5.2: maps fill the image row at max-height min(52vh, 460px).
          expect(m!.svg.bottom - m!.svg.top, `${id}: map height against the spec cap`).toBeLessThanOrEqual(Math.min(0.52 * g.vh, 460) + 0.5);
          if (c.fit !== 'any') expect(m!.svg.bottom - m!.svg.top, `${id}: map height at ${c.name}`).toBeGreaterThanOrEqual(MIN_MAP_PX);
          // A label is its font size (20 map units; A1's 24) tall; at the lab-standard screens at 100% it must be legible on a projector.
          const fontPx = Math.min(...m!.labels.map((t) => t.fontPx));
          expect(fontPx, `${id}: the labels have a font size`).toBeGreaterThanOrEqual(20);
          if (c.fit === 'normal') expect(fontPx * m!.scale, `${id}: label height in CSS px at ${c.name}`).toBeGreaterThanOrEqual(MIN_LABEL_PX);

          // The words on the map are the approved ones, each once, and every one is whole inside the picture and clear of the others.
          expect(m!.labels.map((t) => t.text).sort(), `${id}: map labels`).toEqual(expectedLabels(id).sort());
          const vb = m!.viewBox;
          for (const t of m!.labels) {
            expect(t.box.left, `${id} "${t.text}" left in the picture`).toBeGreaterThanOrEqual(vb.left - 0.01);
            expect(t.box.right, `${id} "${t.text}" right in the picture`).toBeLessThanOrEqual(vb.right + 0.01);
            expect(t.box.top, `${id} "${t.text}" top in the picture`).toBeGreaterThanOrEqual(vb.top - 0.01);
            expect(t.box.bottom, `${id} "${t.text}" bottom in the picture`).toBeLessThanOrEqual(vb.bottom + 0.01);
          }
          // The arrow maps' words are far apart, so they are held to the whole line box. A1 puts one word at each of eight dots, and two of
          // them sit one line apart (27 units between the Estonian and Lithuanian dots against a line box of 1.2 em, 29 at 24): the
          // letters are clear of each other but the empty space above and below them is not, so A1 is judged on the glyphs.
          const extent = (t: MapLabel): Box => (id === 'A1' ? t.glyphs : t.box);
          for (let i = 0; i < m!.labels.length; i++) {
            for (let j = i + 1; j < m!.labels.length; j++) {
              expect(overlaps(extent(m!.labels[i]!), extent(m!.labels[j]!)), `${id}: "${m!.labels[i]!.text}" overlaps "${m!.labels[j]!.text}"`).toBe(false);
            }
          }
          expect(m!.arrows.length, `${id}: arrows`).toBe(id === 'A1' ? 0 : id === 'D1' ? 2 : id === 'E1' ? 1 : 5);
          for (const a of m!.arrows) {
            expect(a.left >= vb.left && a.right <= vb.right && a.top >= vb.top && a.bottom <= vb.bottom, `${id}: an arrow leaves the picture`).toBe(true);
          }

          // A1 (Task 23): 26 links, each a line, a grey dot and a DNA dot; no dot cut off by the window, none hidden under a word, and at
          // the lab-standard screens at 100% the picture is big enough for the dots to be seen.
          if (id === 'A1') {
            expect([m!.links, m!.lines, m!.dots.length], 'A1: 26 links, 26 lines, 52 dots').toEqual([26, 26, 52]);
            expect(m!.dots.filter((d) => d.kind === 'true'), 'A1: grey dots').toHaveLength(26);
            expect(m!.dots.filter((d) => d.kind === 'genetic'), 'A1: DNA dots').toHaveLength(26);
            for (const d of m!.dots) {
              expect(d.cx - d.r >= vb.left - 0.01 && d.cx + d.r <= vb.right + 0.01 && d.cy - d.r >= vb.top - 0.01 && d.cy + d.r <= vb.bottom + 0.01,
                `A1: the ${d.kind} dot at ${d.cx.toFixed(0)}, ${d.cy.toFixed(0)} is cut off by the window`).toBe(true);
              for (const t of m!.labels) {
                const hidden = d.cx > t.glyphs.left && d.cx < t.glyphs.right && d.cy > t.glyphs.top && d.cy < t.glyphs.bottom;
                expect(hidden, `A1: "${t.text}" covers the ${d.kind} dot at ${d.cx.toFixed(0)}, ${d.cy.toFixed(0)}`).toBe(false);
              }
            }
            if (c.fit === 'normal') {
              expect(m!.scale, `A1: picture scale at ${c.name}`).toBeGreaterThanOrEqual(MIN_A1_SCALE);
              expect(Math.min(...m!.dots.filter((d) => d.kind === 'true').map((d) => d.px)), 'A1: grey dot width in CSS px').toBeGreaterThanOrEqual(4.8);
              expect(Math.min(...m!.dots.filter((d) => d.kind === 'genetic').map((d) => d.px)), 'A1: DNA dot width in CSS px').toBeGreaterThanOrEqual(6);
            }
            // The source line is the approved one, with the real counts from europe_fit.
            const source = await page.locator('#card .card-source').textContent();
            expect(source, 'A1: source line').toMatch(/^Drawn from this workshop's data \(\d+ groups, [\d,]+ people\)\. The DNA map was turned and scaled to fit the real map as closely as possible\. Inspired by Novembre et al\. 2008\. Map outline: Made with Natural Earth\.$/);
          }

          // Spec §5.4 (guided.spec): no content-rule violation in anything on screen with this card open.
          expect(await screenViolations(page), `${id}: rule violations on screen`).toEqual([]);
          testInfo.annotations.push({ type: 'map size', description: `${id} at ${c.name}: ${m!.sizeCss[0]} x ${m!.sizeCss[1]} px, scale ${m!.scale.toFixed(3)}, label ${(fontPx * m!.scale).toFixed(1)} px, fit ${g.fit}` });

          await page.locator('#card .card-continue').click();
          await expect(page.locator('#card')).toBeHidden();
          expect(await page.evaluate(() => document.activeElement === document.querySelector('#terminal .term-input')), `${id}: prompt focused after Continue`).toBe(true);
          await settle(page);
        }
        expect(w.requests).toEqual([]);
        expect(w.errors).toEqual([]);
      });
    });
  }

  test('the map cards are the four and only four cards that draw a map in this build', async ({ page }) => {
    await page.goto(`${app.url}?test&reset`);
    await expect(prompt(page)).toBeVisible();
    await idle(page);
    const withMap: string[] = [];
    for (const id of Object.keys(CARDS) as CardId[]) {
      await page.evaluate((cid: CardId) => window.__adw!.openCard!(cid), id);
      if ((await page.locator('#card .card-map').count()) > 0) withMap.push(id);
      await page.locator('#card .card-continue').click();
    }
    expect(withMap).toEqual([...IDS]);
  });

  // A1 ships unlabelled until the instructor confirms the eight names (open check 14: A1_CONFIRMED_LABELS stays empty), but the proof above
  // runs on the labelled map, the stricter one. This ties the two together: the same card, the same picture, whatever the words.
  test('A1 as the repo has it (its own label list, empty until the names are confirmed) is the same picture, in the same place, as the labelled one', async ({ browser }) => {
    test.setTimeout(240_000);
    const repoHas = await buildMapApp(['A1']);
    try {
      for (const [width, height] of [[1366, 768], [1920, 1080]] as const) {
        const read = async (url: string): Promise<{ svg: Rect | null; viewBox: string | null; labels: number; links: number; fit: string | null; sh: number }> => {
          let out!: Awaited<ReturnType<typeof read>>;
          await withPage(browser, { name: `${width}x${height}`, width, height, dsf: 1, fit: 'normal' }, async (page) => {
            await page.goto(`${url}?test&reset`);
            await expect(prompt(page)).toBeVisible();
            await idle(page);
            await page.evaluate(() => window.__adw!.openCard!('A1'));
            await expect(page.locator('#card[data-card-id="A1"]')).toBeVisible();
            await settle(page);
            out = await page.evaluate(() => {
              const svg = document.querySelector<SVGSVGElement>('#card .card-map svg.map-svg');
              const r = svg?.getBoundingClientRect();
              return {
                svg: r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null,
                viewBox: svg?.getAttribute('viewBox') ?? null,
                labels: svg?.querySelectorAll('text.map-label').length ?? 0,
                links: svg?.querySelectorAll('g.map-link').length ?? 0,
                fit: document.querySelector('#card')?.getAttribute('data-fit') ?? null,
                sh: document.documentElement.scrollHeight,
              };
            });
          });
          return out;
        };
        const labelled = await read(app.url);
        const asShipped = await read(repoHas.url);
        expect(labelled.labels, 'the labelled build names the eight groups').toBe(8);
        expect(asShipped.labels, `A1 as the repo has it names ${A1_CONFIRMED_LABELS.length} groups`).toBe(A1_CONFIRMED_LABELS.length);
        expect([asShipped.links, labelled.links]).toEqual([26, 26]);
        expect(asShipped.svg, `${width}x${height}: same picture box`).toEqual(labelled.svg);
        expect(asShipped.viewBox, `${width}x${height}: same window`).toBe(labelled.viewBox);
        expect(asShipped.fit, `${width}x${height}: same fit`).toBe(labelled.fit);
        expect(asShipped.fit, `${width}x${height}: normal`).toBe('normal');
        expect(asShipped.sh, `${width}x${height}: no page scroll`).toBeLessThanOrEqual(height);
      }
    } finally {
      repoHas.cleanup();
    }
  });
});
