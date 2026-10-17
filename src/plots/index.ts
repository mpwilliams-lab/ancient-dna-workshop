import type { WorkshopData } from '../types';
import type { Features } from '../features';
import { pcaCaptions, type PlotState } from '../plotState';
import { PLOT_EMPTY } from '../content';
import { renderPca, renderPcaCaptions } from './pca';
import { renderAdmixture } from './admixture';
import { renderTrajectory } from './trajectory';
import { SVG_NS } from './svg';
import './plots.css';

/** Same shape as RenderOpts in controller.ts; `features` is read by the finale animation (Task 22). */
export type PlotRenderOpts = { animate?: boolean; features?: Features };

function renderEmpty(host: HTMLElement): void {
  const p = document.createElement('p');
  p.className = 'plot-empty';
  p.textContent = PLOT_EMPTY;
  host.replaceChildren(p);
}

/** The one SVG reused across PCA/ADMIXTURE renders, so PCA frame changes can animate. */
function plotSvg(host: HTMLElement): SVGSVGElement {
  const existing = Array.from(host.children).find(
    (c): c is SVGSVGElement => c instanceof SVGSVGElement && c.classList.contains('plot-svg'),
  );
  if (existing) return existing;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('plot-svg');
  host.replaceChildren(svg);
  return svg;
}

/** Keeps the svg in place (never detached, so a running frame transition is not cut), removes every other child and
 *  puts `after` right behind the svg. */
function keepSvg(host: HTMLElement, svg: SVGSVGElement, after?: Element): void {
  for (const c of Array.from(host.children)) if (c !== svg) c.remove();
  if (after) svg.after(after);
}

/** Draws the single current view. Never throws: a failed draw logs and shows the empty panel. */
export function renderPlot(host: HTMLElement, data: WorkshopData, p: PlotState, opts: PlotRenderOpts = {}): void {
  try {
    host.setAttribute('data-view', p.view);
    if (p.view === 'trait' && p.gene) {
      renderTrajectory(host, data, p.gene);
    } else if (p.view === 'pca') {
      const svg = plotSvg(host);
      renderPca(svg, data, p, opts);
      keepSvg(host, svg, renderPcaCaptions(host.ownerDocument, pcaCaptions(p, data)));
    } else if (p.view === 'admixture') {
      const svg = plotSvg(host);
      renderAdmixture(svg, data, p);
      keepSvg(host, svg);
    } else {
      renderEmpty(host);
    }
  } catch (err) {
    console.error('renderPlot failed', err);
    try {
      renderEmpty(host);
    } catch {
      /* host unusable: nothing more to do */
    }
  }
}

/** True while a plot animation that a key press may cut short is running: the finale marks its svg data-animating. */
export function plotIsAnimating(host: HTMLElement): boolean {
  return host.querySelector('svg[data-animating="true"]') !== null;
}

/** Jumps every running animation under the host to its end (blank Enter, Back or a new command). */
export function finishPlotAnimations(host: HTMLElement): void {
  if (typeof host.getAnimations !== 'function') return; // jsdom and very old browsers: nothing can be running
  for (const a of host.getAnimations({ subtree: true })) {
    try {
      a.finish();
    } catch {
      // an animation that cannot finish (idle or infinite) is left alone
    }
  }
}
