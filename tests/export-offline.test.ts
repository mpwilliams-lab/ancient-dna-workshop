// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../scripts/export-offline.mjs');
const PKG = resolve(__dirname, '../package.json');
const BIG = 'x'.repeat(1200);
const GOOD = `<!doctype html><html><head><style>body{background:url(data:image/png;base64,AA)}</style></head><body><div id="app"></div><script type="module" crossorigin>const a="${BIG}";</script></body></html>`;

function exportTo(html: string) {
  const dir = mkdtempSync(join(tmpdir(), 'export-'));
  const src = join(dir, 'index.html');
  const out = join(dir, 'sub dir with spaces', 'ancient-dna-workshop.html');
  writeFileSync(src, html);
  const r = spawnSync(process.execPath, [SCRIPT, out, src], { encoding: 'utf8' });
  return { ...r, src, out };
}

describe('scripts/export-offline.mjs', () => {
  it('copies a self-contained build byte for byte and prints its sha256', () => {
    const r = exportTo(GOOD);
    expect(r.status).toBe(0);
    expect(readFileSync(r.out, 'utf8')).toBe(GOOD);
    expect(r.stdout).toMatch(/sha256 [0-9a-f]{64}/);
  });
  it.each([
    ['<script src="https://cdn.example/x.js"></script>', 'script src'],
    ['<link rel="stylesheet" href="style.css">', 'link href'],
    ['<img src="logo.png">', 'non-data: src'],
    ['<style>@import "x.css";</style>', '@import'],
    ['<style>.a{background:url(bg.png)}</style>', 'url('],
  ])('refuses a build containing %s', (snippet, why) => {
    const r = exportTo(GOOD.replace('<div id="app"></div>', `<div id="app"></div>${snippet}`));
    expect(r.status, why).toBe(1);
    expect(r.stderr).toContain('is not self-contained');
  });
  // index.html declares <link rel="icon" href="data:,"> so browsers never ask the server for /favicon.ico. A data: URL
  // is inline content, so it is self-contained; anything that would be fetched is not.
  it.each([
    ['<link rel="icon" href="data:,">'],
    ["<link rel='icon' href='data:,'>"],
    ['<link rel="icon" href = "data:," />'],
    ['<link rel="icon" href=data:,>'],
    ['<link rel="icon" href="data:image/png;base64,AA==">'],
  ])('accepts an inline data: icon link: %s', (snippet) => {
    const r = exportTo(GOOD.replace('<head>', `<head>${snippet}`));
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(r.out, 'utf8')).toContain(snippet);
  });
  it.each([
    ['<link rel="icon" href="/favicon.ico">'],
    ['<link rel="icon" href="favicon.png">'],
    ['<link rel="icon" href="https://cdn.example/f.png">'],
    ["<link rel='icon' href='//cdn.example/f.png'>"],
    ['<link rel="icon" href=favicon.ico>'],
    ['<link rel="icon" href="data:,"><link rel="icon" href="/favicon.ico">'],
  ])('still refuses an icon link that is not a data: URL: %s', (snippet) => {
    const r = exportTo(GOOD.replace('<head>', `<head>${snippet}`));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('is not self-contained');
  });
  // The same rule for media elements: a data: src is inline content, whatever the quote style.
  it.each([
    ['<img src="data:image/png;base64,AA">'],
    ["<img src='data:image/png;base64,AA'>"],
    ['<img src = "data:image/png;base64,AA" alt="">'],
    ['<img src=data:image/png;base64,AA>'],
    ['<iframe src="data:text/html,hi"></iframe>'],
  ])('accepts an inline data: media src: %s', (snippet) => {
    const r = exportTo(GOOD.replace('<div id="app"></div>', `<div id="app"></div>${snippet}`));
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(r.out, 'utf8')).toContain(snippet);
  });
  it.each([
    ["<img src='logo.png'>"],
    ['<img src=logo.png>'],
    ['<iframe src="https://example.com/"></iframe>'],
    ['<video src="//cdn.example/v.mp4"></video>'],
    ['<img src="data:image/png;base64,AA"><img src="logo.png">'],
  ])('still refuses a media src that is not a data: URL: %s', (snippet) => {
    const r = exportTo(GOOD.replace('<div id="app"></div>', `<div id="app"></div>${snippet}`));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('is not self-contained');
  });
  it('refuses a build with no inlined module script', () => {
    const r = exportTo('<!doctype html><html><body>hi</body></html>');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no inlined module script');
  });
  it('fails clearly when dist/index.html is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'export-'));
    const r = spawnSync(process.execPath, [SCRIPT, join(dir, 'o.html'), join(dir, 'missing.html')], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Run `npm run build` first');
  });
  it('package.json has the e2e and export scripts', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
    expect(pkg.scripts.e2e).toBe('npm run build && playwright test');
    expect(pkg.scripts['export-offline']).toBe('npm run build && node scripts/export-offline.mjs');
  });
});

