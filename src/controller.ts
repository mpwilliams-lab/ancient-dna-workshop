// Wires parse -> applyCommand (replay.ts) -> plot, hint line, cards and the session v2 log (spec v3 §4.1-§4.4, §5.3).
// Live runs keep a Derived in memory and never replay; derive() is used only to restore a saved session (and, from
// Task 17, for Back). Owns the three-tries counter, the Enter-mid-print ordering and the card repeat guard.
import { CARD_IDS, type CardId, type WorkshopData } from './types';
import { parse, formatCommand, completions, leadInOf, type ParseError, type ParseResult } from './parser';
import { SCRIPT, hintCommand, hintText } from './hints';
import type { PlotState } from './plotState';
import { CARD_HINT } from './content';
import { FEATURES, type Features } from './features';
import {
  INITIAL_DERIVED, applyCommand, cardPlacement, derive, isHousekeeping, sessionBuildHash, type Applied, type Derived,
} from './replay';
import {
  MAX_TRANSCRIPT, saveSession, visibleTranscript,
  type Cursor, type SessionStep, type SessionStorageLike, type SessionV2, type TranscriptEntry, type TranscriptKind,
} from './session';
import type { KeyInfo, TerminalView } from './terminal';

/** false: no 0.5 s frame transition and no finale animation (restore and Back). */
export interface RenderOpts { animate?: boolean }

/** Draws cards over the plot (Task 12: src/cardView.ts). Opening a card never changes the plot state. */
export interface CardHost {
  open(id: CardId, index: number, count: number, placement: 'after' | 'before'): void;
  close(): void;
}

/** = the session cursor: step k with card j open, or step k bare (card = number of cards of step k). */
export interface Screen { step: number; card: number }

export interface ControllerDeps {
  data: WorkshopData;
  terminal: TerminalView;
  renderPlot(p: PlotState, opts?: RenderOpts): void;
  store: SessionStorageLike | null;
  cards?: CardHost;                                   // absent: card state is still tracked, nothing is drawn
  features?: Features;                                // default FEATURES
  now?: () => number;                                 // default performance.now(); used by the repeat guard
  plotAnimating?: () => boolean;                      // finale animation running (Task 22; default () => false)
  finishPlotAnimation?: () => void;                   // jump to the final frame
  onScreen?: (s: Screen, canGoBack: boolean) => void; // the shell updates #back (Task 17)
}

/** Spec §4.2: three incorrect tries in a row fill in the hint. */
export const MAX_BAD_TRIES = 3;
/** Longest input echoed / kept in history; longer pastes are shown cut with an ellipsis. */
export const MAX_ECHO_CHARS = 200;
/** History entries kept in the session. */
export const MAX_HISTORY = 200;
/** Spec §5.3: Enter/Esc card advances within this many ms of a card opening or of the previous advance are ignored. */
export const CARD_REPEAT_GUARD_MS = 400;

// On-screen strings owned by the controller (exported so the content scan can include them).
export function didYouMean(suggestion: string): string {
  return `Did you mean ${suggestion}?`;
}
export const AUTOFILL_NOTE = 'I have filled in the hinted command for you. Press Enter to run it.';
export const INTERNAL_ERROR_LINE = 'Something went wrong with that command. Press Esc to fill in the hinted command.';
export const CONTROLLER_STRINGS: string[] = [AUTOFILL_NOTE, INTERNAL_ERROR_LINE, didYouMean('')];

const BUILD = sessionBuildHash();
type ShownKind = Exclude<TranscriptKind, 'clear'>;

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function commonPrefix(xs: string[]): string {
  if (xs.length === 0) return '';
  let p = xs[0]!;
  for (const x of xs.slice(1)) {
    let k = 0;
    while (k < p.length && k < x.length && p[k]!.toLowerCase() === x[k]!.toLowerCase()) k++;
    p = p.slice(0, k);
  }
  return p;
}

/** A completion is either a full prompt line (starts with the partial) or a token that replaces the partial's last token. */
export function completeLine(partial: string, cand: string): string {
  if (cand.toLowerCase().startsWith(partial.toLowerCase())) return cand;
  // A copied prompt or hint label in front of the command ("> ", "Next: ") stays as typed; the candidate completes what follows it.
  const lead = leadInOf(partial);
  if (lead !== '' && cand.toLowerCase().startsWith(partial.slice(lead.length).toLowerCase())) return lead + cand;
  const m = /[A-Za-z0-9_\-]*$/.exec(partial);
  const start = m ? partial.length - m[0].length : partial.length;
  const before = partial.slice(0, start);
  const quote = before.slice(-1);
  const token = (quote === '"' || quote === "'") && cand.startsWith(quote) ? cand.slice(1) : cand;
  return before + token;
}

