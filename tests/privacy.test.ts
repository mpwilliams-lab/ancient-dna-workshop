// @vitest-environment node
// Public repo (plan Global Constraints, RF5): no machine path, account name, e-mail address or personal name of this computer's
// user in any tracked file or commit message.
//
// What to look for is read from this machine when the test runs: the home directory, the account name, the git e-mail and the
// real name (git's user.name, plus the operating system's own record of the account holder where it has one). So this file names
// nobody, and cannot trip itself. The test is skipped where there is no such person: a CI runner has the generic account "runner"
// and no git identity, and "runner" is an ordinary word in the sources, so looking for it there would only produce false alarms.
// The commit that goes to the public repo is made on the author's own machine, where the test runs for real.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
/** Tracked files read as bytes, not text. Only the longer needles are looked for in them (a short one could occur in compressed data by chance). */
const BINARY = /\.(jpe?g|png|gif|webp|ico|woff2?|ttf|otf|pdf)$/i;
const BINARY_MIN_NEEDLE = 6;

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** One slash style, so a Windows home directory is found however a file spells it. */
const slashes = (s: string): string => s.replace(/[\\/]+/g, '/');

/** A command's output, or '' when it is missing or fails (a machine without git config, a system without `id -F`). */
function lenient(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** A git command that must work: a failure fails the test instead of looking like a clean repo. */
const git = (...args: string[]): string => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

interface Needle { label: string; sample: string; re: RegExp }

const GIT_NAME = lenient('git', ['config', 'user.name']);
const GIT_EMAIL = lenient('git', ['config', 'user.email']);

function account(): string[] {
  const names = new Set<string>();
  try {
    names.add(userInfo().username);
  } catch {
    // no passwd entry for this user
  }
  names.add(basename(homedir()));
  return [...names].filter((n) => n.length > 2);
}

function needles(): Needle[] {
  const out: Needle[] = [];
  const add = (label: string, sample: string): void => {
    if (!out.some((n) => n.sample.toLowerCase() === sample.toLowerCase())) out.push({ label, sample, re: new RegExp(esc(sample), 'i') });
  };
  const home = slashes(homedir());
  if (home.length > 3) add('home directory', home);
  for (const name of account()) add('account name', name);
  if (GIT_EMAIL.includes('@')) add('git e-mail', GIT_EMAIL);
  // The first and the last word of each real name on record (git's, and the system account's where `id -F` knows it).
  for (const full of [GIT_NAME, lenient('id', ['-F'])]) {
    const words = (full.match(/\p{L}[\p{L}'’-]*/gu) ?? []).filter((w) => w.length > 2);
    if (words.length === 0) continue;
    add("instructor's first name", words[0]!);
    add("instructor's last name", words[words.length - 1]!);
  }
  return out;
}

const N = needles();
const ON_CI = ['true', '1'].includes((process.env.CI ?? '').toLowerCase());
const HAS_PERSON = GIT_NAME !== '' || GIT_EMAIL !== '';

/**
 * The public organisation (repo owner and Pages host) is the account name followed by "-lab" and a "." or "/": that text is
 * public already and is allowed. It is taken out before looking, because the last name sits inside it too.
 */
const PUBLIC_ORG = account().map((a) => `${esc(a)}-lab(?=[./])`).join('|');
const PUBLIC_ORG_RE = PUBLIC_ORG === '' ? null : new RegExp(PUBLIC_ORG, 'gi');

/** Labels of every needle found in `text` (the bytes of a binary file read as latin1 when `binary` is set). */
function hitsIn(text: string, binary = false): string[] {
  const clean = slashes(PUBLIC_ORG_RE === null ? text : text.replace(PUBLIC_ORG_RE, ''));
  return N.filter((n) => (!binary || n.sample.length >= BINARY_MIN_NEEDLE) && n.re.test(clean)).map((n) => n.label);
}

describe.skipIf(ON_CI || !HAS_PERSON)('public-repo privacy (skipped on CI and wherever git has no identity)', () => {
  it('looks for this machine\'s home directory, account name, git e-mail and the instructor\'s first and last name', () => {
    const labels = N.map((n) => n.label);
    expect(labels).toContain('home directory');
    expect(labels).toContain('account name');
    expect(labels.length, 'needles found on this machine').toBeGreaterThanOrEqual(3);
  });

  it('its matcher finds each of them in any letter case, and exempts only the public organisation name', () => {
    for (const n of N) {
      expect(hitsIn(`before ${n.sample} after`), n.label).toContain(n.label);
      expect(hitsIn(`before ${n.sample.toUpperCase()} after`), `${n.label} in capitals`).toContain(n.label);
      expect(hitsIn(`before ${n.sample.toLowerCase()} after`), `${n.label} in lower case`).toContain(n.label);
    }
    for (const a of account()) {
      expect(hitsIn(`https://${a}-lab.example/x and https://example.org/${a}-lab/repo`), `the organisation name built from ${a}`).toEqual([]);
      expect(hitsIn(`${a}-labs`), `${a}-labs is not the organisation name`).toContain('account name');
      expect(hitsIn(`${a}-lab`), `a bare ${a}-lab is not the organisation's address`).toContain('account name');
    }
    const home = N.find((n) => n.label === 'home directory');
    if (home) expect(hitsIn(home.sample.replace(/\//g, '\\')), 'a home directory written with backslashes').toContain('home directory');
    expect(hitsIn('nothing personal in here: C:/Users/lab/Desktop/ancient-dna-workshop.html'), 'the lab desktop path').toEqual([]);
  });

  it('only the longer needles are looked for in binary files', () => {
    for (const n of N) expect(hitsIn(`\u0000${n.sample}\u0000`, true).includes(n.label), n.label).toBe(n.sample.length >= BINARY_MIN_NEEDLE);
  });

  it('no tracked file contains any of them', () => {
    const hits: string[] = [];
    for (const f of git('ls-files', '-z').split('\0').filter(Boolean)) {
      const binary = BINARY.test(f);
      let text: string;
      try {
        text = readFileSync(join(ROOT, f), binary ? 'latin1' : 'utf8');
      } catch {
        continue; // tracked, but deleted in the working tree
      }
      for (const label of hitsIn(text, binary)) hits.push(`${f}: ${label}`);
    }
    expect(hits, 'remove the personal string from each file listed (never weaken this test)').toEqual([]);
  });

  it('no commit message, on any branch or tag, contains any of them', () => {
    const log = git('log', '--all', '--format=%B%x00');
    expect(hitsIn(log), 'a hit in an old commit message cannot be fixed without rewriting public history: tell the instructor').toEqual([]);
  });
});