describe('scripts/export-offline.mjs finds its destination without a hard-coded path', () => {
  /**
   * A throwaway repo root holding a byte-identical copy of the script and a built page at dist/index.html.
   * `local-paths.json` and `dist/` then resolve inside that temp dir, so these tests never read or write the real
   * ones (a developer's real local-paths.json exists on their machine). The inherited environment is stripped of
   * WORKSHOP_OFFLINE_DIR so every case starts unconfigured, and no output path is passed as an argument.
   */
  function miniRepo() {
    const root = mkdtempSync(join(tmpdir(), 'repo-'));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'dist'));
    const script = join(root, 'scripts', 'export-offline.mjs');
    copyFileSync(SCRIPT, script);
    writeFileSync(join(root, 'dist', 'index.html'), GOOD);
    const base: NodeJS.ProcessEnv = { ...process.env };
    delete base.WORKSHOP_OFFLINE_DIR;
    return {
      root,
      writeLocalPaths: (text: string) => writeFileSync(join(root, 'local-paths.json'), text),
      run: (extraEnv: Record<string, string> = {}) =>
        spawnSync(process.execPath, [script], { env: { ...base, ...extraEnv }, encoding: 'utf8' }),
    };
  }

  it('writes ancient-dna-workshop.html into WORKSHOP_OFFLINE_DIR, creating the folder', () => {
    const repo = miniRepo();
    const dir = join(repo.root, 'drive copy', 'web-app-dist');
    const r = repo.run({ WORKSHOP_OFFLINE_DIR: dir });
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'ancient-dna-workshop.html'), 'utf8')).toBe(GOOD);
    expect(r.stdout).toContain(join(dir, 'ancient-dna-workshop.html'));
    expect(r.stdout).toMatch(/sha256 [0-9a-f]{64}/);
  });

  it('reads offlineExportDir from local-paths.json when WORKSHOP_OFFLINE_DIR is unset', () => {
    const repo = miniRepo();
    const dir = join(repo.root, 'from-file');
    repo.writeLocalPaths(JSON.stringify({ workshopDataSrc: '/not/used.json', offlineExportDir: dir }));
    const r = repo.run();
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'ancient-dna-workshop.html'), 'utf8')).toBe(GOOD);
  });

  it('WORKSHOP_OFFLINE_DIR takes precedence over local-paths.json', () => {
    const repo = miniRepo();
    const fromEnv = join(repo.root, 'from-env');
    const fromFile = join(repo.root, 'from-file');
    repo.writeLocalPaths(JSON.stringify({ offlineExportDir: fromFile }));
    const r = repo.run({ WORKSHOP_OFFLINE_DIR: fromEnv });
    expect(r.status).toBe(0);
    expect(existsSync(join(fromEnv, 'ancient-dna-workshop.html'))).toBe(true);
    expect(existsSync(fromFile)).toBe(false);
  });

  it('exits non-zero and names both ways to configure it when neither is set', () => {
    const repo = miniRepo();
    const unconfigured = repo.run();
    expect(unconfigured.status).toBe(1);
    expect(unconfigured.stderr).toContain('no offline export folder configured');
    expect(unconfigured.stderr).toContain('WORKSHOP_OFFLINE_DIR');
    expect(unconfigured.stderr).toContain('local-paths.json');
    expect(unconfigured.stderr).toContain('offlineExportDir');
    // A local-paths.json that exists but lacks the key (the real one starts out with workshopDataSrc only) counts as unset.
    repo.writeLocalPaths(JSON.stringify({ workshopDataSrc: '/some/where.json' }));
    const noKey = repo.run();
    expect(noKey.status).toBe(1);
    expect(noKey.stderr).toContain('offlineExportDir');
    // An empty value is not a folder either.
    repo.writeLocalPaths(JSON.stringify({ offlineExportDir: '  ' }));
    expect(repo.run().status).toBe(1);
    // None of the failed runs wrote anything: the throwaway repo still holds only what miniRepo() put there.
    expect(readdirSync(repo.root).sort()).toEqual(['dist', 'local-paths.json', 'scripts']);
  });

  it('refuses a local-paths.json that is not valid JSON', () => {
    const repo = miniRepo();
    repo.writeLocalPaths('not json');
    const r = repo.run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('is not valid JSON');
    // The environment variable never reads the file, so a broken one does not matter then.
    expect(repo.run({ WORKSHOP_OFFLINE_DIR: join(repo.root, 'out') }).status).toBe(0);
  });

  it('writes nothing, not even the folder, when the build is not self-contained', () => {
    const repo = miniRepo();
    writeFileSync(join(repo.root, 'dist', 'index.html'), GOOD.replace('<div id="app"></div>', '<script src="https://cdn.example/x.js"></script>'));
    const dir = join(repo.root, 'out');
    const r = repo.run({ WORKSHOP_OFFLINE_DIR: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('is not self-contained');
    expect(existsSync(dir)).toBe(false);
  });

  it('hard-codes no machine-specific path or account name (the repo is public)', () => {
    expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(/\/Users\/|\/home\/|CloudStorage|GoogleDrive|@gmail\.com/);
  });
});