export class Controller {
  /** Kept whole for later tasks (Task 17 reads deps.plotAnimating / deps.onScreen); the fields below are the defaults applied. */
  private readonly deps: ControllerDeps;
  private readonly data: WorkshopData;
  private readonly t: TerminalView;
  private readonly render: (p: PlotState, opts?: RenderOpts) => void;
  private readonly store: SessionStorageLike | null;
  /** The card host (Task 12 wires src/cardView.ts; Task 12's openCardForTest uses this field). */
  private readonly cards: CardHost | undefined;
  private readonly features: Features;
  private readonly now: () => number;
  private readonly plotAnimating: () => boolean;
  private readonly finishPlotAnimation: () => void;
  private readonly onScreen: ((s: Screen, canGoBack: boolean) => void) | undefined;
  private hist: string[] = [];
  private transcript: TranscriptEntry[] = [];
  private nextSeq = 1;
  private steps: SessionStep[] = [];
  private live: Derived = INITIAL_DERIVED;
  private cursor: Cursor = { step: 0, card: 0 };
  private tries = 0;
  private pendingRender: PlotState | null = null;
  private printToken = 0;
  /** Non-null while the current step's after-cards wait for its log to end (-1 while the print is being started). */
  private pendingAfterToken: number | null = null;
  private lastCardEventAt = Number.NEGATIVE_INFINITY;
  private hostShows: CardId | null = null;
  /** A card shown by ?test openCard (spec §5.4): drawn over the current plot, never part of the session. */
  private testCard: CardId | null = null;

  constructor(deps: ControllerDeps, restored: SessionV2 | null) {
    this.deps = deps;
    this.data = deps.data;
    this.t = deps.terminal;
    this.render = deps.renderPlot;
    this.store = deps.store;
    this.cards = deps.cards;
    this.features = deps.features ?? FEATURES;
    this.now = deps.now ?? defaultNow;
    this.plotAnimating = deps.plotAnimating ?? (() => false);
    this.finishPlotAnimation = deps.finishPlotAnimation ?? (() => undefined);
    this.onScreen = deps.onScreen;
    let restoredOk = false;
    if (restored) {
      try {
        this.restore(restored);
        restoredOk = true;
      } catch (err) {
        console.error('restore failed; starting fresh', err);
        this.resetToStart();
        this.t.clearScreen();
      }
    }
    // RESTORED_NOTICE is printed once by the shell, never here.
    if (!restoredOk) this.safeRender(this.live.plot, { animate: false });
    this.refreshHint();
    this.notifyScreen();
  }

  get hintIndex(): number {
    return this.live.hintIndex;
  }

  get badTries(): number {
    return this.tries;
  }

  /** Read-only copy of the live derived state (plot, hint index, lastRan, extrasTick, cards per step). */
  get derived(): Derived {
    return { ...this.live, cardsFor: this.live.cardsFor.map((c) => [...c]) };
  }

  get session(): SessionV2 {
    return {
      version: 2,
      build: BUILD,
      history: [...this.hist],
      transcript: this.transcript.map((e) => ({ ...e })),
      steps: this.steps.map((s) => ({ ...s })),
      cursor: { ...this.cursor },
      nextSeq: this.nextSeq,
    };
  }

  get screen(): Screen {
    return { ...this.cursor };
  }

  /** The card on screen (a ?test card included); null while none is open or while the step's after-cards still wait for its log. */
  get cardOpen(): CardId | null {
    if (this.testCard !== null) return this.testCard;
    if (this.pendingAfterToken !== null) return null;
    const cards = this.currentCards();
    return this.cursor.card < cards.length ? cards[this.cursor.card]! : null;
  }

  /** Back (Task 17) is possible from any screen after the first step. */
  get canGoBack(): boolean {
    return this.cursor.step > 0;
  }

