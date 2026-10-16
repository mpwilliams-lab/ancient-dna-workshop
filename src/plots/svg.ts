import type { PeriodId, SourceId } from '../types';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Round to one decimal for SVG attributes ("-0" becomes "0"). */
export function f1(v: number): string {
  const r = Math.round(v * 10) / 10;
  return (r === 0 ? 0 : r).toString();
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, typeof v === 'number' ? f1(v) : v);
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Greedy word wrap; a single word longer than maxChars gets its own line. */
export function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur === '') cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

/**
 * Multi-line SVG text. Every tspan but the last keeps a trailing space, so
 * element.textContent equals the original sentence exactly (tests and e2e read it).
 */
export function textBlock(
  text: string,
  maxChars: number,
  x: number,
  y: number,
  lineHeight: number,
  attrs: Record<string, string | number> = {},
): { el: SVGTextElement; lines: number } {
  const lines = wrapText(text, maxChars);
  const el = svgEl('text', { x, y, ...attrs });
  lines.forEach((line, i) => {
    const span = svgEl('tspan', { x, dy: i === 0 ? 0 : lineHeight }, i < lines.length - 1 ? `${line} ` : line);
    el.append(span);
  });
  return { el, lines: lines.length };
}

// Okabe–Ito hues. The six used for periods pass the dataviz validator all-pairs
// (normal-vision ΔE >= 15.6); CVD worst pair 7.6 is backed by shapes + labels.
export const OKABE_ITO = {
  orange: '#E69F00',
  skyBlue: '#56B4E9',
  green: '#009E73',
  blue: '#0072B2',
  vermillion: '#D55E00',
  purple: '#CC79A7',
  black: '#000000',
} as const;

export const MAP_GREY = '#B3B3B3';
export const TODAY_GREY = '#595959';
export const INK = '#1A1A1A';

export const PERIOD_COLORS: Record<PeriodId, string> = {
  FirstFarmers: OKABE_ITO.orange,
  BellBeaker: OKABE_ITO.purple,
  BronzeAge: OKABE_ITO.green,
  IronAge: OKABE_ITO.blue,
  Roman: OKABE_ITO.vermillion,
  AngloSaxon: OKABE_ITO.skyBlue,
  Viking: OKABE_ITO.black,
  Today: TODAY_GREY,
};

export type Shape = 'circle' | 'square' | 'triangle' | 'diamond';
export const PERIOD_SHAPES: Record<PeriodId, Shape> = {
  FirstFarmers: 'circle',
  BellBeaker: 'square',
  BronzeAge: 'diamond',
  IronAge: 'circle',
  Roman: 'square',
  AngloSaxon: 'triangle',
  Viking: 'diamond',
  Today: 'circle',
};

export const SOURCE_COLORS: Record<SourceId, string> = {
  STEPPE: OKABE_ITO.blue,
  FARMER: OKABE_ITO.orange,
  WHG: OKABE_ITO.green,
};

/** Path data for a marker of the given shape centred on (x, y) with radius r. */
export function shapePath(shape: Shape, x: number, y: number, r: number): string {
  switch (shape) {
    case 'circle':
      return `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0Z`;
    case 'square': {
      const s = 0.9 * r;
      return `M${f1(x - s)} ${f1(y - s)}h${f1(2 * s)}v${f1(2 * s)}h${f1(-2 * s)}Z`;
    }
    case 'triangle':
      return `M${f1(x)} ${f1(y - 1.25 * r)}L${f1(x + 1.1 * r)} ${f1(y + 0.7 * r)}L${f1(x - 1.1 * r)} ${f1(y + 0.7 * r)}Z`;
    case 'diamond':
      return `M${f1(x)} ${f1(y - 1.3 * r)}L${f1(x + 1.3 * r)} ${f1(y)}L${f1(x)} ${f1(y + 1.3 * r)}L${f1(x - 1.3 * r)} ${f1(y)}Z`;
  }
}

const wired = new WeakSet<SVGSVGElement>();

/**
 * Tap/hover label: any element with data-tip shows that text (and nothing else)
 * in the svg's .plot-tip element. Listeners are attached once per svg element.
 */
export function wireTips(svg: SVGSVGElement): void {
  if (wired.has(svg)) return;
  wired.add(svg);
  const show = (e: Event) => {
    const tip = svg.querySelector('.plot-tip');
    if (!tip) return;
    const target = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    tip.textContent = target ? target.getAttribute('data-tip') ?? '' : '';
  };
  svg.addEventListener('pointerover', show);
  svg.addEventListener('click', show);
  svg.addEventListener('pointerleave', () => {
    const tip = svg.querySelector('.plot-tip');
    if (tip) tip.textContent = '';
  });
}
