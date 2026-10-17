// @vitest-environment node
// Fix round 1 for the instructor run sheet (review of eb9996c). Each test pins something the sheet tells the instructor
// against the app itself (hints.ts, plotState.ts, commands.ts, content.ts), so the sheet cannot drift from what the
// students see. tests/runsheet.test.ts is the brief's file and stays as the brief wrote it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as content from '../src/content';
import { advance, EXTRAS, hintCommand, SCRIPT } from '../src/hints';
import { formatCommand } from '../src/parser';
import { beats, buildRunSheet } from '../src/runsheet';
import { FIXTURE } from './helpers/shellEnv';

const md = buildRunSheet(FIXTURE, '2026-10-19T09:00:00Z', '/Drive/web-app-dist/ancient-dna-workshop.html');

/** One row of a table in the sheet, found by the text of its first cell. */
function row(title: string): string {
  const line = md.split('\n').find((l) => l.startsWith(`| ${title} |`));
  if (line === undefined) throw new Error(`the run sheet has no "${title}" row`);
  return line;
}

describe('run sheet: nothing tells the instructor to skip a guided command', () => {
  // Why the rule exists. The hint line is per station and moves on only when the HINTED command is run, so a station
  // that skips a step stays stuck on it, and Esc and the three-tries auto-fill keep inserting the skipped command.
  it('rests on how the hint really works: only the hinted command moves it on, and Esc inserts that command', () => {
    expect(advance(0, SCRIPT[1]!)).toBe(0);
    expect(advance(0, SCRIPT[0]!)).toBe(1);
    expect(formatCommand(hintCommand(0, 0))).toBe(formatCommand(SCRIPT[0]!));
  });

  it('never advises skipping a step, skipping ahead, or saying a command aloud instead of typing it', () => {
    const advice: [RegExp, string][] = [
      [/instead of typing|without typing|rather than typing/i, 'saying a command aloud instead of typing it'],
      [/skip ahead/i, 'skipping ahead'],
      [/\b(?:skip|omit|leave out) (?:the |a |any |that )?(?:guided |first |hook )?(?:command|step|hook)\b/i, 'skipping a guided command'],
      [/do not type|don't type|no need to type/i, 'not typing a command'],
    ];
    for (const [pattern, what] of advice) expect(md, what).not.toMatch(pattern);
  });

  it('"Running long" keeps the command: run it with Esc and Enter, and warn that skipping strands the hint', () => {
    const r = row('Running long');
    expect(r).toMatch(/\bEsc\b/);
    expect(r).toMatch(/\bEnter\b/);
    expect(r).toMatch(/\bhint\b/i);
  });

  it('"A student is far behind" catches up through the guided steps with Esc, and says skipping leaves the hint behind', () => {
    const r = row('A student is far behind');
    expect(r).toMatch(/\bEsc\b/);
    expect(r).toMatch(/skipping/i);
    expect(r).toMatch(/\bhint\b/i);
  });
});

describe('run sheet: strings come from the app, not from hand copies', () => {
  it('src/runsheet.ts holds no hand-typed copy of a long on-screen string: it imports the constant from content.ts', () => {
    // Quote escapes are removed first, so a copy written as 'AncestryDNA\'s ...' is still found.
    const source = readFileSync(resolve(__dirname, '../src/runsheet.ts'), 'utf8').replace(/\\(['"`])/g, '$1');
    const copied = Object.entries(content)
      .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].length >= 40 && source.includes(e[1]))
      .map(([name]) => name);
    expect(copied).toEqual([]);
  });

  it('quotes AncestryDNA exactly as the app does, down to the last words "region or group"', () => {
    const quote = /"([^"]+)"/.exec(content.CONSUMER_TAKEAWAY)?.[1];
    expect(quote).toMatch(/region or group$/);
    expect(md).toContain(`(it compares customers with "${quote}")`);
  });

  it('keeps the restored-session wording: the checklist fragment starts the app notice, which is quoted in full', () => {
    expect(content.RESTORED_NOTICE.startsWith('Restored previous session')).toBe(true);
    expect(md).toContain('No "Restored previous session" line in the terminal.');
    expect(md).toContain(`the session comes back with "${content.RESTORED_NOTICE}"`);
  });

  it('keeps the wrap line, in full, as the answer about how old the bones are', () => {
    expect(md).toContain(`answer with the wrap line: "${content.WRAP_LINE}"`);
  });
});

describe('run sheet: Q&A time', () => {
  it('says that help() lists the commands and that, after the last guided step, the hint line suggests the extras', () => {
    const qa = beats(FIXTURE).find((b) => b.beat === 'Q&A')!;
    const text = qa.say.join('\n');
    expect(text).toContain('help()');
    expect(text).toMatch(/after the last guided step/i);
    for (const extra of EXTRAS) expect(text).toContain(formatCommand(extra));
  });
});
