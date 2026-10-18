// The instructor's preview of the maps (Task 20, spec §6, §7.2): `npm run preview-maps` writes a page that shows every built map from
// the real data, so the instructor can check each one before running `npm run visual-check -- <ids>`. It is a tool for one person
// at one desk: never shipped, never a way to check a map for him. These tests run the real npm script with --no-cards (no browser)
// into a temporary folder.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CARDS } from '../src/cards';
import { MAP_TEXT, YORK_TRAVELLER_LABEL } from '../src/content';
import { A1_CONFIRMED_LABELS, MAP_SPECS_BUILT } from '../src/maps';

// Every test here runs `npm run preview-maps`: a Vite build and a Node run, about 3 s alone and 5 s or more when the whole suite runs in
// parallel, which is over vitest's default 5 s (the first test, which draws every built map, timed out at 5.27 s once Task 27 added two
// maps to it). The script itself is given 120 s below.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, '..');
const MANIFEST = resolve(ROOT, 'assets/manifest.json');
const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function preview(...args: string[]): { status: number | null; stdout: string; stderr: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'adw-preview-'));
  made.push(dir);
  const r = spawnSync('npm', ['run', 'preview-maps', '--', ...args, '--out', dir, '--no-cards'], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, dir };
}

describe('npm run preview-maps', () => {
  const unescape = (s: string): string => s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

  it('writes one page with every built map: its card title, its labels, and the visual-check command for exactly those maps', () => {
    const before = sha(MANIFEST);
    const r = preview();
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(r.dir)).toEqual(['maps.html']);
    const html = readFileSync(join(r.dir, 'maps.html'), 'utf8');
    const text = unescape(html);
    const ids = [...MAP_SPECS_BUILT];
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (const id of ids) {
      // The F1 inset (Task 29) is a tile of the Roman slide, so its section is titled by that card, and its two labels are the text key
      // under the map, not map text.
      const inset = id === 'F1inset';
      expect(html, id).toContain(`<section id="${id}">`);
      expect(text, id).toContain(CARDS[inset ? 'F1' : (id as keyof typeof CARDS)].title);
      // Each other map is drawn by renderMap, whose text elements carry the approved labels.
      for (const label of MAP_TEXT[id]) expect(text, `${id} "${label}"`).toContain(inset ? `${label}</span>` : `>${label}</text>`);
      // Once per lab screen; A1 twice per screen while its names are unconfirmed (as it ships, and with the eight names: see below); the
      // inset's figure and its svg both carry its id, so it counts twice per screen.
      const drawn = id === 'A1' && A1_CONFIRMED_LABELS.length === 0 ? 4 : inset ? 4 : 2;
      expect(html.match(new RegExp(`data-map="${id}"`, 'g')), `${id} drawn ${drawn} times`).toHaveLength(drawn);
    }
    // The main batch of the visual check leaves the F1 inset out: it stays off for the event (the smaller lab screen has no room for it), so it
    // has a batch of its own, which the page words as for a bigger screen or for after the event (docs/instructor-photo-map-check.md, batch 6).
    const batch = ids.filter((id) => id !== 'F1inset');
    expect(ids).toContain('F1inset');
    expect(text).toContain(`npm run visual-check -- ${batch.join(' ')}</code>`);
    expect(text).not.toContain(`npm run visual-check -- ${ids.join(' ')}`);
    expect(text.match(/npm run visual-check -- [^<]*F1inset/g)).toEqual(['npm run visual-check -- F1inset']);
    expect(text).toContain('only if the lab screen is 1600 x 900 or bigger, or after the event');
    // The whole page ends with the York traveller, a point on a plot (no visual check, so not in the command above).
    expect(html).toContain('<section id="york-traveller">');
    expect(html.indexOf('<section id="york-traveller">')).toBeGreaterThan(html.lastIndexOf(`<section id="${ids.at(-1)}">`));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
    // The instructor alone records a check: the preview never touches the manifest.
    expect(sha(MANIFEST)).toBe(before);
  });

  it('draws only the maps named, each at both lab screens', () => {
    const r = preview('G1');
    expect(r.status, r.stderr).toBe(0);
    const html = readFileSync(join(r.dir, 'maps.html'), 'utf8');
    expect(html).toContain('<section id="G1">');
    for (const other of ['A1', 'D1', 'E1']) expect(html).not.toContain(`<section id="${other}">`);
    expect(unescape(html)).toContain('npm run visual-check -- G1</code>');
    expect(html, 'a page of named maps says nothing of the inset').not.toContain('F1inset');
    expect(html).toContain('At 1366 x 768');
    expect(html).toContain('At 1920 x 1080');
  });

  // Open check 14: until the instructor confirms the eight A1 names the map ships unlabelled, and the preview shows it both ways so he can
  // decide. Once the names are in A1_CONFIRMED_LABELS the shipped map has them and the second drawing would only repeat it.
  it('A1: what to look for, the map as it ships, and (until the names are confirmed) the same map with the eight groups named', () => {
    const r = preview('A1');
    expect(r.status, r.stderr).toBe(0);
    const text = unescape(readFileSync(join(r.dir, 'maps.html'), 'utf8'));
    const eight = ['Estonian', 'Lithuanian', 'Czech', 'Hungarian', 'Romanian', 'Serbian', 'South Italian', 'Sicilian'];
    expect(text).toContain('<section id="A1">');
    expect(text).toContain('26 pairs of dots');
    // The card's words never name the two colours (tests/runsheet-content.test.ts pins that), so the page tells him to say them aloud, as the
    // run sheet's Europe step does, and no longer says the card does.
    expect(text).toContain('say aloud: grey = where the group lives, blue = where its DNA places it');
    expect(text).not.toContain('the card says so');
    expect(text).toContain(`npm run visual-check -- A1</code>`);
    // Eight labels in each of the two lab-screen drawings that carry them, none in the unlabelled ones.
    expect(text.match(/class="map-label"/g) ?? []).toHaveLength(16);
    for (const name of eight) expect(text.match(new RegExp(`>${name}</text>`, 'g')), name).toHaveLength(2);
    if (A1_CONFIRMED_LABELS.length === 0) {
      expect(text).toContain('Labels: until you confirm open check 14 the map ships WITHOUT labels');
      expect(text).toContain('as it ships: no labels');
      expect(text).toContain(`groups named (${eight.join(', ')})`);
      expect(text).toContain('The app does not show these labels until you do');
    } else {
      // Confirmed: the shipped map has the names, the question is whether they read well, and nothing is shown that is not shipped.
      expect(text).toContain(`Labels: the eight confirmed names are on the map (${A1_CONFIRMED_LABELS.join(', ')})`);
      for (const stale of ['groups named', 'as it ships: no labels', 'until you confirm', 'does not show these labels']) expect(text, stale).not.toContain(stale);
    }
    expect(text).not.toMatch(/<script/i);
  });

  // Task 24: the distribution maps' what-to-look-for lines are written from the real rows, so they cannot go stale when the data does.
  it('H2, I2, J3: what to look for from the real rows, the Ireland footnote, the side list, the card\'s own source line, and the map drawn with its words', () => {
    const before = sha(MANIFEST);
    const r = preview('H2', 'I2', 'J3');
    expect(r.status, r.stderr).toBe(0);
    const html = readFileSync(join(r.dir, 'maps.html'), 'utf8');
    const text = unescape(html);
    for (const id of ['H2', 'I2', 'J3']) expect(text).toContain(`<section id="${id}">`);
    expect(text).toContain('npm run visual-check -- H2 I2 J3</code>');
    // H2: twenty countries with the card's numbers, the footnote under the map, no side list.
    expect(text).toContain('One dot for each of 20 countries');
    expect(text).toContain('Ireland 96, Norway 84, United Kingdom 75, Sweden 73, Netherlands 68');
    expect(text).toContain('Under the map, as in the spec\'s side-list footnote: "Ireland: small sample."');
    expect(text).toContain('>United Kingdom 75</text>');
    // I2 and J3: ten places, the Middle East in a side list, the hollow rings named.
    expect(text).toContain('One dot for each of 10 places where 1000 Genomes took its samples');
    expect(text).toContain('Britain 98, Tuscany 97, Finland 96, Spain 82, Pakistan 6, Bangladesh 4, China 1, Kenya 1, Japan 0, Nigeria 0');
    expect(text).toContain('Finland 91, Britain 82, Tuscany 42, Spain 32, Pakistan 10, Bangladesh 10, China 0, Japan 0, Nigeria 0, Kenya 0');
    expect(text).toContain('Japan, Nigeria print 0 and are the small hollow rings');
    expect(text).toContain('China, Japan, Nigeria, Kenya print 0 and are the small hollow rings');
    expect(text).toContain('Middle East 47: no point for it');
    expect(text).toContain('Middle East 21: no point for it');
    expect(text).toContain('On the card the side list sits beside it: Middle East 47.');
    expect(text).toContain('>Britain 98</text>');
    // The cards' source lines, verbatim from spec §3.4.
    expect(text).toContain('Source line (spec §3.4, as the card prints it): Data: Liebert et al. 2017 (CC BY 4.0). Map outline: Made with Natural Earth.');
    expect(text.match(/Source line \(spec §3\.4, as the card prints it\): Data: 1000 Genomes Project; gnomAD\. Map outline: Made with Natural Earth\./g)).toHaveLength(2);
    expect(text).toContain('Nothing on this map gives the puzzle away');
    expect(html).not.toMatch(/<script/i);
    expect(sha(MANIFEST)).toBe(before);
  });

  // Task 27: K2 (TYK2, Old World frame, one decimal, fixed 0-15 scale) and L3 (HLA-DQ2, Europe only, Europe-west frame), written from the real rows.
  it('K2, L3: what to look for from the real rows, the one decimal and the fixed scale, the side lists, the source line as the card prints it with its map, and the maps drawn with their words', () => {
    const before = sha(MANIFEST);
    const r = preview('K2', 'L3');
    expect(r.status, r.stderr).toBe(0);
    const html = readFileSync(join(r.dir, 'maps.html'), 'utf8');
    const text = unescape(html);
    for (const id of ['K2', 'L3']) expect(text).toContain(`<section id="${id}">`);
    expect(text).toContain('npm run visual-check -- K2 L3</code>');
    // K2: seven 1000 Genomes places with one decimal, the four zeros as rings, the three gnomAD rows in the side list, the fixed scale.
    expect(text).toContain('One dot for each of 7 places where 1000 Genomes took its samples');
    expect(text).toContain('Spain 3.3, Tuscany 2.8, Britain 2.7, China 0.0, Japan 0.0, Nigeria 0.0, Kenya 0.0');
    expect(text).toContain('Britain, Tuscany and Spain in Europe; China (Beijing) and Japan (Tokyo) in East Asia; Nigeria (Ibadan) and Kenya (Webuye) in Africa.');
    expect(text).toContain('China, Japan, Nigeria, Kenya print 0.0 and are the small hollow rings');
    expect(text).toContain('even the smallest (Britain 2.7), is a filled dot about twice as wide as a ring');
    expect(text).toContain('The scale of this map is fixed at 0 to 15 copies in every 100');
    expect(text).toContain('Europe (large sample) 4.4, Middle East 3.1, Finland 2.9: no point for them');
    expect(text).toContain('On the card the side list sits beside it: Europe (large sample) 4.4, Middle East 3.1, Finland 2.9.');
    expect(text).toContain('The side list\'s "Finland" is the gnomAD Finnish sample');
    expect(text).toContain('>Spain 3.3</text>');
    expect(text).toContain('>Britain 2.7</text>');
    // Spec §3.4's K2 line has no Natural Earth line; the card adds it when its map is drawn (§6), and the page says the line as printed.
    expect(text).toContain('Source line (spec §3.4, as the card prints it): Data: gnomAD; 1000 Genomes Project. Europe (large sample) = gnomAD non-Finnish Europeans; Finland = gnomAD Finnish. Map outline: Made with Natural Earth.');
    // L3: four places, whole numbers, Europe only on its own frame, one row in the side list.
    expect(text).toContain('One dot for each of 4 places where 1000 Genomes took its samples');
    expect(text).toContain('Spain 25, Tuscany 21, Britain 16, Finland 9');
    expect(text).toContain('Britain, Finland, Tuscany and Spain in Europe. Each dot in its own country or city.');
    expect(text).toContain('No number here is 0, so there are no hollow rings: even the smallest (Finland 9) is a filled dot');
    expect(text).toContain('This map shows Europe only, on its own western-Europe frame');
    // No word hangs over the frame (the Finland word used to): the page tells him so, and no longer says it hangs.
    expect(text).toContain('Every word is inside the frame; Finland\'s sits to the left of its dot.');
    expect(text).not.toContain('hangs over the frame');
    expect(text).toContain('Europe (large sample) 22: no point for it');
    expect(text).toContain('On the card the side list sits beside it: Europe (large sample) 22.');
    expect(text).toContain('>Spain 25</text>');
    expect(text).toContain('Source line (spec §3.4, as the card prints it): Data: 1000 Genomes Project; gnomAD. Europe (large sample) = gnomAD non-Finnish Europeans. Map outline: Made with Natural Earth.');
    // Both are "before" cards: nothing on the page may say what the plot shows. (The words of the instructions below the maps, not the maps.)
    for (const id of ['K2', 'L3']) {
      const section = text.slice(text.indexOf(`<section id="${id}">`), text.indexOf('</section>', text.indexOf(`<section id="${id}">`)));
      expect(section, id).toContain('Nothing on this map gives the puzzle away');
      expect(section, `${id}: the map's own words`).not.toMatch(/>[^<]*(selection|advantage|spread|rose|once more common)[^<]*<\/text>/i);
    }
    // Each is drawn once per lab screen, on its own frame (the Europe-west outline is the one L3 draws).
    expect(html.match(/data-map="K2"/g)).toHaveLength(2);
    expect(html.match(/data-map="L3"/g)).toHaveLength(2);
    expect(html.match(/data-frame="europeWest"/g)).toHaveLength(2);
    expect(html.match(/data-frame="oldWorld"/g)).toHaveLength(2);
    expect(html).not.toMatch(/<script/i);
    expect(sha(MANIFEST)).toBe(before);
  });

  // Task 29: the Roman slide's town inset. It is a tile of the slide, cropped to Britain, with a text key, so it is drawn by the slide's own
  // renderer (not renderMap) and each lab screen gets the inset alone; the card pictures need a browser and are not taken here (--no-cards).
  it('F1inset: what to look for, the inset drawn as the slide draws it (six filled dots, one hollow, the two-line key, no place name), and the command for it alone', () => {
    const before = sha(MANIFEST);
    const r = preview('F1inset');
    expect(r.status, r.stderr).toBe(0);
    const html = readFileSync(join(r.dir, 'maps.html'), 'utf8');
    const text = unescape(html);
    expect(text).toContain('<section id="F1inset">');
    expect(text).toContain(`F1inset: ${CARDS.F1.title} (the town inset on the Roman slide)`);
    expect(text).toContain('npm run visual-check -- F1inset</code>');
    expect(text, 'its command is for a bigger lab screen or after the event').toContain('only if the lab screen is 1600 x 900 or bigger (the town inset stays off at the smaller one), or after the event');
    expect(html.match(/class="card-tile card-inset is-optional"/g)).toHaveLength(2);       // once per lab screen
    expect(html.match(/class="inset-town"/g)).toHaveLength(12);
    expect(html.match(/class="inset-country"/g)).toHaveLength(2);
    for (const label of MAP_TEXT.F1inset) expect(text.match(new RegExp(`${label}</span>`, 'g')), label).toHaveLength(2);
    expect(html.match(/<svg[^>]*class="[^"]*inset-svg/g)).toHaveLength(2);
    // What he is told to look for: the six towns, the countryside dot, the key and the credit line.
    for (const word of ['York and Catterick', 'Colchester and Canterbury', 'Winchester', 'Gloucester', 'Cambridgeshire', 'Newcomers found here', 'Map outline: Made with Natural Earth.']) {
      expect(text, word).toContain(word);
    }
    // The drawing itself names no place: the towns are only in the words to him, never in the picture.
    const drawings = [...html.matchAll(/<div class="inset-alone"[^>]*>(.*?)<\/figure><\/div>/gs)].map((m) => m[1]!);
    expect(drawings).toHaveLength(2);
    for (const d of drawings) for (const name of ['York', 'Catterick', 'Colchester', 'Canterbury', 'Winchester', 'Gloucester', 'Cambridgeshire']) expect(d, name).not.toContain(name);
    // Without the card pictures the sizes are estimates, and the page says so; the York section belongs to the whole page only.
    expect(text).toContain('(the most the slide gives it, estimated)');
    expect(html).not.toContain('<section id="york-traveller">');
    expect(readdirSync(r.dir)).toEqual(['maps.html']);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(sha(MANIFEST)).toBe(before);
  });

  // Task 29: the York traveller is a point on a plot, so the page draws the Roman plot with his mark (a drawing that can be zoomed) and, with
  // the card pictures, a picture of the plot pane at each lab screen. It has no visual check, so it is not in the visual-check command.
  it('the whole page ends with the York traveller on the Roman plot: his words, the mark at each lab screen, no visual-check command for him', () => {
    const r = preview();
    expect(r.status, r.stderr).toBe(0);
    const html = readFileSync(join(r.dir, 'maps.html'), 'utf8');
    const text = unescape(html);
    const section = text.slice(text.indexOf('<section id="york-traveller">'), text.indexOf('</section>', text.indexOf('<section id="york-traveller">')));
    expect(section).toContain('York traveller: a point on the Roman plot, off the zoomed map (no visual check)');
    expect(section).toContain(`"${YORK_TRAVELLER_LABEL}"`);                                  // the words he is asked about, verbatim
    expect(section).toContain('Martiniano et al. 2016');
    expect(section).toContain('There is no visual-check command for a point on a plot');
    expect(section).not.toContain('npm run visual-check');
    // The Roman plot with his mark, drawn once at each lab screen, at the plot's real widths without the pictures (745 and 1047 px).
    expect(section.match(/<g class="york-traveller"/g)).toHaveLength(2);
    expect(section.match(new RegExp(`${YORK_TRAVELLER_LABEL.slice(0, 20)}`, 'g'))!.length).toBeGreaterThanOrEqual(2);
    expect(section).toContain('745 px wide (estimated)');
    expect(section).toContain('1047 px wide (estimated)');
    expect(section.match(/data-view="pca"/g)).toHaveLength(2);
    // It is the Roman plot: the Roman layer is in focus, and the page says nothing a Roman plot would not.
    expect(section.match(/data-focus="Roman"/g)).toHaveLength(2);
    // It is the plot a class has at the Roman step, the guided commands from the start (fix round 1), not the one a shortcut (the Iron Age and
    // then the Roman period) leaves: every earlier step's layer is on it, and so are the legend entries whose row the mark's arrow once touched.
    for (const layer of ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'Today']) {
      expect(section.match(new RegExp(`data-layer="${layer}"`, 'g')), `layer ${layer}`).toHaveLength(2);
    }
    for (const entry of ['BellBeaker', 'BronzeAge', 'IronAge', 'Roman']) expect(section.match(new RegExp(`data-legend="${entry}"`, 'g')), `legend ${entry}`).toHaveLength(2);
    // No sample number, group code or site name: the mark is a key, a square, an arrow and the words.
    expect(section).not.toMatch(/3DT26|Driffield|oLevant|Britannia|\.SG\b/);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
    // Only the whole page has it: a page of named maps does not.
    expect(readFileSync(join(preview('G1').dir, 'maps.html'), 'utf8')).not.toContain('york-traveller');
  });

  it('refuses a map that is not built, and an option it does not know, and writes nothing', () => {
    const unbuilt = preview('Z9');
    expect(unbuilt.status).toBe(1);
    expect(unbuilt.stderr).toMatch(/Z9 is not a built map/);
    expect(readdirSync(unbuilt.dir)).toEqual([]);
    const odd = preview('--frobnicate');
    expect(odd.status).toBe(1);
    expect(odd.stderr).toMatch(/unknown option --frobnicate/);
  });
});
