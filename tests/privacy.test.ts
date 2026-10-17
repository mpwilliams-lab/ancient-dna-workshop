// @vitest-environment node
// Public repo (plan Global Constraints, RF5): no machine path, account name, e-mail address or personal name of this computer's
// user in anything a push publishes.
//
// What is scanned, and where it is read from. tests/helpers/gitScan.ts asks git; it never reads the working tree, so a file
// edited after its commit cannot hide a leak that is about to go public:
//   - every blob of the HEAD commit (and its file name),
//   - the added lines of `git log -p -U0 origin/main..HEAD`: the commits a push would publish, even a line that a later commit
//     removes again (that part is skipped only where the ref origin/main does not exist),
//   - every commit message, on any branch or tag.
//
// Two groups of tests:
//   1. This machine's own strings (home directory, account name, git e-mail, real name). They are read from the machine when the
//      test runs, so this file names nobody and cannot trip itself. A CI runner has the generic account "runner" and no git
//      identity, and "runner" is an ordinary word in the sources: the group is skipped when CI is set, and ONLY then. A machine
//      without a git identity does not skip it: it fails, because git cannot commit there either.
//   2. Machine-independent rules, run everywhere (CI included, where group 1 is skipped): any user directory under /Users/ or
//      /home/ other than the lab PCs' shared account, and any e-mail address other than a noreply trailer.
// The commit that goes to the public repo is made on the author's own machine, where both groups run for real.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, homedir, tmpdir, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { addedChunks, commitMessages, headBlobs, unpushedRange } from './helpers/gitScan';

const ROOT = resolve(__dirname, '..');
/** Only the longer needles are looked for in binary files (a short one could occur in compressed data by chance). */
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

// ---- Machine-independent rules ----

/** The lab PCs' shared Windows account: C:\Users\lab\Desktop is named in the test fixtures on purpose. Every other user directory is somebody's. */
const ALLOWED_HOME_USERS: ReadonlySet<string> = new Set(['lab']);
const HOME_PATH = /\/(?:Users|home)\/([^/\s"'`<>()[\]{}|\\]+)\//gi;
/** Bounded quantifiers: a long run of letters with no "@" in it cannot make the scan slow. */
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}/g;
/** The only addresses that may appear: the commit trailer's, and the ones GitHub itself writes. */
const NOREPLY = /^(?:noreply@anthropic\.com|noreply@github\.com|[A-Za-z0-9._+-]*@users\.noreply\.github\.com)$/i;

/** Every "/Users/<name>/" or "/home/<name>/" in `text` (either slash style) whose <name> is not the lab account's. */
function foreignHomePaths(text: string): string[] {
  const out: string[] = [];
  for (const m of slashes(text).matchAll(HOME_PATH)) if (!ALLOWED_HOME_USERS.has(m[1]!.toLowerCase())) out.push(m[0]);
  return out;
}

/** Every e-mail address in `text` except a noreply one. */
function strayEmails(text: string): string[] {
  return (text.match(EMAIL) ?? []).filter((e) => !NOREPLY.test(e));
}

/** Both machine-independent checks, as one list of findings. */
const stray = (text: string): string[] => [...foreignHomePaths(text), ...strayEmails(text)];

// Sample leaks are put together at run time, so this file never contains one itself.
const SAMPLE_HOME = ['', 'Users', 'someone'].join('/');
const SAMPLE_LINUX_HOME = ['', 'home', 'someone'].join('/');
const SAMPLE_WINDOWS_HOME = ['C:', 'Users', 'SOMEONE', 'Desktop', 'x'].join('\\');
const SAMPLE_MAIL = ['someone', 'example.org'].join('@');

// ---- A throw-away repository, to prove where the scanners read from ----

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

/** A git repository in a temp folder, with a fixed fake identity and none of this machine's git configuration. */
function tempRepo(): { dir: string; run: (...args: string[]) => void; write: (file: string, text: string) => void } {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-scan-'));
  tempDirs.push(dir);
  const fake = ['tester', 'example.invalid'].join('@');
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'tester',
    GIT_AUTHOR_EMAIL: fake,
    GIT_COMMITTER_NAME: 'tester',
    GIT_COMMITTER_EMAIL: fake,
  };
  const run = (...args: string[]): void => {
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, env, stdio: 'ignore' });
  };
  const write = (file: string, text: string): void => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text, 'latin1');
  };
  run('init', '-q', '-b', 'main');
  return { dir, run, write };
}

