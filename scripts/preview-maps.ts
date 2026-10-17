// CLI: vite build --ssr scripts/preview-maps.ts --outDir .preview-maps --emptyOutDir && node .preview-maps/preview-maps.js [ids...] [--out <dir>] [--no-cards]
// (that is `npm run preview-maps`, optionally `npm run preview-maps -- G1`). Draws the built maps (src/maps.ts MAP_SPECS_BUILT, or
// only the ids given) from the real data into assets/preview/maps.html (git-ignored), so the instructor can check each one at
// projector size (spec §6, §7.2) before running `npm run visual-check -- <ids>`. The app itself never draws a map before that check,
// so the page shows each map two ways: the whole card as it will look, a picture taken of a scratch copy of the app with the map
// flags forced on (e2e/mapBuild.ts, in memory, into a temporary directory) at the two lab screens, 1366 x 768 and 1920 x 1080; and
// the map alone as a vector drawing at the size the card gives it there, which can be zoomed. Nothing written here is shipped or
// committed, and no flag or visual_check entry is touched.
//   --out <dir>   write to <dir> instead of assets/preview (the tests use a temporary one)
//   --no-cards    skip the card pictures (no browser is started); the maps are then drawn at estimated card sizes
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { buildMapApp } from '../e2e/mapBuild';

// The built file sits in <repo>/.preview-maps/ (the source in <repo>/scripts/): the repo root is one folder up either way.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The two lab-standard screens (spec §5.4), at 100% display scale. */
const SCREENS = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }] as const;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** What the instructor should see on each map (spec §3.2, §3.3, §6). Plain words for the person checking; never shown to students. */
const SHOULD_SHOW: Readonly<Record<string, readonly string[]>> = {
  D1: [
    'One thick red arrow from "Steppe herders\' homeland" (north of the Black Sea) west through central Europe ("Corded Ware people"), to the mouth of the Rhine ("Bell Beaker people") and across to Britain (arrowhead near Wiltshire, labelled "Britain").',
    'One thin dashed arrow from Portugal to the Rhine mouth, labelled "Pot style probably spread from here, mostly as an idea". It must read as an idea, not as a movement of people.',
  ],
  E1: [
    'One broad arrow from north-east France to Kent, labelled "A few at a time over many generations"; "France" on France and "Kent: earliest newcomers found here" at its tip.',
    '"Scotland: almost no change" over Scotland, with no arrow near it.',
  ],
  G1: [
    'Four thick arrows across the North Sea: from northern Germany and from Jutland, Denmark, to East Anglia, Yorkshire and Kent; from the Netherlands to East Anglia. Labels: Northern Germany, Netherlands, Denmark, East Anglia, Yorkshire, Kent.',
    'One thin dashed arrow from Paris towards Kent, labelled "From France: a smaller share" (smaller than the others, and dashed).',
  ],
};

interface Options { ids: string[]; out: string; cards: boolean }