  submit(line: string, key?: KeyInfo): void {
    if (this.testCard !== null) {
      this.closeTestCard();
      if (String(line ?? '').trim() === '') return; // a blank Enter only closes the test card
    }
    const raw = typeof line === 'string' ? line : String(line ?? '');
    if (raw.trim() === '') {
      this.blankLine(key);
      return;
    }
    if (this.cardOpen !== null) this.closeStepCards(); // they stay screens for Back
    this.settlePrinting(true);
    const shown = raw.length > MAX_ECHO_CHARS ? `${raw.slice(0, MAX_ECHO_CHARS)}…` : raw;
    this.t.echoInput(shown);
    this.record('input', shown);
    if (this.hist[this.hist.length - 1] !== shown) this.hist.push(shown); // the live terminal's Up/Down history skips a repeat too
    if (this.hist.length > MAX_HISTORY) this.hist.splice(0, this.hist.length - MAX_HISTORY);

    let res: ParseResult;
    try {
      res = parse(raw);
    } catch (err) {
      console.error('parser threw', err);
      res = { ok: false, kind: 'syntax', message: INTERNAL_ERROR_LINE };
    }
    if (!res.ok) {
      this.badTry(res);
      this.notifyScreen();
      this.save();
      return;
    }

    let applied: Applied;
    try {
      applied = applyCommand(this.live, res.command, this.data, this.features);
    } catch (err) {
      console.error('command threw', err);
      this.print([INTERNAL_ERROR_LINE], false);
      this.save();
      return;
    }

    const out = applied.result;
    const isStep = !out.refused && !isHousekeeping(res.command);
    if (out.clear) {
      this.t.clearScreen();
      this.record('clear', '');
    }
    if (!out.refused) this.tries = 0;
    let target: PlotState | null = null;
    const hasCards = isStep && applied.cards.length > 0;
    if (isStep) {
      this.steps.length = this.cursor.step; // after Back (Task 17) a new step drops the undone ones; otherwise a no-op
      this.live = applied.derived;
      this.steps.push({ cmd: formatCommand(res.command), endSeq: 0 });
      this.cursor = { step: this.steps.length, card: 0 };
      if (out.plot.kind !== 'none') target = this.live.plot;
      if (hasCards && applied.placement !== 'before') this.pendingAfterToken = -1; // held until this step's log ends
    }
    this.pendingRender = target;
    this.refreshHint();
    const token = this.print(out.lines, isStep);
    if (isStep) this.steps[this.steps.length - 1]!.endSeq = this.nextSeq - 1;
    if (hasCards) {
      if (applied.placement === 'before') {
        this.showCurrentCard();
      } else if (this.t.isPrinting()) {
        this.pendingAfterToken = token;
      } else {
        this.pendingAfterToken = null; // the log is already on screen and its plot drawn
        this.showCurrentCard();
      }
    } else {
      this.notifyScreen();
    }
    this.save();
  }

  /**
   * Esc: a card is open -> advance one card; otherwise fill script[i] (v2.1). The repeat guard covers both branches: a held
   * or double-pressed Esc moves at most one card, and the press that arrives just after the last card closed must not fall
   * through to filling in the hinted command (spec §5.3).
   */
  escape(key?: KeyInfo): void {
    if (this.closeTestCard()) return;
    if (!this.keyAllowed(key)) return;
    if (this.cardOpen !== null) {
      this.advanceCard();
      return;
    }
    this.tries = 0;
    this.t.fillPrompt(this.fillText());
  }

  /** The Continue button: advance one card. Never throttled. */
  continueCard(): void {
    if (this.closeTestCard()) return;
    if (this.cardOpen !== null) this.advanceCard();
  }

  /**
   * ?test only (spec §5.4, CONTRACT §4.9): shows card `id` over the current plot. Changes no step, cursor, transcript, plot
   * or hint index. Ignored while a real card is open or about to open (a guided card is never hidden behind a test card).
   * The next Continue, blank Enter or Esc closes it; Enter with text closes it and runs the line.
   */
  openCardForTest(id: CardId): void {
    if (!CARD_IDS.includes(id)) return;
    if (this.testCard === null && (this.cardOpen !== null || this.pendingAfterToken !== null)) return;
    this.testCard = id;
    this.t.setHint(CARD_HINT);    // before the card opens: the card view places it against the hint line it finds
    this.hostOpen(id, 0, 1, 'after');
  }

  /** Closes the ?test card. Returns true when one was open (the key press or click is then used up). */
  private closeTestCard(): boolean {
    if (this.testCard === null) return false;
    this.testCard = null;
    this.hostClose();
    this.refreshHint();
    return true;
  }

  tab(partial: string): string {
    const p = typeof partial === 'string' ? partial : '';
    let cands: string[];
    try {
      cands = completions(p);
    } catch {
      return p;
    }
    if (!Array.isArray(cands) || cands.length === 0) return p;
    const full = [...new Set(cands.map((c) => completeLine(p, String(c))))];
    if (full.length === 1) return full[0]!;
    const lcp = commonPrefix(full);
    if (lcp.length > p.length) return lcp;
    this.settlePrinting(false);
    const listing = cands.join('   ');
    void this.t.printLines([listing]);
    this.record('output', listing);
    this.save();
    return p;
  }

  // ---------- cards ----------