describe.skipIf(ON_CI)('public-repo privacy: this machine\'s own strings (skipped only on CI)', () => {
  it('looks for this machine\'s home directory, account name, git e-mail and the instructor\'s first and last name', () => {
    expect(HAS_PERSON, 'git has no user.name or user.email on this machine, so the test cannot know whose name to look for: set them with git config').toBe(true);
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

  it('no file of the HEAD commit, and no file name, contains any of them', () => {
    const hits: string[] = [];
    for (const f of headBlobs(ROOT)) {
      for (const label of hitsIn(f.path)) hits.push(`${f.path}: ${label} (in the file name)`);
      for (const label of hitsIn(f.text, f.binary)) hits.push(`${f.path}: ${label}`);
    }
    expect(hits, 'remove the personal string from each file listed, in a new commit (never weaken this test)').toEqual([]);
  }, 30_000);

  it('finds this machine\'s home directory inside the bytes of a binary file an unpushed commit adds, then deletes (long needles only, as in the HEAD scan)', () => {
    const { dir, run, write } = tempRepo();
    write('a.txt', 'a\n');
    run('add', 'a.txt');
    run('commit', '-q', '-m', 'first');
    run('update-ref', 'refs/remotes/origin/main', 'HEAD');
    write('img/photo.jpg', `\u0000\u00ff\u00d8\u00ff\u0000${slashes(homedir())}\u0000`);
    run('add', 'img/photo.jpg');
    run('commit', '-q', '-m', 'adds a photo with the path in its metadata');
    run('rm', '-q', 'img/photo.jpg');
    run('commit', '-q', '-m', 'removes it');
    const chunk = addedChunks(dir, 'origin/main..HEAD').find((c) => c.path === 'img/photo.jpg' && c.text !== '')!;
    expect(chunk.binary).toBe(true);
    expect(hitsIn(chunk.text, chunk.binary)).toContain('home directory');
  });

  it('no line added by an unpushed commit contains any of them, even one a later commit removes again', () => {
    const range = unpushedRange(ROOT);
    const hits: string[] = [];
    for (const c of range === null ? [] : addedChunks(ROOT, range)) {
      for (const label of [...hitsIn(c.path), ...hitsIn(c.text, c.binary)]) hits.push(`${c.commit} ${c.path}: ${label}`);
    }
    expect(hits, 'the commit is not pushed yet: fix it (amend, or rebase -i) before any push').toEqual([]);
  }, 30_000);

  it('no commit message, on any branch or tag, contains any of them', () => {
    expect(hitsIn(commitMessages(ROOT, '--all')), 'a hit in an old commit message cannot be fixed without rewriting public history: tell the instructor').toEqual([]);
  }, 30_000);
});

describe('public-repo privacy: rules that need no knowledge of this machine (run everywhere, CI included)', () => {
  it('finds a user directory under /Users/ or /home/ and an e-mail address, but passes the lab account and noreply trailers', () => {
    expect(foreignHomePaths(`${SAMPLE_HOME}/project/file.ts`)).toEqual([`${SAMPLE_HOME}/`]);
    expect(foreignHomePaths(`path = '${SAMPLE_LINUX_HOME}/work'`)).toEqual([`${SAMPLE_LINUX_HOME}/`]);
    expect(foreignHomePaths(SAMPLE_WINDOWS_HOME), 'Windows spelling, any letter case').toEqual([`${['', 'Users', 'SOMEONE'].join('/')}/`]);
    expect(foreignHomePaths('file:///C:/Users/lab/Desktop/ancient-dna-workshop.html'), 'the lab PCs\' shared account').toEqual([]);
    expect(foreignHomePaths('C:\\Users\\lab\\Desktop\\x'), 'the lab account with backslashes').toEqual([]);
    expect(foreignHomePaths('the /Users folder and a /home page'), 'words, not user directories').toEqual([]);
    expect(strayEmails(`write to ${SAMPLE_MAIL} today`)).toEqual([SAMPLE_MAIL]);
    expect(strayEmails(SAMPLE_MAIL.toUpperCase()), 'any letter case').toHaveLength(1);
    expect(strayEmails('Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'), 'the commit trailer').toEqual([]);
    expect(strayEmails('12345+name@users.noreply.github.com and noreply@github.com'), 'GitHub\'s own noreply addresses').toEqual([]);
    expect(strayEmails('"@types/node": "24.13.6", vite@8.3.1, a@b, @vitest-environment node'), 'package names, versions and pragmas are not addresses').toEqual([]);
    expect(stray(`${SAMPLE_HOME}/x and ${SAMPLE_MAIL}`)).toHaveLength(2);
  });

  it('reads the HEAD commit and the unpushed commits from git, not from the working tree', () => {
    const { dir, run, write } = tempRepo();
    write('clean.txt', 'nothing personal here\n');
    run('add', 'clean.txt');
    run('commit', '-q', '-m', 'first');
    run('update-ref', 'refs/remotes/origin/main', 'HEAD');     // what a push has already published
    expect(unpushedRange(dir)).toBe('origin/main..HEAD');
    expect(addedChunks(dir, 'origin/main..HEAD'), 'nothing is unpushed yet').toEqual([]);

    // A leak added by one unpushed commit and removed by the next: the push would still publish it.
    write('leak.txt', `see ${SAMPLE_HOME}/notes and ${SAMPLE_MAIL}\nsecond line\n`);
    run('add', 'leak.txt');
    run('commit', '-q', '-m', 'adds a leak');
    run('rm', '-q', 'leak.txt');
    run('commit', '-q', '-m', 'removes it again');
    // A committed leak that the working tree no longer shows, and a clean commit that the working tree now spoils.
    write('drift.txt', `${SAMPLE_HOME}/x\n`);
    run('add', 'drift.txt');
    run('commit', '-q', '-m', 'adds drift.txt');
    write('drift.txt', 'clean in the working tree\n');
    write('clean.txt', `${SAMPLE_MAIL}\n`);

    // git log lists the newest commit first; the commit that removes leak.txt adds no line.
    const added = addedChunks(dir, 'origin/main..HEAD').filter((c) => c.text !== '');
    expect(added.map((c) => c.path)).toEqual(['drift.txt', 'leak.txt']);
    const leak = added.find((c) => c.path === 'leak.txt')!;
    expect(leak.text, 'the added lines, nothing else').toBe(`see ${SAMPLE_HOME}/notes and ${SAMPLE_MAIL}\nsecond line\n`);
    expect(stray(leak.text)).toHaveLength(2);

    const blobs = headBlobs(dir);
    expect(blobs.map((b) => b.path).sort()).toEqual(['clean.txt', 'drift.txt']);
    expect(blobs.find((b) => b.path === 'drift.txt')!.text, 'the committed text, not the file on disk').toBe(`${SAMPLE_HOME}/x\n`);
    expect(blobs.find((b) => b.path === 'clean.txt')!.text, 'an uncommitted edit is not a HEAD blob').toBe('nothing personal here\n');

    expect(commitMessages(dir, 'origin/main..HEAD')).toContain('adds a leak');
    expect(commitMessages(dir, '--all')).toContain('first');
  });

  it('skips the unpushed-commit scan, without failing, where origin/main does not exist', () => {
    const { dir, run, write } = tempRepo();
    write('a.txt', 'a\n');
    run('add', 'a.txt');
    run('commit', '-q', '-m', 'only commit');
    expect(unpushedRange(dir)).toBeNull();
  });

  it('returns a binary file as bytes (latin1) and a text file as UTF-8', () => {
    const { dir, run, write } = tempRepo();
    write('t.txt', 'caf\u00e9\n');
    write('i.png', '\u0089PNG\u0000\u00ff');
    run('add', 't.txt', 'i.png');
    run('commit', '-q', '-m', 'files');
    const byPath = new Map(headBlobs(dir).map((b) => [b.path, b]));
    expect(byPath.get('i.png')).toMatchObject({ binary: true, text: '\u0089PNG\u0000\u00ff' });
    expect(byPath.get('t.txt')!.binary).toBe(false);
  });

  it('reads the added bytes of a committed binary file too (git log -p --text), even one that a later commit deletes', () => {
    const { dir, run, write } = tempRepo();
    write('a.txt', 'a\n');
    run('add', 'a.txt');
    run('commit', '-q', '-m', 'first');
    run('update-ref', 'refs/remotes/origin/main', 'HEAD');
    write('img/blob.png', `\u0000\u0089PNG\r\n\u001a\n\u0000${SAMPLE_HOME}/x\u0000${SAMPLE_MAIL}\u0000`);
    run('add', 'img/blob.png');
    run('commit', '-q', '-m', 'adds a binary');
    run('rm', '-q', 'img/blob.png');
    run('commit', '-q', '-m', 'deletes it');
    const [chunk] = addedChunks(dir, 'origin/main..HEAD').filter((c) => c.path === 'img/blob.png' && c.text !== '');
    expect(chunk, 'git says "Binary files differ" unless --text is given').toBeDefined();
    expect(chunk!.binary).toBe(true);
    expect(chunk!.text).toContain(`${SAMPLE_HOME}/x`);
    expect(chunk!.text).toContain(SAMPLE_MAIL);
    expect(addedChunks(dir, 'origin/main..HEAD').find((c) => c.path === 'a.txt'), 'a text file is not a binary chunk').toBeUndefined();
    write('t.txt', 'text\n');
    run('add', 't.txt');
    run('commit', '-q', '-m', 'text');
    expect(addedChunks(dir, 'origin/main..HEAD').find((c) => c.path === 't.txt')!.binary).toBe(false);
  });

  it('no file of the HEAD commit holds a user directory other than the lab account\'s, or an e-mail address', () => {
    const hits: string[] = [];
    for (const f of headBlobs(ROOT)) if (!f.binary) for (const s of stray(f.text)) hits.push(`${f.path}: ${s}`);
    expect(hits, 'remove the path or address from each file listed, in a new commit (never weaken this test)').toEqual([]);
  }, 30_000);

  it('no line added by an unpushed commit does', () => {
    const range = unpushedRange(ROOT);
    const hits: string[] = [];
    for (const c of range === null ? [] : addedChunks(ROOT, range)) if (!c.binary) for (const s of stray(c.text)) hits.push(`${c.commit} ${c.path}: ${s}`);
    expect(hits, 'the commit is not pushed yet: fix it (amend, or rebase -i) before any push').toEqual([]);
  }, 30_000);

  it('no commit message, on any branch or tag, does', () => {
    expect(stray(commitMessages(ROOT, '--all')), 'a hit in an old commit message cannot be fixed without rewriting public history: tell the instructor').toEqual([]);
  }, 30_000);
});
