// The instructor's preview of the maps (Task 20, spec §6, §7.2): `npm run preview-maps` writes a page that shows every built map from
// the real data, so the instructor can check each one before running `npm run visual-check -- <ids>`. It is a tool for one person
// at one desk: never shipped, never a way to check a map for him. These tests run the real npm script with --no-cards (no browser)
// into a temporary folder.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CARDS } from '../src/cards';
import { MAP_TEXT } from '../src/content';
import { A1_CONFIRMED_LABELS, MAP_SPECS_BUILT } from '../src/maps';

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
      expect(html, id).toContain(`<section id="${id}">`);
      expect(text, id).toContain(CARDS[id as keyof typeof CARDS].title);
      // Each map is drawn by renderMap, whose text elements carry the approved labels.
      for (const label of MAP_TEXT[id]) expect(text, `${id} "${label}"`).toContain(`>${label}</text>`);
      // Once per lab screen; A1 twice per screen while its names are unconfirmed (as it ships, and with the eight names: see below).
      const drawn = id === 'A1' && A1_CONFIRMED_LABELS.length === 0 ? 4 : 2;
      expect(html.match(new RegExp(`data-map="${id}"`, 'g')), `${id} drawn ${drawn} times`).toHaveLength(drawn);
    }
    expect(text).toContain(`npm run visual-check -- ${ids.join(' ')}`);
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

  it('refuses a map that is not built, and an option it does not know, and writes nothing', () => {
    const unbuilt = preview('F1inset');
    expect(unbuilt.status).toBe(1);
    expect(unbuilt.stderr).toMatch(/F1inset is not a built map/);
    expect(readdirSync(unbuilt.dir)).toEqual([]);
    const odd = preview('--frobnicate');
    expect(odd.status).toBe(1);
    expect(odd.stderr).toMatch(/unknown option --frobnicate/);
  });
});
