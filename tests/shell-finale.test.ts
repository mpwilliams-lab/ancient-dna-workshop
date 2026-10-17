// @vitest-environment jsdom
// Task 22: the shell hands the Controller the plot host's plotAnimating / finishPlotAnimation, so the keys and Back end a
// running finale for real (spec §2.3, §4.4, §4.5 test 6); a refreshed session draws the final frame without animation (RF1).
// The real shell, controller, terminal and plot router run here; only the Web Animations API is a recorder (jsdom has none).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot, type Booted } from '../src/shell';
import { withFeatures } from '../src/features';
import { saveSession } from '../src/session';
import { sessionBuildHash } from '../src/replay';
import { FIXTURE, MemStore, loadIndexHtml } from './helpers/shellEnv';
import { installFakeAnimate, type FakeAnimate } from './helpers/fakeAnimation';

const FILE_URL = 'file:///lab/ancient-dna-workshop.html';
const ON = withFeatures({ finaleAnimation: true });
const ALL = 'run_pca(period = "all")';
const IRON = 'run_pca(period = "IronAge")';

let fake: FakeAnimate;
beforeEach(() => {
  vi.useFakeTimers();
  fake = installFakeAnimate();
  loadIndexHtml();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  fake.restore();
});

const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('#terminal input')!;
const svg = (): SVGSVGElement => document.querySelector<SVGSVGElement>('#plot svg.plot-svg')!;
const caption = (): HTMLElement => document.querySelector<HTMLElement>('#plot p.pca-caption[data-caption="FINALE_CAPTION"]')!;
const finaleAnims = () => fake.created.filter((a) => a.target.matches('g.layer.period, circle.finale-pulse'));

function bootWith(store: MemStore = new MemStore()): Booted {
  return boot({
    doc: document, href: FILE_URL, getStorage: () => store as unknown as Storage, replaceUrl: () => {}, data: FIXTURE, features: ON,
  });
}

/** A student's Enter on the prompt (a bare Enter for ''), then the staggered log runs out, which is when the plot is drawn. */
async function enter(line: string): Promise<void> {
  input().value = line;
  input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await vi.runAllTimersAsync();
}

describe('the finale in the real shell', () => {
  it('a live run_pca(period = "all") plays in the plot host; a blank Enter jumps to the final frame', async () => {
    bootWith();
    await enter(ALL);
    expect(svg().getAttribute('data-animating')).toBe('true');
    expect(caption().hidden).toBe(true);
    const running = finaleAnims();
    expect(running).toHaveLength(9); // the eight period layers and the pulse ring
    expect(running.every((a) => a.playState === 'running')).toBe(true);

    await enter('');
    expect(running.every((a) => a.playState === 'finished')).toBe(true);
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect(caption().hidden).toBe(false);
  });

  it('a command typed during the finale ends it first, even one that draws nothing', async () => {
    bootWith();
    await enter(ALL);
    const running = finaleAnims();
    await enter('help()');
    expect(running.every((a) => a.playState === 'finished')).toBe(true);
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect(caption().hidden).toBe(false);
    expect(svg().getAttribute('data-focus')).toBe('all'); // help() drew nothing: the finale's final frame stays

    await enter(ALL);
    expect(svg().getAttribute('data-animating')).toBe('true');
    await enter('run_pca(period = "Viking")');
    expect(finaleAnims().every((a) => a.playState === 'finished')).toBe(true);
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect(svg().getAttribute('data-focus')).toBe('Viking');
  });

  it('left alone, the finale ends by itself and the caption appears', async () => {
    bootWith();
    await enter(ALL);
    for (const a of finaleAnims()) a.finish(); // what the browser does when the clock runs out
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect(caption().hidden).toBe(false);
    await enter('');                           // and a later blank Enter has nothing to end
    expect(caption().hidden).toBe(false);
  });

  it('Back (the header button) during the finale ends it and draws the earlier screen without animating anything', async () => {
    bootWith();
    await enter(IRON);
    await enter(ALL);
    expect(svg().getAttribute('data-animating')).toBe('true');
    const running = finaleAnims();
    const created = fake.created.length;

    document.getElementById('back')!.click();
    expect(running.every((a) => a.playState === 'finished')).toBe(true);
    expect(fake.created).toHaveLength(created);                 // Back draws the Europe to British frame change at once
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect([svg().getAttribute('data-view'), svg().getAttribute('data-focus')]).toEqual(['pca', 'IronAge']);
    expect(document.querySelector('#plot p.pca-caption[data-caption="FINALE_CAPTION"]')).toBeNull();
  });

  it('Back onto the finale itself shows its final frame at once: no animation, the caption already there', async () => {
    bootWith();
    await enter(ALL);
    await enter(IRON);
    const created = fake.created.length;
    document.getElementById('back')!.click();
    expect(svg().getAttribute('data-focus')).toBe('all');
    expect(fake.created).toHaveLength(created);
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect(caption().hidden).toBe(false);
  });

  it('a refresh after the finale draws its final frame directly: no animation, caption shown (RF1)', () => {
    const store = new MemStore();
    saveSession(store, {
      version: 2, build: sessionBuildHash(), history: [ALL], transcript: [{ seq: 1, kind: 'input', text: ALL }],
      steps: [{ cmd: ALL, endSeq: 1 }], cursor: { step: 1, card: 0 }, nextSeq: 2,
    });
    const b = bootWith(store);
    expect(b.restored).toBe(true);
    expect(fake.created).toHaveLength(0);
    expect(svg().getAttribute('data-focus')).toBe('all');
    expect(svg().hasAttribute('data-animating')).toBe(false);
    expect(caption().hidden).toBe(false);
    expect(document.querySelectorAll('#plot g.layer.period')).toHaveLength(8);
  });
});
