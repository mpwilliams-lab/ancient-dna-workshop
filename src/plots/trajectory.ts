import type { AxisTick, GeneId, Trait, TraitPoint, WorkshopData } from '../types';
import {
  GENE_TRAIT_LABELS, HLA_REVEAL_LINE, HLA_TEXT_CARD, LOCAL_ANGLO_SAXON_POINT_LABEL, PERIOD_LABELS, TICK_LABELS, TRAIT_Y_LABEL,
  countNote, traitCaption, traitSourceLabel,
} from '../content';
import { INK, OKABE_ITO, f1, svgEl, textBlock } from './svg';

export const TRAJ_VIEW = { width: 1000, height: 520, left: 84, right: 960, top: 24, bottom: 440 } as const;
const LINE = OKABE_ITO.blue;

export interface TrajScale {
  tMax: number; tMin: number; yMax: number; yStep: number;
  toX(t: number): number;
  toY(f: number): number;
}

/**
 * Time runs left (oldest) to right (today). `t` is internal only: it positions marks
 * and is never printed. The y range is 0..yMax, where yMax is the smallest step multiple
 * covering every upper interval bound (step 0.1 up to 40%, else 0.25).
 */
export function trajectoryScale(points: TraitPoint[], ticks: AxisTick[]): TrajScale {
  const ts = [...points.map((p) => p.t), ...ticks.map((k) => k.t)];
  const tMax = ts.length ? Math.max(...ts) : 1;
  const tMin = ts.length ? Math.min(...ts) : 0;
  const span = tMax - tMin || 1;
  const hi = points.length ? Math.max(...points.map((p) => p.hi)) : 1;
  const yStep = hi <= 0.4 ? 0.1 : 0.25;
  const yMax = Math.min(1, Math.max(yStep, Math.ceil(hi / yStep - 1e-9) * yStep));
  const w = TRAJ_VIEW.right - TRAJ_VIEW.left;
  const h = TRAJ_VIEW.bottom - TRAJ_VIEW.top;
  return {
    tMax, tMin, yMax, yStep,
    toX: (t) => TRAJ_VIEW.left + ((tMax - t) / span) * w,
    toY: (f) => TRAJ_VIEW.bottom - (Math.min(Math.max(f, 0), yMax) / yMax) * h,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function axes(svg: SVGSVGElement, sc: TrajScale, ticks: AxisTick[]): void {
  const g = svgEl('g', { class: 'axes' });
  const steps = Math.round(sc.yMax / sc.yStep);
  for (let i = 0; i <= steps; i += 1) {
    const v = i * sc.yStep;
    const y = sc.toY(v);
    g.append(svgEl('line', { class: 'grid', x1: TRAJ_VIEW.left, x2: TRAJ_VIEW.right, y1: y, y2: y, stroke: '#D9D9D9', 'stroke-width': 1 }));
    g.append(svgEl('text', { class: 'y-tick', x: TRAJ_VIEW.left - 10, y: y + 5, 'text-anchor': 'end', 'font-size': 16, fill: INK }, `${Math.round(v * 100)}%`));
  }
  const midY = (TRAJ_VIEW.top + TRAJ_VIEW.bottom) / 2;
  g.append(svgEl('text', {
    class: 'y-label', x: 20, y: midY, transform: `rotate(-90 20 ${f1(midY)})`, 'text-anchor': 'middle', 'font-size': 16, fill: INK,
  }, TRAIT_Y_LABEL));
  // Period-name ticks only (no numbers); neighbours alternate between two rows.
  [...ticks].sort((a, b) => b.t - a.t).forEach((k, i) => {
    const x = sc.toX(k.t);
    g.append(svgEl('line', { class: 'x-tick', x1: x, x2: x, y1: TRAJ_VIEW.bottom, y2: TRAJ_VIEW.bottom + 6, stroke: INK, 'stroke-width': 1.5 }));
    g.append(svgEl('text', {
      class: 'x-tick-label', 'data-key': k.key, x, y: TRAJ_VIEW.bottom + 26 + (i % 2) * 22, 'text-anchor': 'middle', 'font-size': 16, fill: INK,
    }, TICK_LABELS[k.key]));
  });
  g.append(svgEl('line', { class: 'x-axis', x1: TRAJ_VIEW.left, x2: TRAJ_VIEW.right, y1: TRAJ_VIEW.bottom, y2: TRAJ_VIEW.bottom, stroke: INK, 'stroke-width': 1.5 }));
  svg.append(g);
}

function linePath(pts: TraitPoint[], sc: TrajScale, key: 'f' | 'lo' | 'hi'): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${f1(sc.toX(p.t))} ${f1(sc.toY(p[key]))}`).join('');
}

function drawAges(svg: SVGSVGElement, pts: TraitPoint[], sc: TrajScale): void {
  const upper = linePath(pts, sc, 'hi');
  const lower = [...pts].reverse().map((p) => `L${f1(sc.toX(p.t))} ${f1(sc.toY(p.lo))}`).join('');
  svg.append(svgEl('path', { class: 'traj-band', d: `${upper}${lower}Z`, fill: LINE, 'fill-opacity': 0.2, stroke: 'none' }));
  svg.append(svgEl('path', { class: 'traj-line', d: linePath(pts, sc, 'f'), fill: 'none', stroke: LINE, 'stroke-width': 2.5 }));
}

function drawLocal(svg: SVGSVGElement, trait: Trait, pts: TraitPoint[], sc: TrajScale): void {
  svg.append(svgEl('path', {
    class: 'traj-line', d: linePath(pts, sc, 'f'), fill: 'none', stroke: LINE, 'stroke-width': 1.5, 'stroke-dasharray': '4 4',
  }));
  const labels = svgEl('g', { class: 'traj-labels' });
  for (const p of pts) {
    const x = sc.toX(p.t);
    const yf = sc.toY(p.f);
    const yHi = sc.toY(p.hi);
    const yLo = sc.toY(p.lo);
    svg.append(svgEl('line', { class: 'traj-whisker', x1: x, x2: x, y1: yLo, y2: yHi, stroke: LINE, 'stroke-width': 2 }));
    svg.append(svgEl('line', { class: 'traj-whisker-cap', x1: x - 6, x2: x + 6, y1: yHi, y2: yHi, stroke: LINE, 'stroke-width': 2 }));
    svg.append(svgEl('line', { class: 'traj-whisker-cap', x1: x - 6, x2: x + 6, y1: yLo, y2: yLo, stroke: LINE, 'stroke-width': 2 }));
    svg.append(svgEl('circle', { class: 'traj-point', 'data-period': p.period ?? '', cx: x, cy: yf, r: 7, fill: LINE, stroke: '#FFFFFF', 'stroke-width': 2 }));
    const halo = { fill: INK, stroke: '#FFFFFF', 'stroke-width': 4, 'paint-order': 'stroke', 'font-size': 15 };
    const above = (text: string, maxChars: number, anchor: 'start' | 'middle', dx: number, cls: string) => {
      const n = Math.ceil(text.length / maxChars) + 1;
      let y = yHi - 12 - (n - 1) * 18;
      if (y < TRAJ_VIEW.top + 14) y = yLo + 24; // no room above: go below the whisker
      labels.append(textBlock(text, maxChars, x + dx, y, 18, { class: cls, 'text-anchor': anchor, ...halo }).el);
    };
    if (p.period === 'FirstFarmers') above(PERIOD_LABELS.FirstFarmers, 20, 'start', 4, 'traj-point-label');
    if (p.period === 'AngloSaxon') above(LOCAL_ANGLO_SAXON_POINT_LABEL, 28, 'middle', 0, 'traj-point-label');
    if (trait.gene === 'TYK2' && p.period === 'BellBeaker' && p.n) {
      labels.append(svgEl('text', { class: 'traj-point-label traj-count', x: x + 14, y: yf + 5, 'text-anchor': 'start', ...halo }, countNote(p.f, p.n)));
    }
  }
  svg.append(labels);
}

export function renderTrajectory(host: HTMLElement, data: WorkshopData, gene: GeneId): void {
  host.replaceChildren();
  const trait = data.traits.find((t) => t.gene === gene);
  if (!trait) return;
  const wrap = el('div', 'traj');
  wrap.setAttribute('data-gene', gene);
  wrap.setAttribute('data-source', trait.source);
  wrap.append(el('h3', 'traj-title', GENE_TRAIT_LABELS[gene]));

  const pts = [...trait.points].sort((a, b) => b.t - a.t);
  if (trait.source === 'text' || pts.length === 0) {
    wrap.classList.add('hla-card');
    wrap.append(el('p', 'hla-text', gene === 'HLA-DQ2' ? HLA_TEXT_CARD : traitCaption(trait)));
    wrap.append(el('p', 'traj-source', traitSourceLabel(trait)));
    host.append(wrap);
    return;
  }

  const svg = svgEl('svg', {
    class: 'traj-svg', viewBox: `0 0 ${TRAJ_VIEW.width} ${TRAJ_VIEW.height}`, preserveAspectRatio: 'xMidYMid meet',
    role: 'img', 'aria-label': GENE_TRAIT_LABELS[gene],
  });
  const sc = trajectoryScale(pts, data.trait_ticks);
  axes(svg, sc, data.trait_ticks);
  if (trait.source === 'ages') drawAges(svg, pts, sc);
  else drawLocal(svg, trait, pts, sc);
  wrap.append(svg);
  wrap.append(el('p', 'traj-caption', traitCaption(trait)));
  // Spec §3.4 L-reveal: a second caption line under the HLA-DQ2 trajectory (the rule 6 caption above it is unchanged).
  // Only a drawn trajectory gets it: the text card above returns before this point.
  if (gene === 'HLA-DQ2') wrap.append(el('p', 'traj-reveal', HLA_REVEAL_LINE));
  wrap.append(el('p', 'traj-source', traitSourceLabel(trait)));
  host.append(wrap);
}
