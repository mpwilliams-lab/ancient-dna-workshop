import { describe, it, expect } from 'vitest';
import {
  saveSession, loadSession, clearSession, getSessionStore, SESSION_KEY, MAX_TRANSCRIPT, MAX_HISTORY,
  type Session, type SessionStorageLike,
} from '../src/session';
import { INITIAL_PLOT } from '../src/plotState';

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

const SAMPLE: Session = {
  history: ['ancestry_test(person = "me")', 'load_genomes()', 'run_pca(period = "AngloSaxon")'],
  transcript: [
    { kind: 'input', text: '> ancestry_test(person = "me")' },
    { kind: 'output', text: '  British      [##################..]  92%' },
    { kind: 'notice', text: 'Restored previous session — reload with ?reset to start fresh' },
  ],
  hintIndex: 2,
  plot: {
    ...INITIAL_PLOT, view: 'admixture', layers: ['IronAge', 'AngloSaxon', 'Today'], frame: 'britain', showNorthSea: true,
    admixShown: ['IronAge', 'AngloSaxon', 'Today'], admixNew: ['AngloSaxon'], admixPeriod: 'AngloSaxon', gene: 'LCT',
  },
};

describe('session persistence (RF4)', () => {
  it('uses one versioned key', () => {
    expect(SESSION_KEY).toBe('adna-workshop-session-v1');
  });
  it('round-trips a session', () => {
    const store = new MemoryStore();
    saveSession(store, SAMPLE);
    expect(store.map.has(SESSION_KEY)).toBe(true);
    expect(loadSession(store)).toEqual(SAMPLE);
  });
  it('round-trips the initial plot (no optional fields)', () => {
    const store = new MemoryStore();
    const s: Session = { history: [], transcript: [], hintIndex: 0, plot: INITIAL_PLOT };
    saveSession(store, s);
    expect(loadSession(store)).toEqual(s);
  });
  it('returns null when nothing is saved', () => {
    expect(loadSession(new MemoryStore())).toBeNull();
  });
  it('a null store (storage unavailable) never throws', () => {
    expect(() => saveSession(null, SAMPLE)).not.toThrow();
    expect(loadSession(null)).toBeNull();
    expect(() => clearSession(null)).not.toThrow();
  });
  it('blocked storage (every call throws) never throws', () => {
    const store = new BlockedStore();
    expect(() => saveSession(store, SAMPLE)).not.toThrow();
    expect(loadSession(store)).toBeNull();
    expect(() => clearSession(store)).not.toThrow();
  });
  it('corrupt or wrong-shaped data returns null and removes the bad entry', () => {
    const bad: string[] = [
      '{not json', 'null', '42', '"text"', '[]', '{}',
      JSON.stringify({ ...SAMPLE, history: 'run_pca' }),
      JSON.stringify({ ...SAMPLE, history: [1, 2] }),
      JSON.stringify({ ...SAMPLE, transcript: [{ kind: 'shout', text: 'x' }] }),
      JSON.stringify({ ...SAMPLE, transcript: [{ kind: 'input' }] }),
      JSON.stringify({ ...SAMPLE, hintIndex: 17 }),
      JSON.stringify({ ...SAMPLE, hintIndex: -1 }),
      JSON.stringify({ ...SAMPLE, hintIndex: 1.5 }),
      JSON.stringify({ ...SAMPLE, hintIndex: '3' }),
      JSON.stringify({ ...SAMPLE, plot: null }),
      JSON.stringify({ ...SAMPLE, plot: { ...SAMPLE.plot, view: 'map' } }),
      JSON.stringify({ ...SAMPLE, plot: { ...SAMPLE.plot, layers: ['Neolithic'] } }),
      JSON.stringify({ ...SAMPLE, plot: { ...SAMPLE.plot, frame: 'asia' } }),
      JSON.stringify({ ...SAMPLE, plot: { ...SAMPLE.plot, showNorthSea: 'yes' } }),
      JSON.stringify({ ...SAMPLE, plot: { ...SAMPLE.plot, admixShown: 'Today' } }),
      JSON.stringify({ ...SAMPLE, plot: { ...SAMPLE.plot, admixNew: ['Mars'] } }),
      JSON.stringify({ ...SAMPLE, plot: { ...SAMPLE.plot, admixPeriod: 'all' } }),
      JSON.stringify({ ...SAMPLE, plot: { ...SAMPLE.plot, gene: 'APOE' } }),
    ];
    for (const raw of bad) {
      const store = new MemoryStore();
      store.setItem(SESSION_KEY, raw);
      expect(loadSession(store)).toBeNull();
      expect(store.map.has(SESSION_KEY)).toBe(false);
    }
  });
  it('the last script position (16, after HLA-DQ2) is a valid hint index', () => {
    const store = new MemoryStore();
    saveSession(store, { ...SAMPLE, hintIndex: 16 });
    expect(loadSession(store)?.hintIndex).toBe(16);
  });
  it('keeps only the newest transcript and history lines, and survives a 2,000-character line', () => {
    expect(MAX_TRANSCRIPT).toBe(2000);
    expect(MAX_HISTORY).toBe(200);
    const store = new MemoryStore();
    const paste = 'x'.repeat(2000);
    const s: Session = {
      ...SAMPLE,
      history: Array.from({ length: 300 }, (_, k) => `cmd ${k}`).concat(paste),
      transcript: Array.from({ length: 2500 }, (_, k) => ({ kind: 'output' as const, text: `line ${k}` })),
    };
    saveSession(store, s);
    const back = loadSession(store)!;
    expect(back.history).toHaveLength(200);
    expect(back.history[199]).toBe(paste);
    expect(back.history[0]).toBe('cmd 101');
    expect(back.transcript).toHaveLength(2000);
    expect(back.transcript[0]?.text).toBe('line 500');
    expect(back.transcript[1999]?.text).toBe('line 2499');
  });
  it('clearSession removes the saved session (?reset)', () => {
    const store = new MemoryStore();
    saveSession(store, SAMPLE);
    clearSession(store);
    expect(loadSession(store)).toBeNull();
    expect(store.map.size).toBe(0);
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
