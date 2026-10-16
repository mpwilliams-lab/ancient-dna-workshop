// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const yml = readFileSync(resolve(__dirname, '../.github/workflows/pages.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));

describe('GitHub Pages workflow', () => {
  it('deploys main with the Pages permissions', () => {
    expect(yml).toMatch(/on:\n  push:\n    branches: \[main\]/);
    expect(yml).toContain('  pages: write\n');
    expect(yml).toContain('  id-token: write\n');
  });
  it('tests and builds with Node 24 from the lockfile before uploading dist', () => {
    const order = ['actions/checkout@v7', 'node-version: 24', 'run: npm ci', 'run: npm test', 'run: npm run build', 'actions/configure-pages@v6', 'actions/upload-pages-artifact@v5', 'path: dist', 'actions/deploy-pages@v5'];
    let at = -1;
    for (const s of order) {
      const i = yml.indexOf(s);
      expect(i, s).toBeGreaterThan(at);
      at = i;
    }
  });
  it('package.json builds with the QR pre-render', () => {
    expect(pkg.scripts.prebuild).toBe('node scripts/make-qr.mjs');
    expect(pkg.scripts.build).toMatch(/vite build/);
  });
});
