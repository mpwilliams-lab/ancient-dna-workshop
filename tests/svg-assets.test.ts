// Every own drawing in src/assets/svg/ is inlined into the page as a data: URL (src/assets.ts), so each one must stay small, hold no
// text (all on-screen text lives in src/content.ts and src/cards.ts, where the content rules scan it), run no script and refer to
// nothing outside itself. The one reference allowed is url(#id) to an id defined in the same file (a gradient): a file shown by an
// <img> is its own document, so its ids cannot clash with the page's. Carry-forward from the Task 16 review, added with J1's irises.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMAGE_IDS } from '../src/assetManifest';

const SVG_DIR = resolve(__dirname, '../src/assets/svg');
const SVG_MAX_BYTES = 2000;
const SVG_NS = 'http://www.w3.org/2000/svg';

const BANNED: readonly (readonly [string, RegExp])[] = [
  ['a <script>', /<script\b/i],
  ['a <foreignObject>', /<foreignObject\b/i],
  ['an href (a link, a <use> or an <image> source)', /href/i],
  ['an <image> element', /<image\b/i],
  ['an event handler (on...=)', /\bon[a-z]+\s*=/i],
  ['an @import', /@import/i],
  ['text (<text> or <tspan>)', /<(?:text|tspan)\b/i],
];

/** What is wrong with an own drawing's source, one line each; [] when it is clean. */
function svgViolations(svg: string): string[] {
  const out: string[] = [];
  const bytes = Buffer.byteLength(svg);
  if (bytes > SVG_MAX_BYTES) out.push(`${bytes} bytes (limit ${SVG_MAX_BYTES})`);
  for (const [what, re] of BANNED) if (re.test(svg)) out.push(`has ${what}`);
  // url(...) only as url(#id) with the id defined in this file; anything left over is an outside reference.
  const ids = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!));
  const rest = svg.replace(/url\(#([A-Za-z][\w.-]*)\)/g, (_whole, id: string) => {
    if (!ids.has(id)) out.push(`url(#${id}) names no id defined in the file`);
    return '';
  });
  if (/url\(/i.test(rest)) out.push('has a url( that is not a local #id reference');
  if (rest.replace(`xmlns="${SVG_NS}"`, '').includes('://')) out.push('has an absolute URL other than the SVG namespace');
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror') !== null) out.push('is not well-formed XML');
  else if (doc.documentElement.localName !== 'svg' || doc.documentElement.namespaceURI !== SVG_NS) out.push('does not start with an <svg> in the SVG namespace');
  return out;
}

const CLEAN = `<svg xmlns="${SVG_NS}" viewBox="0 0 10 10" width="10" height="10"><defs><radialGradient id="g"><stop offset="0" stop-color="#fff"/></radialGradient></defs><circle r="4" fill="url(#g)"/></svg>\n`;

describe('the checker itself: each banned construct is flagged, a local gradient reference is not', () => {
  const insert = (fragment: string): string => CLEAN.replace('</svg>', `${fragment}</svg>`);

  it('passes a small drawing with a gradient defined and used in the file', () => {
    expect(svgViolations(CLEAN)).toEqual([]);
  });
  it.each([
    ['a script', '<script>alert(1)</script>', 'a <script>'],
    ['a foreignObject', '<foreignObject width="5" height="5"/>', 'a <foreignObject>'],
    ['an href', '<use href="#g"/>', 'an href'],
    ['an xlink:href', '<use xlink:href="#g"/>', 'an href'],
    ['an image element', '<image width="5" height="5"/>', 'an <image> element'],
    ['an event handler', '<rect width="1" height="1" onclick="alert(1)"/>', 'an event handler'],
    ['an @import', '<style>@import "x.css";</style>', 'an @import'],
    ['text', '<text>Brown</text>', 'text'],
  ])('flags %s', (_name, fragment, expected) => {
    expect(svgViolations(insert(fragment)).join('\n')).toContain(expected);
  });
  it('flags a url( to an outside file or a data: image, even unclosed, and a #id that is not defined in the file', () => {
    expect(svgViolations(insert('<rect width="1" height="1" fill="url(https://example.org/p.svg#a)"/>')).join('\n')).toContain('not a local #id reference');
    expect(svgViolations(insert('<rect width="1" height="1" fill="url(data:image/png;base64,AAAA)"/>')).join('\n')).toContain('not a local #id reference');
    expect(svgViolations(insert('<rect width="1" height="1" fill="url(#g"/>')).join('\n')).toContain('not a local #id reference');
    expect(svgViolations(insert('<rect width="1" height="1" fill="url(\'#g\')"/>')).join('\n')).toContain('not a local #id reference');
    expect(svgViolations(insert('<rect width="1" height="1" fill="url(#nope)"/>')).join('\n')).toContain('url(#nope) names no id defined in the file');
  });
  it('flags an absolute URL other than the SVG namespace', () => {
    expect(svgViolations(CLEAN.replace('<defs>', '<desc>https://example.org/</desc><defs>')).join('\n')).toContain('absolute URL');
    expect(svgViolations(CLEAN.replace('<svg ', '<svg xmlns:x="http://www.w3.org/1999/xlink" ')).join('\n')).toContain('absolute URL');
  });
  it('flags a file over 2000 bytes, malformed XML and a root that is not <svg>', () => {
    expect(svgViolations(insert(`<!-- ${'x'.repeat(2000)} -->`)).join('\n')).toContain('(limit 2000)');
    expect(svgViolations(CLEAN.replace('</svg>', '</g></svg>')).join('\n')).toContain('not well-formed');
    expect(svgViolations(CLEAN.replace(/svg/g, 'html')).join('\n')).toContain('does not start with an <svg>');
  });
});

describe('src/assets/svg/*.svg (Task 16 Part B carry-forward, J1)', () => {
  const files = readdirSync(SVG_DIR).filter((f) => f.endsWith('.svg')).sort();

  it('holds the own drawings, each named for a manifest image id (src/assets.ts bundles nothing else)', () => {
    expect(files.length, 'the Thornborough plan and the irises').toBeGreaterThanOrEqual(2);
    for (const f of files) expect(IMAGE_IDS as readonly string[], f).toContain(f.replace(/\.svg$/, ''));
  });
  for (const f of files) {
    it(`${f} is at most ${SVG_MAX_BYTES} bytes, with no script, text, image or reference to anything outside the file`, () => {
      expect(svgViolations(readFileSync(join(SVG_DIR, f), 'utf8')), f).toEqual([]);
    });
  }
});
