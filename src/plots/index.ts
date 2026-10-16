import type { WorkshopData } from '../types';
import type { PlotState } from '../plotState';
import { PLOT_EMPTY } from '../content';
import { renderPca } from './pca';
import { renderAdmixture } from './admixture';
import { renderTrajectory } from './trajectory';
import { SVG_NS } from './svg';
import './plots.css';

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

/** Draws the single current view. Never throws: a failed draw logs and shows the empty panel. */
export function renderPlot(host: HTMLElement, data: WorkshopData, p: PlotState): void {
  try {
    host.setAttribute('data-view', p.view);
    if (p.view === 'trait' && p.gene) {
      renderTrajectory(host, data, p.gene);
    } else if (p.view === 'pca') {
      renderPca(plotSvg(host), data, p);
    } else if (p.view === 'admixture') {
      renderAdmixture(plotSvg(host), data, p);
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
