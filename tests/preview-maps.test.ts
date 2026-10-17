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
import { MAP_SPECS_BUILT } from '../src/maps';

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
      expect(html.match(new RegExp(`data-map="${id}"`, 'g')), `${id} drawn once per lab screen`).toHaveLength(2);
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
    expect(html).not.toContain('<section id="D1">');
    expect(html).not.toContain('<section id="E1">');
    expect(unescape(html)).toContain('npm run visual-check -- G1</code>');
    expect(html).toContain('At 1366 x 768');
    expect(html).toContain('At 1920 x 1080');
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
