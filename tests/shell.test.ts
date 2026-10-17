// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot, hasReset, probeStorage, stripReset } from '../src/shell';
import { ALL_OFF, withFeatures } from '../src/features';
import { Controller } from '../src/controller';
import { mountTerminal } from '../src/terminal';
import { saveSession, loadSession, LEGACY_SESSION_KEY, SESSION_KEY, type SessionV2 } from '../src/session';
import { sessionBuildHash } from '../src/replay';
import { APP_TITLE, RESTORED_NOTICE, WRAP_BUTTON, WRAP_CREDIT, WRAP_LINE, WRAP_QR_CAPTION } from '../src/content';
import { FIXTURE, MemStore, countText, loadIndexHtml } from './helpers/shellEnv';

const FILE_URL = 'file:///C:/Users/lab/Desktop/ancient-dna-workshop.html';
const PAGES = 'https://mpwilliams-lab.github.io/ancient-dna-workshop/';

function savedSession(): SessionV2 {
  return {
    version: 2,
    build: sessionBuildHash(),
    history: ['ancestry_test(person = "me")'],
    transcript: [{ seq: 1, kind: 'input', text: 'ancestry_test(person = "me")' }],
    steps: [{ cmd: 'ancestry_test(person = "me")', endSeq: 1 }],
    cursor: { step: 1, card: 0 },
    nextSeq: 2,
  };
}

