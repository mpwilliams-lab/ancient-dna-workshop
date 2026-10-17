// Session v2 (spec v3 §4.2, CONTRACT §4.7): the command log, a cursor and the build hash. Plot, hint pointer and cards
// are not stored: they are rebuilt by replaying the log (replay.ts), so refresh (P1) and Back (P2) share one mechanism.
import { sessionBuildHash } from './replay';

export const SESSION_KEY = 'adna-workshop-session-v2';
/** The v2.1 key. Ignored and removed on every load. */
export const LEGACY_SESSION_KEY = 'adna-workshop-session-v1';
export const MAX_STEPS = 1000;
export const MAX_TRANSCRIPT = 2000;
export const MAX_HISTORY = 200;

export type TranscriptKind = 'input' | 'output' | 'notice' | 'clear';
export interface TranscriptEntry { seq: number; kind: TranscriptKind; text: string }
/** cmd = formatCommand(parsed command); endSeq = last transcript seq of that step's output. */
export interface SessionStep { cmd: string; endSeq: number }
/** step = number of steps applied (0..steps.length); card = open card index, or cards.length when none is open. */
export interface Cursor { step: number; card: number }
export interface SessionV2 {
  version: 2;
  build: string;
  history: string[];
  transcript: TranscriptEntry[];
  steps: SessionStep[];
  cursor: Cursor;
  nextSeq: number;
}
export type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KINDS: readonly TranscriptKind[] = ['input', 'output', 'notice', 'clear'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isKind = (v: unknown): v is TranscriptKind => typeof v === 'string' && (KINDS as readonly string[]).includes(v);

function toSession(v: unknown, build: string): SessionV2 | null {
  if (!isObj(v) || v.version !== 2 || v.build !== build) return null;
  const { history, transcript, steps, cursor, nextSeq } = v;
  if (!Array.isArray(history) || !history.every((h) => typeof h === 'string')) return null;
  if (!Array.isArray(transcript) || !Array.isArray(steps)) return null;
  const t: TranscriptEntry[] = [];
  let last = 0;
  for (const e of transcript) {
    if (!isObj(e) || !isInt(e.seq) || e.seq <= last || !isKind(e.kind) || typeof e.text !== 'string') return null;
    last = e.seq;
    t.push({ seq: e.seq, kind: e.kind, text: e.text });
  }
  if (steps.length > MAX_STEPS) return null;
  const st: SessionStep[] = [];
  for (const s of steps) {
    if (!isObj(s) || typeof s.cmd !== 'string' || !isInt(s.endSeq) || s.endSeq < 0) return null;
    st.push({ cmd: s.cmd, endSeq: s.endSeq });
  }
  if (!isObj(cursor) || !isInt(cursor.step) || !isInt(cursor.card)) return null;
  if (cursor.step < 0 || cursor.step > st.length || cursor.card < 0) return null;
  if (!isInt(nextSeq) || nextSeq <= last) return null;
  return {
    version: 2,
    build,
    history: (history as string[]).slice(-MAX_HISTORY),
    transcript: t,
    steps: st,
    cursor: { step: cursor.step, card: cursor.card },
    nextSeq,
  };
}

let warnedTooLong = false;

/** Saves the session, keeping the newest MAX_HISTORY / MAX_TRANSCRIPT entries. Past MAX_STEPS steps it stops saving and
 *  warns once per page. Silently does nothing if storage is missing, blocked or full. Never throws. */
export function saveSession(store: SessionStorageLike | null, s: SessionV2): void {
  if (!store) return;
  if (s.steps.length > MAX_STEPS) {
    if (!warnedTooLong) {
      warnedTooLong = true;
      console.warn(`Session not saved: more than ${MAX_STEPS} steps. The workshop carries on; a refresh would start from the last save.`);
    }
    return;
  }
  try {
    const out: SessionV2 = { ...s, history: s.history.slice(-MAX_HISTORY), transcript: s.transcript.slice(-MAX_TRANSCRIPT) };
    store.setItem(SESSION_KEY, JSON.stringify(out));
  } catch {
    // blocked or over quota: the workshop carries on without persistence
  }
}

/** The saved session, or null when it is missing, corrupt, wrong-shaped, from another build, or storage is blocked.
 *  Always removes the v1 key; a rejected v2 entry is removed too. Never throws. */
export function loadSession(store: SessionStorageLike | null, build: string = sessionBuildHash()): SessionV2 | null {
  if (!store) return null;
  try {
    store.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // blocked storage: nothing to remove
  }
  let raw: string | null;
  try {
    raw = store.getItem(SESSION_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let session: SessionV2 | null = null;
  try {
    session = toSession(JSON.parse(raw), build);
  } catch {
    session = null;
  }
  if (!session) {
    try {
      store.removeItem(SESSION_KEY);
    } catch {
      // nothing to do
    }
  }
  return session;
}

/** Removes the saved session and the v1 key (?reset). Never throws. */
export function clearSession(store: SessionStorageLike | null): void {
  if (!store) return;
  for (const key of [SESSION_KEY, LEGACY_SESSION_KEY]) {
    try {
      store.removeItem(key);
    } catch {
      // nothing to do
    }
  }
}

/** w.sessionStorage if it can actually be used, else null. Touching the property can itself throw in Edge.
 *  Call as getSessionStore(typeof window === 'undefined' ? null : window). */
export function getSessionStore(w: { sessionStorage: Storage } | null): SessionStorageLike | null {
  if (!w) return null;
  try {
    const store = w.sessionStorage;
    if (!store) return null;
    const probe = `${SESSION_KEY}-probe`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

/** The entries after the last 'clear' marker with seq <= uptoSeq, markers excluded (uptoSeq = Infinity: everything). */
export function visibleTranscript(t: readonly TranscriptEntry[], uptoSeq: number): TranscriptEntry[] {
  let start = 0;
  t.forEach((e, i) => {
    if (e.kind === 'clear' && e.seq <= uptoSeq) start = i + 1;
  });
  return t.slice(start).filter((e) => e.kind !== 'clear' && e.seq <= uptoSeq);
}

export function emptySession(): SessionV2 {
  return { version: 2, build: sessionBuildHash(), history: [], transcript: [], steps: [], cursor: { step: 0, card: 0 }, nextSeq: 1 };
}
