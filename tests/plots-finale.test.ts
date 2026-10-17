// @vitest-environment jsdom
// Spec §2.3 run_pca(period = "all") finale (P2, flag finaleAnimation) and §4.4 "blank line during the animation".
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FINALE_CAPTION } from '../src/content';
import { withFeatures } from '../src/features';
import { INITIAL_PLOT, reducePlot, type PlotState } from '../src/plotState';
import { finaleWanted, finishPlotAnimations, plotIsAnimating, renderPlot } from '../src/plots/index';
import { FINALE_PULSE, FINALE_TIMING, animateFinale, finaleSchedule, finaleTotalMs, makeScale } from '../src/plots/pca';
import { INK, f1 } from '../src/plots/svg';
import { FIXTURE } from './fixtures/fixture';
import { installFakeAnimate, type FakeAnimate, type FakeAnimation } from './helpers/fakeAnimation';

const ON = withFeatures({ finaleAnimation: true });
const ALL: PlotState = reducePlot(INITIAL_PLOT, { kind: 'pca', period: 'all' }, FIXTURE);
const IRON: PlotState = reducePlot(INITIAL_PLOT, { kind: 'pca', period: 'IronAge' }, FIXTURE);
const ORDER = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking', 'Today'];

let fake: FakeAnimate;
let host: HTMLElement;
beforeEach(() => {
  fake = installFakeAnimate();
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  fake.restore();
  host.remove();
  vi.useRealTimers();
});

const layerAnims = (): FakeAnimation[] => fake.created.filter((a) => a.target.matches('g.layer.period'));
const pulseAnims = (): FakeAnimation[] => fake.created.filter((a) => a.target.matches('circle.finale-pulse'));
const svg = (): SVGSVGElement => host.querySelector('svg.plot-svg')!;
const caption = (): HTMLElement => host.querySelector<HTMLElement>('p.pca-caption[data-caption="FINALE_CAPTION"]')!;

describe('finale schedule (spec §2.3)', () => {
  it('oldest first, one period every 600 ms, Britain today after the 900 ms pause, about 5.5 s in all', () => {
    expect(FINALE_TIMING).toEqual({ fadeMs: 250, stepMs: 600, pauseMs: 900 });
    expect(finaleSchedule()).toEqual([
      { layer: 'FirstFarmers', delay: 0 }, { layer: 'BellBeaker', delay: 600 }, { layer: 'BronzeAge', delay: 1200 },
      { layer: 'IronAge', delay: 1800 }, { layer: 'Roman', delay: 2400 }, { layer: 'AngloSaxon', delay: 3000 },
      { layer: 'Viking', delay: 3600 }, { layer: 'Today', delay: 4750 },
    ]);
    expect(finaleTotalMs()).toBe(5350);
    expect(finaleTotalMs()).toBeGreaterThanOrEqual(5000);
    expect(finaleTotalMs()).toBeLessThanOrEqual(6000);
  });
});

