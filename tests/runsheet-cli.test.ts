// @vitest-environment node
// scripts/runsheet-cli.ts must find where to write the run sheet (and where the offline master copy lives)
// without a machine-specific path in this public repo. Order for the output file:
//   1. the first command-line argument, 2. WORKSHOP_RUNSHEET_PATH, 3. runSheetPath in the git-ignored local-paths.json,
//   4. otherwise a clear error naming all three.
// The offline master copy's folder is the one `npm run export-offline` writes to: WORKSHOP_OFFLINE_DIR, then offlineExportDir.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { PAGES_URL } from '../src/runsheet';
import { FIXTURE } from './helpers/shellEnv';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VITE = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const CLI_SOURCE = fileURLToPath(new URL('../scripts/runsheet-cli.ts', import.meta.url));
const RUNSHEET_SOURCE = fileURLToPath(new URL('../src/runsheet.ts', import.meta.url));
const OFFLINE_NAME = 'ancient-dna-workshop.html';

let BUILT = '';

beforeAll(() => {
  BUILT = mkdtempSync(join(tmpdir(), 'runsheet-build-'));
  // The same command as `npm run run-sheet`, but from the fixture data and into a temp folder, without Vitest's own environment.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key === 'NODE_ENV' || key.startsWith('VITEST')) delete env[key];
  const r = spawnSync(process.execPath, [VITE, 'build', '--ssr', 'scripts/runsheet-cli.ts', '--mode', 'fixture', '--outDir', BUILT, '--emptyOutDir'], { cwd: ROOT, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`the run-sheet CLI did not build:\n${r.stdout}\n${r.stderr}`);
}, 120_000);

/**
 * A throwaway repo root holding a copy of the built CLI at .runsheet/runsheet-cli.js, exactly where `npm run run-sheet`
 * puts it. The CLI looks for local-paths.json one folder above itself, so it finds the one in this temp dir and never
 * the developer's real one. The inherited environment is stripped of both variables so every case starts unconfigured.
 */
function miniRepo() {
  const root = mkdtempSync(join(tmpdir(), 'runsheet-repo-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  cpSync(BUILT, join(root, '.runsheet'), { recursive: true });
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base.WORKSHOP_RUNSHEET_PATH;
  delete base.WORKSHOP_OFFLINE_DIR;
  return {
    root,
    offline: join(root, 'drive copy', 'web-app-dist'),
    localPaths: (cfg: Record<string, unknown>) => writeFileSync(join(root, 'local-paths.json'), JSON.stringify(cfg)),
    rawLocalPaths: (text: string) => writeFileSync(join(root, 'local-paths.json'), text),
    // cwd is the temp repo, so even a relative output path could only ever land there and never in the real repo.
    run: (args: string[] = [], env: Record<string, string> = {}) =>
      spawnSync(process.execPath, [join(root, '.runsheet', 'runsheet-cli.js'), ...args], { cwd: root, env: { ...base, ...env }, encoding: 'utf8' }),
    /** Everything in the repo root that the CLI did not find there: used to prove a failed run wrote nothing. */
    strangers: () => readdirSync(root).filter((f) => !['.runsheet', 'package.json', 'local-paths.json'].includes(f)),
  };
}

describe('scripts/runsheet-cli.ts finds its output path without a hard-coded path', () => {
  it('writes to the first argument, creating its folder, ahead of the environment and local-paths.json', () => {
    const repo = miniRepo();
    const fromArg = join(repo.root, 'new folder', 'from-arg.md');
    const fromEnv = join(repo.root, 'from-env.md');
    const fromFile = join(repo.root, 'from-file.md');
    repo.localPaths({ runSheetPath: fromFile, offlineExportDir: repo.offline });
    const r = repo.run([fromArg], { WORKSHOP_RUNSHEET_PATH: fromEnv });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`run-sheet: wrote ${fromArg} (`);
    expect(readFileSync(fromArg, 'utf8').startsWith('---\n')).toBe(true);
    expect(existsSync(fromEnv)).toBe(false);
    expect(existsSync(fromFile)).toBe(false);
  });

  it('WORKSHOP_RUNSHEET_PATH takes precedence over local-paths.json', () => {
    const repo = miniRepo();
    const fromEnv = join(repo.root, 'env folder', 'from-env.md');
    const fromFile = join(repo.root, 'from-file.md');
    repo.localPaths({ runSheetPath: fromFile, offlineExportDir: repo.offline });
    const r = repo.run([], { WORKSHOP_RUNSHEET_PATH: fromEnv });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(fromEnv)).toBe(true);
    expect(existsSync(fromFile)).toBe(false);
  });

  it('reads runSheetPath from local-paths.json when the argument and the environment are unset or blank', () => {
    const repo = miniRepo();
    const fromFile = join(repo.root, 'file folder', 'run-sheet.md');
    repo.localPaths({ workshopDataSrc: '/not/used.json', runSheetPath: fromFile, offlineExportDir: repo.offline });
    const r = repo.run(['  '], { WORKSHOP_RUNSHEET_PATH: ' ' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`run-sheet: wrote ${fromFile} (`);
    expect(existsSync(fromFile)).toBe(true);
  });

  it('exits non-zero and names all three ways to configure it when none is set', () => {
    const repo = miniRepo();
    const named = (stderr: string) => {
      expect(stderr).toContain('no output path configured');
      expect(stderr).toContain('first argument');
      expect(stderr).toContain('WORKSHOP_RUNSHEET_PATH');
      expect(stderr).toContain('local-paths.json');
      expect(stderr).toContain('runSheetPath');
    };
    // No local-paths.json at all.
    const none = repo.run();
    expect(none.status).toBe(1);
    named(none.stderr);
    // A local-paths.json that exists but lacks the key (the real one started with workshopDataSrc and offlineExportDir only) counts as unset.
    repo.localPaths({ workshopDataSrc: '/not/used.json', offlineExportDir: repo.offline });
    const noKey = repo.run();
    expect(noKey.status).toBe(1);
    named(noKey.stderr);
    // A blank value is not a path, and neither is one of the wrong type.
    for (const runSheetPath of ['  ', '', 42, null]) {
      repo.localPaths({ runSheetPath, offlineExportDir: repo.offline });
      const r = repo.run();
      expect(r.status, String(runSheetPath)).toBe(1);
      named(r.stderr);
    }
    // None of the failed runs wrote anything.
    expect(repo.strangers()).toEqual([]);
    expect(existsSync(repo.offline)).toBe(false);
  });

  it('refuses a local-paths.json that is not valid JSON, but only when it has to read it', () => {
    const repo = miniRepo();
    repo.rawLocalPaths('not json');
    const broken = repo.run();
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain('is not valid JSON');
    expect(repo.strangers()).toEqual([]);
    // With the argument and WORKSHOP_OFFLINE_DIR given, the file is never opened, so a broken one does not matter.
    const out = join(repo.root, 'out.md');
    const ok = repo.run([out], { WORKSHOP_OFFLINE_DIR: repo.offline });
    expect(ok.status, ok.stderr).toBe(0);
    expect(existsSync(out)).toBe(true);
  });
});

describe('scripts/runsheet-cli.ts names the offline master copy from the export folder, not from a fixed path', () => {
  it('uses WORKSHOP_OFFLINE_DIR ahead of offlineExportDir, and the file name the export writes', () => {
    const repo = miniRepo();
    const fromEnv = join(repo.root, 'from-env');
    const fromFile = join(repo.root, 'from-file');
    const out = join(repo.root, 'run-sheet.md');
    repo.localPaths({ offlineExportDir: fromFile });
    const r = repo.run([out], { WORKSHOP_OFFLINE_DIR: fromEnv });
    expect(r.status, r.stderr).toBe(0);
    const md = readFileSync(out, 'utf8');
    expect(md).toContain(join(fromEnv, OFFLINE_NAME));
    expect(md).not.toContain(fromFile);
    // Nothing is exported by this script: it only names the folder.
    expect(existsSync(fromEnv)).toBe(false);
  });

  it('reads offlineExportDir from local-paths.json when WORKSHOP_OFFLINE_DIR is unset', () => {
    const repo = miniRepo();
    const out = join(repo.root, 'run-sheet.md');
    repo.localPaths({ offlineExportDir: repo.offline });
    const r = repo.run([out]);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain(join(repo.offline, OFFLINE_NAME));
  });

  it('exits non-zero and names both ways to configure it when neither is set, writing nothing', () => {
    const repo = miniRepo();
    const out = join(repo.root, 'run-sheet.md');
    for (const cfg of [undefined, { runSheetPath: out }, { offlineExportDir: ' ' }]) {
      if (cfg) repo.localPaths(cfg);
      const r = repo.run([out]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('no offline export folder configured');
      expect(r.stderr).toContain('WORKSHOP_OFFLINE_DIR');
      expect(r.stderr).toContain('local-paths.json');
      expect(r.stderr).toContain('offlineExportDir');
    }
    expect(existsSync(out)).toBe(false);
    expect(repo.strangers()).toEqual([]);
  });
});

describe('the run sheet the CLI writes', () => {
  it('is a draft built from the data, names the Pages URL, the offline master copy and ?reset, and carries no verified stamp', () => {
    const repo = miniRepo();
    const out = join(repo.root, 'docs', 'run-sheet.md');
    repo.localPaths({ runSheetPath: out, offlineExportDir: repo.offline });
    const r = repo.run();
    expect(r.status, r.stderr).toBe(0);
    const md = readFileSync(out, 'utf8');
    expect(r.stdout.trim()).toBe(`run-sheet: wrote ${out} (${md.length} chars)`);
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(md)?.[1] ?? '';
    expect(fm).toContain('status: draft');
    expect(fm).toMatch(/generated: \{ by: agent\/ClaudeCode, at: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ \}/);
    expect(fm).not.toMatch(/verified/);
    expect(md).toContain(PAGES_URL);
    expect(md).toContain(join(repo.offline, OFFLINE_NAME));
    expect(md).toContain('?reset');
    expect(md).toContain('Microsoft Edge');
    // The fixture build's numbers, straight from the data.
    expect(md).toContain(`| Steppe share, Bell Beaker-period Britons (this run) | ${FIXTURE.admixture.beaker_steppe_pct}% |`);
  });

  it('hard-codes no machine-specific path or account name (the repo is public)', () => {
    for (const file of [CLI_SOURCE, RUNSHEET_SOURCE]) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\/Users\/|\/home\/|CloudStorage|GoogleDrive|@gmail\.com/);
    }
  });
});

// ---------- final review: "Freeze and verify" records the exported file, hashed at generation time ----------
describe('the run sheet records the exported offline file, read when the sheet is generated', () => {
  // Bytes that are not valid UTF-8 and characters that take more than one byte: a text read of this file would give a
  // different size and a different hash from a read of the bytes, which is what Get-FileHash on a desktop copy sees.
  const BODY = Buffer.concat([
    Buffer.from('<!doctype html><title>Ancient DNA — offline copy ✓</title>\n', 'utf8'),
    Buffer.from([0xff, 0xfe, 0x00, 0x80]),
    Buffer.from('x'.repeat(777), 'utf8'),
  ]);
  const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
  const BYTES = (b: Buffer): string => `${b.length.toLocaleString('en-US')} bytes`;
  const HEX64 = /\b[0-9a-f]{64}\b/;

  function exportTo(dir: string, body: Buffer = BODY): string {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, OFFLINE_NAME);
    writeFileSync(file, body);
    return file;
  }

  it('the sample tells bytes from characters (so the tests below would catch a text read)', () => {
    expect(BODY.length).not.toBe(BODY.toString('utf8').length);
    expect(sha256(BODY)).not.toBe(createHash('sha256').update(BODY.toString('utf8')).digest('hex'));
  });

  it('hashes the file in WORKSHOP_OFFLINE_DIR and writes its byte size and sha256 into the sheet', () => {
    const repo = miniRepo();
    const dir = join(repo.root, 'export from env');
    const out = join(repo.root, 'run-sheet.md');
    exportTo(dir);
    const r = repo.run([out], { WORKSHOP_OFFLINE_DIR: dir });
    expect(r.status, r.stderr).toBe(0);
    const md = readFileSync(out, 'utf8');
    expect(md).toContain('\n## Freeze and verify\n');
    expect(md).toContain(`\`${sha256(BODY)}\``);
    expect(md).toContain(BYTES(BODY));
    expect(md).toContain(join(dir, OFFLINE_NAME)); // the master copy it describes is the file it hashed
    expect(md).toContain('Get-FileHash -Algorithm SHA256');
    expect(r.stderr).not.toMatch(/warning/i);
    expect(r.stdout.trim()).toBe(`run-sheet: wrote ${out} (${md.length} chars)`);
  });

  it('finds the file the way export-offline does: WORKSHOP_OFFLINE_DIR first, then offlineExportDir in local-paths.json', () => {
    const repo = miniRepo();
    const fromEnv = join(repo.root, 'from-env');
    const fromFile = join(repo.root, 'from-file');
    const envBody = Buffer.from('the file in the environment folder');
    const fileBody = Buffer.from('the file in the local-paths.json folder');
    exportTo(fromEnv, envBody);
    exportTo(fromFile, fileBody);
    repo.localPaths({ offlineExportDir: fromFile });

    const out1 = join(repo.root, 'env.md');
    expect(repo.run([out1], { WORKSHOP_OFFLINE_DIR: fromEnv }).status).toBe(0);
    const env = readFileSync(out1, 'utf8');
    expect(env).toContain(sha256(envBody));
    expect(env).not.toContain(sha256(fileBody));

    const out2 = join(repo.root, 'file.md');
    expect(repo.run([out2]).status).toBe(0);
    const file = readFileSync(out2, 'utf8');
    expect(file).toContain(sha256(fileBody));
    expect(file).toContain(BYTES(fileBody));
    expect(file).not.toContain(sha256(envBody));
  });

  it('reads the file at generation time: after a new export, the next sheet records the new size and hash', () => {
    const repo = miniRepo();
    const dir = join(repo.root, 'export');
    const out = join(repo.root, 'run-sheet.md');
    const first = Buffer.from('first build');
    const second = Buffer.from('second build, a different size');
    exportTo(dir, first);
    expect(repo.run([out], { WORKSHOP_OFFLINE_DIR: dir }).status).toBe(0);
    const a = readFileSync(out, 'utf8');
    expect(a).toContain(sha256(first));
    exportTo(dir, second);
    expect(repo.run([out], { WORKSHOP_OFFLINE_DIR: dir }).status).toBe(0);
    const b = readFileSync(out, 'utf8');
    expect(b).toContain(sha256(second));
    expect(b).toContain(BYTES(second));
    expect(b).not.toContain(sha256(first));
    expect(b).not.toContain(BYTES(first));
  });

  it('hashes only the exported file: not dist/index.html and not its neighbours in the folder', () => {
    const repo = miniRepo();
    const dir = join(repo.root, 'export');
    const out = join(repo.root, 'run-sheet.md');
    const decoy = Buffer.from('a build that was never exported');
    exportTo(dir);
    writeFileSync(join(dir, 'ancient-dna-workshop-old.html'), decoy);
    mkdirSync(join(repo.root, 'dist'));
    writeFileSync(join(repo.root, 'dist', 'index.html'), decoy);
    expect(repo.run([out], { WORKSHOP_OFFLINE_DIR: dir }).status).toBe(0);
    const md = readFileSync(out, 'utf8');
    expect(md).toContain(sha256(BODY));
    expect(md).not.toContain(sha256(decoy));
    expect(md.match(new RegExp(HEX64, 'g'))).toEqual([sha256(BODY)]);
  });

  it('a missing offline file is a warning line in the sheet and on stderr, not a crash: the sheet is still written', () => {
    const repo = miniRepo();
    const out = join(repo.root, 'run-sheet.md');
    repo.localPaths({ offlineExportDir: repo.offline }); // the folder does not exist
    const r = repo.run([out]);
    expect(r.status, r.stderr).toBe(0);
    const md = readFileSync(out, 'utf8');
    const freeze = md.slice(md.indexOf('\n## Freeze and verify\n'));
    const warning = freeze.split('\n').find((l) => /warning/i.test(l));
    expect(warning, 'a warning line in the freeze section').toBeDefined();
    expect(warning).toContain(join(repo.offline, OFFLINE_NAME));
    expect(warning).toMatch(/not found|could not be read/i);
    expect(freeze).not.toMatch(HEX64);
    expect(freeze).not.toMatch(/\d+ bytes/);
    expect(md).toContain('\n## Fallbacks\n'); // the rest of the sheet is intact
    expect(md).not.toMatch(/undefined|NaN/);
    expect(r.stderr).toMatch(/run-sheet: warning: .*not found or could not be read/);
    expect(r.stderr).toContain(join(repo.offline, OFFLINE_NAME));
    expect(r.stdout.trim()).toBe(`run-sheet: wrote ${out} (${md.length} chars)`);
    expect(existsSync(repo.offline)).toBe(false); // it never creates the export folder
  });

  it('something unreadable where the file should be (a folder of that name) is the same warning, not a crash', () => {
    const repo = miniRepo();
    const dir = join(repo.root, 'export');
    const out = join(repo.root, 'run-sheet.md');
    mkdirSync(join(dir, OFFLINE_NAME), { recursive: true });
    const r = repo.run([out], { WORKSHOP_OFFLINE_DIR: dir });
    expect(r.status, r.stderr).toBe(0);
    const md = readFileSync(out, 'utf8');
    expect(md).toMatch(/warning/i);
    expect(md).not.toMatch(HEX64);
    expect(r.stderr).toMatch(/run-sheet: warning:/);
  });

  it('an empty offline file is still a file: its size is 0 bytes and its hash is the hash of nothing', () => {
    const repo = miniRepo();
    const dir = join(repo.root, 'export');
    const out = join(repo.root, 'run-sheet.md');
    exportTo(dir, Buffer.alloc(0));
    const r = repo.run([out], { WORKSHOP_OFFLINE_DIR: dir });
    expect(r.status, r.stderr).toBe(0);
    const md = readFileSync(out, 'utf8');
    expect(md).toContain('`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`');
    expect(md).toContain('0 bytes');
  });

  it('stays a draft with no verified stamp, with the numbers in the body and nothing about them in the front matter', () => {
    const repo = miniRepo();
    const out = join(repo.root, 'run-sheet.md');
    exportTo(join(repo.root, 'export'));
    expect(repo.run([out], { WORKSHOP_OFFLINE_DIR: join(repo.root, 'export') }).status).toBe(0);
    const text = readFileSync(out, 'utf8');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
    expect(fm).toContain('status: draft');
    expect(fm).not.toMatch(/verified/);
    expect(fm).not.toMatch(HEX64);
    expect(text).toContain(sha256(BODY));
  });
});
