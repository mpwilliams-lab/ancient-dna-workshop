// @vitest-environment jsdom
// Spec §2.3 run_pca(period = "all") finale (P2, flag finaleAnimation) and §4.4 "blank line during the animation".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FINALE_CAPTION } from '../src/content';
import { withFeatures } from '../src/features';
import { INITIAL_PLOT, reducePlot, type PlotState } from '../src/plotState';
import { finaleWanted, finishPlotAnimations, plotIsAnimating, renderPlot } from '../src/plots/index';
import { FINALE_PULSE, FINALE_TIMING, TODAY_RING, finaleSchedule, finaleTotalMs, makeScale } from '../src/plots/pca';
import { f1 } from '../src/plots/svg';
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

  it('the pulse ring sits on Britain today, on top of the plot, takes no pointer events and is a single 600 ms pulse', () => {
    renderPlot(host, FIXTURE, ALL, { features: ON });
    const [pulse] = pulseAnims();
    const ring = pulse!.target;
    const today = FIXTURE.periods.find((p) => p.id === 'Today')!.centre;
    const sc = makeScale(FIXTURE.frames.europe);
    const world = svg().querySelector('g.world')!;
    expect(ring.parentElement).toBe(world);
    expect(world.lastElementChild).toBe(ring);
    expect(ring.getAttribute('cx')).toBe(f1(sc.toX(today.x)));
    expect(ring.getAttribute('cy')).toBe(f1(sc.toY(today.y)));
    expect(ring.getAttribute('r')).toBe(String(FINALE_PULSE.r));
    expect(ring.getAttribute('stroke')).toBe(TODAY_RING.stroke);
    expect(ring.getAttribute('stroke-width')).toBe(String(FINALE_PULSE.strokeWidth));
    expect(ring.getAttribute('fill')).toBe('none');
    expect(ring.getAttribute('pointer-events')).toBe('none');
    expect(pulse!.options).toMatchObject({ duration: FINALE_PULSE.ms, delay: 4750 });
    expect(pulse!.options.iterations ?? 1).toBe(1);
    expect(pulse!.keyframes).toEqual([{ opacity: 0.9, transform: 'scale(0.2)' }, { opacity: 0, transform: 'scale(1)' }]);
    expect(host.querySelectorAll('circle.finale-pulse')).toHaveLength(1);
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
