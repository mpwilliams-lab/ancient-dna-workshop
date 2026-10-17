// @vitest-environment node
// J1's own iris drawing (spec §3.4 J1, §7.1): small, text-free, self-contained SVG.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const IRISES = fileURLToPath(new URL('../src/assets/svg/irises.svg', import.meta.url));

describe('src/assets/svg/irises.svg', () => {
  it('exists', () => {
    expect(existsSync(IRISES)).toBe(true);
  });
  it('is small, has no text, script, image or external reference, and draws three irises', () => {
    const svg = readFileSync(IRISES, 'utf8');
    expect(Buffer.byteLength(svg)).toBeLessThanOrEqual(3 * 1024);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).not.toMatch(/<text|<script|<foreignObject|<image|href=|url\((?!#)|on[a-z]+=/i);
    expect((svg.match(/<radialGradient /g) ?? []).length).toBe(3);
    expect((svg.match(/<circle r="50" fill="url\(#(brown|green|blue)\)"/g) ?? []).length).toBe(3);
  });
});
