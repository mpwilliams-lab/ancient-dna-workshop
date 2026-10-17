// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// The real Controller on a real terminal, except that the terminal refuses to redraw a restored transcript that holds an
// input line. The Controller swallows that failure itself (it logs, resets to a fresh start and clears the screen) and
// does not throw, so the shell cannot rely on a throw to learn that nothing was restored.
vi.mock('../src/terminal', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/terminal')>();
  return {
    ...mod,
    mountTerminal: (...args: Parameters<typeof mod.mountTerminal>) => {
      const view = mod.mountTerminal(...args);
      const showLines = view.showLines;
      view.showLines = (lines) => {
        if (lines.some((l) => l.kind === 'input')) throw new Error('cannot replay');
        showLines(lines);
      };
      return view;
    },
  };
});

import { boot } from '../src/shell';
import { loadSession, saveSession, type SessionV2 } from '../src/session';
import { sessionBuildHash } from '../src/replay';
import { RESTORED_NOTICE } from '../src/content';
import { FIXTURE, MemStore, countText, loadIndexHtml } from './helpers/shellEnv';

const FILE_URL = 'file:///C:/Users/lab/Desktop/ancient-dna-workshop.html';

function bootOn(store: MemStore) {
  return boot({ doc: document, href: FILE_URL, getStorage: () => store as unknown as Storage, replaceUrl: () => {}, data: FIXTURE });
}

function session(over: Partial<SessionV2>): SessionV2 {
  return {
    version: 2, build: sessionBuildHash(), history: [], transcript: [], steps: [], cursor: { step: 0, card: 0 }, nextSeq: 1, ...over,
  };
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  loadIndexHtml();
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

it('a replay the Controller swallows is not announced, not reported as restored and not kept', () => {
  const store = new MemStore();
  saveSession(store, session({
    history: ['ancestry_test(person = "me")'],
    transcript: [{ seq: 1, kind: 'input', text: 'ancestry_test(person = "me")' }],
    steps: [{ cmd: 'ancestry_test(person = "me")', endSeq: 1 }],
    cursor: { step: 1, card: 0 },
    nextSeq: 2,
  }));
  const b = bootOn(store);
  expect(errors).toHaveBeenCalledWith('restore failed; starting fresh', expect.any(Error));
  expect(b.controller.hintIndex).toBe(0);
  expect(b.controller.session.history).toEqual([]);
  expect(b.restored).toBe(false);
  expect(countText(RESTORED_NOTICE)).toBe(0);
  const after = loadSession(store);
  expect(after === null || after.history.length === 0).toBe(true);
});

it('a restore that works is still announced once when only the typing history came back', () => {
  // Typed clear() first: nothing is visible and there is no step, but the Up-arrow history is restored.
  const store = new MemStore();
  saveSession(store, session({
    history: ['clear()'],
    transcript: [{ seq: 1, kind: 'input', text: 'clear()' }, { seq: 2, kind: 'clear', text: '' }],
    nextSeq: 3,
  }));
  const b = bootOn(store);
  expect(errors).not.toHaveBeenCalled();
  expect(b.restored).toBe(true);
  expect(b.controller.session.history).toEqual(['clear()']);
  expect(countText(RESTORED_NOTICE)).toBe(1);
});

it('a restore that works is still announced once when only output lines were saved', () => {
  const store = new MemStore();
  saveSession(store, session({ history: ['help()'], transcript: [{ seq: 1, kind: 'output', text: 'Commands' }], nextSeq: 2 }));
  const b = bootOn(store);
  expect(errors).not.toHaveBeenCalled();
  expect(b.restored).toBe(true);
  expect(countText(RESTORED_NOTICE)).toBe(1);
});
