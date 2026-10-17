// session.ts v2 (Task 6, CONTRACT §4.7) and spec §4.5 test 8.
import { describe, expect, it, vi } from 'vitest';
import {
  LEGACY_SESSION_KEY, MAX_HISTORY, MAX_STEPS, MAX_TRANSCRIPT, SESSION_KEY, clearSession, emptySession, getSessionStore,
  loadSession, saveSession, visibleTranscript, type SessionStorageLike, type SessionV2, type TranscriptEntry,
} from '../src/session';
import { sessionBuildHash } from '../src/replay';

class MemoryStore implements SessionStorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
}
class BlockedStore implements SessionStorageLike {
  getItem(): string | null { throw new DOMException('The operation is insecure.', 'SecurityError'); }
  setItem(): void { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }
  removeItem(): void { throw new DOMException('The operation is insecure.', 'SecurityError'); }
}

const SAMPLE: SessionV2 = {
  version: 2,
  build: sessionBuildHash(),
  history: ['ancestry_test(person = "me")', 'oops', 'load_genomes()'],
  transcript: [
    { seq: 1, kind: 'input', text: 'ancestry_test(person = "me")' },
    { seq: 2, kind: 'output', text: '  British      [##################..]  92%' },
    { seq: 3, kind: 'input', text: 'oops' },
    { seq: 4, kind: 'output', text: 'That is not a command in this workshop.' },
    { seq: 5, kind: 'clear', text: '' },
    { seq: 6, kind: 'input', text: 'load_genomes()' },
    { seq: 7, kind: 'output', text: 'Genomes loaded.' },
  ],
  steps: [{ cmd: 'ancestry_test(person = "me")', endSeq: 2 }, { cmd: 'load_genomes()', endSeq: 7 }],
  cursor: { step: 2, card: 0 },
  nextSeq: 8,
};
const clone = (): SessionV2 => structuredClone(SAMPLE);

describe('session v2 keys and limits', () => {
  it('uses the v2 key, knows the v1 key, and pins the limits', () => {
    expect(SESSION_KEY).toBe('adna-workshop-session-v2');
    expect(LEGACY_SESSION_KEY).toBe('adna-workshop-session-v1');
    expect(MAX_STEPS).toBe(1000);
    expect(MAX_TRANSCRIPT).toBe(2000);
    expect(MAX_HISTORY).toBe(200);
  });
});

