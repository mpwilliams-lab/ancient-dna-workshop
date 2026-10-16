// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

// The real Controller, except that replaying a restored session throws (simulates a saved
// session from an older build that the controller cannot replay).
vi.mock('../src/controller', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/controller')>();
  class ThrowOnRestore extends mod.Controller {
    constructor(deps: ConstructorParameters<typeof mod.Controller>[0], restored: ConstructorParameters<typeof mod.Controller>[1]) {
      if (restored) throw new Error('cannot replay');
      super(deps, restored);
    }
  }
  return { ...mod, Controller: ThrowOnRestore };
});

import { boot } from '../src/shell';
import { loadSession, saveSession } from '../src/session';
import { INITIAL_PLOT } from '../src/plotState';
import { RESTORED_NOTICE } from '../src/content';
import { FIXTURE, MemStore, countText, loadIndexHtml } from './helpers/shellEnv';

beforeEach(() => loadIndexHtml());

it('a saved session the controller cannot replay is discarded and the app starts fresh', () => {
  const store = new MemStore();
  saveSession(store, { history: ['load_genomes()'], transcript: [], hintIndex: 2, plot: INITIAL_PLOT });
  const b = boot({ doc: document, href: 'file:///C:/x.html', getStorage: () => store as unknown as Storage, replaceUrl: () => {}, data: FIXTURE });
  expect(b.restored).toBe(false);
  expect(b.controller.hintIndex).toBe(0);
  expect(countText(RESTORED_NOTICE)).toBe(0);
  const after = loadSession(store);
  expect(after === null || after.history.length === 0).toBe(true);
});
