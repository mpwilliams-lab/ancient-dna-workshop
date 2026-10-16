// Wires parse -> execute -> hints -> plotState -> session, owns the three-tries counter
// and the Enter-mid-print ordering (spec §4.2-§4.4, §7 persistence).
import type { WorkshopData } from './types';
import { parse, formatCommand, completions, type Command, type ParseError, type ParseResult } from './parser';
import { execute, type CommandResult } from './commands';
import { SCRIPT, advance, hintCommand, hintText } from './hints';
import { INITIAL_PLOT, reducePlot, type PlotState } from './plotState';
import { saveSession, type Session, type SessionStorageLike, type TranscriptLine } from './session';
import type { TerminalView } from './terminal';

export interface ControllerDeps {
  data: WorkshopData;
  terminal: TerminalView;
  renderPlot(p: PlotState): void;
  store: SessionStorageLike | null;
}

/** Spec §4.2: three incorrect tries in a row fill in the hint. */
export const MAX_BAD_TRIES = 3;
/** Longest input echoed / kept in history; longer pastes are shown cut with an ellipsis. */
export const MAX_ECHO_CHARS = 200;
/** Transcript lines kept in the session (oldest dropped first). */
export const MAX_TRANSCRIPT = 500;
/** History entries kept in the session. */
export const MAX_HISTORY = 200;

// On-screen strings owned by the controller (exported so the §6 content scan can include them).
export function didYouMean(suggestion: string): string {
  return `Did you mean ${suggestion}?`;
}
export const AUTOFILL_NOTE = 'I have filled in the hinted command for you. Press Enter to run it.';
export const INTERNAL_ERROR_LINE = 'Something went wrong with that command. Press Esc to fill in the hinted command.';
export const CONTROLLER_STRINGS: string[] = [AUTOFILL_NOTE, INTERNAL_ERROR_LINE, didYouMean('')];

function clampHint(i: unknown): number {
  const n = typeof i === 'number' && Number.isFinite(i) ? Math.trunc(i) : 0;
  return Math.max(0, Math.min(SCRIPT.length, n));
}

function commonPrefix(xs: string[]): string {
  if (xs.length === 0) return '';
  let p = xs[0];
  for (const x of xs.slice(1)) {
    let k = 0;
    while (k < p.length && k < x.length && p[k].toLowerCase() === x[k].toLowerCase()) k++;
    p = p.slice(0, k);
  }
  return p;
}

/** A completion is either a full prompt line (starts with the partial) or a token that replaces the partial's last token. */
export function completeLine(partial: string, cand: string): string {
  if (cand.toLowerCase().startsWith(partial.toLowerCase())) return cand;
  const m = /[A-Za-z0-9_\-]*$/.exec(partial);
  const start = m ? partial.length - m[0].length : partial.length;
  const before = partial.slice(0, start);
  const quote = before.slice(-1);
  const token = (quote === '"' || quote === "'") && cand.startsWith(quote) ? cand.slice(1) : cand;
  return before + token;
}

export class Controller {
  private readonly data: WorkshopData;
  private readonly t: TerminalView;
  private readonly render: (p: PlotState) => void;
  private readonly store: SessionStorageLike | null;
  private hist: string[] = [];
  private lines: TranscriptLine[] = [];
  private hint = 0;
  private plot: PlotState = INITIAL_PLOT;
  private tries = 0;
  private lastRan: Command | null = null;
  private extrasTick = 0;
  private pendingRender: PlotState | null = null;
  private printToken = 0;

  constructor(deps: ControllerDeps, restored: Session | null) {
    this.data = deps.data;
    this.t = deps.terminal;
    this.render = deps.renderPlot;
    this.store = deps.store;
    if (restored) {
      try {
        this.hist = Array.isArray(restored.history) ? restored.history.filter((h) => typeof h === 'string').slice(-MAX_HISTORY) : [];
        this.lines = Array.isArray(restored.transcript) ? restored.transcript.filter((l) => l && typeof l.text === 'string').slice(-MAX_TRANSCRIPT) : [];
        this.hint = clampHint(restored.hintIndex);
        this.plot = restored.plot ?? INITIAL_PLOT;
        for (const l of this.lines) {
          if (l.kind === 'input') this.t.echoInput(l.text);
          else if (l.kind === 'notice') this.t.notice(l.text);
          else void this.t.printLines([l.text]);
        }
        this.t.setHistory?.(this.hist);
        // RESTORED_NOTICE is printed once by the shell (Task 13), never here.
      } catch (err) {
        console.error('restore failed; starting fresh', err);
        this.hist = [];
        this.lines = [];
        this.hint = 0;
        this.plot = INITIAL_PLOT;
        this.t.clearScreen();
      }
    }
    this.safeRender(this.plot);
    this.refreshHint();
  }

