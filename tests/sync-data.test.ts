// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../scripts/sync-data.mjs', import.meta.url));
// Self-contained on purpose: tests/fixtures/data.fixture.json does not exist yet at this step (Step 11 writes it).

function run(src: string, dest: string) {
  return spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, WORKSHOP_DATA_SRC: src, WORKSHOP_DATA_DEST: dest }, encoding: 'utf8' });
}

describe('scripts/sync-data.mjs', () => {
  it('copies the build output byte for byte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-'));
    const src = join(dir, 'in.json');
    writeFileSync(src, JSON.stringify({ version: 1, ok: true }));
    const dest = join(dir, 'nested', 'workshop_data.json');
    const r = run(src, dest);
    expect(r.status).toBe(0);
    expect(readFileSync(dest, 'utf8')).toBe(readFileSync(src, 'utf8'));
  });

  it('fails with a clear message when the build output is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-'));
    const dest = join(dir, 'workshop_data.json');
    const r = run(join(dir, 'nope.json'), dest);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not found. Run the data build first');
    expect(existsSync(dest)).toBe(false);
  });

  it('refuses a file that is not version-1 JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-'));
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"version": 2}');
    const r = run(bad, join(dir, 'out.json'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('expected 1');
    writeFileSync(bad, 'CHROM\tPOS\tBETA');
    expect(run(bad, join(dir, 'out.json')).stderr).toContain('is not valid JSON');
  });
});

describe('scripts/sync-data.mjs finds its source without a hard-coded path', () => {
  /**
   * A throwaway repo root holding a byte-identical copy of the script. `local-paths.json` and `src/data/` then
   * resolve inside that temp dir, so these tests never read or write the real ones (a developer's real
   * local-paths.json exists on their machine). The inherited environment is stripped of WORKSHOP_DATA_SRC and
   * WORKSHOP_DATA_DEST so every case starts unconfigured.
   */
  function miniRepo() {
    const root = mkdtempSync(join(tmpdir(), 'repo-'));
    mkdirSync(join(root, 'scripts'));
    const script = join(root, 'scripts', 'sync-data.mjs');
    copyFileSync(SCRIPT, script);
    const base: NodeJS.ProcessEnv = { ...process.env };
    delete base.WORKSHOP_DATA_SRC;
    delete base.WORKSHOP_DATA_DEST;
    return {
      root,
      out: join(root, 'src', 'data', 'workshop_data.json'),
      writeLocalPaths: (text: string) => writeFileSync(join(root, 'local-paths.json'), text),
      run: (extraEnv: Record<string, string> = {}) =>
        spawnSync(process.execPath, [script], { env: { ...base, ...extraEnv }, encoding: 'utf8' }),
    };
  }

  it('reads the source from local-paths.json when WORKSHOP_DATA_SRC is unset', () => {
    const repo = miniRepo();
    const src = join(repo.root, 'built.json');
    writeFileSync(src, JSON.stringify({ version: 1, from: 'local-paths' }));
    repo.writeLocalPaths(JSON.stringify({ workshopDataSrc: src }));
    const r = repo.run();
    expect(r.status).toBe(0);
    expect(readFileSync(repo.out, 'utf8')).toBe(readFileSync(src, 'utf8'));
  });

  it('WORKSHOP_DATA_SRC takes precedence over local-paths.json', () => {
    const repo = miniRepo();
    const fromEnv = join(repo.root, 'env.json');
    const fromFile = join(repo.root, 'file.json');
    writeFileSync(fromEnv, JSON.stringify({ version: 1, from: 'env' }));
    writeFileSync(fromFile, JSON.stringify({ version: 1, from: 'file' }));
    repo.writeLocalPaths(JSON.stringify({ workshopDataSrc: fromFile }));
    const r = repo.run({ WORKSHOP_DATA_SRC: fromEnv });
    expect(r.status).toBe(0);
    expect(JSON.parse(readFileSync(repo.out, 'utf8')).from).toBe('env');
  });

  it('exits non-zero and names both ways to configure it when neither is set', () => {
    const repo = miniRepo();
    const r = repo.run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no data source configured');
    expect(r.stderr).toContain('WORKSHOP_DATA_SRC');
    expect(r.stderr).toContain('local-paths.json');
    expect(r.stderr).toContain('workshopDataSrc');
    expect(existsSync(repo.out)).toBe(false);
  });

  it('refuses a local-paths.json that is not JSON or has no workshopDataSrc', () => {
    const repo = miniRepo();
    repo.writeLocalPaths('not json');
    const notJson = repo.run();
    expect(notJson.status).toBe(1);
    expect(notJson.stderr).toContain('is not valid JSON');
    repo.writeLocalPaths(JSON.stringify({ somethingElse: 1 }));
    const noKey = repo.run();
    expect(noKey.status).toBe(1);
    expect(noKey.stderr).toContain('workshopDataSrc');
    expect(existsSync(repo.out)).toBe(false);
  });

  it('hard-codes no machine-specific path or account name (the repo is public)', () => {
    expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(/\/Users\/|\/home\/|CloudStorage|GoogleDrive|@gmail\.com/);
  });
});