  private currentCards(): CardId[] {
    return this.cursor.step > 0 ? this.live.cardsFor[this.cursor.step - 1] ?? [] : [];
  }

  /**
   * Refreshes the hint line, makes the card host match the cursor, and tells the shell. The hint goes first: it is one line
   * as a step hint and two as CARD_HINT at the smallest lab screens, and the card view places the card's bottom edge against
   * the hint line it finds when it opens. A hint that changed height after that would leave the card over it, by 15.6 px at
   * 682 x 512: a ResizeObserver reports only a size that differs from the last one it reported, and a card closed and another
   * opened inside one frame (Back through a bare plot does that) ends on the size it began with, so nothing refits it.
   */
  private showCurrentCard(): void {
    const id = this.cardOpen;
    this.refreshHint();
    if (id !== null) {
      this.lastCardEventAt = this.now();
      this.hostOpen(id, this.cursor.card, this.currentCards().length, cardPlacement(id));
    } else {
      this.hostClose();
    }
    this.notifyScreen();
  }

  private advanceCard(): void {
    if (this.cardOpen === null) return;
    this.cursor = { step: this.cursor.step, card: this.cursor.card + 1 };
    this.lastCardEventAt = this.now();
    this.showCurrentCard();
    this.save();
  }

  /** Closes the remaining cards of the current step (Enter with text). They stay screens for Back. */
  private closeStepCards(): void {
    this.pendingAfterToken = null;
    this.cursor = { step: this.cursor.step, card: this.currentCards().length };
    this.showCurrentCard();
  }

  /** Spec §5.3: ignore repeat keydowns and anything within CARD_REPEAT_GUARD_MS of a card opening or the last advance. */
  private keyAllowed(key?: KeyInfo): boolean {
    if (key?.repeat === true) return false;
    return this.now() - this.lastCardEventAt >= CARD_REPEAT_GUARD_MS;
  }

  private hostOpen(id: CardId, index: number, count: number, placement: 'after' | 'before'): void {
    this.hostShows = id;
    try {
      this.cards?.open(id, index, count, placement);
    } catch (err) {
      console.error('card view failed', err);
    }
  }

  private hostClose(): void {
    if (this.hostShows === null) return;
    this.hostShows = null;
    try {
      this.cards?.close();
    } catch (err) {
      console.error('card view failed', err);
    }
  }

  /** Spec §4.4: a blank line advances a card, or ends the finale animation, or is ignored. It never flushes a log. */
  private blankLine(key?: KeyInfo): void {
    if (this.cardOpen !== null) {
      if (this.keyAllowed(key)) this.advanceCard();
      return;
    }
    if (this.animating()) this.finishAnimation();
  }

  // ---------- printing and drawing ----------

  /**
   * Enter mid-print: finish the running log and draw its plot before anything else happens. Held after-cards are
   * skipped (a typed line, spec §4.4) or opened now (a Tab listing). A running finale animation jumps to its end.
   */
  private settlePrinting(skipAfterCards: boolean): void {
    if (skipAfterCards) {
      this.skipPrinting();
    } else {
      if (this.t.isPrinting()) this.t.flush();
      this.applyPendingRender();
      if (this.pendingAfterToken !== null) {
        this.pendingAfterToken = null;
        this.showCurrentCard();
      }
    }
    if (this.animating()) this.finishAnimation();
  }

  /** The typed-line path (spec §4.4 row 2; Task 17's Back reuses it): flush the running log, draw its plot, and skip the
   *  step's held after-cards (cursor.card = cards.length; they stay screens). */
  private skipPrinting(): void {
    if (this.t.isPrinting()) this.t.flush();
    this.applyPendingRender();
    if (this.pendingAfterToken !== null) {
      this.pendingAfterToken = null;
      this.cursor = { step: this.cursor.step, card: this.currentCards().length };
      this.notifyScreen();
    }
  }

  private applyPendingRender(): void {
    const p = this.pendingRender;
    this.pendingRender = null;
    if (p) this.safeRender(p);
  }

  /** Prints and records the lines; returns the print token. A staggered log draws its plot (then opens held
   *  after-cards) when it ends on its own; the token stops a stale callback acting for a newer command. */
  private print(lines: string[], stagger: boolean): number {
    for (const l of lines) this.record('output', l);
    const token = ++this.printToken;
    let done: Promise<void>;
    try {
      done = this.t.printLines(lines, { stagger });
    } catch (err) {
      console.error('printLines threw', err);
      done = Promise.resolve();
    }
    if (!this.t.isPrinting()) this.applyPendingRender();
    void done.then(() => {
      if (token !== this.printToken) return;
      this.applyPendingRender();
      if (this.pendingAfterToken === token) {
        this.pendingAfterToken = null;
        this.showCurrentCard();
        this.save();
      }
    });
    return token;
  }

