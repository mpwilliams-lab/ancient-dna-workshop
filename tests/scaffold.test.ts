import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

describe('scaffold', () => {
  it('pins every dev dependency to an exact version', () => {
    expect(pkg.devDependencies).toEqual({
      '@playwright/test': '1.63.0',
      '@types/node': '24.13.6',
      '@types/qrcode': '1.5.6',
      jsdom: '30.1.1',
      jsqr: '1.4.0',
      qrcode: '1.5.4',
      typescript: '5.9.3',
      vite: '8.3.1',
      'vite-plugin-singlefile': '2.3.3',
      vitest: '5.0.3',
    });
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('runs unit tests in jsdom', () => {
    expect(typeof document.createElement).toBe('function');
  });

  it('index.html has the app title, a mount point and no external resources', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('<title>Ancient DNA of Britain</title>');
    expect(html).toContain('<div id="app">');
    expect(html).not.toMatch(/https?:\/\//);
  });
});
