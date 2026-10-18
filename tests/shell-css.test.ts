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
  // Task 26: the PCA's caption strip follows the plot. The svg takes the height its own proportions give it at the pane's width (and
  // so the blank band that sat between the legend and the strip, 106 px at 1366 x 768, is gone), yet can still shrink where the pane is
  // too short for plot and strip together, and stays anchored to the pane's top. e2e/layout.spec.ts measures it in the browser.
  it('lets the PCA svg take its own proportions\' height and shrink, and no other view: the bars keep filling the pane', () => {
    const pca = rule('#plot[data-view="pca"] > svg.plot-svg');
    expect(pca.flex).toBe('0 1 auto');
    expect(pca.height).toBe('auto');
    expect(rule('#plot > svg').flex).toBe('1 1 auto');
    expect(rule('#plot > svg').height).toBe('100%');
    expect(rule('#plot > svg')['min-height']).toBe('0');      // the shrinking depends on it
    const order = rules(css).map((r) => r.prelude);
    expect(order.indexOf('#plot[data-view="pca"] > svg.plot-svg'), 'after the general rule it overrides').toBeGreaterThan(order.indexOf('#plot > svg'));
  });
});

describe('the header Back button (Task 17, spec §4.3)', () => {
  it('takes the free space of the header bar, so it sits beside "Take this home" and the title keeps the left edge', () => {
    expect(rule('#back')['margin-left']).toBe('auto');
    expect(rule('#bar').display).toBe('flex');
  });
  it('looks disabled by colour alone: muted text, the quiet border, the default cursor (no opacity: the plots draw theirs as attributes)', () => {
    const disabled = rule('#bar button:disabled');
    expect(disabled.color).toBe('var(--muted)');
    expect(disabled['border-color']).toBe('var(--border)');
    expect(disabled.cursor).toBe('default');
    expect(Object.keys(disabled)).not.toContain('opacity');
  });
  it('takes no pointer events, so a click on it reaches the header and the prompt gets the keyboard back (Chrome sends none to a disabled control)', () => {
    expect(rule('#bar button:disabled')['pointer-events']).toBe('none');
  });
  it('selects nothing: a double or triple click on the header would highlight "Back", and keepPromptFocused leaves the focus alone while text is selected', () => {
    expect(rule('#bar')['user-select']).toBe('none');
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
  it('F1 caps its pictures below the general cap so its photo form fits at normal size at 1366 x 768 (Task 21): inside the spec bound, never above it', () => {
    const cap = rule('#card[data-card-id="F1"] .card-tile img')['max-height'];
    expect(cap).toBe('min(15vh, 230px)');
    const m = /^min\((\d+(?:\.\d+)?)vh, (\d+)px\)$/.exec(cap!);
    expect(m, 'a min(Nvh, Mpx) cap, comparable with the spec bound').not.toBeNull();
    expect(Number(m![1]), 'never above the spec bound min(26vh, 230px): the vh part').toBeLessThanOrEqual(26);
    expect(Number(m![2]), 'never above the spec bound min(26vh, 230px): the px part').toBeLessThanOrEqual(230);
    // The cap belongs to F1 alone: no other card has a per-card picture cap.
    const perCard = allRules(css).filter((r) => /data-card-id/.test(r.prelude) && /\.card-tile img/.test(r.prelude));
    expect(perCard.map((r) => r.prelude)).toEqual(['#card[data-card-id="F1"] .card-tile img']);
  });
  // After Task 26 (review of Task 25): a card with a single picture (I1's diagram, J1's drawing) may draw it larger than the general cap, because
  // its tile spans the whole card and a picture held to min(26vh, 230px) sits small in a wide grey panel. The cap is a ramp, not a step: it leaves
  // the general cap at a window height of 640 px, grows 0.54 px per px of height, and stops at min(35vh, 380px), which it reaches at 768 px, the
  // height of the 1366 x 768 lab screen. (Fix round 1: a step at 600 px gave a picture 54 px taller to windows with 35 px to spare and tipped the
  // card to dense; the ramp leaves 43 px or more to spare in 6,540 windows.) The stacked layout, where the card is only the lower half of the
  // window, keeps the general cap. e2e/layout.spec.ts measures all of it in the browser.
  it('lets a card with a single picture draw it larger by a ramp that starts at 640 px of window height and reaches min(35vh, 380px) at 768 px, and not in the stacked layout', () => {
    const SINGLE = '#card .card-tiles[data-count="1"] .card-tile img';
    const all = rules(css);
    const generalCap = rule('#card .card-tile img')['max-height']!;
    expect(generalCap).toBe('min(26vh, 230px)');
    expect(all.filter((r) => r.prelude === SINGLE), 'one top-level single-picture rule').toHaveLength(1);
    const single = rule(SINGLE)['max-height']!;
    expect(single).toBe('max(min(26vh, 230px), min(35vh, 380px, calc(26vh + 0.54 * (100vh - 640px))))');

    // The cap at a window height h (CSS px), evaluated from the numbers in the stylesheet itself.
    const m = /^max\(min\((\d+)vh, (\d+)px\), min\((\d+)vh, (\d+)px, calc\((\d+)vh \+ ([\d.]+) \* \(100vh - (\d+)px\)\)\)\)$/.exec(single);
    expect(m, 'max(general, min(ceiling, calc(general + slope * (100vh - start))))').not.toBeNull();
    const [gv, gp, cv, cp, rv, slope, start] = m!.slice(1).map(Number) as [number, number, number, number, number, number, number];
    expect([gv, gp, rv], 'the ramp starts from the general cap').toEqual([26, 230, 26]);
    const general = (h: number): number => Math.min((gv * h) / 100, gp);
    const ceiling = (h: number): number => Math.min((cv * h) / 100, cp);
    const cap = (h: number): number => Math.max(general(h), Math.min(ceiling(h), (rv * h) / 100 + slope * (h - start)));
    const bad: string[] = [];
    for (let h = 300; h <= 2400; h++) {
      if (h <= start && Math.abs(cap(h) - general(h)) > 1e-9) bad.push(`${h} px: ${cap(h)} is not the general cap ${general(h)}: nothing is added up to ${start} px`);
      if (cap(h) < general(h) - 1e-9) bad.push(`${h} px: below the general cap`);
      if (cap(h) > ceiling(h) + 1e-9) bad.push(`${h} px: above min(${cv}vh, ${cp}px)`);
      const step = cap(h + 1) - cap(h);
      if (step < -1e-9 || step > 1 + 1e-9) bad.push(`${h} px: the cap changes by ${step.toFixed(3)} px for one more px of window height (a cliff)`);
      if (h >= 768 && Math.abs(cap(h) - ceiling(h)) > 1e-9) bad.push(`${h} px: the ramp has not reached min(${cv}vh, ${cp}px) at 768 px`);
    }
    expect(bad.slice(0, 8), 'the ramp at every window height from 300 to 2400 px').toEqual([]);

    // The stacked layout puts the general cap back: the same selector, in a block that comes later in the file, so it wins at equal specificity.
    // Both positions come from the same list of rules, so the order check means something.
    const singleAt = all.findIndex((r) => r.prelude === SINGLE);
    const stackedAt = all.findIndex((r) => r.prelude === '@media (max-width: 599px), (max-aspect-ratio: 3/4)' && rules(r.body).some((x) => x.prelude === SINGLE));
    expect(singleAt, 'the single-picture rule is a top-level rule').toBeGreaterThanOrEqual(0);
    expect(stackedAt, 'a stacked block carries the override').toBeGreaterThanOrEqual(0);
    expect(all.filter((r) => r.prelude.startsWith('@media') && rules(r.body).some((x) => x.prelude === SINGLE)), 'only that block').toHaveLength(1);
    expect(decls(rules(all[stackedAt]!.body).find((x) => x.prelude === SINGLE)!.body)).toEqual({ 'max-height': generalCap });
    expect(stackedAt, 'the override comes after the single-picture rule, so it wins').toBeGreaterThan(singleAt);
    // Nothing else caps a tile picture's height: the general rule, the single-picture one and its stacked override, and F1's own.
    const capped = allRules(css).filter((r) => /\.card-tile img/.test(r.prelude) && 'max-height' in decls(r.body)).map((r) => r.prelude).sort();
    expect(capped).toEqual(['#card .card-tile img', '#card[data-card-id="F1"] .card-tile img', SINGLE, SINGLE].sort());
  });
  it('shows every card picture whole (Task 21 ruling): no card-image rule sets object-fit: cover or an aspect-ratio, and the letterbox has a background', () => {
    const pictureRules = allRules(css).filter((r) => /\.card-tile img|\.tile-img/.test(r.prelude));
    expect(pictureRules.length, 'the base, compact and contain rules').toBeGreaterThanOrEqual(3);
    for (const r of pictureRules) {
      const d = decls(r.body);
      expect(d['object-fit'], r.prelude).not.toBe('cover');
      expect(d['aspect-ratio'], `${r.prelude} (a fixed box would cut or pad a picture that is shown in its own proportions)`).toBeUndefined();
    }
    expect(allRules(css).some((r) => r.prelude.includes('tile-img--cover')), 'no selector for a cover class').toBe(false);
    expect(rule('#card .card-tile img')['object-fit']).toBe('contain');
    expect(rule('#card .card-tile img.tile-img--contain')).toMatchObject({ 'object-fit': 'contain', background: '#f2f2f2' });
  });
  it('gives the value labels room for "Europe (large sample)" on one line (label column up to 12em), but not in the long two-column list, which keeps its longer bars', () => {
    expect(rule('#card .value-row')['grid-template-columns']).toBe('minmax(6.5em, 12em) minmax(3em, 1fr) 2.6em');
    expect(rule('#card .card-values[data-long] .value-row')['grid-template-columns']).toBe('minmax(6.5em, 9.5em) minmax(3em, 1fr) 2.6em');
  });
});
