import type { WorkshopData } from '../types';
import { FEATURES, type Features } from '../features';
import { pcaCaptions, type PlotState } from '../plotState';
import { PLOT_EMPTY } from '../content';
import { animateFinale, prefersReducedMotion, renderPca, renderPcaCaptions } from './pca';
import { renderAdmixture } from './admixture';
import { renderConsumer } from './consumer';
import { renderTrajectory } from './trajectory';
import { SVG_NS } from './svg';
import './plots.css';

/** Same shape as RenderOpts in controller.ts (plots never import the controller); `features` is read by the finale (Task 22). */
export type PlotRenderOpts = { animate?: boolean; features?: Features };

function renderEmpty(host: HTMLElement): void {
  const p = document.createElement('p');
  p.className = 'plot-empty';
  p.textContent = PLOT_EMPTY;
  host.replaceChildren(p);
}

/** The one SVG reused across the PCA, ADMIXTURE and consumer renders, so PCA frame changes can animate. */
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

interface FinaleRun { animations: Animation[]; finished: boolean; done(): void }
/** The finale each plot host is playing, if any. A WeakMap, so a host that goes away takes its run with it. */
const finaleRuns = new WeakMap<HTMLElement, FinaleRun>();

/**
 * The live finale plays only for run_pca(period = "all") with the flag on, when not restoring or going Back
 * (animate: false), without prefers-reduced-motion, and where the browser has Web Animations.
 */
export function finaleWanted(p: PlotState, opts: PlotRenderOpts | undefined, features: Features): boolean {
  return features.finaleAnimation && opts?.animate !== false && p.view === 'pca' && p.focus === 'all'
    && !prefersReducedMotion() && typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
}

/**
 * Starts the finale on the PCA svg that renderPca has just drawn, hides FINALE_CAPTION until it ends and marks the svg
 * data-animating. Called after renderPca returns, because every render clears that marker (clearPlotMarkers).
 */
function startFinaleRun(host: HTMLElement, svg: SVGSVGElement, data: WorkshopData): void {
  const animations = animateFinale(svg, data);
  if (animations.length === 0) return;
  const caption = host.querySelector<HTMLElement>('p.pca-caption[data-caption="FINALE_CAPTION"]');
  svg.setAttribute('data-animating', 'true');
  if (caption) caption.hidden = true;
  const run: FinaleRun = {
    animations,
    finished: false,
    done() {
      if (run.finished) return;
      run.finished = true;
      svg.removeAttribute('data-animating');
      if (caption) caption.hidden = false;
      if (finaleRuns.get(host) === run) finaleRuns.delete(host);
    },
  };
  finaleRuns.set(host, run);
  const last = animations[animations.length - 1]!; // the pulse ring ends last
  last.addEventListener('finish', () => run.done());
  last.addEventListener('cancel', () => run.done());
}

/** Draws the single current view. Never throws: a failed draw logs and shows the empty panel. */
export function renderPlot(host: HTMLElement, data: WorkshopData, p: PlotState, opts: PlotRenderOpts = {}): void {
  try {
    finishPlotAnimations(host); // a new plot never inherits a half-run finale
    host.setAttribute('data-view', p.view);
    if (p.view === 'trait' && p.gene) {
      renderTrajectory(host, data, p.gene);
    } else if (p.view === 'pca') {
      const svg = plotSvg(host);
      renderPca(svg, data, p, opts);
      keepSvg(host, svg, renderPcaCaptions(host.ownerDocument, pcaCaptions(p, data)));
      if (finaleWanted(p, opts, opts.features ?? FEATURES)) startFinaleRun(host, svg, data);
    } else if (p.view === 'admixture') {
      const svg = plotSvg(host);
      renderAdmixture(svg, data, p);
      keepSvg(host, svg);
    } else if (p.view === 'consumer' && p.person !== undefined) {
      const svg = plotSvg(host);
      renderConsumer(svg, data, p.person);
      keepSvg(host, svg);                                      // the PCA caption strip belongs to the PCA view only
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

/** True while the finale is still playing in this host: the one animation a key press may cut short (blank Enter, Back, a new command). */
export function plotIsAnimating(host: HTMLElement): boolean {
  const run = finaleRuns.get(host);
  return run !== undefined && !run.finished;
}

/**
 * Jumps every running animation in the host to its end (the finale and the 0.5 s frame change) and reveals FINALE_CAPTION.
 * A browser fires `finish` events later, not inside finish(), so the finale's own done() is called here as well; it is
 * idempotent, so the event that follows does nothing.
 */
export function finishPlotAnimations(host: HTMLElement): void {
  const run = finaleRuns.get(host);
  if (run) {
    for (const a of run.animations) {
      try {
        a.finish();
      } catch {
        // an animation that cannot finish is simply dropped
      }
    }
    run.done();
  }
  if (typeof host.getAnimations === 'function') { // jsdom and very old browsers: nothing else can be running
    for (const a of host.getAnimations({ subtree: true })) {
      try {
        a.finish();
      } catch {
        // an animation that cannot finish (idle or infinite) is left alone
      }
    }
  }
}
