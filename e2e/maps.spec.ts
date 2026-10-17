import { expect, test, type Page } from '@playwright/test';
import { CARDS, distributionRows } from '../src/cards';
import { IRELAND_FOOTNOTE, MAP_TEXT } from '../src/content';
import { FEATURES } from '../src/features';
import { A1_CONFIRMED_LABELS, DISTRIBUTION_MAP_GENE } from '../src/maps';
import type { CardId } from '../src/types';
import { a1LabelCandidates, buildMapApp, MAP_CARD_IDS, type MapApp } from './mapBuild';
import { DATA, idle, intersects, prompt, screenViolations, settle, watch, type Rect } from './helpers';
import { ALLOWED_FITS, CASES as cases, withPage } from './viewports';

/**
 * The map cards A1 (Task 23), D1, E1 and G1 (Task 20), and the distribution cards H2, I2 and J3 (Task 24), in their MAP form. The shipped
 * build draws their text form until the instructor has checked the maps, so this spec builds its own copy of the app with the seven map
 * flags forced on and the seven maps recorded as checked, and A1's label list filled with the eight names the data build chose
 * (e2e/mapBuild.ts: an in-memory change while Vite reads three modules, into a temporary directory; nothing in the repo is written and
 * the shipped flags and the empty A1 list stay as committed). It then asks what spec §5.2 and §5.4 ask of every card, of these seven:
 * no page scroll, title, first body line and every footer button on screen, the prompt and hint line uncovered, and no `dense` at the
 * lab-standard screens at 100% (`normal`); plus what only a map can get wrong: a label cut off or overlapped, a picture too small to
 * read, rule violations in the map text, and for A1 a dot cut off by its window or hidden under a word. A1's window does not depend on
 * its labels (src/maps.ts specA1), so the card is the same size with the map labelled or not, and the labelled build proves both.
 * The distribution maps (the real data's rows, in the real browser) are asked for a dot for every row with coordinates (a ring exactly
 * where the number prints 0, a dot of at least 4 map units otherwise), no word over any dot or over another word, every word whole
 * inside the picture, the side list for the rows without coordinates in view beside it, and H2's Ireland footnote under the map.
 *
 * The viewport matrix is e2e/viewports.ts's, the one e2e/layout.spec.ts runs too (26 cases plus LAB_VIEWPORTS).
 */

/** The map cards built so far, in card order (Task 27 adds its own for K2 and L3). */
const IDS = ['A1', 'D1', 'E1', 'G1', 'H2', 'I2', 'J3'] as const satisfies readonly CardId[];
type MapCardId = (typeof IDS)[number];
type DistributionCardId = 'H2' | 'I2' | 'J3';
const isDistribution = (id: MapCardId): id is DistributionCardId => id === 'H2' || id === 'I2' || id === 'J3';
const hasCoordinates = (r: { lat?: number; lon?: number }): boolean => r.lat !== undefined && r.lon !== undefined;
/** The rows of a distribution card from the real data, in the card's order: the ones with coordinates are dots, the others the side list. */
const rowsOf = (id: DistributionCardId) => distributionRows(DATA, DISTRIBUTION_MAP_GENE[id]);

/** The words each map must carry: the approved text; for A1 the eight groups the data build chose (the build forces them in); for the
 *  distribution maps "<place> <copies>" for every row with coordinates, the numbers the value list prints. */
const LABELS = a1LabelCandidates();
const expectedLabels = (id: MapCardId): string[] =>
  id === 'A1' ? [...LABELS] : isDistribution(id) ? rowsOf(id).filter(hasCoordinates).map((r) => `${r.label} ${r.display}`) : [...MAP_TEXT[id]];

/** A label in the picture must be at least this many CSS px tall at the lab-standard screens at 100% (spec §5.2 body text is 19 px). */
const MIN_LABEL_PX = 14;
/** No card may leave its map smaller than this (CSS px of height) at a screen whose fit rule is 'normal' or 'no-scroll'. */
const MIN_MAP_PX = 150;
/** A1 is 26 pairs of dots: at the lab-standard screens at 100% its picture must be drawn at no less than this many CSS px to a map unit,
 *  so a grey dot (4 units) is at least 4.8 px across and a DNA dot (5 units) at least 6 px (Task 23: legible at 1366 x 768). */
