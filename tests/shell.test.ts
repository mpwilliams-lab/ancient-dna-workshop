// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot, hasReset, probeStorage, stripReset } from '../src/shell';
import { Controller } from '../src/controller';
import { mountTerminal } from '../src/terminal';
import { saveSession, loadSession, type Session } from '../src/session';
import { INITIAL_PLOT } from '../src/plotState';
import { APP_TITLE, RESTORED_NOTICE, WRAP_BUTTON, WRAP_CREDIT, WRAP_LINE, WRAP_QR_CAPTION } from '../src/content';
import { FIXTURE, MemStore, countText, loadIndexHtml } from './helpers/shellEnv';

const FILE_URL = 'file:///C:/Users/lab/Desktop/ancient-dna-workshop.html';
const PAGES = 'https://mpwilliams-lab.github.io/ancient-dna-workshop/';

function savedSession(): Session {
  return {
    history: ['ancestry_test(person = "me")'],
    transcript: [{ kind: 'input', text: 'ancestry_test(person = "me")' }],
    hintIndex: 1,
    plot: INITIAL_PLOT,
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
