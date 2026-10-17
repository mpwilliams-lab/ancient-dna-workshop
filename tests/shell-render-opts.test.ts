// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// The real shell and controller, with renderPlot replaced by a spy: what matters here is which arguments the shell's
// deps hand the router (spec v3 §2.3: restore and Back pass animate: false, a live command passes no animate option; each
// carries the flag set the shell booted with, which the finale reads). Every other export of the module stays real, because
// the shell also imports plotIsAnimating and finishPlotAnimations from it (Task 22): keep importOriginal.
vi.mock('../src/plots/index', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/plots/index')>();
  return { ...mod, renderPlot: vi.fn() };
});

import { boot } from '../src/shell';
import { FEATURES, withFeatures } from '../src/features';
import { renderPlot } from '../src/plots/index';
import { saveSession } from '../src/session';
import { sessionBuildHash } from '../src/replay';
import { FIXTURE, MemStore, loadIndexHtml } from './helpers/shellEnv';

const FILE_URL = 'file:///lab/ancient-dna-workshop.html';
const spy = vi.mocked(renderPlot);

function bootWith(store: MemStore) {
  return boot({ doc: document, href: FILE_URL, getStorage: () => store as unknown as Storage, replaceUrl: () => {}, data: FIXTURE });
}

beforeEach(() => {
  vi.useFakeTimers();
  loadIndexHtml();
  spy.mockClear();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

it('a fresh start draws the empty panel through the router with animate: false', () => {
  bootWith(new MemStore());
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenLastCalledWith(
    document.getElementById('plot'), FIXTURE, expect.objectContaining({ view: 'none' }), { animate: false, features: FEATURES },
  );
});

it('a restored session draws its plot without animation', () => {
  const store = new MemStore();
  const cmd = 'run_pca(period = "IronAge")';
  saveSession(store, {
    version: 2, build: sessionBuildHash(), history: [cmd], transcript: [{ seq: 1, kind: 'input', text: cmd }],
    steps: [{ cmd, endSeq: 1 }], cursor: { step: 1, card: 0 }, nextSeq: 2,
  });
  const b = bootWith(store);
  expect(b.restored).toBe(true);
  expect(spy).toHaveBeenLastCalledWith(
    document.getElementById('plot'), FIXTURE, expect.objectContaining({ view: 'pca', focus: 'IronAge' }), { animate: false, features: FEATURES },
  );
});

it('a live command draws with no animate option, so the router may animate the frame change and the finale', async () => {
  const b = bootWith(new MemStore());
  spy.mockClear();
  b.controller.submit('run_pca(period = "Europe")');
  await vi.runAllTimersAsync(); // the plot is drawn when the staggered log ends on its own
  expect(spy).toHaveBeenCalled();
  expect(spy.mock.calls.at(-1)![2]).toMatchObject({ view: 'pca', focus: 'Europe' });
  expect(spy.mock.calls.at(-1)![3]).toEqual({ features: FEATURES });
  expect(spy.mock.calls.at(-1)![3]).not.toHaveProperty('animate');
});

it('the router gets the flag set the shell booted with, on every kind of draw', async () => {
  const features = withFeatures({ finaleAnimation: !FEATURES.finaleAnimation });
  const b = boot({
    doc: document, href: FILE_URL, getStorage: () => new MemStore() as unknown as Storage, replaceUrl: () => {}, data: FIXTURE, features,
  });
  expect(spy.mock.calls.at(-1)![3]).toEqual({ animate: false, features });
  spy.mockClear();
  b.controller.submit('run_pca(period = "all")');
  await vi.runAllTimersAsync();
  expect(spy.mock.calls.at(-1)![3]).toEqual({ features });
});