describe('save and load', () => {
  it('round-trips a session', () => {
    const store = new MemoryStore();
    saveSession(store, SAMPLE);
    expect(store.map.has(SESSION_KEY)).toBe(true);
    expect(loadSession(store)).toEqual(SAMPLE);
  });

  it('emptySession is version 2 with the build hash, empty lists, cursor {0, 0} and nextSeq 1, and round-trips', () => {
    const e = emptySession();
    expect(e).toEqual({
      version: 2, build: sessionBuildHash(), history: [], transcript: [], steps: [], cursor: { step: 0, card: 0 }, nextSeq: 1,
    });
    const store = new MemoryStore();
    saveSession(store, e);
    expect(loadSession(store)).toEqual(e);
  });

  it('returns null when nothing is saved; a null store and blocked storage never throw', () => {
    expect(loadSession(new MemoryStore())).toBeNull();
    expect(() => saveSession(null, SAMPLE)).not.toThrow();
    expect(loadSession(null)).toBeNull();
    expect(() => clearSession(null)).not.toThrow();
    const blocked = new BlockedStore();
    expect(() => saveSession(blocked, SAMPLE)).not.toThrow();
    expect(loadSession(blocked)).toBeNull();
    expect(() => clearSession(blocked)).not.toThrow();
  });

  it('keeps only the newest history and transcript entries, and survives a 2,000-character line', () => {
    const store = new MemoryStore();
    const paste = 'x'.repeat(2000);
    const transcript: TranscriptEntry[] = Array.from({ length: 2500 }, (_, k) => ({ seq: k + 1, kind: 'output' as const, text: `line ${k}` }));
    saveSession(store, {
      ...clone(),
      history: Array.from({ length: 300 }, (_, k) => `cmd ${k}`).concat(paste),
      transcript,
      steps: [],
      cursor: { step: 0, card: 0 },
      nextSeq: 2501,
    });
    const back = loadSession(store)!;
    expect(back.history).toHaveLength(MAX_HISTORY);
    expect(back.history[MAX_HISTORY - 1]).toBe(paste);
    expect(back.history[0]).toBe('cmd 101');
    expect(back.transcript).toHaveLength(MAX_TRANSCRIPT);
    expect(back.transcript[0]?.text).toBe('line 500');
    expect(back.transcript[MAX_TRANSCRIPT - 1]?.text).toBe('line 2499');
  });

  it('past MAX_STEPS it stops saving and warns once per page (the workshop carries on)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new MemoryStore();
    const tooLong: SessionV2 = {
      ...clone(),
      steps: Array.from({ length: MAX_STEPS + 1 }, () => ({ cmd: 'load_genomes()', endSeq: 7 })),
      cursor: { step: MAX_STEPS + 1, card: 0 },
    };
    expect(() => saveSession(store, tooLong)).not.toThrow();
    expect(() => saveSession(store, tooLong)).not.toThrow();
    expect(store.map.has(SESSION_KEY)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('clearSession removes both the v2 and the v1 key (?reset)', () => {
    const store = new MemoryStore();
    saveSession(store, SAMPLE);
    store.setItem(LEGACY_SESSION_KEY, '{}');
    clearSession(store);
    expect(store.map.size).toBe(0);
  });
});

describe('spec §4.5 test 8: corrupt, v1 and other-build sessions start fresh without throwing', () => {
  it('always removes the v1 key, even when the v2 entry is fine', () => {
    const store = new MemoryStore();
    saveSession(store, SAMPLE);
    store.setItem(LEGACY_SESSION_KEY, JSON.stringify({ history: [], transcript: [], hintIndex: 2, plot: {} }));
    expect(loadSession(store)).toEqual(SAMPLE);
    expect(store.map.has(LEGACY_SESSION_KEY)).toBe(false);
  });

  it('a v1 session alone is ignored and removed', () => {
    const store = new MemoryStore();
    store.setItem(LEGACY_SESSION_KEY, JSON.stringify({ history: ['load_genomes()'], transcript: [], hintIndex: 2, plot: {} }));
    expect(loadSession(store)).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it('a session from another build (different script or cards) is rejected and removed', () => {
    const store = new MemoryStore();
    saveSession(store, { ...clone(), build: '00000000' });
    expect(loadSession(store)).toBeNull();
    expect(store.map.has(SESSION_KEY)).toBe(false);
    saveSession(store, SAMPLE);
    expect(loadSession(store, 'ffffffff')).toBeNull(); // an explicit build is honoured
  });

  const BROKEN: [string, (s: any) => void][] = [
    ['version 1', (s) => { s.version = 1; }],
    ['no build', (s) => { delete s.build; }],
    ['history not strings', (s) => { s.history = [1, 2]; }],
    ['an unknown transcript kind', (s) => { s.transcript[0].kind = 'shout'; }],
    ['transcript seqs not increasing', (s) => { s.transcript[1].seq = 1; }],
    ['a transcript entry without text', (s) => { delete s.transcript[2].text; }],
    ['a step without cmd', (s) => { delete s.steps[0].cmd; }],
    ['a negative endSeq', (s) => { s.steps[1].endSeq = -1; }],
    ['steps not an array', (s) => { s.steps = {}; }],
    ['more than MAX_STEPS steps', (s) => {
      s.steps = Array.from({ length: MAX_STEPS + 1 }, () => ({ cmd: 'load_genomes()', endSeq: 7 }));
      s.cursor.step = 0;
    }],
    ['a cursor past the last step', (s) => { s.cursor.step = 3; }],
    ['a negative card index', (s) => { s.cursor.card = -1; }],
    ['a fractional cursor', (s) => { s.cursor.step = 1.5; }],
    ['a cursor that is not an object', (s) => { s.cursor = 2; }],
    ['nextSeq not after the last seq', (s) => { s.nextSeq = 7; }],
  ];
  it.each(BROKEN)('a wrong-shaped session (%s) returns null and is removed', (_name, breakIt) => {
    const store = new MemoryStore();
    const s = clone();
    breakIt(s);
    store.setItem(SESSION_KEY, JSON.stringify(s));
    expect(() => loadSession(store)).not.toThrow();
    expect(loadSession(store)).toBeNull();
    expect(store.map.has(SESSION_KEY)).toBe(false);
  });

  it.each(['{not json', 'null', '42', '"text"', '[]', '{}'])('corrupt JSON %j returns null and is removed', (raw) => {
    const store = new MemoryStore();
    store.setItem(SESSION_KEY, raw);
    expect(loadSession(store)).toBeNull();
    expect(store.map.has(SESSION_KEY)).toBe(false);
  });
});

describe('visibleTranscript', () => {
  it('shows the entries after the last clear marker, never the markers themselves', () => {
    expect(visibleTranscript(SAMPLE.transcript, Infinity).map((e) => e.seq)).toEqual([6, 7]);
  });
  it('cuts at uptoSeq, and a clear marker after uptoSeq does not hide earlier lines', () => {
    expect(visibleTranscript(SAMPLE.transcript, 4).map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(visibleTranscript(SAMPLE.transcript, 6).map((e) => e.seq)).toEqual([6]);
    expect(visibleTranscript(SAMPLE.transcript, 0)).toEqual([]);
    expect(visibleTranscript([], Infinity)).toEqual([]);
  });
});

describe('getSessionStore', () => {
  it('returns null when there is no window', () => {
    expect(getSessionStore(null)).toBeNull();
  });
  it.runIf(typeof window !== 'undefined')('works with the real (jsdom) window', () => {
    expect(getSessionStore(window)).toBe(window.sessionStorage);
  });
  it('returns null when touching sessionStorage throws (Edge with site data blocked)', () => {
    const w = {} as { sessionStorage: Storage };
    Object.defineProperty(w, 'sessionStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
    expect(getSessionStore(w)).toBeNull();
  });
  it('returns null when a probe write fails', () => {
    expect(getSessionStore({ sessionStorage: new BlockedStore() as unknown as Storage })).toBeNull();
  });
  it('returns the store when it works and leaves no probe behind', () => {
    const mem = new MemoryStore();
    expect(getSessionStore({ sessionStorage: mem as unknown as Storage })).toBe(mem);
    expect(mem.map.size).toBe(0);
  });
});
