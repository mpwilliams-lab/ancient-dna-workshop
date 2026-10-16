// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));

/**
 * The workflow with its comments removed (whole-line comments, and a trailing "  # ..."), blank lines dropped.
 * Every check below runs on these lines and compares whole lines. So a commented-out gate cannot satisfy a check,
 * a comment cannot hide a bypass, and `npm test || true` is not the line `npm test`.
 */
const lines = readFileSync(resolve(__dirname, '../.github/workflows/pages.yml'), 'utf8')
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .map((l) => l.replace(/\s+#.*$/, '').trimEnd())
  .filter((l) => l !== '');
const yml = `${lines.join('\n')}\n`;

/** The lines of one job under `jobs:` (its key sits at two spaces), up to the next job. */
function job(name: string): string[] {
  const at = lines.indexOf(`  ${name}:`);
  expect(at, `job "${name}" is missing`).toBeGreaterThan(-1);
  const body = lines.slice(at + 1);
  const next = body.findIndex((l) => /^ {2}\S/.test(l));
  return next === -1 ? body : body.slice(0, next);
}

describe('GitHub Pages workflow', () => {
  it('deploys main with the Pages permissions', () => {
    expect(yml).toMatch(/on:\n  push:\n    branches: \[main\]/);
    expect(lines).toContain('permissions:');
    expect(lines).toContain('  contents: read');
    expect(lines).toContain('  pages: write');
    expect(lines).toContain('  id-token: write');
  });
  it('has no way to wave a failed step through or to skip one', () => {
    expect(yml).not.toContain('||');
    expect(yml).not.toMatch(/continue-on-error/);
    expect(yml).not.toMatch(/^\s*(?:- )?if:/m);
  });
  it('queues deploys instead of cancelling one that is running', () => {
    expect(lines).toContain('concurrency:');
    expect(lines).toContain('  group: pages');
    expect(lines).toContain('  cancel-in-progress: false');
    expect(yml).not.toMatch(/cancel-in-progress:\s*true/);
  });
  it('pins both jobs to Ubuntu 24.04 (ubuntu-latest becomes Ubuntu 26 on 2026-10-19) with a 10 minute timeout', () => {
    expect(yml).not.toContain('ubuntu-latest');
    for (const name of ['build', 'deploy']) {
      expect(job(name), `${name}: runs-on`).toContain('    runs-on: ubuntu-24.04');
      expect(job(name), `${name}: timeout-minutes`).toContain('    timeout-minutes: 10');
    }
  });
  it('deploys only after build succeeds, into the github-pages environment', () => {
    const deploy = job('deploy');
    expect(deploy).toContain('    needs: build');
    expect(deploy).toContain('      name: github-pages');
    expect(deploy).toContain('        uses: actions/deploy-pages@v5');
  });
  it('tests and builds with Node 24 from the lockfile, gate after gate, before uploading dist', () => {
    const build = job('build');
    const order = [
      '      - uses: actions/checkout@v7',
      '      - uses: actions/setup-node@v7',
      '          node-version: 24',
      '      - run: npm ci',
      '      - run: npm test',
      '      - run: npm run check-data',
      '      - run: npm run build',
      '      - run: test -s dist/index.html',
      '      - uses: actions/configure-pages@v6',
      '      - uses: actions/upload-pages-artifact@v5',
      '          path: dist',
    ];
    let at = -1;
    for (const s of order) {
      expect(build.filter((l) => l === s), `${s.trim()}: exactly one such line in the build job`).toHaveLength(1);
      const i = build.indexOf(s);
      expect(i, s.trim()).toBeGreaterThan(at);
      at = i;
    }
  });
  it('package.json builds with the QR pre-render', () => {
    expect(pkg.scripts.prebuild).toBe('node scripts/make-qr.mjs');
    expect(pkg.scripts.build).toMatch(/vite build/);
  });
  it('package.json check-data runs the real-data tests, which skip unless REAL_DATA=1', () => {
    expect(pkg.scripts['check-data']).toBe('REAL_DATA=1 vitest run tests/real-data.test.ts');
  });
});
