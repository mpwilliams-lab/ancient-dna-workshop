// @vitest-environment node
// Final-review fixes for the instructor run sheet (the last fix wave before the Monday rehearsal):
//   - Beat 3 says the eastern-England burials are the black-outlined triangles the plot draws;
//   - the "Pacing is free" bullet is accurate after the last guided step and does not read as permission to skip;
//   - a Fallbacks row for the dead keyboard (a student opened "Take this home");
//   - a "Freeze and verify" section: the offline file's size and sha256 (passed in by the CLI, never typed here),
//     the Windows Get-FileHash check for each desktop copy, and the hotfix procedure.
// tests/runsheet-cli.test.ts covers the part that needs the real CLI (hashing the exported file at generation time).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WRAP_BUTTON, WRAP_CLOSE } from '../src/content';
import { advance, EXTRA_PREFIX, hintText, NEXT_PREFIX, SCRIPT } from '../src/hints';
import { PERIOD_SHAPES } from '../src/plots/svg';
import { beats, buildRunSheet, OFFLINE_NAME, type OfflineFileInfo } from '../src/runsheet';
import { FIXTURE } from './helpers/shellEnv';

const AT = '2026-10-19T09:00:00Z';
const OFFLINE = '/Drive/web-app-dist/ancient-dna-workshop.html';
const FILE: OfflineFileInfo = { bytes: 146254, sha256: '7baf0ba7c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f708192a3b4b257' };
const OTHER: OfflineFileInfo = { bytes: 99001, sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' };
const md = buildRunSheet(FIXTURE, AT, OFFLINE, FILE);
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { scripts: Record<string, string> };

/** One "## " section of the sheet, heading included, up to the next "## " heading or the end. */
function section(text: string, title: string): string {
  const start = text.indexOf(`\n## ${title}\n`);
  if (start < 0) throw new Error(`the run sheet has no "## ${title}" section`);
  const rest = text.slice(start + 1);
  const next = rest.indexOf('\n## ', 4);
  return next < 0 ? rest : rest.slice(0, next);
}

/** One row of a table in the sheet, found by the text of its first cell. */
function row(text: string, title: string): string {
  const line = text.split('\n').find((l) => l.startsWith(`| ${title} |`));
  if (line === undefined) throw new Error(`the run sheet has no "${title}" row`);
  return line;
}

const freezeOf = (text: string): string => section(text, 'Freeze and verify');

describe('run sheet: Beat 3 names the outlined eastern-England triangles', () => {
  const lineOf = (): string | undefined =>
    beats(FIXTURE).find((b) => b.beat.startsWith('Beat 3'))!.say.find((s) => /Eastern-England burials/.test(s));

  it('says the eastern-England burials are the triangles with a black outline, in the line read aloud', () => {
    const line = lineOf();
    expect(line, 'a Beat 3 say line about the eastern-England burials').toBeDefined();
    expect(line).toMatch(/triangles/);
    expect(line).toMatch(/black outline/);
    expect(line).toContain('up to 76% continental ancestry'); // the claim it already made is still there
    expect(md).toContain(`- ${line}`);
  });

  it('rests on what the plot draws: Anglo-Saxon markers are triangles', () => {
    // src/plots/pca.ts outlines the Anglo-Saxon points flagged east in black; PERIOD_SHAPES says what shape that marker is.
    expect(PERIOD_SHAPES.AngloSaxon).toBe('triangle');
  });
});

describe('run sheet: the hint-line bullet is accurate and does not read as permission to skip', () => {
  const bulletOf = (): string | undefined =>
    section(md, 'At a glance').split('\n').find((l) => l.startsWith('- **Keep stations on the guided order:**'));

  it('replaces "Pacing is free ... the hint line always shows the next guided command"', () => {
    expect(md).not.toMatch(/Pacing is free/i);
    expect(md).not.toMatch(/always shows the next guided command/i);
    expect(bulletOf(), 'the new bullet in "At a glance"').toBeDefined();
  });

  it('says the hint moves on only when its hinted command is run', () => {
    expect(bulletOf()).toMatch(/only when its hinted command is run/);
    // ... because that is how the app works: a later step run early leaves the hint where it was.
    expect(advance(0, SCRIPT[1]!)).toBe(0);
    expect(advance(0, SCRIPT[0]!)).toBe(1);
  });

  it('names both hint-line forms, and says the extras start after the last guided step', () => {
    const bullet = bulletOf();
    expect(bullet).toContain(`\`${NEXT_PREFIX}…\``);
    expect(bullet).toContain(`\`${EXTRA_PREFIX}…\``);
    expect(bullet).toMatch(/until the last guided step/);
    expect(bullet).toMatch(/one optional extra at a time/);
    // ... and the app really shows those two forms (the sheet cannot drift from hints.ts)
    expect(hintText(0, null, 0).startsWith(NEXT_PREFIX)).toBe(true);
    expect(hintText(SCRIPT.length - 1, null, 0).startsWith(NEXT_PREFIX)).toBe(true);
    expect(hintText(SCRIPT.length, null, 0).startsWith(EXTRA_PREFIX)).toBe(true);
  });

  it('does not offer free pacing, any order or skipping', () => {
    expect(bulletOf()).not.toMatch(/free|any order|skip|always/i);
  });
});

describe('run sheet: Fallbacks has a row for a dead keyboard', () => {
  const fallbacks = (): string => section(md, 'Fallbacks');

  it('says a student opened "Take this home", and that Esc or the close button gets the terminal back', () => {
    const r = row(fallbacks(), 'Keyboard seems dead');
    expect(WRAP_BUTTON).toBe('Take this home');
    expect(r).toContain(`"${WRAP_BUTTON}"`);
    expect(r).toMatch(/\bEsc\b/);
    // the close button's own label, from the app (the wrap screen's button is not called "Close")
    expect(r).toContain(`"${WRAP_CLOSE}"`);
  });

  it('is a well-formed two-cell table row inside the Fallbacks table', () => {
    const r = row(fallbacks(), 'Keyboard seems dead');
    expect(r.match(/(?<!\\)\|/g)).toHaveLength(3);
    expect(fallbacks()).toContain('| Problem | Do this |');
  });

  it('is one more row: none of the existing fallbacks was lost', () => {
    for (const title of ['Pages URL will not load', 'A station is frozen or shows an error', 'A student is lost', 'A student is far behind', 'Projector shows a cut-off page', 'A trait plot looks wrong', 'Running long']) {
      expect(() => row(fallbacks(), title), title).not.toThrow();
    }
  });
});

describe('run sheet: "Freeze and verify"', () => {
  it('is the last section, after Fallbacks', () => {
    const at = md.indexOf('\n## Freeze and verify\n');
    expect(at, 'a Freeze and verify section').toBeGreaterThan(0);
    expect(md.indexOf('\n## Fallbacks\n')).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(md.indexOf('\n## Fallbacks\n'));
    expect(md.indexOf('\n## ', at + 4)).toBe(-1);
  });

  it('records the offline file name, its byte size and its sha256, exactly as they were passed in', () => {
    const freeze = freezeOf(md);
    expect(freeze).toContain(OFFLINE_NAME);
    expect(freeze).toContain(`${FILE.bytes.toLocaleString('en-US')} bytes`);
    expect(freeze).toContain(`\`${FILE.sha256}\``);
    expect(freeze).toContain(OFFLINE); // the Drive master copy, named the way "At a glance" names it
    expect(freeze).not.toMatch(/warning/i);
  });

  it('takes the numbers from the file it is given, never from the generator: other values give other numbers', () => {
    const freeze = freezeOf(md);
    const other = freezeOf(buildRunSheet(FIXTURE, AT, OFFLINE, OTHER));
    expect(other).toContain(OTHER.sha256);
    expect(other).toContain(`${OTHER.bytes.toLocaleString('en-US')} bytes`);
    expect(other).not.toContain(FILE.sha256);
    expect(other).not.toContain(FILE.bytes.toLocaleString('en-US'));
    expect(freeze).not.toContain(OTHER.sha256);
    // and the generator source holds no hash and no byte count of its own
    const source = readFileSync(resolve(__dirname, '../src/runsheet.ts'), 'utf8');
    expect(source).not.toMatch(/\b[0-9a-fA-F]{64}\b/);
    expect(source).not.toMatch(/\b\d[\d,]*\s+bytes\b/);
  });

  it('tells the instructor to check each Windows desktop copy with Get-FileHash and to compare it with the hash above', () => {
    const freeze = freezeOf(md);
    expect(freeze).toContain('Get-FileHash -Algorithm SHA256');
    expect(freeze).toMatch(/Get-FileHash -Algorithm SHA256 \.\\ancient-dna-workshop\.html/);
    expect(freeze).toMatch(/every lab desktop|each lab desktop|every desktop copy|each desktop copy/i);
    expect(freeze).toMatch(/must equal/i);
    expect(freeze).toMatch(/capitals|upper.?case/i); // PowerShell prints the hash in capitals; the sheet prints it in lower case
    expect(freeze).toMatch(/copy the Drive master over it|copy it again/i);
  });

  it('gives the hotfix procedure in order: tests, e2e, push, CI green, export-offline, re-copy, Ctrl+F5 (Pages caches for 10 minutes)', () => {
    const freeze = freezeOf(md);
    const order = ['`npm test`', '`npm run e2e`', 'Push', 'green', '`npm run export-offline`', 'Re-copy', 'Ctrl+F5'];
    let from = freeze.toLowerCase().indexOf('hotfix');
    expect(from, 'a hotfix heading').toBeGreaterThan(-1);
    for (const step of order) {
      const at = freeze.indexOf(step, from);
      expect(at, `"${step}" after the previous step`).toBeGreaterThan(-1);
      from = at;
    }
    expect(freeze).toMatch(/Pages caches[^.]*10 minutes/i);
    expect(freeze).toMatch(/every desktop|every lab desktop/i);
    expect(freeze).toMatch(/every station that (opens|uses)[^.]*Pages|Pages stations?/i);
    // the sheet's own hash must follow the new build
    expect(freeze).toContain('`npm run run-sheet`');
  });

  it('names only npm scripts that exist in package.json', () => {
    const freeze = freezeOf(md);
    for (const name of ['test', 'e2e', 'export-offline', 'run-sheet']) {
      expect(pkg.scripts[name], `scripts.${name}`).toBeTruthy();
      expect(freeze, name).toContain(name === 'test' ? '`npm test`' : `\`npm run ${name}\``);
    }
  });

  it('when the offline file is missing it prints a clear warning line instead of numbers (no crash, no made-up hash)', () => {
    for (const missing of [buildRunSheet(FIXTURE, AT, OFFLINE), buildRunSheet(FIXTURE, AT, OFFLINE, null)]) {
      const text = freezeOf(missing);
      const warning = text.split('\n').find((l) => /warning/i.test(l));
      expect(warning, 'a warning line').toBeDefined();
      expect(warning).toContain(OFFLINE);
      expect(warning).toMatch(/not found|could not be read/i);
      expect(warning).toMatch(/size and hash/i);
      expect(warning).toContain('`npm run export-offline`');
      expect(warning).toContain('`npm run run-sheet`');
      expect(text).not.toMatch(/\b[0-9a-f]{64}\b/);
      expect(text).not.toMatch(/\d+ bytes/);
      expect(missing).not.toMatch(/undefined|NaN|\{\{|TBD/);
      // everything else in the sheet is still there
      expect(missing).toContain('\n## Fallbacks\n');
      expect(text).toContain('Get-FileHash -Algorithm SHA256');
      expect(text).toContain('`npm run e2e`');
    }
  });

  it('treats a damaged record (not a whole number of bytes, not a sha256) as missing rather than printing it', () => {
    const bad: unknown[] = [
      { bytes: Number.NaN, sha256: FILE.sha256 }, { bytes: Number.POSITIVE_INFINITY, sha256: FILE.sha256 },
      { bytes: -1, sha256: FILE.sha256 }, { bytes: 1.5, sha256: FILE.sha256 },
      { bytes: 10, sha256: 'xyz' }, { bytes: 10, sha256: FILE.sha256.slice(1) }, { bytes: 10, sha256: `${FILE.sha256}0` },
      { bytes: 10, sha256: null }, { bytes: 10 }, {}, 'file', 42,
    ];
    for (const info of bad) {
      const text = freezeOf(buildRunSheet(FIXTURE, AT, OFFLINE, info as OfflineFileInfo));
      expect(text, JSON.stringify(info)).toMatch(/warning/i);
      expect(text, JSON.stringify(info)).not.toMatch(/undefined|NaN|Infinity/);
    }
  });
});

describe('run sheet: the final fixes keep what the sheet already promised', () => {
  it('is still a draft with no verified stamp', () => {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(md)?.[1] ?? '';
    expect(fm).toContain('status: draft');
    expect(fm).not.toMatch(/verified/);
    expect(md).not.toMatch(/undefined|NaN|\{\{|TBD/);
  });

  it('never advises skipping a guided command, even in the new text', () => {
    const advice: RegExp[] = [
      /instead of typing|without typing|rather than typing/i,
      /skip ahead/i,
      /\b(?:skip|omit|leave out) (?:the |a |any |that )?(?:guided |first |hook )?(?:command|step|hook)\b/i,
      /do not type|don't type|no need to type/i,
    ];
    for (const pattern of advice) expect(md).not.toMatch(pattern);
  });
});
