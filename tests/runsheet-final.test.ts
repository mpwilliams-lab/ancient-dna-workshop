// @vitest-environment node
// The hint-line bullet, the Fallbacks rows and the "Freeze and verify" section (spec §3.6 freeze text, §10.2 Thu 22).
// tests/runsheet-cli.test.ts covers the part that needs the real CLI (hashing the exported file at generation time).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_HINT, WRAP_BUTTON, WRAP_CLOSE } from '../src/content';
import { advance, EXTRA_PREFIX, hintText, NEXT_PREFIX, SCRIPT } from '../src/hints';
import { buildRunSheet, FREEZE_TEXT, OFFLINE_NAME, type OfflineFileInfo } from '../src/runsheet';
import { FIXTURE } from './helpers/shellEnv';

const AT = '2026-10-19T09:00:00Z';
const OFFLINE = '/Drive/web-app-dist/ancient-dna-workshop.html';
const FILE: OfflineFileInfo = { bytes: 146254, sha256: '7baf0ba7c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f708192a3b4b257' };
const OTHER: OfflineFileInfo = { bytes: 99001, sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' };
const md = buildRunSheet(FIXTURE, AT, OFFLINE, FILE);
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { scripts: Record<string, string> };

function section(text: string, title: string): string {
  const start = text.indexOf(`\n## ${title}\n`);
  if (start < 0) throw new Error(`the run sheet has no "## ${title}" section`);
  const rest = text.slice(start + 1);
  const next = rest.indexOf('\n## ', 4);
  return next < 0 ? rest : rest.slice(0, next);
}
function row(text: string, title: string): string {
  const line = text.split('\n').find((l) => l.startsWith(`| ${title} |`));
  if (line === undefined) throw new Error(`the run sheet has no "${title}" row`);
  return line;
}
const freezeOf = (text: string): string => section(text, 'Freeze and verify');

describe('run sheet: the hint-line bullet is accurate and does not read as permission to skip', () => {
  const bulletOf = (): string | undefined =>
    section(md, 'At a glance').split('\n').find((l) => l.startsWith('- **Keep stations on the guided order:**'));
  it('says the hint moves on only when its hinted command is run', () => {
    expect(bulletOf()).toMatch(/only when its hinted command is run/);
    expect(advance(0, SCRIPT[1]!)).toBe(0);
    expect(advance(0, SCRIPT[0]!)).toBe(1);
  });
  it('names both hint-line forms, and says the extras start after the last guided step', () => {
    const bullet = bulletOf();
    expect(bullet).toContain(`\`${NEXT_PREFIX}…\``);
    expect(bullet).toContain(`\`${EXTRA_PREFIX}…\``);
    expect(bullet).toMatch(/until the last guided step/);
    expect(bullet).toMatch(/one optional extra at a time/);
    expect(hintText(0, null, 0).startsWith(NEXT_PREFIX)).toBe(true);
    expect(hintText(SCRIPT.length, null, 0).startsWith(EXTRA_PREFIX)).toBe(true);
  });
  it('does not offer free pacing, any order or skipping', () => {
    expect(bulletOf()).not.toMatch(/free|any order|skip|always/i);
  });
  it('explains cards: they open by themselves, Enter or Continue moves on, the hint line reads CARD_HINT', () => {
    const cards = section(md, 'At a glance').split('\n').find((l) => l.startsWith('- **Cards:**'));
    expect(cards).toBeDefined();
    expect(cards).toContain(`"${CARD_HINT}"`);
    expect(cards).toMatch(/at most one card/);
  });
});

describe('run sheet: Fallbacks', () => {
  const fallbacks = (): string => section(md, 'Fallbacks');
  it('a dead keyboard: a student opened "Take this home"; Esc or the close button gets the terminal back', () => {
    const r = row(fallbacks(), 'Keyboard seems dead');
    expect(r).toContain(`"${WRAP_BUTTON}"`);
    expect(r).toMatch(/\bEsc\b/);
    expect(r).toContain(`"${WRAP_CLOSE}"`);
  });
  it('a card that will not go away: Enter on an empty prompt or Continue, one card per press', () => {
    const r = row(fallbacks(), 'A card will not close');
    expect(r).toMatch(/\bEnter\b/);
    expect(r).toMatch(/Continue/);
  });
  it('keeps every earlier row', () => {
    for (const title of ['Pages URL will not load', 'A station is frozen or shows an error', 'A student is lost', 'A student is far behind', 'Projector shows a cut-off page', 'A trait plot looks wrong', 'Running long']) {
      expect(() => row(fallbacks(), title), title).not.toThrow();
    }
    expect(fallbacks()).toContain('| Problem | Do this |');
  });
});

describe('run sheet: "Freeze and verify" (spec §3.6 freeze text)', () => {
  it('is the last section', () => {
    const at = md.indexOf('\n## Freeze and verify\n');
    expect(at).toBeGreaterThan(md.indexOf('\n## Fallbacks\n'));
    expect(md.indexOf('\n## ', at + 4)).toBe(-1);
  });
  it('opens with the spec freeze text, and there is no hotfix procedure any more', () => {
    expect(FREEZE_TEXT).toBe('Code freeze Wed 21 Oct 20:00 PT. The offline file\'s size and SHA-256 are recorded here. No code changes or hotfixes 22–24 Oct: note problems below and handle them by voice.');
    const freeze = freezeOf(md);
    expect(freeze.split('\n')[2]).toBe(FREEZE_TEXT);
    expect(md).not.toMatch(/Hotfix after the freeze|### Hotfix/i);
    expect(freeze).not.toMatch(/Push to `main`|Ctrl\+F5/);
  });
  it('names the event days: sessions Thu 22 and Fri 23 Oct only, none on Sat 24', () => {
    const freeze = freezeOf(md);
    expect(freeze).toMatch(/Sessions run Thu 22 and Fri 23 Oct only/);
    expect(freeze).toMatch(/none on Sat 24/);
  });
  it('records the offline file name, its byte size and its sha256, exactly as they were passed in', () => {
    const freeze = freezeOf(md);
    expect(freeze).toContain(OFFLINE_NAME);
    expect(freeze).toContain(`${FILE.bytes.toLocaleString('en-US')} bytes`);
    expect(freeze).toContain(`\`${FILE.sha256}\``);
    expect(freeze).toContain(OFFLINE);
    expect(freeze).not.toMatch(/warning/i);
  });
  it('takes the numbers from the file it is given, never from the generator', () => {
    const other = freezeOf(buildRunSheet(FIXTURE, AT, OFFLINE, OTHER));
    expect(other).toContain(OTHER.sha256);
    expect(other).not.toContain(FILE.sha256);
    const source = readFileSync(resolve(__dirname, '../src/runsheet.ts'), 'utf8');
    expect(source).not.toMatch(/\b[0-9a-fA-F]{64}\b/);
    expect(source).not.toMatch(/\b\d[\d,]*\s+bytes\b/);
  });
  it('Thu 22: check every desktop copy with Get-FileHash, re-copy a stale one, remove the Mon 19 copy', () => {
    const freeze = freezeOf(md);
    expect(freeze).toMatch(/Get-FileHash -Algorithm SHA256 \.\\ancient-dna-workshop\.html/);
    expect(freeze).toMatch(/each lab desktop|every lab desktop/i);
    expect(freeze).toMatch(/must equal/i);
    expect(freeze).toMatch(/capitals/i);
    expect(freeze).toMatch(/copy the Drive master over it/i);
    expect(freeze).toMatch(/remove the Mon 19 copy/i);
  });
  it('has a place to note problems during the sessions', () => {
    expect(freezeOf(md)).toContain('### Problems noted during sessions');
    expect(freezeOf(md)).toContain('| When | Station | Problem | Handled by voice |');
  });
  it('names only npm scripts that exist in package.json', () => {
    const freeze = freezeOf(md);
    for (const name of ['export-offline', 'run-sheet']) {
      expect(pkg.scripts[name], `scripts.${name}`).toBeTruthy();
      expect(freeze, name).toContain(`\`npm run ${name}\``);
    }
  });
  it('when the offline file is missing it prints a clear warning line instead of numbers (no crash, no made-up hash)', () => {
    for (const missing of [buildRunSheet(FIXTURE, AT, OFFLINE), buildRunSheet(FIXTURE, AT, OFFLINE, null)]) {
      const text = freezeOf(missing);
      const warning = text.split('\n').find((l) => /warning/i.test(l));
      expect(warning).toBeDefined();
      expect(warning).toContain(OFFLINE);
      expect(warning).toMatch(/not found|could not be read/i);
      expect(warning).toMatch(/size and hash/i);
      expect(warning).toContain('`npm run export-offline`');
      expect(warning).toContain('`npm run run-sheet`');
      expect(text).not.toMatch(/\b[0-9a-f]{64}\b/);
      expect(missing).not.toMatch(/undefined|NaN|\{\{|TBD/);
      expect(text).toContain('Get-FileHash -Algorithm SHA256');
    }
  });
  it('treats a damaged record as missing rather than printing it', () => {
    const bad: unknown[] = [
      { bytes: Number.NaN, sha256: FILE.sha256 }, { bytes: -1, sha256: FILE.sha256 }, { bytes: 1.5, sha256: FILE.sha256 },
      { bytes: 10, sha256: 'xyz' }, { bytes: 10, sha256: `${FILE.sha256}0` }, { bytes: 10 }, {}, 'file', 42,
    ];
    for (const info of bad) {
      const text = freezeOf(buildRunSheet(FIXTURE, AT, OFFLINE, info as OfflineFileInfo));
      expect(text, JSON.stringify(info)).toMatch(/warning/i);
      expect(text, JSON.stringify(info)).not.toMatch(/undefined|NaN|Infinity/);
    }
  });
});

describe('run sheet: still a draft', () => {
  it('has no verified stamp and no leftover placeholders', () => {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(md)?.[1] ?? '';
    expect(fm).toContain('status: draft');
    expect(fm).not.toMatch(/verified/);
    expect(md).not.toMatch(/undefined|NaN|\{\{|TBD/);
  });
});
