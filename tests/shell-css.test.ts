// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mountTerminal } from '../src/terminal';

// Pins the shell stylesheet decisions so a later edit cannot quietly undo them. Complements the brief's
// tests/shell-static.test.ts (font stack string, no remote assets, page scroll lock).

const css = readFileSync(resolve(__dirname, '../src/style.css'), 'utf8');

interface Rule {
  prelude: string;
  body: string;
}

/** The top-level rules of a stylesheet, comments dropped. An at-rule's body is the text of its nested rules. */
function rules(source: string): Rule[] {
  const src = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  let i = 0;
  for (;;) {
    const open = src.indexOf('{', i);
    if (open < 0) return out;
    let depth = 1;
    let j = open + 1;
    for (; j < src.length && depth > 0; j++) depth += src[j] === '{' ? 1 : src[j] === '}' ? -1 : 0;
    out.push({ prelude: src.slice(i, open).replace(/\s+/g, ' ').trim(), body: src.slice(open + 1, j - 1) });
    i = j;
  }
}

/** property -> value for one declaration block. */
function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of body.split(';')) {
    const k = d.indexOf(':');
    if (k > 0) out[d.slice(0, k).trim()] = d.slice(k + 1).trim();
  }
  return out;
}

/** The declarations of the top-level rule with exactly this selector list. */
function rule(prelude: string): Record<string, string> {
  const r = rules(css).find((x) => x.prelude === prelude);
  if (!r) throw new Error(`style.css has no rule for "${prelude}"`);
  return decls(r.body);
}

/** Every rule, including the ones nested in an @media block. */
function allRules(source: string): Rule[] {
  return rules(source).flatMap((r) => (r.prelude.startsWith('@') ? allRules(r.body) : [r]));
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('fonts', () => {
  it('applies the UI stack (Segoe UI first) to the whole page', () => {
    expect(rule(':root')['--ui']).toMatch(/^"Segoe UI", /);
    expect(rule('html, body')['font-family']).toBe('var(--ui)');
  });
  it('applies the monospace stack to the terminal, and the prompt input inherits it', () => {
    expect(rule(':root')['--mono']).toBe('Consolas, "Cascadia Mono", Menlo, monospace');
    expect(rule('#terminal')['font-family']).toBe('var(--mono)');
    expect(rule('#terminal input, #terminal textarea').font).toBe('inherit');
  });
});

describe('layout', () => {
  it('puts the terminal and the plot side by side, 5 parts to 6', () => {
    expect(rule('#panes')['grid-template-columns']).toBe('minmax(0, 5fr) minmax(0, 6fr)');
  });
  it('stacks them (terminal above plot, equal rows) on narrow or portrait screens', () => {
    const media = rules(css).find((r) => r.prelude.startsWith('@media'));
    expect(media?.prelude).toBe('@media (max-width: 599px), (max-aspect-ratio: 3/4)');
    const nested = rules(media!.body);
    const panes = decls(nested.find((r) => r.prelude === '#panes')!.body);
    expect(panes['grid-template-columns']).toBe('minmax(0, 1fr)');
    expect(panes['grid-template-rows']).toBe('minmax(0, 1fr) minmax(0, 1fr)');
    expect(decls(nested.find((r) => r.prelude === '#terminal')!.body)['border-right']).toBe('0');
  });
});

describe('the plot is left to the plot code', () => {
  it('sets no fill, stroke or opacity anywhere (the plots draw those as attributes, and a CSS rule would override them)', () => {
    const props = allRules(css).flatMap((r) => Object.keys(decls(r.body)));
    expect(props.length).toBeGreaterThan(20); // the parser really read the stylesheet
    expect(props.filter((p) => /^(fill|stroke)(-|$)|^opacity$/.test(p))).toEqual([]);
  });
  it('has no selector that targets an SVG shape element', () => {
    const selectors = allRules(css).flatMap((r) => r.prelude.split(','));
    expect(selectors.length).toBeGreaterThan(15);
    expect(selectors.filter((s) => /(^|[\s>+~])(path|circle|rect|line|polygon|polyline|ellipse)\b/.test(s.trim()))).toEqual([]);
  });
});

describe('the restore notice', () => {
  it('is styled apart from command output: muted colour and italic', () => {
    const notice = rule('#terminal .term-line--notice');
    expect(notice.color).toBe('var(--muted)');
    expect(notice['font-style']).toBe('italic');
  });
  it('keeps the muted colour readable on the terminal background (WCAG AA, 4.5 to 1)', () => {
    const root = rule(':root');
    expect(root['--muted']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(root['--panel']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(root['--muted']!, root['--panel']!)).toBeGreaterThanOrEqual(4.5);
  });
  it('the style matches the element the terminal prints for a notice, and not an output line', () => {
    document.body.innerHTML = '<section id="terminal"></section>';
    const terminal = mountTerminal(document.getElementById('terminal')!, { onEnter: () => {}, onEsc: () => {}, onTab: (p) => p });
    void terminal.printLines(['an output line']);
    terminal.notice('a notice');
    const selector = rules(css).find((r) => r.prelude.includes('term-line--notice'))!.prelude;
    const lines = [...document.querySelectorAll('.term-line')];
    const notice = lines.find((l) => l.textContent === 'a notice')!;
    const output = lines.find((l) => l.textContent === 'an output line')!;
    expect(notice.matches(selector)).toBe(true);
    expect(output.matches(selector)).toBe(false);
  });
});