  get hintIndex(): number {
    return this.hint;
  }

  get badTries(): number {
    return this.tries;
  }

  get session(): Session {
    return { history: [...this.hist], transcript: [...this.lines], hintIndex: this.hint, plot: this.plot };
  }

  submit(line: string): void {
    const raw = typeof line === 'string' ? line : String(line ?? '');
    // Blank input is ignored completely, even while a log is printing: only a real line flushes the running log.
    if (raw.trim() === '') return;
    this.settlePrinting();
    const shown = raw.length > MAX_ECHO_CHARS ? `${raw.slice(0, MAX_ECHO_CHARS)}…` : raw;
    this.t.echoInput(shown);
    this.record('input', shown);
    this.hist.push(shown);
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
      this.save();
      return;
    }

    let out: CommandResult;
    try {
      out = execute(res.command, this.data);
    } catch (err) {
      console.error('command threw', err);
      this.print([INTERNAL_ERROR_LINE], false);
      this.save();
      return;
    }

    // help() and clear() print at once and draw nothing. They are not recorded as the last command run, so they do
    // not end the Predict beat that follows run_pca(FirstFarmers).
    const housekeeping = res.command.name === 'help' || res.command.name === 'clear';
    if (out.clear) {
      this.t.clearScreen();
      this.lines = [];
    }
    if (!out.refused) {
      this.tries = 0;
      const before = this.hint;
      this.hint = clampHint(advance(this.hint, res.command));
      if (before >= SCRIPT.length) this.extrasTick++;
      if (!housekeeping) this.lastRan = res.command;
    }
    let target: PlotState | null = null;
    if (!out.refused && out.plot.kind !== 'none') {
      this.plot = reducePlot(this.plot, out.plot, this.data);
      target = this.plot;
    }
    const stagger = !out.refused && !housekeeping;
    this.refreshHint();
    this.pendingRender = target;
    this.print(out.lines, stagger);
    this.save();
  }

  escape(): void {
    this.tries = 0;
    this.t.fillPrompt(this.fillText());
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
    if (full.length === 1) return full[0];
    const lcp = commonPrefix(full);
    if (lcp.length > p.length) return lcp;
    this.settlePrinting();
    const listing = cands.join('   ');
    void this.t.printLines([listing]);
    this.record('output', listing);
    return p;
  }

  /** Enter mid-print: finish the running log and apply its plot before anything else happens. */
  private settlePrinting(): void {
    if (this.t.isPrinting()) this.t.flush();
    this.applyPendingRender();
  }

  private applyPendingRender(): void {
    const p = this.pendingRender;
    this.pendingRender = null;
    if (p) this.safeRender(p);
  }

  private print(lines: string[], stagger: boolean): void {
    for (const l of lines) this.record('output', l);
    const token = ++this.printToken;
    let done: Promise<void>;
    try {
      done = this.t.printLines(lines, { stagger });
    } catch (err) {
      console.error('printLines threw', err);
      done = Promise.resolve();
    }
    // Unstaggered output is already on screen: draw now. Staggered output draws when its log ends
    // (or earlier, when the next Enter flushes it; the token stops a stale callback drawing a newer plot).
    if (!this.t.isPrinting()) this.applyPendingRender();
    void done.then(() => {
      if (token === this.printToken) this.applyPendingRender();
    });
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

  /** What Esc and the three-tries auto-fill insert: script[i], or the extra the hint line shows after the last step.
   *  hintText does not call hintCommand; both read the script and the extras rotation through the same helpers in
   *  hints.ts, and the "Esc always inserts what the hint line shows" test in tests/hints.test.ts pins that they agree. */
  private fillText(): string {
    return formatCommand(hintCommand(this.hint, this.extrasTick));
  }

  private currentHint(): string {
    try {
      return hintText(this.hint, this.lastRan, this.extrasTick);
    } catch {
      return this.hint < SCRIPT.length ? formatCommand(SCRIPT[this.hint]) : '';
    }
  }

  private refreshHint(): void {
    this.t.setHint(this.currentHint());
  }

  private record(kind: TranscriptLine['kind'], text: string): void {
    this.lines.push({ kind, text });
    if (this.lines.length > MAX_TRANSCRIPT) this.lines.splice(0, this.lines.length - MAX_TRANSCRIPT);
  }

  private safeRender(p: PlotState): void {
    try {
      this.render(p);
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
