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

describe('card overlay (spec §5.2, CONTRACT §4.11)', () => {
  const nested = (prelude: string): Rule[] => {
    const media = rules(css).find((r) => r.prelude === prelude);
    if (!media) throw new Error(`style.css has no "${prelude}" block`);
    return rules(media.body);
  };
  it('defines the card tokens on :root', () => {
    const root = rule(':root');
    for (const t of ['--card-bg', '--card-fg', '--map-land']) expect(root[t], t).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(root['--card-fg']!, root['--card-bg']!)).toBeGreaterThanOrEqual(7);
  });
  it('places #card over the plot column at >= 1100 px: absolute in #panes, opaque, the body font clamp', () => {
    const card = rule('#card');
    expect(card.position).toBe('absolute');
    expect(card.left).toBe('calc(100% * 5 / 11)');
    expect([card.top, card.right, card.bottom]).toEqual(['0', '0', '0']);
    expect(card.background).toBe('var(--card-bg)');
    expect(card['font-size']).toBe('clamp(14px, 1.15vw + 0.5vh, 19px)');
    expect(rule('#card[hidden]').display).toBe('none');
    const panes = rules(css).filter((r) => r.prelude === '#panes').map((r) => decls(r.body));
    expect(panes.some((d) => d.position === 'relative')).toBe(true);
  });
  it('below 1100 px it covers both panes down to the hint line', () => {
    const r = decls(nested('@media (max-width: 1099px)').find((x) => x.prelude === '#card')!.body);
    expect(r.left).toBe('0');
    expect(r.bottom).toBe('var(--card-bottom, 0px)');
  });
  it('in the stacked layout it covers the plot pane only, and that rule comes after the 1100 px one', () => {
    const blocks = rules(css).filter((r) => r.prelude.startsWith('@media'));
    const stackedCard = blocks.findIndex((b) => b.prelude === '@media (max-width: 599px), (max-aspect-ratio: 3/4)' && /#card\s*\{/.test(b.body));
    const narrow = blocks.findIndex((b) => b.prelude === '@media (max-width: 1099px)');
    expect(stackedCard).toBeGreaterThan(narrow);
    const r = decls(rules(blocks[stackedCard]!.body).find((x) => x.prelude === '#card')!.body);
    expect([r.left, r.top, r.bottom]).toEqual(['0', '50%', '0']);
  });
  it('keeps the footer outside the scrolling body; only .scroll lets the body scroll', () => {
    expect(rule('#card .card-body').overflow).toBe('hidden');
    expect(rule('#card.scroll .card-body')['overflow-y']).toBe('auto');
    expect(rule('#card .card-footer').flex).toBe('0 0 auto');
  });
  it('dense shrinks the font; compact hides leads, tile images and optional tiles, and splits value lists', () => {
    expect(rule('#card.dense')['font-size']).toBe('calc(clamp(14px, 1.15vw + 0.5vh, 19px) * 0.9)');
    expect(rule('#card.compact .card-lead, #card.compact .card-tile img, #card.compact .card-tile.is-optional').display).toBe('none');
    expect(rule('#card.compact .card-values').columns).toBe('2');
    expect(rule('#card .card-values[data-long]').columns).toBe('2 14em');
  });
  it('images and maps keep the §5.2 height caps', () => {
    expect(rule('#card .card-tile img')['max-height']).toBe('min(26vh, 230px)');
    expect(rule('#card .card-map')['max-height']).toBe('min(52vh, 460px)');
  });
  it('gives the value labels room for "Europe (large sample)" on one line (label column up to 12em), but not in the long two-column list, which keeps its longer bars', () => {
    expect(rule('#card .value-row')['grid-template-columns']).toBe('minmax(6.5em, 12em) minmax(3em, 1fr) 2.6em');
    expect(rule('#card .card-values[data-long] .value-row')['grid-template-columns']).toBe('minmax(6.5em, 9.5em) minmax(3em, 1fr) 2.6em');
  });
});
