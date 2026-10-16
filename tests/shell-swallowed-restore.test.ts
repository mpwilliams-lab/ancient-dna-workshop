// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// The real Controller on a real terminal, except that the terminal refuses to echo the first replayed input line.
// The Controller swallows that failure itself (it logs, resets to a fresh start and clears the screen) and does not
// throw, so the shell cannot rely on a throw to learn that nothing was restored.
vi.mock('../src/terminal', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/terminal')>();
  return {
    ...mod,
    mountTerminal: (...args: Parameters<typeof mod.mountTerminal>) => {
      const view = mod.mountTerminal(...args);
      const echoInput = view.echoInput;
      let refused = false;
      view.echoInput = (text: string) => {
        if (!refused) {
          refused = true;
          throw new Error('cannot replay');
        }
        echoInput(text);
      };
      return view;
    },
  };
});

import { boot } from '../src/shell';
import { loadSession, saveSession, type Session } from '../src/session';
import { INITIAL_PLOT } from '../src/plotState';
import { RESTORED_NOTICE } from '../src/content';
import { FIXTURE, MemStore, countText, loadIndexHtml } from './helpers/shellEnv';

const FILE_URL = 'file:///C:/Users/lab/Desktop/ancient-dna-workshop.html';

function bootOn(store: MemStore) {
  return boot({ doc: document, href: FILE_URL, getStorage: () => store as unknown as Storage, replaceUrl: () => {}, data: FIXTURE });
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  loadIndexHtml();
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

it('a replay the Controller swallows is not announced, not reported as restored and not kept', () => {
  const store = new MemStore();
  const saved: Session = {
    history: ['ancestry_test(person = "me")'],
    transcript: [{ kind: 'input', text: 'ancestry_test(person = "me")' }],
    hintIndex: 1,
    plot: INITIAL_PLOT,
  };
  saveSession(store, saved);
  const b = bootOn(store);
  // The swallow path really ran (otherwise this test would pass without testing anything).
  expect(errors).toHaveBeenCalledWith('restore failed; starting fresh', expect.any(Error));
  expect(b.controller.hintIndex).toBe(0);
  expect(b.controller.session.history).toEqual([]);
  expect(b.restored).toBe(false);
  expect(countText(RESTORED_NOTICE)).toBe(0);
  const after = loadSession(store);
  expect(after === null || after.history.length === 0).toBe(true);
});

it('a restore that works is still announced once when only the typing history came back', () => {
  // Typed clear() first: the screen is empty and the hint is still step 0, but the Up-arrow history is restored.
  const store = new MemStore();
  saveSession(store, { history: ['clear()'], transcript: [], hintIndex: 0, plot: INITIAL_PLOT });
  const b = bootOn(store);
  expect(errors).not.toHaveBeenCalled();
  expect(b.restored).toBe(true);
  expect(b.controller.session.history).toEqual(['clear()']);
  expect(countText(RESTORED_NOTICE)).toBe(1);
});

it('a restore that works is still announced once when only output lines were saved', () => {
  const store = new MemStore();
  saveSession(store, { history: ['help()'], transcript: [{ kind: 'output', text: 'Commands' }], hintIndex: 0, plot: INITIAL_PLOT });
  const b = bootOn(store);
  expect(errors).not.toHaveBeenCalled();
  expect(b.restored).toBe(true);
  expect(countText(RESTORED_NOTICE)).toBe(1);
});