function parseArgs(argv: string[]): Options {
  const o: Options = { ids: [], out: resolve(ROOT, 'assets/preview'), cards: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--no-cards') o.cards = false;
    else if (a === '--out') {
      const dir = argv[++i];
      if (dir === undefined || dir.trim() === '') throw new Error('--out needs a folder');
      o.out = resolve(dir);
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else if (a.trim() !== '') o.ids.push(a);
  }
  return o;
}

/** The card as the students will see it at one screen: where the picture was saved and the size of the map's own box on it. */
interface CardShot { file: string; mapWidth: number; mapHeight: number; fit: string | null }

/** Pictures of the cards at the lab screens, from a scratch copy of the app with these maps drawn. Null (with the reason on stderr) when it cannot be done. */
async function takeCardPictures(ids: string[], out: string): Promise<Map<string, CardShot> | null> {
  const shots = new Map<string, CardShot>();
  let app: Awaited<ReturnType<typeof buildMapApp>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    app = await buildMapApp(ids as never);
    browser = await chromium.launch();
    mkdirSync(resolve(out, 'cards'), { recursive: true });
    for (const screen of SCREENS) {
      const context = await browser.newContext({ viewport: { width: screen.width, height: screen.height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await page.goto(`${app.url}?test&reset`);
      await page.waitForFunction(() => {
        const hook = (window as unknown as { __adw?: { isPrinting(): boolean } }).__adw;
        return hook !== undefined && !hook.isPrinting();
      });
      for (const id of ids) {
        await page.evaluate((cardId) => (window as unknown as { __adw: { openCard(id: string): void } }).__adw.openCard(cardId), id);
        await page.locator(`#card[data-card-id="${id}"]`).waitFor();
        // Two animation frames: layout and the card view's refit have run.
        await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
        const box = await page.locator('#card .card-map svg.map-svg').boundingBox();
        if (box === null) throw new Error(`${id} drew no map in the scratch build`);
        const file = `cards/${id}-${screen.width}x${screen.height}.png`;
        await page.locator('#card').screenshot({ path: resolve(out, file) });
        shots.set(`${id}@${screen.width}`, {
          file, mapWidth: Math.round(box.width), mapHeight: Math.round(box.height),
          fit: await page.locator('#card').getAttribute('data-fit'),
        });
        await page.locator('#card .card-continue').click();
      }
      await context.close();
    }
    return shots;
  } catch (err) {
    console.error(`preview-maps: could not take the card pictures (${(err as Error).message}). The maps are drawn at estimated sizes.`);
    return null;
  } finally {
    await browser?.close();
    app?.cleanup();
  }
}

async function main(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  // svgEl() and renderMap() create elements through the global document.
  Object.assign(globalThis, { document: dom.window.document, window: dom.window });
  const { DATA } = await import('../src/data');
  const { mapSpec, MAP_SPECS_BUILT } = await import('../src/maps');
  const { renderMap } = await import('../src/plots/map');
  const { CARDS } = await import('../src/cards');
  const { SVG_NS } = await import('../src/plots/svg');
  for (const id of options.ids) {
    if (!MAP_SPECS_BUILT.has(id as never)) throw new Error(`${id} is not a built map (built: ${[...MAP_SPECS_BUILT].join(', ')})`);
  }
  const ids = [...MAP_SPECS_BUILT].filter((id) => options.ids.length === 0 || options.ids.includes(id));
  const css = readFileSync(resolve(ROOT, 'src/style.css'), 'utf8');
  const plotsCss = readFileSync(resolve(ROOT, 'src/plots/plots.css'), 'utf8');
  const token = (name: string, fallback: string): string =>
    css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim() ?? fallback;
  // The map rules the card uses (labels, halo, land, overflow), without the card's own layout rules.
  const mapRules = plotsCss.slice(plotsCss.indexOf('.map-svg {'));

  mkdirSync(options.out, { recursive: true });
  const shots = options.cards ? await takeCardPictures(ids, options.out) : null;

  const sections: string[] = [];
  for (const id of ids) {
    const spec = mapSpec(id as never, DATA);
    const svg = dom.window.document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement;
    svg.setAttribute('class', 'map-svg');
    renderMap(svg, spec);
    const title = id in CARDS ? CARDS[id as keyof typeof CARDS].title : id;
    const aspect = spec.view !== undefined ? spec.view.width / spec.view.height : 1000 / 700;
    const expect = (SHOULD_SHOW[id] ?? []).map((line) => `<li>${escapeHtml(line)}</li>`).join('');
    const figures = SCREENS.map((screen) => {
      const shot = shots?.get(`${id}@${screen.width}`);
      // Without a measured card: the room a card has at best, its width less the card's padding, and the spec cap on the height.
      const width = shot?.mapWidth ?? Math.round(screen.width * 6 / 11 - 42);
      const height = shot?.mapHeight ?? Math.round(Math.min(width / aspect, 0.52 * screen.height, 460));
      const label = `${screen.width} x ${screen.height}`;
      const card = shot === undefined ? '' :
        `<figure><img class="card" src="${escapeHtml(shot.file)}" alt="The ${escapeHtml(id)} card at ${label}">` +
        `<figcaption>The whole card as the students see it at ${label} (picture size: its real size).</figcaption></figure>`;
      const alone = `<figure><div class="map" style="width:${width}px;height:${height}px">${svg.outerHTML}</div>` +
        `<figcaption>The map alone at ${label}: ${width} x ${height} px${shot === undefined ? ' (estimated)' : ''}. Zoom in to look closer.</figcaption></figure>`;
      return `<h3>At ${label}</h3>${card}${alone}`;
    });
    sections.push(`<section id="${escapeHtml(id)}"><h2>${escapeHtml(id)}: ${escapeHtml(title)}</h2><ul class="expect">${expect}</ul>${figures.join('')}</section>`);
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Map preview</title><style>
:root { --map-land: ${token('map-land', '#e4dfd3')}; --card-bg: ${token('card-bg', '#ffffff')}; }
body { margin: 24px; font-family: "Segoe UI", system-ui, sans-serif; background: #f2f2f2; color: #1a1a1a; }
section { background: var(--card-bg); padding: 16px; margin: 0 0 32px; }
h3 { margin: 20px 0 8px; }
.expect { margin: 0 0 12px; padding-left: 1.2em; }
figure { margin: 0 0 16px; }
figcaption { font-size: 0.85em; color: #4a5560; }
img.card { display: block; border: 1px solid #8a8a8a; }
.map { max-width: 100%; }
.map svg { display: block; width: 100%; height: 100%; background: var(--card-bg); }
${mapRules}
</style></head><body><h1>Map preview for the visual check (not shipped)</h1>
<p>Check each map: places in the right spots, every label readable at projector size, no dates or banned words, coastlines look right.
Open this page full screen on the projector if you can. Then, in your own terminal: <code>npm run visual-check -- ${escapeHtml(ids.join(' '))}</code></p>
${sections.join('\n')}</body></html>`;
  const page = resolve(options.out, 'maps.html');
  writeFileSync(page, html);
  console.log(`preview-maps: wrote ${page} (${ids.join(', ')}${shots === null ? '' : `; card pictures in ${resolve(options.out, 'cards')}`})`);
}

void main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`preview-maps: ${(err as Error).message}`);
  process.exit(1);
});
