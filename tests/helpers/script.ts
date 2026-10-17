// The guided script as screens (Task 17, spec §4.1): which screens a session has, which one a student stands on, and one walk through
// the whole script that the headless Back tests (fake terminal, fake card host) and the real-page Back tests (boot, jsdom) both use,
// each through a small driver of its own. Pure: no DOM and no test framework in here.
import { SCRIPT, SCRIPT_STEPS } from '../../src/hints';
import { formatCommand } from '../../src/parser';
import type { CardId } from '../../src/types';

/** A screen is step k with card j open, or step k bare (j = the step's card count): the session cursor. */
export interface Screen { step: number; card: number }

/** How many cards guided step i (0-based) opens: the screens that come before its bare plot. */
export const cardCount = (i: number): number => SCRIPT_STEPS[i]?.cards?.ids.length ?? 0;

/**
 * Every screen of a session in the order a student meets them: the start, then for each step its cards and its bare plot.
 * cardsFor[k] are the cards step k (0-based) opened. A step without cards has only its bare plot, {step, card: 0}.
 * This is the model Back must follow, and it shares no code with src/back.ts.
 */
export function screensOf(cardsFor: readonly (readonly CardId[])[]): Screen[] {
  const all: Screen[] = [{ step: 0, card: 0 }];
  cardsFor.forEach((cards, k) => {
    for (let j = 0; j <= cards.length; j += 1) if (!(cards.length === 0 && j === 1)) all.push({ step: k + 1, card: j });
  });
  return all;
}

/** What a Controller lets a test read to say which screen the student is on. */
export interface ScreenSource {
  screen: Screen;
  cardOpen: CardId | null;
  derived: { cardsFor: readonly (readonly CardId[])[] };
}

/**
 * The screen the student stands on: the open card, else the step's bare plot. A step whose after-cards still wait for their log
 * has cursor.card 0 and no card open: it stands on its bare plot (the cards are skipped, but they stay screens).
 */
export function standingOn(c: ScreenSource): Screen {
  const { step, card } = c.screen;
  return c.cardOpen !== null ? { step, card } : { step, card: c.derived.cardsFor[step - 1]?.length ?? 0 };
}

/** "step.card" of a screen. */
export const screenKey = (s: Screen): string => `${s.step}.${s.card}`;

/** The screens of a full guided run, as "step.card" keys. */
export function screenKeys(): string[] {
  return screensOf(SCRIPT_STEPS.map((st) => st.cards?.ids ?? [])).map(screenKey);
}

/** How a test drives one page or controller through the script, and what it records at each screen. */
export interface ScriptDriver<S> {
  /** Types one command and lets its log finish (an after-card has opened by then, a "before" card when the command was accepted). */
  run(line: string): Promise<void>;
  /** The Continue button of the open card. */
  continueCard(): void;
  /** Everything the test compares at a screen. */
  snap(): S;
}

/**
 * Runs the guided script from step `from` (0-based, the next command to type) to its end, clicking through every card, and calls
 * `at` with the snapshot of every screen on the way, keyed "step.card". From the start it reports the first screen, "0.0", too.
 * Cards of the step the run begins in must be closed already.
 */
export async function forwardRun<S>(d: ScriptDriver<S>, at: (key: string, s: S) => void, from = 0): Promise<void> {
  if (from === 0) at('0.0', d.snap());
  for (let i = from; i < SCRIPT.length; i += 1) {
    await d.run(formatCommand(SCRIPT[i]!));
    const n = cardCount(i);
    for (let j = 0; j < n; j += 1) {
      at(`${i + 1}.${j}`, d.snap());   // card j is open
      d.continueCard();
    }
    at(`${i + 1}.${n}`, d.snap());     // the bare plot
  }
}