  private badTry(err: ParseError): void {
    this.tries++;
    const out = [String(err.message)];
    if (err.suggestion && !/did you mean/i.test(err.message)) out.push(didYouMean(err.suggestion));
    out.push(this.currentHint());
    this.pendingRender = null;
    this.print(out, false);
    if (this.tries >= MAX_BAD_TRIES) {
      this.t.fillPrompt(this.fillText());
      this.print([AUTOFILL_NOTE], false);
      this.tries = 0;
    }
  }

  private animating(): boolean {
    try {
      return this.plotAnimating();
    } catch {
      return false;
    }
  }

  private finishAnimation(): void {
    try {
      this.finishPlotAnimation();
    } catch (err) {
      console.error('finishPlotAnimation failed', err);
    }
  }

  // ---------- hint line ----------

  /** What Esc and the three-tries auto-fill insert: script[i], or the extra the hint line shows after the last step. */
  private fillText(): string {
    return formatCommand(hintCommand(this.live.hintIndex, this.live.extrasTick));
  }

  private currentHint(): string {
    try {
      return hintText(this.live.hintIndex, this.live.lastRan, this.live.extrasTick);
    } catch {
      return this.live.hintIndex < SCRIPT.length ? formatCommand(SCRIPT[this.live.hintIndex]!) : '';
    }
  }

  /** The hint line reads CARD_HINT while a card is open (spec §2.2), else the step hint. */
  private refreshHint(): void {
    this.t.setHint(this.cardOpen !== null ? CARD_HINT : this.currentHint());
  }

  // ---------- session ----------

  private record(kind: TranscriptKind, text: string): void {
    this.transcript.push({ seq: this.nextSeq++, kind, text });
    if (this.transcript.length > MAX_TRANSCRIPT) this.transcript.splice(0, this.transcript.length - MAX_TRANSCRIPT);
  }

  /**
   * Spec §4.2: replay the log to cursor.step, draw the visible transcript at once, render without animation, reopen the
   * card, then save. The one routine for refresh-restore (constructor) and, from Task 17, for Back. Bumping printToken
   * and dropping the held render/after-cards stops a stale print callback drawing or opening anything afterwards.
   */
  private restore(s: SessionV2): void {
    const d = derive(this.data, s.steps, s.cursor.step, this.features);
    this.printToken += 1;
    this.pendingAfterToken = null;
    this.pendingRender = null;
    const transcript = s.transcript.slice(-MAX_TRANSCRIPT).map((e) => ({ ...e }));
    const visible = visibleTranscript(transcript, Infinity).flatMap((e) =>
      e.kind === 'clear' ? [] : [{ kind: e.kind as ShownKind, text: e.text }]);
    this.t.showLines(visible);
    const cards = s.cursor.step > 0 ? d.cardsFor[s.cursor.step - 1] ?? [] : [];
    this.hist = s.history.filter((h) => typeof h === 'string').slice(-MAX_HISTORY);
    this.transcript = transcript;
    this.nextSeq = Math.max(s.nextSeq, (transcript[transcript.length - 1]?.seq ?? 0) + 1);
    this.steps = s.steps.map((st) => ({ cmd: st.cmd, endSeq: st.endSeq }));
    this.live = d;
    this.cursor = { step: s.cursor.step, card: Math.min(Math.max(0, s.cursor.card), cards.length) };
    this.t.setHistory?.(this.hist);
    this.safeRender(d.plot, { animate: false });
    this.showCurrentCard();
    this.save();
  }

  private resetToStart(): void {
    this.hist = [];
    this.transcript = [];
    this.nextSeq = 1;
    this.steps = [];
    this.live = INITIAL_DERIVED;
    this.cursor = { step: 0, card: 0 };
    this.pendingAfterToken = null;
    this.pendingRender = null;
    this.hostClose();
    try {
      this.t.setHistory?.([]);
    } catch {
      // the terminal keeps whatever history it had
    }
  }

  private notifyScreen(): void {
    if (!this.onScreen) return;
    try {
      this.onScreen({ ...this.cursor }, this.canGoBack);
    } catch (err) {
      console.error('onScreen failed', err);
    }
  }

  private safeRender(p: PlotState, opts?: RenderOpts): void {
    try {
      this.render(p, opts);
    } catch (err) {
      console.error('renderPlot failed', err);
    }
  }

  private save(): void {
    try {
      saveSession(this.store, this.session);
    } catch (err) {
      console.error('saveSession failed', err);
    }
  }
}
