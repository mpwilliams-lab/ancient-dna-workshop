// Back (spec §4.1, CONTRACT §4.9): which screen comes before the current one, and the session cut back to it.
// Pure, so the controller, refresh-restore and the tests share one definition. A screen is { step, card }: step = number of
// steps applied; card = the open card's index, or the step's card count for its bare plot (session cursor).
import type { CardId } from './types';
import type { Cursor, SessionV2 } from './session';

/** The screen before `cursor`, or null at the start. cardsFor[k] are the cards step k (0-based) opened, skipped or not. */
export function prevScreen(cursor: Cursor, cardsFor: readonly (readonly CardId[])[]): Cursor | null {
  const s = Number.isFinite(cursor.step) ? Math.trunc(cursor.step) : 0;
  if (s <= 0) return null;
  const n = cardsFor[s - 1]?.length ?? 0;
  const c = Math.max(0, Math.min(Number.isFinite(cursor.card) ? Math.trunc(cursor.card) : n, n));
  if (c > 0) return { step: s, card: c - 1 };
  if (s === 1) return { step: 0, card: 0 };
  return { step: s - 1, card: cardsFor[s - 2]?.length ?? 0 };
}

/**
 * The session after one Back: steps after the target screen dropped (there is no forward), the transcript cut to what it
 * was at the end of the target step (everything after it, mistyped lines and clear markers included, disappears), the
 * cursor on the target screen. Up/Down history, nextSeq and the build hash are kept. Null at the start.
 */
export function backSession(s: SessionV2, cardsFor: readonly (readonly CardId[])[]): SessionV2 | null {
  const target = prevScreen(s.cursor, cardsFor);
  if (target === null) return null;
  const steps = s.steps.slice(0, target.step);
  const cut = target.step > 0 ? steps[target.step - 1]!.endSeq : 0;
  return {
    ...s,
    history: [...s.history],
    steps,
    transcript: s.transcript.filter((e) => e.seq <= cut),
    cursor: target,
  };
}
