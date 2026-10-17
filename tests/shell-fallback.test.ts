// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

// The real Controller, except that replaying a restored session throws (simulates a saved session the controller
// cannot replay at all). Like a restore that fails half way, it has already opened a card when it throws.
vi.mock('../src/controller', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/controller')>();
  class ThrowOnRestore extends mod.Controller {
    constructor(deps: ConstructorParameters<typeof mod.Controller>[0], restored: ConstructorParameters<typeof mod.Controller>[1]) {
      if (restored) {
        deps.cards?.open('A1', 0, 1, 'after');
        throw new Error('cannot replay');
      }
      super(deps, restored);
    }
  }
  return { ...mod, Controller: ThrowOnRestore };
});

import { boot } from '../src/shell';
import { loadSession, saveSession } from '../src/session';
import { sessionBuildHash } from '../src/replay';
import { RESTORED_NOTICE } from '../src/content';
import { FIXTURE, MemStore, countText, loadIndexHtml } from './helpers/shellEnv';

beforeEach(() => loadIndexHtml());

it('a saved session the controller cannot replay is discarded and the app starts fresh', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const store = new MemStore();
  saveSession(store, {
    version: 2, build: sessionBuildHash(), history: ['load_genomes()'], transcript: [],
    steps: [{ cmd: 'load_genomes()', endSeq: 0 }], cursor: { step: 1, card: 0 }, nextSeq: 1,
  });
  const b = boot({ doc: document, href: 'file:///C:/x.html', getStorage: () => store as unknown as Storage, replaceUrl: () => {}, data: FIXTURE });
  expect(errors).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: 'cannot replay' }));
  errors.mockRestore();
  expect(b.restored).toBe(false);
  expect(b.controller.hintIndex).toBe(0);
  expect(countText(RESTORED_NOTICE)).toBe(0);
  // The card the failed restore opened is not left on screen over the fresh start (Task 12, decision 5).
  expect(b.cards.isOpen()).toBe(false);
  expect(document.getElementById('card')!.hidden).toBe(true);
  expect(document.getElementById('card')!.childElementCount).toBe(0);
  const after = loadSession(store);
  expect(after === null || after.history.length === 0).toBe(true);
});