function env(store: MemStore | (() => Storage), href = FILE_URL, replaceUrl: (u: string) => void = () => {}) {
  return {
    doc: document,
    href,
    getStorage: typeof store === 'function' ? store : () => store as unknown as Storage,
    replaceUrl,
    data: FIXTURE,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  loadIndexHtml();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('reset URL helpers', () => {
  it('detects ?reset in every spelling and nothing else', () => {
    expect(hasReset(`${FILE_URL}?reset`)).toBe(true);
    expect(hasReset(`${PAGES}?reset=1`)).toBe(true);
    expect(hasReset(`${PAGES}?a=b&reset`)).toBe(true);
    expect(hasReset(`${PAGES}?resetx`)).toBe(false);
    expect(hasReset(PAGES)).toBe(false);
    expect(hasReset('not a url')).toBe(false);
  });
  it('strips only the reset parameter', () => {
    expect(stripReset(`${FILE_URL}?reset`)).toBe(FILE_URL);
    expect(stripReset(`${PAGES}?reset=1#x`)).toBe(`${PAGES}#x`);
    expect(stripReset(`${PAGES}?a=1&reset`)).toBe(`${PAGES}?a=1`);
    expect(stripReset('not a url')).toBe('not a url');
  });
});

describe('probeStorage', () => {
  it('returns null when the getter throws (blocked storage)', () => {
    expect(probeStorage(() => { throw new DOMException('denied', 'SecurityError'); })).toBeNull();
  });
  it('returns null when writing throws (quota / private mode)', () => {
    const s = new MemStore();
    s.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    expect(probeStorage(() => s as unknown as Storage)).toBeNull();
  });
  it('returns the storage when it works and leaves no probe key behind', () => {
    const s = new MemStore();
    expect(probeStorage(() => s as unknown as Storage)).toBe(s);
    expect(s.length).toBe(0);
  });
});

describe('boot', () => {
  it('fresh start: title, empty notice, first hint, wrap hidden with QR', () => {
    const b = boot(env(new MemStore()));
    expect(document.title).toBe(APP_TITLE);
    expect(document.getElementById('app-title')!.textContent).toBe(APP_TITLE);
    expect(b.restored).toBe(false);
    expect(b.reset).toBe(false);
    expect(b.controller.hintIndex).toBe(0);
    expect(countText(RESTORED_NOTICE)).toBe(0);
    expect(document.getElementById('wrap')!.hidden).toBe(true);
    expect(document.getElementById('wrap-open')!.textContent).toBe(WRAP_BUTTON);
    expect(document.querySelector('#wrap-qr svg')).not.toBeNull();
    expect(document.getElementById('wrap-url')!.textContent).toBe(PAGES);
    expect(document.getElementById('wrap-line')!.textContent).toBe(WRAP_LINE);
    expect(document.getElementById('wrap-caption')!.textContent).toBe(WRAP_QR_CAPTION);
    expect(document.getElementById('wrap-org')!.textContent).toBe(WRAP_CREDIT);
  });

  it('refresh: restores the saved session and shows the notice exactly once', () => {
    const store = new MemStore();
    saveSession(store, savedSession());
    const b = boot(env(store));
    expect(b.restored).toBe(true);
    expect(b.controller.hintIndex).toBe(1);
    expect(b.controller.session.history).toEqual(['ancestry_test(person = "me")']);
    expect(countText(RESTORED_NOTICE)).toBe(1);
    expect(b.controller.session.transcript.some((l) => l.text === RESTORED_NOTICE)).toBe(false);
  });

  it('the notice comes from the shell: a Controller built on a restored session prints none', () => {
    const terminal = mountTerminal(document.getElementById('terminal')!, { onEnter: () => {}, onEsc: () => {}, onTab: (p) => p });
    new Controller({ data: FIXTURE, terminal, renderPlot: () => {}, store: new MemStore() }, savedSession());
    expect(countText(RESTORED_NOTICE)).toBe(0);
  });

  it('?reset: clears the saved session, starts at step 0 and strips ?reset from the URL', () => {
    const store = new MemStore();
    saveSession(store, savedSession());
    const replaced: string[] = [];
    const b = boot(env(store, `${FILE_URL}?reset`, (u) => replaced.push(u)));
    expect(b.reset).toBe(true);
    expect(b.restored).toBe(false);
    expect(b.controller.hintIndex).toBe(0);
    expect(b.controller.session.history).toEqual([]);
    expect(countText(RESTORED_NOTICE)).toBe(0);
    expect(replaced).toEqual([FILE_URL]);
    const after = loadSession(store);
    expect(after === null || after.history.length === 0).toBe(true);
  });

  it('?reset still works when replaceState is refused', () => {
    const store = new MemStore();
    saveSession(store, savedSession());
    const b = boot(env(store, `${FILE_URL}?reset`, () => { throw new DOMException('no', 'SecurityError'); }));
    expect(b.restored).toBe(false);
    expect(b.controller.hintIndex).toBe(0);
  });

  it('corrupt saved session: no crash, no notice, fresh start', () => {
    const store = new MemStore();
    saveSession(store, savedSession());
    expect(store.length).toBeGreaterThan(0);
    for (const k of [...store.map.keys()]) store.map.set(k, '{"history": [oops');
    const b = boot(env(store));
    expect(b.restored).toBe(false);
    expect(b.controller.hintIndex).toBe(0);
    expect(countText(RESTORED_NOTICE)).toBe(0);
  });

  it('refresh reads the v2 key', () => {
    const store = new MemStore();
    saveSession(store, savedSession());
    expect([...store.map.keys()]).toEqual([SESSION_KEY]);
    expect(boot(env(store)).restored).toBe(true);
  });

  it('a v1 session (the old key) is removed and ignored: fresh start, no notice', () => {
    const store = new MemStore();
    store.setItem(LEGACY_SESSION_KEY, JSON.stringify({ history: ['load_genomes()'], transcript: [], hintIndex: 2, plot: {} }));
    const b = boot(env(store));
    expect(b.restored).toBe(false);
    expect(b.controller.hintIndex).toBe(0);
    expect(store.map.has(LEGACY_SESSION_KEY)).toBe(false);
    expect(countText(RESTORED_NOTICE)).toBe(0);
  });

  it('blocked sessionStorage: no crash, commands still run', () => {
    const b = boot(env(() => { throw new DOMException('denied', 'SecurityError'); }));
    expect(b.store).toBeNull();
    expect(b.restored).toBe(false);
    expect(() => b.controller.submit('help()')).not.toThrow();
    expect(() => b.controller.submit('load_genomes()')).not.toThrow();
  });

  it('storage whose reads throw after a good probe: no crash', () => {
    const store = new MemStore();
    store.getItem = () => { throw new DOMException('denied', 'SecurityError'); };
    const b = boot(env(store));
    expect(b.restored).toBe(false);
    expect(() => b.controller.submit('help()')).not.toThrow();
  });

  it('wrap screen opens with the button and closes with Esc and with its button', () => {
    boot(env(new MemStore()));
    const wrap = document.getElementById('wrap')!;
    document.getElementById('wrap-open')!.click();
    expect(wrap.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrap.hidden).toBe(true);
    document.getElementById('wrap-open')!.click();
    document.getElementById('wrap-close')!.click();
    expect(wrap.hidden).toBe(true);
  });
});

describe('card view wiring (Task 12)', () => {
  it('boot mounts the card view on #card, hidden, and reports the flags and the test flag', () => {
    const b = boot(env(new MemStore()));
    expect(b.cards.isOpen()).toBe(false);
    expect(document.getElementById('card')!.hidden).toBe(true);
    expect(document.getElementById('card')!.classList.contains('card')).toBe(true);
    expect(b.test).toBe(false);
    expect(boot(env(new MemStore(), `${FILE_URL}?test`)).test).toBe(true);
  });

  it('mounts the view after the terminal: the view already watches the hint line when boot returns', () => {
    const win = document.defaultView as unknown as { ResizeObserver?: unknown };
    const observed: Element[] = [];
    win.ResizeObserver = class {
      observe(e: Element): void {
        observed.push(e);
      }
      disconnect(): void {}
    };
    try {
      boot(env(new MemStore()));
    } finally {
      delete win.ResizeObserver;
    }
    // Mounted before the terminal, the view would find no hint line at mount and would only start watching at its first open.
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(document.querySelector('#terminal .term-hint'));
  });

  it('gives the card view the flag set: the Back button is on the card only with the back flag', () => {
    const on = boot({ ...env(new MemStore()), features: withFeatures({ back: true }, ALL_OFF) });
    expect(on.features.back).toBe(true);
    on.cards.open('A1', 0, 1, 'after');
    expect(document.querySelector('#card .card-back')).not.toBeNull();
    loadIndexHtml();
    const off = boot({ ...env(new MemStore()), features: ALL_OFF });
    off.cards.open('A1', 0, 1, 'after');
    expect(document.querySelector('#card .card-back')).toBeNull();
  });

  it('the controller opens and closes cards through that view, and a guided card draws over #card', () => {
    const b = boot(env(new MemStore(), `${FILE_URL}?test`));
    b.controller.openCardForTest('A1');
    expect(b.cards.isOpen()).toBe(true);
    expect(b.cards.currentId()).toBe('A1');
    expect(document.getElementById('card')!.hidden).toBe(false);
    b.controller.continueCard();
    expect(b.cards.isOpen()).toBe(false);
    expect(document.getElementById('card')!.hidden).toBe(true);
  });
});

describe('Up/Down history after a refresh (Task 12, carry-forward from the Task 6 review)', () => {
  const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('#terminal input')!;
  const press = (key: string): void => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };
  const typeLine = (line: string): void => {
    input().value = line;
    press('Enter');
  };
  /** What a student sees pressing Up until the oldest entry, then three more times. */
  const walkUp = (n: number): string[] => Array.from({ length: n }, () => (press('ArrowUp'), input().value));

  it('matches the live terminal: a line typed twice in a row is in the history once', () => {
    const store = new MemStore();
    boot(env(store));
    for (const line of ['help()', 'help()', 'oops', 'oops', 'help()', 'help() ']) typeLine(line);   // the last differs by a space
    const live = walkUp(6);
    expect(live).toEqual(['help() ', 'help()', 'oops', 'help()', 'help()', 'help()']);

    loadIndexHtml();                       // a refresh: new page, same sessionStorage
    const again = boot(env(store));
    expect(again.restored).toBe(true);
    expect(walkUp(6)).toEqual(live);
  });
});
