// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allRenderableStrings, SHELL_STRINGS } from '../src/content';

const ROOT = resolve(__dirname, '..');
const css = readFileSync(resolve(ROOT, 'src/style.css'), 'utf8');
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

describe('shell static files', () => {
  it('uses the Windows-first monospace stack and loads no fonts or remote assets', () => {
    expect(css).toContain('--mono: Consolas, "Cascadia Mono", Menlo, monospace;');
    expect(css).not.toMatch(/@import|@font-face|url\(/i);
    expect(html).not.toMatch(/(src|href)="https?:/i);
  });
  it('declares an inline data: icon, so no browser asks the server for /favicon.ico', () => {
    const head = /<head>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
    const links = head.match(/<link\b[^>]*>/gi) ?? [];
    expect(links.some((l) => /\brel="icon"/.test(l))).toBe(true);
    // Nothing the head links to is fetched: every <link> carries its content inline.
    for (const l of links) expect(l).toMatch(/\bhref="data:/);
  });
  it('locks the page itself against scrolling (terminal output scrolls inside its pane)', () => {
    expect(css).toMatch(/html,\s*body\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/#terminal \.term-out\s*\{[^}]*overflow-y:\s*auto/);
  });
  it('has every element the shell wires up', () => {
    for (const id of ['app', 'bar', 'app-title', 'wrap-open', 'panes', 'terminal', 'plot', 'card', 'wrap', 'wrap-line', 'wrap-caption', 'wrap-qr', 'wrap-url', 'wrap-org', 'wrap-close']) {
      expect(html).toContain(`id="${id}"`);
    }
  });
  it('shell strings obey spec §6 rule 1 (no dates, no banned period words)', () => {
    for (const s of SHELL_STRINGS) {
      expect(s).not.toMatch(/\b(BCE|BC|BP|kya|ya)\b|years ago|generations ago/i);
      expect(s).not.toMatch(/Mesolithic|Neolithic|Pal(a)?eolithic|Megalithic|Ice Age/i);
    }
  });
  it('allRenderableStrings() returns every shell string, so the full spec §6 scan covers them', () => {
    const all = allRenderableStrings();
    for (const s of SHELL_STRINGS) expect(all).toContain(s);
  });
});
