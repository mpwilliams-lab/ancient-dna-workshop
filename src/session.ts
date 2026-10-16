import type { PeriodId } from './types';
import { PERIOD_IDS, GENE_IDS, FRAME_IDS } from './types';
import type { PlotState } from './plotState';
import { SCRIPT } from './hints';

export interface TranscriptLine { kind: 'input' | 'output' | 'notice'; text: string }
export interface Session { history: string[]; transcript: TranscriptLine[]; hintIndex: number; plot: PlotState }
export type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const SESSION_KEY = 'adna-workshop-session-v1';
export const MAX_TRANSCRIPT = 2000;
export const MAX_HISTORY = 200;

const VIEWS: readonly PlotState['view'][] = ['none', 'pca', 'admixture', 'trait'];
const KINDS: readonly TranscriptLine['kind'][] = ['input', 'output', 'notice'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const isPeriodList = (v: unknown): v is PeriodId[] => Array.isArray(v) && v.every((x) => isOneOf(PERIOD_IDS, x));

function toPlot(v: unknown): PlotState | null {
  if (!isObj(v)) return null;
  if (!isOneOf(VIEWS, v.view) || !isOneOf(FRAME_IDS, v.frame) || typeof v.showNorthSea !== 'boolean') return null;
  if (!isPeriodList(v.layers) || !isPeriodList(v.admixShown) || !isPeriodList(v.admixNew)) return null;
  if (v.admixPeriod !== undefined && !isOneOf(PERIOD_IDS, v.admixPeriod)) return null;
  if (v.gene !== undefined && !isOneOf(GENE_IDS, v.gene)) return null;
  const plot: PlotState = {
    view: v.view, layers: v.layers, frame: v.frame, showNorthSea: v.showNorthSea, admixShown: v.admixShown, admixNew: v.admixNew,
  };
  if (v.admixPeriod !== undefined) plot.admixPeriod = v.admixPeriod;
  if (v.gene !== undefined) plot.gene = v.gene;
  return plot;
}

function toSession(v: unknown): Session | null {
  if (!isObj(v)) return null;
  const { history, transcript, hintIndex } = v;
  if (!Array.isArray(history) || !history.every((h) => typeof h === 'string')) return null;
  if (!Array.isArray(transcript) || !transcript.every((t) => isObj(t) && isOneOf(KINDS, t.kind) && typeof t.text === 'string')) return null;
  if (typeof hintIndex !== 'number' || !Number.isInteger(hintIndex) || hintIndex < 0 || hintIndex > SCRIPT.length) return null;
  const plot = toPlot(v.plot);
  if (!plot) return null;
  return {
    history: history as string[],
    transcript: (transcript as TranscriptLine[]).map((t) => ({ kind: t.kind, text: t.text })),
    hintIndex,
    plot,
  };
}

/** Saves the session; silently does nothing if storage is missing, blocked or full. */
export function saveSession(store: SessionStorageLike | null, s: Session): void {
  if (!store) return;
  try {
    const trimmed: Session = { ...s, history: s.history.slice(-MAX_HISTORY), transcript: s.transcript.slice(-MAX_TRANSCRIPT) };
    store.setItem(SESSION_KEY, JSON.stringify(trimmed));
  } catch {
    // blocked or over quota: the workshop carries on without persistence
  }
}

/** The saved session, or null when it is missing, corrupt, wrong-shaped or storage is blocked. A bad entry is removed. */
export function loadSession(store: SessionStorageLike | null): Session | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(SESSION_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let session: Session | null = null;
  try {
    session = toSession(JSON.parse(raw));
  } catch {
    session = null;
  }
  if (!session) clearSession(store);
  return session;
}

/** Removes the saved session (?reset). Never throws. */
export function clearSession(store: SessionStorageLike | null): void {
  if (!store) return;
  try {
    store.removeItem(SESSION_KEY);
  } catch {
    // nothing to do
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
