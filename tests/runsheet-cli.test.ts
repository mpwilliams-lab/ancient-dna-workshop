// @vitest-environment node
// scripts/runsheet-cli.ts must find where to write the run sheet (and where the offline master copy lives)
// without a machine-specific path in this public repo. Order for the output file:
//   1. the first command-line argument, 2. WORKSHOP_RUNSHEET_PATH, 3. runSheetPath in the git-ignored local-paths.json,
//   4. otherwise a clear error naming all three.
// The offline master copy's folder is the one `npm run export-offline` writes to: WORKSHOP_OFFLINE_DIR, then offlineExportDir.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