const MIN_A1_SCALE = 0.6;

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
    /** The distribution maps (Task 24): the value dots and zero rings in map units (px = drawn width in CSS px), and the side list. */
    values: { zero: boolean; cx: number; cy: number; r: number; px: number }[];
    side: null | { rect: Rect; items: string[] };
  };
}
interface MapLabel { text: string; box: Box; glyphs: Box; fontPx: number; widthVsEstimate: number }

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
            // How wide the word really draws against src/maps.ts' estimate (0.58 em a character): the placer keeps clear of the estimate.
            widthVsEstimate: b.width / ((t.textContent ?? '').length * 0.58 * f),
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
        values: [...svg.querySelectorAll<SVGCircleElement>('circle.map-dot--value, circle.map-dot--zero')].map((e) => ({
          zero: e.classList.contains('map-dot--zero'),
          cx: Number(e.getAttribute('cx')), cy: Number(e.getAttribute('cy')), r: Number(e.getAttribute('r')),
          px: e.getBoundingClientRect().width,
        })),
        side: ((): null | { rect: Rect; items: string[] } => {
          const list = slot.querySelector<HTMLElement>('ul.card-map-side');
          return list ? { rect: rect(list)!, items: [...list.querySelectorAll('li')].map((li) => li.textContent ?? '') } : null;
        })(),
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

  test('the proof covers exactly the map cards the scratch build can force on (e2e/mapBuild.ts MAP_CARD_IDS)', () => {
    expect([...IDS]).toEqual([...MAP_CARD_IDS]);
  });

  test('the scratch build differs from the shipped flags in the seven map flags only', async ({ page }) => {
    await page.goto(`${app.url}?test&reset`);
    await expect(prompt(page)).toBeVisible();
    await idle(page);
    const features = await page.evaluate(() => ({ ...window.__adw!.features }));
    expect(features).toEqual({ ...FEATURES, ...Object.fromEntries(IDS.map((id) => [`map.${id}`, true])) });
  });

  for (const c of cases) {
    test(`A1, D1, E1, G1, H2, I2 and J3 show their map and fit: ${c.name}`, async ({ browser }, testInfo) => {
      test.setTimeout(240_000);
      await withPage(browser, c, async (page) => {
        const w = watch(page);
        await page.goto(`${app.url}?test&reset`);
        await expect(prompt(page)).toBeVisible();
        await idle(page);
        const allowed = ALLOWED_FITS[c.fit];

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
          onScreen('first bullet (a distribution card has its first line)', g.first);
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
          // A label is its font size (20 map units; A1's and the distribution maps' 24 to 26) tall; at the lab-standard screens at 100% it
          // must be legible on a projector.
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
          // letters are clear of each other but the empty space above and below them is not, so A1 is judged on the glyphs. So are the
          // distribution maps, whose twenty (H2) or ten words sit close to their dots (Task 24); src/maps.ts placeDotLabels measures the same.
          const extent = (t: MapLabel): Box => (id === 'A1' || isDistribution(id) ? t.glyphs : t.box);
          for (let i = 0; i < m!.labels.length; i++) {
            for (let j = i + 1; j < m!.labels.length; j++) {
              expect(overlaps(extent(m!.labels[i]!), extent(m!.labels[j]!)), `${id}: "${m!.labels[i]!.text}" overlaps "${m!.labels[j]!.text}"`).toBe(false);
            }
          }
          expect(m!.arrows.length, `${id}: arrows`).toBe(id === 'A1' || isDistribution(id) ? 0 : id === 'D1' ? 2 : id === 'E1' ? 1 : 5);
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

          // H2, I2, J3 (Task 24; the real data's rows). A dot for every row with coordinates, whole inside the picture, a ring exactly where the
          // number prints 0 and a filled dot of at least 4 map units for every other number; no word over any dot (its own included) and, as above,
          // none over another word; the rows without coordinates in the side list, in view beside the picture.
          if (isDistribution(id)) {
            const rows = rowsOf(id);
            const dotRows = rows.filter(hasCoordinates);
            const sideRows = rows.filter((r) => !hasCoordinates(r));
            expect(m!.values, `${id}: a dot for every row with coordinates`).toHaveLength(dotRows.length);
            expect(m!.values.filter((v) => v.zero), `${id}: a ring for every number that prints 0, and for no other`).toHaveLength(dotRows.filter((r) => r.display === '0').length);
            for (const v of m!.values) {
              const at = `${v.zero ? 'ring' : 'dot'} at ${v.cx.toFixed(0)}, ${v.cy.toFixed(0)}`;
              expect(v.zero ? v.r === 3 : v.r >= 4, `${id}: the ${at} has radius ${v.r}`).toBe(true);
              expect(v.cx - v.r >= vb.left - 0.01 && v.cx + v.r <= vb.right + 0.01 && v.cy - v.r >= vb.top - 0.01 && v.cy + v.r <= vb.bottom + 0.01,
                `${id}: the ${at} is cut off by the window`).toBe(true);
              for (const t of m!.labels) {
                const nearest = Math.hypot(Math.max(t.glyphs.left - v.cx, 0, v.cx - t.glyphs.right), Math.max(t.glyphs.top - v.cy, 0, v.cy - t.glyphs.bottom));
                expect(nearest, `${id}: "${t.text}" covers the ${at}`).toBeGreaterThanOrEqual(v.r);
              }
            }
            if (c.fit === 'normal') {
              const filled = m!.values.filter((v) => !v.zero).map((v) => v.px);
              const rings = m!.values.filter((v) => v.zero).map((v) => v.px);
              expect(Math.min(...filled), `${id}: the smallest dot's width in CSS px at ${c.name}`).toBeGreaterThanOrEqual(4);
              if (rings.length > 0) expect(Math.min(...filled), `${id}: even the smallest filled dot is wider than the zero ring`).toBeGreaterThan(Math.max(...rings));
            }
            const side = m!.side;
            expect(side?.items ?? [], `${id}: the side list holds the rows without coordinates`).toEqual(sideRows.map((r) => `${r.label} ${r.display}`));
            if (side !== null) {
              onScreen('side list', side.rect);
              expect(side.rect.right, `${id}: the side list inside the card`).toBeLessThanOrEqual(g.card!.right + 0.5);
              expect(side.rect.bottom, `${id}: the side list inside the card body`).toBeLessThanOrEqual(g.body!.bottom + 0.5);
              expect(intersects(side.rect, m!.svg), `${id}: the side list is beside the picture, not over it`).toBe(false);
            }
            if (id === 'H2') {
              const note = page.locator('#card .card-side-note');
              expect(await note.textContent(), 'H2: the Ireland footnote').toBe(IRELAND_FOOTNOTE);
              const box = await note.boundingBox();
              expect(box!.y, 'H2: the footnote is under the map').toBeGreaterThanOrEqual(m!.svg.bottom - 0.5);
              expect(box!.y + box!.height, 'H2: the footnote is on screen').toBeLessThanOrEqual(g.vh + 0.5);
            }
          }

          // Spec §5.4 (guided.spec): no content-rule violation in anything on screen with this card open.
          expect(await screenViolations(page), `${id}: rule violations on screen`).toEqual([]);
          testInfo.annotations.push({ type: 'map size', description: `${id} at ${c.name}: ${m!.sizeCss[0]} x ${m!.sizeCss[1]} px, scale ${m!.scale.toFixed(3)}, label ${(fontPx * m!.scale).toFixed(1)} px, fit ${g.fit}, widest word ${Math.max(...m!.labels.map((t) => t.widthVsEstimate), 0).toFixed(2)} of its estimate` });

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

  test('the map cards are the seven and only seven cards that draw a map in this build', async ({ page }) => {
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