describe('renderPlot: the live finale', () => {
  it('fades every period layer in at its turn, then one pulse ring for Britain today', () => {
    renderPlot(host, FIXTURE, ALL, { features: ON });
    const layers = layerAnims();
    expect(layers.map((a) => a.target.getAttribute('data-layer'))).toEqual(ORDER);
    for (const [i, a] of layers.entries()) {
      expect(a.options.delay, ORDER[i]).toBe(finaleSchedule()[i].delay);
      expect(a.options.duration).toBe(250);
      expect(a.options.fill).toBe('backwards');
      expect(a.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    }
    const pulse = pulseAnims();
    expect(pulse).toHaveLength(1);
    expect(pulse[0].options.delay).toBe(4750);
    expect(pulse[0].target.getAttribute('opacity')).toBe('0');
  });

  it('marks the svg, hides FINALE_CAPTION and reports animating until it ends on its own', () => {
    renderPlot(host, FIXTURE, ALL, { features: ON });
    expect(svg().getAttribute('data-animating')).toBe('true');
    expect(caption().hidden).toBe(true);
    expect(caption().textContent).toBe(FINALE_CAPTION);
    expect(plotIsAnimating(host)).toBe(true);
    for (const a of fake.created) a.finish(); // the natural end: the pulse (last) fires 'finish'
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect(caption().hidden).toBe(false);
    expect(plotIsAnimating(host)).toBe(false);
  });

  it('finishPlotAnimations jumps to the final frame at once and reveals the caption (blank Enter, Back, new command)', () => {
    renderPlot(host, FIXTURE, ALL, { features: ON });
    finishPlotAnimations(host);
    expect(fake.created.every((a) => a.playState === 'finished')).toBe(true);
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect(caption().hidden).toBe(false);
    expect(plotIsAnimating(host)).toBe(false);
    expect(() => finishPlotAnimations(host)).not.toThrow(); // idempotent
  });

  it('a new render first finishes a running finale', () => {
    renderPlot(host, FIXTURE, ALL, { features: ON });
    const first = [...fake.created];
    renderPlot(host, FIXTURE, IRON, { features: ON });
    expect(first.every((a) => a.playState === 'finished')).toBe(true);
    expect(plotIsAnimating(host)).toBe(false);
  });

  it('uses no timers', () => {
    vi.useFakeTimers();
    renderPlot(host, FIXTURE, ALL, { features: ON });
    finishPlotAnimations(host);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a second run_pca(period = "all") ends the first finale and plays its own, and only its own end reveals the caption', () => {
    renderPlot(host, FIXTURE, ALL, { features: ON });
    const first = [...fake.created];
    renderPlot(host, FIXTURE, ALL, { features: ON });
    expect(first.every((a) => a.playState === 'finished')).toBe(true);
    const second = fake.created.slice(first.length);
    expect(second).toHaveLength(first.length);
    expect(plotIsAnimating(host)).toBe(true);
    expect(svg().getAttribute('data-animating')).toBe('true');
    expect(caption().hidden).toBe(true);
    for (const a of second) a.finish();
    expect(plotIsAnimating(host)).toBe(false);
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect(caption().hidden).toBe(false);
  });

  it('a finale whose last animation is cancelled ends like a finished one: marker gone, caption shown', () => {
    renderPlot(host, FIXTURE, ALL, { features: ON });
    const last = fake.created.at(-1)!;
    expect(last.target.matches('circle.finale-pulse')).toBe(true); // the run listens to the animation that ends last: the ring
    last.cancel();
    expect(last.playState).toBe('idle');
    expect(plotIsAnimating(host)).toBe(false);
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect(caption().hidden).toBe(false);
    expect(() => finishPlotAnimations(host)).not.toThrow();
  });

  it('the pulse is a dark ring on a white halo, both on Britain today and on top of the plot, quiet to the pointer, one 600 ms pulse', () => {
    renderPlot(host, FIXTURE, ALL, { features: ON });
    const today = FIXTURE.periods.find((p) => p.id === 'Today')!.centre;
    const sc = makeScale(FIXTURE.frames.europe);
    const world = svg().querySelector('g.world')!;
    const halo = world.querySelector('circle.finale-pulse-halo')!;
    const ring = world.querySelector('circle.finale-pulse')!;
    expect(host.querySelectorAll('circle.finale-pulse')).toHaveLength(1);       // the halo has its own class: the ring's matcher stays exact
    expect(host.querySelectorAll('circle.finale-pulse-halo')).toHaveLength(1);
    expect([...world.children].slice(-2)).toEqual([halo, ring]);                // the halo under the ring, both over everything else
    for (const c of [halo, ring]) {
      expect(c.getAttribute('cx')).toBe(f1(sc.toX(today.x)));
      expect(c.getAttribute('cy')).toBe(f1(sc.toY(today.y)));
      expect(c.getAttribute('r')).toBe(String(FINALE_PULSE.r));
      expect(c.getAttribute('fill')).toBe('none');
      expect(c.getAttribute('pointer-events')).toBe('none');
      expect(c.getAttribute('opacity')).toBe('0');                              // invisible before, after and after finish()
      // The ring keeps its on-screen width while it scales: Britain today lies inside the dense Iron Age cloud, where a 0.5 px line at
      // the start of the pulse is lost.
      expect(c.getAttribute('style')).toContain('vector-effect: non-scaling-stroke');
      expect(c.getAttribute('style')).toContain('transform-box: fill-box');
    }
    expect(ring.getAttribute('stroke')).toBe(INK);
    expect(ring.getAttribute('stroke-width')).toBe(String(FINALE_PULSE.strokeWidth));
    expect(halo.getAttribute('stroke')).toBe('#FFFFFF');
    expect(halo.getAttribute('stroke-width')).toBe(String(FINALE_PULSE.haloWidth));
    expect(FINALE_PULSE.haloWidth).toBeGreaterThan(FINALE_PULSE.strokeWidth);   // the halo shows on both sides of the ring
    // Both are one pulse, from the same moment: opacity 1 to 0 while scaling from 20% to full size. The ring is the last animation
    // created, because the run ends with the animation that ends last.
    const pulses = fake.created.filter((a) => a.target === halo || a.target === ring);
    expect(pulses.map((a) => a.target)).toEqual([halo, ring]);
    for (const a of pulses) {
      expect(a.options).toMatchObject({ duration: FINALE_PULSE.ms, delay: 4750, easing: 'ease-out' });
      expect(a.options.iterations ?? 1).toBe(1);
      expect(a.keyframes).toEqual([{ opacity: 1, transform: 'scale(0.2)' }, { opacity: 0, transform: 'scale(1)' }]);
    }
    expect(fake.created.at(-1)!.target).toBe(ring);
  });

  it('the pulse numbers are the ones checked in a browser: a final radius of 100 clears the dense Iron Age cloud (about 140 px across at 1366 x 768)', () => {
    expect(FINALE_PULSE).toEqual({ ms: 600, r: 100, strokeWidth: 3, haloWidth: 8 });
  });

  it('each legend item fades in with its layer, so the legend never lists a period before the plot shows it', () => {
    renderPlot(host, FIXTURE, ALL, { features: ON });
    const items = fake.created.filter((a) => a.target.matches('g.legend-item'));
    expect(items.map((a) => a.target.getAttribute('data-legend'))).toEqual(ORDER);
    for (const [i, a] of items.entries()) {
      expect(a.options.delay, ORDER[i]).toBe(finaleSchedule()[i].delay);
      expect(a.options.duration).toBe(FINALE_TIMING.fadeMs);
      expect(a.options.fill).toBe('backwards');
      expect(a.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    }
    // the headings and the continental groups are in the legend from the start
    const animated = new Set(items.map((a) => a.target));
    const resting = [...svg().querySelectorAll('g.legend-item')].filter((g) => !animated.has(g));
    expect(resting.length).toBeGreaterThan(0);
    for (const g of resting) expect(ORDER).not.toContain(g.getAttribute('data-legend'));
    expect(svg().querySelectorAll('text.legend-heading')).toHaveLength(2);
    expect(fake.created.some((a) => a.target.matches('.legend-heading, g.legend-group, g.legend'))).toBe(false);
  });

  it('a layer whose legend item is missing still fades in (the legend is a courtesy, not a requirement)', () => {
    renderPlot(host, FIXTURE, ALL, { animate: false, features: ON }); // static: nothing animated yet
    expect(fake.created).toHaveLength(0);
    for (const g of [...svg().querySelectorAll('g.legend-item')]) g.remove();
    expect(() => animateFinale(svg(), FIXTURE)).not.toThrow();
    expect(layerAnims().map((a) => a.target.getAttribute('data-layer'))).toEqual(ORDER);
    expect(fake.created.filter((a) => a.target.matches('g.legend-item'))).toHaveLength(0);
    expect(pulseAnims()).toHaveLength(1);
  });
});

describe('finaleWanted (CONTRACT §4.12)', () => {
  it('is true only for a live run_pca(period = "all") with the flag on, motion allowed and Web Animations present', () => {
    expect(finaleWanted(ALL, undefined, ON)).toBe(true);
    expect(finaleWanted(ALL, {}, ON)).toBe(true);
    expect(finaleWanted(ALL, { animate: true }, ON)).toBe(true);
    expect(finaleWanted(ALL, {}, withFeatures({ finaleAnimation: false }))).toBe(false); // the flag
    expect(finaleWanted(ALL, { animate: false }, ON)).toBe(false);                      // restore and Back
    expect(finaleWanted(IRON, {}, ON)).toBe(false);                                     // another period in focus
    expect(finaleWanted({ ...ALL, focus: 'Europe' }, {}, ON)).toBe(false);
    expect(finaleWanted({ ...ALL, view: 'admixture' }, {}, ON)).toBe(false);            // another view
  });

  it('is false where the browser has no Web Animations', () => {
    fake.restore(); // back to jsdom's own Element.prototype, which has no animate
    expect(finaleWanted(ALL, {}, ON)).toBe(false);
  });

  it('is false with prefers-reduced-motion, and asks the browser for exactly that preference', () => {
    const mm = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', mm);
    try {
      expect(finaleWanted(ALL, {}, ON)).toBe(false);
      expect(mm).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('renderPlot: the finale is static when it must be', () => {
  it('animate: false (restore, Back) draws the final frame directly', () => {
    renderPlot(host, FIXTURE, ALL, { animate: false, features: ON });
    expect(layerAnims()).toHaveLength(0);
    expect(pulseAnims()).toHaveLength(0);
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect(caption().hidden).toBe(false);
    expect(plotIsAnimating(host)).toBe(false);
  });

  it('prefers-reduced-motion draws the final frame directly', () => {
    const mm = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', mm);
    try {
      renderPlot(host, FIXTURE, ALL, { features: ON });
      expect(layerAnims()).toHaveLength(0);
      expect(caption().hidden).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('other PCA views never animate their layers', () => {
    renderPlot(host, FIXTURE, IRON, { features: ON });
    expect(layerAnims()).toHaveLength(0);
    expect(plotIsAnimating(host)).toBe(false);
  });
});

// A browser changes playState inside finish() but fires the `finish` event on the next frame. The tests above let the listener run
// inside finish(); these let it arrive late, as it does in Chromium and Edge (flushEvents() plays that frame).
describe('the browser fires finish events later, not inside finish()', () => {
  beforeEach(() => {
    fake.restore();
    fake = installFakeAnimate({ deferEvents: true });
  });

  it('finishPlotAnimations reveals the caption and clears the marker at once, without waiting for the event', () => {
    renderPlot(host, FIXTURE, ALL, { features: ON });
    finishPlotAnimations(host);
    expect(fake.created.every((a) => a.playState === 'finished')).toBe(true);
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect(caption().hidden).toBe(false);
    expect(plotIsAnimating(host)).toBe(false);
    fake.flushEvents(); // the event arrives: nothing is left to do
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect(caption().hidden).toBe(false);
    expect(plotIsAnimating(host)).toBe(false);
  });

  it('the late events of a finale that was cut short leave the next finale alone (the svg is the same element)', () => {
    renderPlot(host, FIXTURE, ALL, { features: ON });
    renderPlot(host, FIXTURE, ALL, { features: ON }); // ends the first finale and plays a second; the first one's events are still queued
    expect(plotIsAnimating(host)).toBe(true);
    fake.flushEvents();
    expect(svg().getAttribute('data-animating')).toBe('true');
    expect(caption().hidden).toBe(true);
    expect(plotIsAnimating(host)).toBe(true);
  });

  it('left alone, the finale ends when the last animation fires its finish event', () => {
    renderPlot(host, FIXTURE, ALL, { features: ON });
    for (const a of fake.created) a.finish(); // the clock runs out: playState changes now, the events are queued
    fake.flushEvents();
    expect(plotIsAnimating(host)).toBe(false);
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect(caption().hidden).toBe(false);
  });
});

// jsdom does not apply plots.css, so what the finale needs from it is pinned in the text of the file (an e2e test checks the
// computed styles in a real browser).
describe('the finale rules in plots.css', () => {
  const css = readFileSync(resolve(__dirname, '../src/plots/plots.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
  /** property -> value of the rule whose selector list is exactly `selector`. */
  function rule(selector: string): Record<string, string> {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (squash(m[1]!) !== squash(selector)) continue;
      const out: Record<string, string> = {};
      for (const d of m[2]!.split(';')) {
        const k = d.indexOf(':');
        if (k > 0) out[d.slice(0, k).trim()] = d.slice(k + 1).trim();
      }
      return out;
    }
    throw new Error(`plots.css has no rule for "${selector}"`);
  }

  it('the caption that waits keeps its room, so the plot does not rescale when it appears', () => {
    expect(rule('.pca-caption[hidden]')).toEqual({ display: 'block', visibility: 'hidden' });
  });

  it('while the finale plays, the period points and the legend items take no pointer events: no tip names a period early', () => {
    expect(rule('.plot-svg[data-animating="true"] g.layer.period .pt, .plot-svg[data-animating="true"] g.legend-item'))
      .toEqual({ 'pointer-events': 'none' });
  });
});
