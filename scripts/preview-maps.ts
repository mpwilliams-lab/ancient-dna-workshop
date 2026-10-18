// CLI: vite build --ssr scripts/preview-maps.ts --outDir .preview-maps --emptyOutDir && node .preview-maps/preview-maps.js [ids...] [--out <dir>] [--no-cards]
// (that is `npm run preview-maps`, optionally `npm run preview-maps -- G1`). Draws the built maps (src/maps.ts MAP_SPECS_BUILT, or
// only the ids given) from the real data into assets/preview/maps.html (git-ignored), so the instructor can check each one at
// projector size (spec §6, §7.2) before running `npm run visual-check -- <ids>`. The app itself never draws a map before that check,
// so the page shows each map two ways: the whole card as it will look, a picture taken of a scratch copy of the app with the map
// flags forced on (e2e/mapBuild.ts, in memory, into a temporary directory) at the two lab screens, 1366 x 768 and 1920 x 1080; and
// the map alone as a vector drawing at the size the card gives it there, which can be zoomed. Until the instructor confirms the eight
// A1 label names (open check 14: A1_CONFIRMED_LABELS in src/maps.ts is empty, so A1 ships unlabelled) the page also draws A1 with those
// names, marked as not shipped. The Roman slide's town inset (F1inset, Task 29) is a map of a card that is a picture card: its section
// shows the whole F1 slide (with grey stand-ins for its three photographs, which are checked on their own) and the inset alone, drawn
// the way the slide draws it (src/cardView.ts renderF1Inset), with its text key. Nothing written here is shipped or committed, and no
// flag or visual_check entry is touched.
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

/** What the instructor should see on each map (spec §3.1, §3.2, §3.3, §6). Plain words for the person checking; never shown to students. */
const SHOULD_SHOW: Readonly<Record<string, readonly string[]>> = {
  A1: [
    '26 pairs of dots, each pair joined by a thin grey line: a grey dot where a group of people lives today and a blue dot where their DNA places them. The words on the card explain the dots and the line but do not name the colours, so say aloud: grey = where the group lives, blue = where its DNA places it. The blue dots are the map of the DNA, turned and scaled to fit the real map as closely as possible.',
    'Grey dots in the right countries, from Norway in the north to Crete in the south and from Spain in the west to Russia in the east. Blue dots near them, in the same order: north groups at the top, south groups at the bottom (north and south agree well), east and west only roughly. Lines short and readable; the longest (Norway, North Spain, Iberia, Russia) are the groups furthest from where the DNA puts them.',
    'Nine groups are left off on purpose (isolated groups such as Basque, Saami and Sardinian people; the card says why). Nothing on the map names a group by an ID or a code.',
  ],
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
  F1inset: [
    'A map of Britain drawn small beside the three photographs on the Roman slide, as a fourth picture in their row: England and Wales, the south of Scotland, the coast of Ireland at the left edge and of France at the bottom right edge; the sea is blank. Is Britain easy to recognise at this size?',
    'Six filled dots, each a town or fort where newcomers were found: York and Catterick (northern England, close together), Colchester and Canterbury (the south-east), Winchester (the south) and Gloucester (the west). One hollow dot in Cambridgeshire (eastern England), the countryside. No dot is cut off by the edge or sits in the sea. No place is named on the map: the key does the explaining.',
    'Under the map a key of two lines, a filled dot "Newcomers found here" and a hollow dot "Countryside: mostly the same families". Are the dots and the two lines readable at projector size?',
    'While the inset shows, the slide\'s source line is "Map outline: Made with Natural Earth." (the slide has no other source line).',
  ],
};

type DistributionRow = { label: string; display: string; value: number; lat?: number; lon?: number };

/** The 1000 Genomes places by region, in the order the instructor looks for them, with how each is named in the instructions (the city the
 *  spec §6 table puts its dot in, where a country has more than one). */
