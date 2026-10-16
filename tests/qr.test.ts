// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { QR_SVG, QR_URL } from '../src/generated/qr';

const ROOT = resolve(__dirname, '..');

/** Rasterises the qrcode-library SVG (one <path> of h-runs drawn with stroke) to RGBA. */
function rasterise(svg: string, scale = 8): { data: Uint8ClampedArray; size: number } {
  const n = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)![1]);
  const d = /<path stroke="#000000" d="([^"]+)"/.exec(svg)![1];
  const size = n * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  let x = 0;
  let y = 0;
  const re = /([MmHh])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g;
  for (let m = re.exec(d); m; m = re.exec(d)) {
    const [, cmd, a, b] = m;
    if (cmd === 'M') { x = Number(a); y = Number(b); }
    else if (cmd === 'm') { x += Number(a); y += Number(b); }
    else {
      const len = cmd === 'h' ? Number(a) : Number(a) - x;
      const row = Math.floor(y);
      for (let cx = x; cx < x + len; cx++) {
        for (let py = row * scale; py < (row + 1) * scale; py++) {
          for (let px = cx * scale; px < (cx + 1) * scale; px++) {
            const i = (py * size + px) * 4;
            data[i] = data[i + 1] = data[i + 2] = 0;
          }
        }
      }
      x += len;
    }
  }
  return { data, size };
}

describe('pre-rendered QR code', () => {
  it('targets the GitHub Pages URL', () => {
    expect(QR_URL).toBe('https://mpwilliams-lab.github.io/ancient-dna-workshop/');
  });
  it('is a 41x41-module inline SVG (QR version 4 + 4-module quiet zone)', () => {
    expect(QR_SVG.startsWith('<svg')).toBe(true);
    expect(QR_SVG).toContain('viewBox="0 0 41 41"');
    expect(QR_SVG).not.toMatch(/<script|href=/i);
  });
  it('decodes to the Pages URL', () => {
    const { data, size } = rasterise(QR_SVG);
    expect(jsQR(data, size, size)?.data).toBe(QR_URL);
  });
  it('the committed src/generated/qr.ts matches a fresh run of scripts/make-qr.mjs', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'qr-')), 'qr.ts');
    execFileSync(process.execPath, [join(ROOT, 'scripts/make-qr.mjs'), out]);
    expect(readFileSync(out, 'utf8')).toBe(readFileSync(join(ROOT, 'src/generated/qr.ts'), 'utf8'));
  });
});