const SITE_REGIONS: readonly (readonly [region: string, places: readonly (readonly [label: string, as: string])[]])[] = [
  ['Europe', [['Britain', 'Britain'], ['Finland', 'Finland'], ['Tuscany', 'Tuscany'], ['Spain', 'Spain']]],
  ['South Asia', [['Pakistan', 'Pakistan (Lahore)'], ['Bangladesh', 'Bangladesh (Dhaka)']]],
  ['East Asia', [['China', 'China (Beijing)'], ['Japan', 'Japan (Tokyo)']]],
  ['Africa', [['Nigeria', 'Nigeria (Ibadan)'], ['Kenya', 'Kenya (Webuye)']]],
];
const andList = (items: readonly string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
 * What the instructor should see on H2, I2, J3, K2 and L3 (Tasks 24 and 27, spec §3.4, §6), written from the real rows so the numbers here
 * are the ones the card prints. Plain words for the person checking; never shown to students. `source` is the card's source line as it
 * prints with its map (the spec's §3.4 line, with the Natural Earth line after it where the spec's K2 line has none: spec §6), `footnote`
 * H2's side note, and `radius` the drawn radius of a dot of this many copies in every 100 on this map's scale.
 */
function distributionShouldShow(
  id: 'H2' | 'I2' | 'J3' | 'K2' | 'L3', rows: readonly DistributionRow[], source: string, footnote: string, radius: (copies: number) => number,
): string[] {
  const placed = (r: DistributionRow): boolean => r.lat !== undefined && r.lon !== undefined;
  const dots = rows.filter(placed);
  const side = rows.filter((r) => !placed(r));
  const named = (list: readonly DistributionRow[]): string => list.map((r) => `${r.label} ${r.display}`).join(', ');
  const isZero = (r: DistributionRow): boolean => Number(r.display) === 0;
  const rings = dots.filter(isZero);
  const smallest = dots.filter((r) => !isZero(r)).at(-1);
  // How much wider than a ring the smallest filled dot is (4 against 3 on the 0-100 maps; 6 against 3 on K2's fixed 0-15 scale).
  const wider = smallest === undefined ? 1 : radius(smallest.value * 100) / 3;
  const filled = wider >= 1.8 ? 'about twice as wide as a ring' : 'a little bigger than a ring';
  const small = `A bigger number is a bigger and darker dot (the biggest is ${dots[0]!.label} ${dots[0]!.display}). `
    + (rings.length > 0
      ? `A small number never looks weaker than none: ${rings.map((r) => r.label).join(', ')} print ${rings[0]!.display} and are the small hollow rings, and `
        + (smallest === undefined ? '' : `every other number, even the smallest (${smallest.label} ${smallest.display}), is a filled dot ${filled}, in a blue that still shows on the land.`)
      : (smallest === undefined ? '' : `No number here is 0, so there are no hollow rings: even the smallest (${smallest.label} ${smallest.display}) is a filled dot, in a blue that still shows on the land.`));
  const where = SITE_REGIONS.map(([region, places]) => {
    const here = places.filter(([label]) => dots.some((r) => r.label === label)).map(([, as]) => as);
    return here.length === 0 ? '' : `${andList(here)} in ${region}`;
  }).filter((s) => s !== '').join('; ');
  const several = side.length > 1;
  const lines: string[] = [
    id === 'H2'
      ? `One dot for each of ${dots.length} countries, in its own country, each with its name and number as the card's value list has them (biggest first): ${named(dots)}.`
      : `One dot for each of ${dots.length} places where 1000 Genomes took its samples, each with its name and number: ${named(dots)}. ${where}. Each dot in its own country or city.`,
    small,
  ];
  if (id === 'K2') {
    lines.push(`The scale of this map is fixed at 0 to 15 copies in every 100 (spec §3.4, the same as the value bars it replaces). Even the biggest dot (${dots[0]!.label} ${dots[0]!.display}) is small next to that 15, so every dot is small${rings.length > 0 ? ' and the zeros are the smallest rings' : ''}: that is right, not a mistake. Numbers have one decimal. The card's own line says some numbers, including Britain's, come from only a handful of copies, so they are rough.`);
  }
  if (id === 'L3') {
    lines.push('This map shows Europe only, on its own western-Europe frame (longitude 12 west to 30 east, latitude 36 to 66 north); the card\'s second line says why (the marker\'s link to coeliac disease was measured in people of European ancestry). Look at the coastlines: Britain, the North Sea, Scandinavia, the Baltic, the Alps, Italy and Spain should all look right.');
  }
  lines.push(
    id === 'H2'
      ? `Under the map, as in the spec's side-list footnote: "${footnote}"`
      : `${named(side)}: no point for ${several ? 'them' : 'it'} (${several ? 'regions and whole samples' : 'a region'}, not ${several ? 'places' : 'a place'}), so ${several ? 'they are' : 'it is'} in a side list beside the map, as the spec says for places without coordinates. The value list the map replaces has all ${rows.length} rows.`,
  );
  if (id === 'K2' && side.some((r) => r.label === 'Finland')) lines.push('The side list\'s "Finland" is the gnomAD Finnish sample (the card\'s source line says so), not a 1000 Genomes dot.');
  if (id === 'I2') lines.push('The card\'s second line sends students to China and Japan ("look at their numbers"): both words must be easy to find and read.');
  lines.push(
    id === 'H2'
      ? 'Every word sits beside its own dot, is readable at projector size, and hides no other word and no dot. Where dots crowd (north-west Europe: Ireland, the United Kingdom, the Netherlands, Germany, Poland) check that each number is clearly its own dot\'s. A word may hang over the edge of the map\'s frame (Ireland and Portugal on the west, Russia on the east): that is where the room is. The picture is a window cut to the dots, so it leaves out the empty Arctic and the south of the frame.'
      : id === 'L3'
        ? 'Every word sits beside its own dot, is readable at projector size, and hides no other word and no dot. The picture is a window of the frame cut to the dots, tall and narrow, so its edges are not the frame\'s: it starts just west of Britain and Spain (Ireland and Portugal are left out) and ends just east of the Finland dot. Every word is inside the frame; Finland\'s sits to the left of its dot.'
        : 'Every word sits beside its own dot, is readable at projector size, and hides no other word and no dot. The picture is a window cut to the dots: it leaves out the empty north and south of the frame and some of its west, so the picture\'s left edge is not the frame\'s.',
  );
  if (id === 'I2' || id === 'J3' || id === 'K2') lines.push('The east edge of the frame cuts Hokkaido (the frame ends at 145 degrees east): that is the frame, not a missing piece.');
  lines.push(
    `Source line (spec §3.4, as the card prints it): ${source}`,
    'Nothing on this map gives the puzzle away: it holds place names and numbers only (no dates, no "selection", no "spread"). The card is a "before" card: students see it before the plot.',
  );
  return lines;
}

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

/** The card as the students will see it at one screen: where the picture was saved and the size of the map's own box on it. `shown` is false
 *  when the map is not on the card at this screen: the F1 inset is an optional tile, and the card drops it (and its photographs) when it
 *  has no room (the `compact` fit level), in which case the box is 0 x 0. */
interface CardShot { file: string; mapWidth: number; mapHeight: number; fit: string | null; shown: boolean }
/** The Roman plot with the York traveller at one screen: where the picture of the plot pane was saved and the size of the plot itself. */
interface PlotShot { file: string; width: number; height: number }
interface Pictures { cards: Map<string, CardShot>; york: Map<number, PlotShot> }

/** The card a map is shown on: its own id, or F1 for the Roman inset (a map that has no card of its own). */
const cardIdOf = (mapId: string): string => (mapId === 'F1inset' ? 'F1' : mapId);

/** The two commands that put the Roman plot on screen the way a class gets there: the Iron Age first, then the Roman period (off the guided script, so no card opens). */
const ROMAN_COMMANDS = ['run_pca(period = "IronAge")', 'run_pca(period = "Roman")'] as const;

/** Pictures of the cards at the lab screens (and, with `york`, of the Roman plot), from a scratch copy of the app with these maps drawn
 *  (the F1 inset beside F1's three photographs, drawn as stand-ins) and the York traveller on. Null (with the reason on stderr) when it
 *  cannot be done. */
async function takeCardPictures(ids: string[], out: string, york: boolean): Promise<Pictures | null> {
  const pictures: Pictures = { cards: new Map(), york: new Map() };
  let app: Awaited<ReturnType<typeof buildMapApp>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    app = await buildMapApp(ids as never, { flags: ['yorkTraveller'], images: ids.includes('F1inset') ? ['F1'] : [] });
    browser = await chromium.launch();
    mkdirSync(resolve(out, 'cards'), { recursive: true });
    if (york) mkdirSync(resolve(out, 'plots'), { recursive: true });
    for (const screen of SCREENS) {
      const context = await browser.newContext({ viewport: { width: screen.width, height: screen.height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await page.goto(`${app.url}?test&reset`);
      const idle = (): Promise<unknown> => page.waitForFunction(() => {
        const hook = (window as unknown as { __adw?: { isPrinting(): boolean } }).__adw;
        return hook !== undefined && !hook.isPrinting();
      });
      await idle();
      if (york) {
        const prompt = page.locator('#terminal').locator('input, textarea').first();
        for (const command of ROMAN_COMMANDS) {
          await prompt.click();
          await prompt.pressSequentially(command);
          await prompt.press('Enter');
          await idle();
        }
        // The 0.5 s change from the Europe frame to the British one must be over before the plot is photographed.
        await page.waitForFunction(() => (document.querySelector('#plot')?.getAnimations({ subtree: true }) ?? []).every((a) => a.playState !== 'running'), null, { polling: 50 });
        const box = await page.locator('#plot svg.plot-svg').boundingBox();
        if (box === null || (await page.locator('#plot g.york-traveller').count()) !== 1) throw new Error('the Roman plot drew no York traveller in the scratch build');
        const file = `plots/york-${screen.width}x${screen.height}.png`;
        await page.locator('#plot').screenshot({ path: resolve(out, file) });
        pictures.york.set(screen.width, { file, width: Math.round(box.width), height: Math.round(box.height) });
      }
      for (const id of ids) {
        const cardId = cardIdOf(id);
        await page.evaluate((c) => (window as unknown as { __adw: { openCard(id: string): void } }).__adw.openCard(c), cardId);
        await page.locator(`#card[data-card-id="${cardId}"]`).waitFor();
        // Two animation frames: layout and the card view's refit have run.
        await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
        const mine = page.locator(id === 'F1inset' ? '#card .card-inset svg.inset-svg' : '#card .card-map svg.map-svg');
        // Only the inset can be absent from its card at a screen (hidden by the compact fit level): every other map is there or the build is wrong.
        const box = (await mine.count()) > 0 ? await mine.boundingBox({ timeout: 5_000 }) : null;
        if (box === null && id !== 'F1inset') throw new Error(`${id} drew no map in the scratch build`);
        if (id === 'F1inset' && (await mine.count()) === 0) throw new Error('F1inset is not in the card of the scratch build');
        const file = `cards/${id}-${screen.width}x${screen.height}.png`;
        await page.locator('#card').screenshot({ path: resolve(out, file) });
        pictures.cards.set(`${id}@${screen.width}`, {
          file, mapWidth: Math.round(box?.width ?? 0), mapHeight: Math.round(box?.height ?? 0), shown: box !== null,
          fit: await page.locator('#card').getAttribute('data-fit'),
        });
        await page.locator('#card .card-continue').click();
      }
      await context.close();
    }
    return pictures;
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
  const { A1_CONFIRMED_LABELS, DISTRIBUTION_MAP_GENE, mapSpec, MAP_SPECS_BUILT, specA1 } = await import('../src/maps');
  const { dotRadius, renderMap } = await import('../src/plots/map');
  const { CARDS, DISTRIBUTION_SCALE_MAX, distributionRows } = await import('../src/cards');
  const { sourceWithMapSuffix, renderF1Inset } = await import('../src/cardView');
  const { IRELAND_FOOTNOTE, YORK_TRAVELLER_LABEL } = await import('../src/content');
  const { ALL_OFF, withFeatures } = await import('../src/features');
  const { INITIAL_PLOT, reducePlot } = await import('../src/plotState');
  const { renderPca } = await import('../src/plots/pca');
  const { SVG_NS } = await import('../src/plots/svg');
  for (const id of options.ids) {
    if (!MAP_SPECS_BUILT.has(id as never)) throw new Error(`${id} is not a built map (built: ${[...MAP_SPECS_BUILT].join(', ')})`);
  }
  const ids = [...MAP_SPECS_BUILT].filter((id) => options.ids.length === 0 || options.ids.includes(id));
  // The York traveller is a point on the Roman plot, not a map and not an image, so it has no id and no visual check; its section is on
  // the whole page (no ids given) after the maps.
  const showYork = options.ids.length === 0;
  const css = readFileSync(resolve(ROOT, 'src/style.css'), 'utf8');
  const plotsCss = readFileSync(resolve(ROOT, 'src/plots/plots.css'), 'utf8');
  const token = (name: string, fallback: string): string =>
    css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim() ?? fallback;
  // The map rules the card uses (labels, halo, land, overflow), without the card's own layout rules.
  const mapRules = plotsCss.slice(plotsCss.indexOf('.map-svg {'));

  mkdirSync(options.out, { recursive: true });
  const pictures = options.cards ? await takeCardPictures(ids, options.out, showYork) : null;

  const drawn = (spec: ReturnType<typeof mapSpec>): SVGSVGElement => {
    const svg = dom.window.document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement;
    svg.setAttribute('class', 'map-svg');
    renderMap(svg, spec);
    return svg;
  };
  // Open check 14: until the instructor confirms the eight A1 names (A1_CONFIRMED_LABELS in src/maps.ts) the map ships unlabelled and
  // the preview also draws it with the data build's eight names, so he can decide. Once the list is filled, the shipped map has them.
  const candidates = A1_CONFIRMED_LABELS.length > 0 ? [] :
    (DATA.europe_pops ?? []).filter((p) => !p.isolate && p.map_label).map((p) => p.label);
  /** What to look for in A1's labels: the question depends on whether the names are confirmed yet. */
  const a1LabelLine = candidates.length > 0
    ? 'Labels: until you confirm open check 14 the map ships WITHOUT labels. Below the card pictures you will see the map alone twice: as it ships (no labels) and with the eight groups named, so you can decide. Are the eight names right, and readable at projector size?'
    : `Labels: the eight confirmed names are on the map (${A1_CONFIRMED_LABELS.join(', ')}). Are they readable at projector size, and clear of the dots?`;

  /**
   * The F1 inset's section (Task 29). The inset is not drawn like the other maps (it is a tile of the Roman slide, cropped to Britain, with a
   * text key), so it is drawn by the slide's own renderer. Each lab screen gets the whole slide, from the scratch build, and the inset alone;
   * where the slide has no room for the inset at a screen (a card at `compact` hides it, with the pictures), the caption says so.
   */
  const insetSection = (): string => {
    const expect = (SHOULD_SHOW.F1inset ?? []).map((line) => `<li>${escapeHtml(line)}</li>`).join('');
    const figures = SCREENS.map((screen) => {
      const label = `${screen.width} x ${screen.height}`;
      const shot = pictures?.cards.get(`F1inset@${screen.width}`);
      // Where the slide has room, the inset is as tall as a picture may be (the spec's min(26vh, 230px)); without a measured slide, that.
      const height = shot !== undefined && shot.shown ? shot.mapHeight : Math.round(Math.min(0.26 * screen.height, 230));
      const verdict = shot === undefined ? '' : shot.shown
        ? ` The slide keeps its "${shot.fit}" form with the inset on.`
        : ` The slide has no room for the inset beside its three pictures at this screen: it drops to its "${shot.fit}" form, which hides the pictures and the inset. That is why the inset stays off unless the lab screen is bigger.`;
      const card = shot === undefined ? '' :
        `<figure><img class="card" src="${escapeHtml(shot.file)}" alt="The Roman slide (F1) at ${label}">` +
        `<figcaption>The whole Roman slide as the students would see it at ${label} with the inset on; its three pictures are grey stand-ins (the real photographs are checked on their own).${escapeHtml(verdict)}</figcaption></figure>`;
      const alone = `<figure><div class="inset-alone" style="--inset-h:${height}px">${renderF1Inset(dom.window.document as unknown as Document, DATA).outerHTML}</div>` +
        `<figcaption>The inset alone at ${label}: ${height} px tall${shot !== undefined && shot.shown ? '' : ' (the most the slide gives it, estimated)'}. Zoom in to look closer.</figcaption></figure>`;
      return `<h3>At ${label}</h3>${card}${alone}`;
    });
    return `<section id="F1inset"><h2>F1inset: ${escapeHtml(CARDS.F1.title)} (the town inset on the Roman slide)</h2><ul class="expect">${expect}</ul>${figures.join('')}</section>`;
  };

  /**
   * The York traveller's section (Task 29): the Roman plot with his mark, as a drawing (always) and, with card pictures, as the plot pane
   * looks in the scratch build at each lab screen. He is a point on a plot, so there is no `visual-check` for him: the instructor says whether
   * the mark and its words read well, and the flag is switched on or not on his word.
   */
  const yorkSection = (): string => {
    const state = reducePlot(reducePlot(INITIAL_PLOT, { kind: 'pca', period: 'IronAge' }, DATA), { kind: 'pca', period: 'Roman' }, DATA);
    const plot = dom.window.document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement;
    renderPca(plot, DATA, state, { animate: false, features: withFeatures({ yorkTraveller: true }, ALL_OFF) });
    plot.setAttribute('class', 'plot-svg');
    const expect = [
      'The Roman plot, as the Roman step draws it (the zoomed British view: the Iron Age cloud, the Roman people, the zoom note under it), with one extra mark: a hollow orange square (the Roman colour and shape) at the bottom right corner of the plot, with a small orange arrow just below it pointing down and a little to the right, off the plot.',
      `Its words, to the left of the square and above it, in three lines with a white outline: "${YORK_TRAVELLER_LABEL}" (Martiniano et al. 2016, which the Roman slide cites). Do they read well at projector size, over the dots behind them?`,
      'He is not one of the 17 Roman-group people: the Roman layer, its count and the legend are the same with or without the mark. The mark appears only on the Roman plot, never on another period or on the Europe view. Hovering over the square, or tapping it, shows the same sentence at the top of the plot.',
      'No sample number, group code or site name is written anywhere in the mark. There is no visual-check command for a point on a plot: if it reads well, tell me and I switch it on (the flag yorkTraveller).',
    ].map((line) => `<li>${escapeHtml(line)}</li>`).join('');
    const figures = SCREENS.map((screen) => {
      const label = `${screen.width} x ${screen.height}`;
      const shot = pictures?.york.get(screen.width);
      // The plot is drawn as wide as its pane at each lab screen (measured in the browser; e2e/layout.spec.ts pins them).
      const width = shot?.width ?? (screen.width === 1366 ? 745 : 1047);
      const pane = shot === undefined ? '' :
        `<figure><img class="card" src="${escapeHtml(shot.file)}" alt="The Roman plot with the York traveller at ${label}">` +
        `<figcaption>The plot pane as the students would see it at ${label} (picture size: its real size).</figcaption></figure>`;
      const alone = `<figure><div class="plot-alone" style="width:${width}px">${plot.outerHTML}</div>` +
        `<figcaption>The Roman plot alone at ${label}: ${width} px wide${shot === undefined ? ' (estimated)' : ''}. Zoom in to look closer.</figcaption></figure>`;
      return `<h3>At ${label}</h3>${pane}${alone}`;
    });
    return `<section id="york-traveller"><h2>York traveller: a point on the Roman plot, off the zoomed map (no visual check)</h2><ul class="expect">${expect}</ul>${figures.join('')}</section>`;
  };

  const sections: string[] = [];
  for (const id of ids) {
    if (id === 'F1inset') {
      sections.push(insetSection());
      continue;
    }
    const spec = mapSpec(id as never, DATA);
    const svg = drawn(spec);
    const named = id === 'A1' && candidates.length > 0 ? drawn(specA1(DATA, candidates)) : null;
    const title = id in CARDS ? CARDS[id as keyof typeof CARDS].title : id;
    const aspect = spec.view !== undefined ? spec.view.width / spec.view.height : 1000 / 700;
    // The distribution maps' lines are written from the real rows (Tasks 24 and 27); the others' are fixed words above. The source line is
    // the card's as it prints with its map: K2's spec line has no Natural Earth line and gets it (sourceWithMapSuffix, spec §6).
    const distribution = id === 'H2' || id === 'I2' || id === 'J3' || id === 'K2' || id === 'L3'
      ? distributionShouldShow(
        id, distributionRows(DATA, DISTRIBUTION_MAP_GENE[id]), sourceWithMapSuffix(CARDS[id].source, true) ?? '', IRELAND_FOOTNOTE,
        (copies) => dotRadius(copies, DISTRIBUTION_SCALE_MAX[DISTRIBUTION_MAP_GENE[id]]),
      ) : [];
    // On the card the rows without coordinates sit in a side list beside the picture, which this picture of the svg alone does not draw.
    const sideNote = (spec.sideList ?? []).length > 0
      ? ` On the card the side list sits beside it: ${(spec.sideList ?? []).map((r) => `${r.label} ${r.display}`).join(', ')}.` : '';
    const expect = [...(SHOULD_SHOW[id] ?? []), ...distribution, ...(id === 'A1' ? [a1LabelLine] : [])].map((line) => `<li>${escapeHtml(line)}</li>`).join('');
    const figures = SCREENS.map((screen) => {
      const shot = pictures?.cards.get(`${id}@${screen.width}`);
      // Without a measured card: the room a card has at best, its width less the card's padding, and the spec cap on the height.
      const width = shot?.mapWidth ?? Math.round(screen.width * 6 / 11 - 42);
      const height = shot?.mapHeight ?? Math.round(Math.min(width / aspect, 0.52 * screen.height, 460));
      const label = `${screen.width} x ${screen.height}`;
      const card = shot === undefined ? '' :
        `<figure><img class="card" src="${escapeHtml(shot.file)}" alt="The ${escapeHtml(id)} card at ${label}">` +
        `<figcaption>The whole card as the students see it at ${label} (picture size: its real size).</figcaption></figure>`;
      const alone = `<figure><div class="map" style="width:${width}px;height:${height}px">${svg.outerHTML}</div>` +
        `<figcaption>The map alone at ${label}: ${width} x ${height} px${shot === undefined ? ' (estimated)' : ''}${named === null ? '' : ', as it ships: no labels'}. Zoom in to look closer.${escapeHtml(sideNote)}</figcaption></figure>`;
      const withNames = named === null ? '' :
        `<figure><div class="map" style="width:${width}px;height:${height}px">${named.outerHTML}</div>` +
        `<figcaption>The same map with its ${candidates.length} groups named (${escapeHtml(candidates.join(', '))}): how it will look if you confirm the names (open check 14). The app does not show these labels until you do.</figcaption></figure>`;
      return `<h3>At ${label}</h3>${card}${alone}${withNames}`;
    });
    sections.push(`<section id="${escapeHtml(id)}"><h2>${escapeHtml(id)}: ${escapeHtml(title)}</h2><ul class="expect">${expect}</ul>${figures.join('')}</section>`);
  }
  if (showYork) sections.push(yorkSection());
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Map preview</title><style>
:root { --map-land: ${token('map-land', '#e4dfd3')}; --card-bg: ${token('card-bg', '#ffffff')}; --card-muted: ${token('card-muted', '#4a5560')}; }
body { margin: 24px; font-family: "Segoe UI", system-ui, sans-serif; background: #f2f2f2; color: #1a1a1a; }
section { background: var(--card-bg); padding: 16px; margin: 0 0 32px; }
h3 { margin: 20px 0 8px; }
.expect { margin: 0 0 12px; padding-left: 1.2em; }
figure { margin: 0 0 16px; }
figcaption { font-size: 0.85em; color: #4a5560; }
img.card { display: block; border: 1px solid #8a8a8a; }
.map { max-width: 100%; }
.map svg { display: block; width: 100%; height: 100%; background: var(--card-bg); }
.inset-alone .card-inset { margin: 0; width: max-content; max-width: 100%; }
.inset-alone .inset-svg { display: block; height: var(--inset-h); width: auto; background: var(--card-bg); }
.inset-alone .inset-key { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; font-size: 16.2px; line-height: 1.3; color: var(--card-muted); }
.inset-alone .inset-key-item { display: inline-flex; align-items: flex-start; gap: 6px; }
.inset-alone .inset-swatch { width: 0.8em; height: 0.8em; flex: none; margin-top: 0.25em; }
.plot-alone { max-width: 100%; border: 1px solid #8a8a8a; background: #ffffff; }
.plot-alone svg { display: block; width: 100%; height: auto; font-family: "Segoe UI", system-ui, -apple-system, Arial, sans-serif; }
${mapRules}
</style></head><body><h1>Map preview for the visual check (not shipped)</h1>
<p>Check each map: places in the right spots, every label readable at projector size, no dates or banned words, coastlines look right.
Open this page full screen on the projector if you can. Then, in your own terminal: <code>npm run visual-check -- ${escapeHtml(ids.join(' '))}</code>${showYork ? ' The last section, the York traveller, is a point on a plot: it has no visual-check command.' : ''}</p>
${sections.join('\n')}</body></html>`;
  const page = resolve(options.out, 'maps.html');
  writeFileSync(page, html);
  console.log(`preview-maps: wrote ${page} (${ids.join(', ')}${showYork ? ', york-traveller' : ''}${pictures === null ? '' : `; pictures in ${resolve(options.out, 'cards')}${showYork ? ` and ${resolve(options.out, 'plots')}` : ''}`})`);
}

void main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`preview-maps: ${(err as Error).message}`);
  process.exit(1);
});
