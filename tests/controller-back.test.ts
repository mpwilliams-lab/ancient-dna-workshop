// @vitest-environment jsdom
// Spec §4.1 Back, §4.4 keys after Back, §4.5 tests 1-6 (P2). Headless: a fake terminal, a fake card host, the fixture data.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backSession, prevScreen } from '../src/back';
import { AUTOFILL_NOTE, MAX_BAD_TRIES } from '../src/controller';
import { CARD_HINT, BACK_BUTTON, BACK_BUTTON_LABEL, PREDICT_HINT, REVEAL_HINT } from '../src/content';
import { Controller, type CardHost, type ControllerDeps } from '../src/controller';
import { ALL_OFF, withFeatures } from '../src/features';
import { EXTRAS, EXTRA_PREFIX, NEXT_PREFIX, SCRIPT, SCRIPT_STEPS } from '../src/hints';
import { formatCommand } from '../src/parser';
import type { PlotState } from '../src/plotState';
import { derive, sessionBuildHash, type Derived } from '../src/replay';
import { loadSession, visibleTranscript, type SessionV2 } from '../src/session';
import { boot } from '../src/shell';
import type { TerminalView } from '../src/terminal';
import type { CardId } from '../src/types';
import { FIXTURE, MemStore, loadIndexHtml } from './helpers/shellEnv';
import { cardCount, forwardRun, screenKeys, type ScriptDriver } from './helpers/script';

const FEATS = withFeatures({ back: true });
type Line = { kind: 'input' | 'output' | 'notice'; text: string };

class FakeTerm implements TerminalView {
  lines: Line[] = [];
  hint = '';
  prompt = '';
  flushes = 0;
  history: string[] = [];
  /** What the hint line read each time the log was drawn whole (showLines scrolls it to its end): the log's box has its final height then or not. */
  hintAtShowLines: string[] = [];
  private pending: (() => void) | null = null;
  printLines(lines: string[], opts?: { stagger?: boolean }): Promise<void> {
    for (const text of lines) this.lines.push({ kind: 'output', text });
    if (!opts?.stagger || lines.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.pending = () => {
        this.pending = null;
        resolve();
      };
    });
  }
  flush(): void {
    if (this.pending) {
      this.flushes += 1;
      this.pending();
    }
  }
  /** The staggered log reaches its last line on its own (not a flush). */
  finish(): void {
    this.pending?.();
  }
  isPrinting(): boolean { return this.pending !== null; }
  echoInput(text: string): void { this.lines.push({ kind: 'input', text }); }
  setHint(text: string): void { this.hint = text; }
  fillPrompt(text: string): void { this.prompt = text; }
  clearScreen(): void { this.lines = []; }
  notice(text: string): void { this.lines.push({ kind: 'notice', text }); }
  setHistory(lines: string[]): void { this.history = [...lines]; }
  showLines(lines: readonly Line[]): void {
    this.hintAtShowLines.push(this.hint);
    this.lines = lines.map((l) => ({ kind: l.kind, text: l.text }));
  }
}

class FakeCards implements CardHost {
  current: { id: CardId; index: number; count: number; placement: 'after' | 'before' } | null = null;
  opened: CardId[] = [];
  /** What the hint line read at the moment each card was opened: the card view places the card against it (Task 17). */
  hintsAtOpen: string[] = [];
  constructor(private readonly term: FakeTerm) {}
  open(id: CardId, index: number, count: number, placement: 'after' | 'before'): void {
    this.current = { id, index, count, placement };
    this.opened.push(id);
    this.hintsAtOpen.push(this.term.hint);
  }
  close(): void { this.current = null; }
}

interface Harness {
  c: Controller; term: FakeTerm; cards: FakeCards; store: MemStore;
  renders: { p: PlotState; animate?: boolean }[]; screens: { step: number; card: number; can: boolean }[];
  clock: { t: number }; anim: { on: boolean; finish: ReturnType<typeof vi.fn> }; deps: ControllerDeps;
}

function make(restored: SessionV2 | null = null, store = new MemStore()): Harness {
  const term = new FakeTerm();
  const cards = new FakeCards(term);
  const renders: Harness['renders'] = [];
  const screens: Harness['screens'] = [];
  const clock = { t: 10_000 };
  const anim = { on: false, finish: vi.fn() };
  anim.finish.mockImplementation(() => { anim.on = false; });
  const deps: ControllerDeps = {
    data: FIXTURE, terminal: term, store, cards, features: FEATS,
    renderPlot: (p, opts) => { renders.push({ p, animate: opts?.animate }); },
    now: () => clock.t,
    plotAnimating: () => anim.on,
    finishPlotAnimation: anim.finish,
    onScreen: (s, can) => { screens.push({ ...s, can }); },
  };
  return { c: new Controller(deps, restored), term, cards, store, renders, screens, clock, anim, deps };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
async function run(h: Harness, line: string): Promise<void> {
  h.clock.t += 1000;
  h.c.submit(line);
  h.term.finish();
  await tick();
}
function closeCards(h: Harness): void {
  for (let guard = 0; h.c.cardOpen !== null && guard < 10; guard++) h.c.continueCard();
}
async function guided(h: Harness, steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await run(h, formatCommand(SCRIPT[i]!));
    closeCards(h);
  }
}
function backTo(h: Harness, step: number, card: number): number {
  let presses = 0;
  while (!(h.c.screen.step === step && h.c.screen.card === card) && presses < 50) {
    h.c.back();
    presses += 1;
  }
  return presses;
}
/** Everything §4.5 test 1 compares: plot, hint index, hint text, lastRan and extrasTick (through derive), cursor, transcript. */
function view(h: Harness) {
  const s = h.c.session;
  return {
    plot: h.renders.at(-1)?.p,
    hintIndex: h.c.hintIndex,
    hint: h.term.hint,
    screen: h.c.screen,
    cardOpen: h.c.cardOpen,
    steps: s.steps,
    transcript: visibleTranscript(s.transcript, Infinity),
    lines: h.term.lines,
    derived: derive(FIXTURE, s.steps, s.cursor.step, FEATS),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('prevScreen / backSession (pure, spec §4.1)', () => {
  const cardsFor: CardId[][] = [[], [], ['A1'], ['B1'], ['C1'], ['D1', 'D2'], [], ['E1', 'E2', 'E3']];
  it('walks the screens backwards: cards in reverse, then the previous step\'s bare plot', () => {
    expect(prevScreen({ step: 8, card: 3 }, cardsFor)).toEqual({ step: 8, card: 2 });
    expect(prevScreen({ step: 8, card: 0 }, cardsFor)).toEqual({ step: 7, card: 0 });
    expect(prevScreen({ step: 7, card: 0 }, cardsFor)).toEqual({ step: 6, card: 2 });
    expect(prevScreen({ step: 3, card: 0 }, cardsFor)).toEqual({ step: 2, card: 0 });
    expect(prevScreen({ step: 1, card: 0 }, cardsFor)).toEqual({ step: 0, card: 0 });
    expect(prevScreen({ step: 0, card: 0 }, cardsFor)).toBeNull();
  });
  it('cuts the steps and the transcript back to the end of the target step; history and nextSeq stay', () => {
    const s: SessionV2 = {
      version: 2, build: 'x', history: ['a', 'b', 'c'], nextSeq: 9, cursor: { step: 2, card: 0 },
      steps: [{ cmd: 'ancestry_test(person = "me")', endSeq: 3 }, { cmd: 'load_genomes()', endSeq: 6 }],
      transcript: [1, 2, 3, 4, 5, 6, 7, 8].map((seq) => ({ seq, kind: 'output' as const, text: `l${seq}` })),
    };
    const b = backSession(s, [[], []])!;
    expect(b.cursor).toEqual({ step: 1, card: 0 });
    expect(b.steps).toEqual([s.steps[0]]);
    expect(b.transcript.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect([b.history, b.nextSeq, b.build]).toEqual([['a', 'b', 'c'], 9, 'x']);
    expect(backSession({ ...s, cursor: { step: 0, card: 0 }, steps: [] }, [])).toBeNull();
    expect(backSession(b, [[]])!.transcript).toEqual([]);
  });
  it('reads a cursor outside the session sensibly: a card past the last is the bare plot, a number that is not finite is the start or the bare plot', () => {
    expect(prevScreen({ step: 8, card: 99 }, cardsFor)).toEqual({ step: 8, card: 2 });
    expect(prevScreen({ step: 8, card: Number.NaN }, cardsFor)).toEqual({ step: 8, card: 2 });
    expect(prevScreen({ step: 8, card: -1 }, cardsFor)).toEqual({ step: 7, card: 0 });
    expect(prevScreen({ step: 8.9, card: 3 }, cardsFor)).toEqual({ step: 8, card: 2 });
    expect(prevScreen({ step: 12, card: 5 }, cardsFor)).toEqual({ step: 11, card: 0 });   // a step the card table does not list has no cards
    for (const step of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -3, 0.5]) {
      expect(prevScreen({ step, card: 0 }, cardsFor), `step ${step}`).toBeNull();
    }
  });
  it('never changes its input and hands back arrays of its own', () => {
    const s: SessionV2 = {
      version: 2, build: 'x', history: ['a', 'b'], nextSeq: 5, cursor: { step: 2, card: 0 },
      steps: [{ cmd: 'ancestry_test(person = "me")', endSeq: 1 }, { cmd: 'load_genomes()', endSeq: 3 }],
      transcript: [1, 2, 3, 4].map((seq) => ({ seq, kind: 'output' as const, text: `l${seq}` })),
    };
    const frozen = structuredClone(s);
    const b = backSession(s, [[], []])!;
    expect(s).toEqual(frozen);
    expect([b.history === s.history, b.steps === s.steps, b.transcript === s.transcript]).toEqual([false, false, false]);
    b.history.push('c');
    expect(s.history).toEqual(['a', 'b']);
  });
});

describe('Controller.back (spec §4.5 tests 1-6)', () => {
  it.each(SCRIPT.map((_, k) => k))('test 1, step %i: Back to the previous step deep-equals a fresh run without it', async (k) => {
    const a = make();
    await guided(a, k + 1);
    backTo(a, k, k === 0 ? 0 : cardCount(k - 1));
    expect(a.c.screen).toEqual({ step: k, card: k === 0 ? 0 : cardCount(k - 1) });
    const b = make();
    await guided(b, k);
    expect(view(a)).toEqual(view(b));
  });

  it('test 2: a step with three cards is four screens, walked in reverse', async () => {
    const h = make();
    await guided(h, 8);                                    // through ironAge (index 7): E1, E2, E3 seen and closed
    expect(h.c.screen).toEqual({ step: 8, card: 3 });
    const seen: (CardId | null)[] = [];
    for (let i = 0; i < 4; i++) {
      h.c.back();
      seen.push(h.c.cardOpen);
    }
    expect(seen).toEqual(['E3', 'E2', 'E1', null]);
    expect(h.c.screen).toEqual({ step: 7, card: 0 });    // bronzeAge has no cards
    expect(h.term.hint).toBe(NEXT_PREFIX + formatCommand(SCRIPT[7]!));
  });

  it('test 2: cards skipped by typing during printing are still screens for Back', async () => {
    const h = make();
    await guided(h, 7);
    h.clock.t += 1000;
    h.c.submit(formatCommand(SCRIPT[7]!));                 // ironAge: E1-E3 open after its log
    expect(h.term.isPrinting()).toBe(true);
    await run(h, formatCommand(SCRIPT[8]!));               // typed while printing: flushes and skips E1-E3
    expect(h.cards.opened).not.toContain('E1');
    expect(h.c.screen).toEqual({ step: 9, card: 0 });
    h.c.back();
    expect(h.c.screen).toEqual({ step: 8, card: 3 });
    expect(h.c.cardOpen).toBeNull();
    h.c.back();
    expect(h.c.cardOpen).toBe('E3');
  });

  it('test 3: bad, unknown, refused, help() and clear() are not steps; Back after three bad tries drops them', async () => {
    const h = make();
    await guided(h, 2);
    for (const line of ['run_pca(period = "Mars")', 'hello()', 'run_pca(period =']) await run(h, line);
    expect(h.term.prompt).toBe(formatCommand(SCRIPT[2]!));          // three tries filled in the hint
    for (const line of ['run_admixture(K = 4)', 'help()', 'clear()']) await run(h, line);
    expect(h.c.session.steps.map((s) => s.cmd)).toEqual([formatCommand(SCRIPT[0]!), formatCommand(SCRIPT[1]!)]);
    h.c.back();
    expect(h.term.prompt).toBe('');
    expect(h.c.badTries).toBe(0);
    const b = make();
    await guided(b, 1);
    expect(view(h)).toEqual(view(b));
  });

  it('test 4: Back across clear() shows the target step\'s transcript from before the clear', async () => {
    const h = make();
    await guided(h, 2);
    await run(h, 'clear()');
    await run(h, formatCommand(SCRIPT[2]!));               // europe, then A1
    closeCards(h);
    h.c.back();
    expect(h.c.cardOpen).toBe('A1');
    const hookInput = (x: Harness) => x.term.lines.some((l) => l.kind === 'input' && l.text === formatCommand(SCRIPT[0]!));
    expect(hookInput(h)).toBe(false);                      // still after the clear marker
    h.c.back();
    expect(hookInput(h)).toBe(true);                       // back before the clear: the old lines return
    const b = make();
    await guided(b, 2);
    expect(view(h)).toEqual(view(b));
  });

  it('test 5: after Back a new command drops the undone steps; Esc fills the undone command; tries reset', async () => {
    const h = make();
    await guided(h, 5);                                    // through bellBeaker (index 4), C1 closed
    await run(h, 'run_pca(period = "Mars")');
    await run(h, 'nope()');
    expect(h.c.badTries).toBe(2);
    h.c.back();
    expect(h.c.cardOpen).toBe('C1');
    expect([h.c.badTries, h.term.prompt]).toEqual([0, '']);
    h.c.back();
    expect(h.c.screen).toEqual({ step: 4, card: 1 });     // firstFarmers' bare plot (B1 closed)
    expect(h.c.session.steps).toHaveLength(4);
    h.clock.t += 1000;
    h.c.escape();
    expect(h.term.prompt).toBe(formatCommand(SCRIPT[4]!));
    await run(h, 'run_pca(period = "Roman")');             // off-script: a step, no card
    expect(h.c.cardOpen).toBeNull();
    expect(h.c.session.steps.map((s) => s.cmd)).toEqual([...SCRIPT.slice(0, 4).map(formatCommand), 'run_pca(period = "Roman")']);
    expect(h.c.hintIndex).toBe(4);
  });

  it('test 6: Back while printing flushes first, then lands on that step\'s last card, opened once', async () => {
    const h = make();
    await guided(h, 2);
    h.clock.t += 1000;
    h.c.submit(formatCommand(SCRIPT[2]!));                 // europe: A1 after its log
    expect(h.term.isPrinting()).toBe(true);
    h.c.back();
    expect(h.term.flushes).toBe(1);
    expect(h.term.isPrinting()).toBe(false);
    await tick();
    expect(h.c.screen).toEqual({ step: 3, card: 0 });
    expect(h.c.cardOpen).toBe('A1');
    expect(h.cards.opened.filter((id) => id === 'A1')).toHaveLength(1);
    expect(h.renders.at(-1)?.animate).toBe(false);
  });

  it('test 6: Back during the finale animation jumps it to the end first, then draws without animation', async () => {
    const h = make();
    await guided(h, 13);                                   // through angloSaxon (G1, G2 closed)
    await run(h, formatCommand(SCRIPT[13]!));              // finale
    h.anim.on = true;
    h.c.back();
    expect(h.anim.finish).toHaveBeenCalledTimes(1);
    expect(h.c.screen).toEqual({ step: 13, card: 2 });
    expect(h.renders.at(-1)).toMatchObject({ animate: false });
  });

  it('test 6: disabled at the start, where it does nothing', () => {
    const h = make();
    expect(h.c.canGoBack).toBe(false);
    const renders = h.renders.length;
    h.c.back();
    expect(h.renders.length).toBe(renders);
    expect(h.c.screen).toEqual({ step: 0, card: 0 });
  });

  it('a card opened by Back shows CARD_HINT and swallows an Enter within 400 ms (repeat guard)', async () => {
    const h = make();
    await guided(h, 6);                                    // through admix1 (D1, D2 closed)
    h.c.back();
    expect([h.c.cardOpen, h.term.hint]).toEqual(['D2', CARD_HINT]);
    h.clock.t += 100;
    h.c.submit('');
    expect(h.c.cardOpen).toBe('D2');
    h.clock.t += 500;
    h.c.submit('');
    expect(h.c.cardOpen).toBeNull();
  });

  it('reports every screen change to onScreen, with canGoBack', async () => {
    const h = make();
    expect(h.screens.at(-1)).toEqual({ step: 0, card: 0, can: false });
    await guided(h, 1);
    expect(h.screens.at(-1)).toEqual({ step: 1, card: 0, can: true });
    h.c.back();
    expect(h.screens.at(-1)).toEqual({ step: 0, card: 0, can: false });
  });

  it('a refresh after Back restores the cut-back screen, card included', async () => {
    const h = make();
    await guided(h, 8);
    h.c.back();
    h.c.back();                                            // E2
    const r = make(loadSession(h.store), h.store);
    expect(r.c.screen).toEqual(h.c.screen);
    expect(r.c.cardOpen).toBe('E2');
    expect(r.c.session.steps).toEqual(h.c.session.steps);
  });
});

describe('the header Back button (spec §4.3)', () => {
  function bootWith(features = FEATS) {
    vi.useFakeTimers();
    loadIndexHtml();
    return boot({
      doc: document, href: 'file:///C:/Users/lab/Desktop/ancient-dna-workshop.html',
      getStorage: () => new MemStore() as unknown as Storage, replaceUrl: () => {}, data: FIXTURE, features,
    });
  }
  it('sits left of "Take this home", is disabled at the start, enabled after a step, and Back returns focus to the prompt', async () => {
    const app = bootWith();
    const btn = document.getElementById('back') as HTMLButtonElement;
    expect(btn.nextElementSibling?.id).toBe('wrap-open');
    expect([btn.type, btn.textContent, btn.getAttribute('aria-label')]).toEqual(['button', BACK_BUTTON, BACK_BUTTON_LABEL]);
    expect(btn.disabled).toBe(true);
    app.controller.submit(formatCommand(SCRIPT[0]!));
    await vi.runAllTimersAsync();
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(app.controller.screen).toEqual({ step: 0, card: 0 });
    expect(btn.disabled).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#terminal input'));
  });
  it('a card\'s Back button steps back too', async () => {
    const app = bootWith();
    for (const i of [0, 1, 2]) {
      app.controller.submit(formatCommand(SCRIPT[i]!));
      await vi.runAllTimersAsync();                        // the log ends on its own, then the after-card opens
    }
    expect(app.controller.cardOpen).toBe('A1');
    (document.querySelector('#card .card-back') as HTMLButtonElement).click();
    expect(app.controller.screen).toEqual({ step: 2, card: 0 });
    expect(app.controller.cardOpen).toBeNull();
  });
  it('false path: no header button, no card Back button', () => {
    const app = bootWith(withFeatures({ back: false }, ALL_OFF));
    expect(document.getElementById('back')).toBeNull();
    app.controller.openCardForTest('A1');
    expect(document.querySelector('#card .card-back')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Task 17 additions: the carry-forward pins (?test card, hint before card, Back while printing, nextSeq), history, the notifications
// and Back at every screen. The same checks against the real terminal, card view and plot renderer are in back-dom.test.ts.
// ---------------------------------------------------------------------------------------------------------------------

describe('Back and a ?test card (carry-forward from the Task 12 review: back() clears it first)', () => {
  it('closes the test card, then steps back from the real screen under it; the test card is never part of the session', async () => {
    const h = make();
    await guided(h, 3);                                    // through europe, A1 closed: the bare plot of step 3
    const saved = JSON.stringify(h.c.session);
    h.c.openCardForTest('K2');
    expect(h.c.cardOpen).toBe('K2');
    expect(JSON.stringify(h.c.session)).toBe(saved);
    h.c.back();
    expect(h.c.screen).toEqual({ step: 3, card: 0 });
    expect(h.c.cardOpen).toBe('A1');                       // not the test card, which would hide it
    expect(h.cards.current).toMatchObject({ id: 'A1', index: 0, count: 1 });
    expect(h.term.hint).toBe(CARD_HINT);
  });
  it('over the start Back closes the test card and does nothing else: no replay, nothing drawn or saved', () => {
    const h = make();
    h.c.openCardForTest('A1');
    const renders = h.renders.length;
    const stored = JSON.stringify([...h.store.map]);
    h.c.back();
    expect(h.c.cardOpen).toBeNull();
    expect(h.cards.current).toBeNull();
    expect(h.term.hint).toBe(NEXT_PREFIX + formatCommand(SCRIPT[0]!));
    expect([h.renders.length, JSON.stringify([...h.store.map])]).toEqual([renders, stored]);
    expect(h.c.screen).toEqual({ step: 0, card: 0 });
  });
});

describe('Back opens a card against the hint line it will have (carry-forward from the Task 14 review; the other paths: controller-card-hint.test.ts)', () => {
  // The step hint is one line and CARD_HINT two at 682 x 512. A Back from a bare plot onto a card, or from a card through two
  // bare plots onto another card inside one frame, used to open the card first and change the hint after it (e2e/back.spec.ts
  // measures the card against the real hint line).
  it('onto a card from a bare plot, from another card, and again after two bare plots in a row', async () => {
    const h = make();
    await guided(h, 8);
    for (let i = 0; i < 6; i++) h.c.back();                // E3 (from a bare plot), E2, E1, bronzeAge's plot, admix1's plot, D2 (from a bare plot)
    expect(h.cards.opened.slice(-4)).toEqual(['E3', 'E2', 'E1', 'D2']);
    expect(h.cards.hintsAtOpen.slice(-4)).toEqual([CARD_HINT, CARD_HINT, CARD_HINT, CARD_HINT]);
  });
  it('the card a refresh reopens after Back', async () => {
    const h = make();
    await guided(h, 8);
    h.c.back();
    const r = make(loadSession(h.store), h.store);
    expect(r.cards.opened).toEqual(['E3']);
    expect(r.cards.hintsAtOpen).toEqual([CARD_HINT]);
  });
});

// restore() ends a print that is still in flight by three statements: it bumps printToken, drops pendingAfterToken (the held
// after-cards) and drops pendingRender (the held plot). Back is what calls it with a print in flight. The two drops are pinned one by
// one below: without the first, a step's last card does not open (cardOpen reads null while the flag is held); without the second,
// the held plot is drawn by the next command that runs. The printToken bump is a third guard that no behaviour can see, because the two
// drops already leave a stale callback nothing to draw or open: removing it alone changes nothing, and removing all three is caught.
describe('the hint line is final before the log is drawn (review fix round 1: a taller hint after the log had scrolled hid its last line)', () => {
  // The log is drawn by showLines, which scrolls it to its end. The hint line is two lines (the Predict and Reveal hints) or one (CARD_HINT,
  // the step hints) at the lab sizes, and the log is the box above it: a hint that changes height AFTER the log scrolled leaves up to 33 px
  // of its last line below the box. Measured in Chromium and Edge: a log whose box shrinks in a later task stays pinned to its end, one
  // whose lines and hint change in the same task does not, and that is how Back and a refresh draw it. The layout is measured in
  // e2e/back.spec.ts; here the order of the two calls.
  it('Back, at every screen of the guided script: the hint the terminal holds when the log is drawn is the hint of the screen Back lands on', async () => {
    const h = make();
    await forwardRun(headless(h), () => undefined);
    const keys = screenKeys();
    const drawn = h.term.hintAtShowLines.length;
    for (let at = keys.length - 2; at >= 0; at--) {
      h.c.back();
      expect(h.term.hintAtShowLines.at(-1), `Back to ${keys[at]}`).toBe(h.term.hint);
    }
    expect(h.term.hintAtShowLines.length - drawn, 'the log is drawn once per Back').toBe(keys.length - 1);
  });
  it('a refresh, at the Predict and Reveal bare plots and at a card: the same', async () => {
    const afterFirstFarmers = make();
    await guided(afterFirstFarmers, 4);                    // through firstFarmers, B1 closed: the Predict hint
    const predict = make(loadSession(afterFirstFarmers.store), afterFirstFarmers.store);
    expect(predict.term.hint).toBe(PREDICT_HINT);
    expect(predict.term.hintAtShowLines).toEqual([PREDICT_HINT]);

    const afterIronAgeTest = make();
    await guided(afterIronAgeTest, 9);                     // through the Iron Age test: the Reveal hint
    const reveal = make(loadSession(afterIronAgeTest.store), afterIronAgeTest.store);
    expect(reveal.term.hint).toBe(REVEAL_HINT);
    expect(reveal.term.hintAtShowLines).toEqual([REVEAL_HINT]);

    const onCard = make();
    await guided(onCard, 8);
    onCard.c.back();                                       // E3, a card
    const card = make(loadSession(onCard.store), onCard.store);
    expect(card.c.cardOpen).toBe('E3');
    expect(card.term.hintAtShowLines).toEqual([CARD_HINT]);
  });
});

describe('Back while a step prints: nothing of the interrupted log acts afterwards (carry-forward from the Task 6 review)', () => {
  it('after-cards: the callback of the flushed log opens no second card and draws nothing; the plot is drawn once, without animation', async () => {
    const h = make();
    await guided(h, 2);
    h.clock.t += 1000;
    h.c.submit(formatCommand(SCRIPT[2]!));                 // europe: its plot and A1 wait for the log
    expect(h.term.isPrinting()).toBe(true);
    const drawn = h.renders.length;
    h.c.back();
    await tick();
    await tick();                                          // the promise of the flushed log settles now
    expect(h.cards.opened).toEqual(['A1']);
    expect(h.renders.length).toBe(drawn + 1);
    expect(h.renders.at(-1)).toMatchObject({ animate: false });
    expect(h.c.screen).toEqual({ step: 3, card: 0 });
    expect(h.c.cardOpen).toBe('A1');
  });
  it('a step without cards: its held plot is dropped, never drawn, then or by the next command', async () => {
    const h = make();
    await guided(h, 6);                                    // through admix1: its bars, D1 and D2 closed
    const plotAfterSix = h.renders.at(-1)!.p;
    h.clock.t += 1000;
    h.c.submit(formatCommand(SCRIPT[6]!));                 // bronzeAge: no cards; its plot waits for the log
    expect(h.term.isPrinting()).toBe(true);
    const drawn = h.renders.length;
    h.c.back();
    expect(h.c.screen).toEqual({ step: 6, card: 2 });
    await tick();
    await tick();
    expect(h.renders.length).toBe(drawn + 1);
    expect(h.renders.at(-1)).toEqual({ p: plotAfterSix, animate: false });
    await run(h, 'run_pca(period = "Viking")');            // off the script: a step with a plot of its own
    expect(h.renders.length).toBe(drawn + 2);              // its own plot only, not bronzeAge's held one first
    expect(h.renders.at(-1)!.p.layers).toContain('Viking');
    expect(h.renders.at(-1)!.p.layers).not.toContain('BronzeAge');
  });
  it('a "before" card step: Back from its first card while the log prints leaves no card, no echo and no held plot', async () => {
    const h = make();
    await guided(h, 14);                                   // through the finale; lct (H1, H2 before its plot) is next
    h.clock.t += 1000;
    h.c.submit(formatCommand(SCRIPT[14]!));
    expect(h.c.cardOpen).toBe('H1');
    expect(h.term.isPrinting()).toBe(true);                // the card is open while the log prints behind it
    const drawn = h.renders.length;
    h.c.back();
    expect(h.c.screen).toEqual({ step: 14, card: 0 });     // the finale's plot: it has no cards
    expect(h.c.cardOpen).toBeNull();
    expect(h.cards.current).toBeNull();
    expect(h.term.isPrinting()).toBe(false);
    expect(h.term.lines.some((l) => l.text === formatCommand(SCRIPT[14]!))).toBe(false);
    await tick();
    await tick();
    expect(h.renders.length).toBe(drawn + 1);
    expect(h.renders.at(-1)).toMatchObject({ animate: false });
    expect(h.term.hint).toBe(NEXT_PREFIX + formatCommand(SCRIPT[14]!));
  });
  it('Back in the instant the log ends on its own, before its after-cards open, is the same as Back while it prints', async () => {
    const h = make();
    await guided(h, 2);
    h.clock.t += 1000;
    h.c.submit(formatCommand(SCRIPT[2]!));
    h.term.finish();                                       // the log is over; the callback that opens A1 has not run yet
    expect(h.term.isPrinting()).toBe(false);
    expect(h.c.cardOpen).toBeNull();
    h.c.back();
    expect(h.c.screen).toEqual({ step: 3, card: 0 });
    expect(h.c.cardOpen).toBe('A1');
    await tick();
    await tick();
    expect(h.cards.opened).toEqual(['A1']);
    expect(h.c.screen).toEqual({ step: 3, card: 0 });
  });
  it('after Back to the step before, running the interrupted command again opens its cards again (they come from the log)', async () => {
    const h = make();
    await guided(h, 2);
    h.clock.t += 1000;
    h.c.submit(formatCommand(SCRIPT[2]!));
    h.c.back();                                            // A1, of the step that was printing
    h.c.back();                                            // the bare plot of step 2: europe is undone
    expect(h.c.session.steps).toHaveLength(2);
    await run(h, formatCommand(SCRIPT[2]!));
    expect(h.c.cardOpen).toBe('A1');
    expect(h.cards.opened).toEqual(['A1', 'A1']);
  });
});

describe('sequence numbers and Up/Down history across Back', () => {
  it('Back keeps nextSeq, so lines typed after it never reuse the numbers of the lines Back cut', async () => {
    const h = make();
    await guided(h, 3);
    const { nextSeq } = h.c.session;
    h.c.back();
    h.c.back();                                            // A1, then the bare plot of step 2: europe's lines are cut
    expect(h.c.session.nextSeq).toBe(nextSeq);
    await run(h, formatCommand(SCRIPT[2]!));
    const seqs = h.c.session.transcript.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs.find((q) => q >= nextSeq)).toBe(nextSeq);
    expect(h.c.session.steps.at(-1)!.endSeq).toBe(seqs.at(-1));
  });
  it('a restored session whose nextSeq lags its transcript is repaired, so the counter never goes backwards into used numbers', () => {
    const s: SessionV2 = {
      version: 2, build: sessionBuildHash(), history: [], nextSeq: 2, cursor: { step: 1, card: 0 },
      steps: [{ cmd: formatCommand(SCRIPT[0]!), endSeq: 5 }],
      transcript: [1, 2, 3, 4, 5].map((seq) => ({ seq, kind: 'output' as const, text: `l${seq}` })),
    };
    const h = make(s);
    expect(h.c.session.nextSeq).toBe(6);
  });
  it('Up/Down history is not rolled back: lines typed after the target screen, bad ones included, stay in it, in the terminal too', async () => {
    const h = make();
    await guided(h, 2);
    for (const line of ['run_pca(period = "Mars")', 'help()']) await run(h, line);
    const typed = h.c.session.history;
    expect(typed.slice(-2)).toEqual(['run_pca(period = "Mars")', 'help()']);
    h.c.back();
    expect(h.c.session.history).toEqual(typed);
    expect(h.term.history).toEqual(typed);
  });
});

describe('what Back reports and what it leaves alone', () => {
  it('one screen change per Back, ending on the target; canGoBack is false only on the first screen', async () => {
    const h = make();
    await guided(h, 3);                                    // the bare plot of step 3: A1 closed
    const n = h.screens.length;
    for (const [step, card, can] of [[3, 0, true], [2, 0, true], [1, 0, true], [0, 0, false]] as const) {
      h.c.back();
      expect(h.screens.slice(n).at(-1), `after Back to ${step}.${card}`).toEqual({ step, card, can });
    }
    expect(h.screens.length - n).toBe(4);                  // exactly one report per Back
    h.c.back();                                            // at the start: nothing happens, nothing is reported
    expect(h.screens.length - n).toBe(4);
  });
  it('three tries start again from zero after Back: two bad lines before it and two after never fill the prompt, the third does', async () => {
    const h = make();
    await guided(h, 3);
    await run(h, 'nope1()');
    await run(h, 'nope2()');
    expect(h.c.badTries).toBe(2);
    h.c.back();
    await run(h, 'nope3()');
    await run(h, 'nope4()');
    expect([h.c.badTries, h.term.prompt]).toEqual([2, '']);
    await run(h, 'nope5()');
    expect(h.term.prompt).not.toBe('');
    expect(h.c.badTries).toBe(0);
    expect(MAX_BAD_TRIES).toBe(3);
    expect(h.term.lines.some((l) => l.text === AUTOFILL_NOTE)).toBe(true);
  });
  it('Back clears what was typed in the prompt', async () => {
    const h = make();
    await guided(h, 2);
    h.term.fillPrompt('half a command');
    h.c.back();
    expect(h.term.prompt).toBe('');
  });
  it('the card rows of §4.4 apply to a card that Back opened: Esc and a blank Enter advance it, typed text closes the rest and runs', async () => {
    const h = make();
    await guided(h, 8);
    h.c.back();                                            // E3
    h.c.back();                                            // E2
    h.clock.t += 500;
    h.c.escape();                                          // advances to E3
    expect(h.c.cardOpen).toBe('E3');
    h.clock.t += 500;
    h.c.submit('');                                        // a blank Enter closes it
    expect(h.c.cardOpen).toBeNull();
    expect(h.c.screen).toEqual({ step: 8, card: 3 });
    h.c.back();
    h.c.back();                                            // E2 again
    await run(h, formatCommand(SCRIPT[8]!));               // typed text: E3 is skipped, consumerIA runs
    expect(h.c.cardOpen).toBeNull();
    expect(h.c.hintIndex).toBe(9);
    expect(h.c.screen).toEqual({ step: 9, card: 0 });
  });
  it('after the script the extras rotation rolls back with the step: the hint and Esc show the undone extra', async () => {
    const h = make();
    await guided(h, SCRIPT.length);
    await run(h, formatCommand(EXTRAS[0]!));
    await run(h, formatCommand(EXTRAS[1]!));
    expect(h.term.hint).toBe(EXTRA_PREFIX + formatCommand(EXTRAS[2]!));
    h.c.back();
    expect(h.term.hint).toBe(EXTRA_PREFIX + formatCommand(EXTRAS[1]!));
    h.clock.t += 1000;
    h.c.escape();
    expect(h.term.prompt).toBe(formatCommand(EXTRAS[1]!));
    expect(h.c.derived.extrasTick).toBe(1);
  });
});

// ---- Back at every screen ----

interface Snap {
  screen: { step: number; card: number }; cardOpen: CardId | null; host: Harness['cards']['current']; hint: string; prompt: string;
  hintIndex: number; badTries: number; canGoBack: boolean; plot: PlotState | undefined; lines: Line[];
  steps: string[]; transcript: { kind: string; text: string }[]; derived: Derived;
}

/** Everything a student can see or press, with sequence numbers left out: they are fresh after a Back, and no student sees them. */
function snap(h: Harness): Snap {
  const s = h.c.session;
  return {
    screen: h.c.screen, cardOpen: h.c.cardOpen, host: h.cards.current ? { ...h.cards.current } : null, hint: h.term.hint,
    prompt: h.term.prompt, hintIndex: h.c.hintIndex, badTries: h.c.badTries, canGoBack: h.c.canGoBack, plot: h.renders.at(-1)?.p,
    lines: h.term.lines.map((l) => ({ ...l })), steps: s.steps.map((x) => x.cmd),
    transcript: visibleTranscript(s.transcript, Infinity).map(({ kind, text }) => ({ kind, text })), derived: h.c.derived,
  };
}

/** The headless station as the shared walk drives it: a typed command lets its log end on its own, Continue is the card's button. */
const headless = (h: Harness): ScriptDriver<Snap> => ({ run: (line) => run(h, line), continueCard: () => h.c.continueCard(), snap: () => snap(h) });

describe('Back at every screen of the guided script (headless; the real-terminal version is in back-dom.test.ts)', () => {
  it('the screen order has one screen per card plus one per step, and Back leaves nothing out', () => {
    const keys = screenKeys();
    const cards = SCRIPT_STEPS.reduce((n, st) => n + (st.cards?.ids.length ?? 0), 0);
    expect(keys).toHaveLength(1 + SCRIPT.length + cards);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('Back from the end shows, at every screen, exactly the station the live run had there; running forward again reproduces them all', async () => {
    const h = make();
    const live = new Map<string, Snap>();
    await forwardRun(headless(h), (key, s) => live.set(key, s));
    const keys = screenKeys();
    expect([...live.keys()]).toEqual(keys);
    expect(h.c.screen).toEqual({ step: SCRIPT.length, card: cardCount(SCRIPT.length - 1) });

    for (let at = keys.length - 2; at >= 0; at--) {
      h.c.back();
      expect(snap(h), `Back to ${keys[at]}`).toEqual(live.get(keys[at]!));
    }
    expect(h.c.canGoBack).toBe(false);

    const again: string[] = [];
    await forwardRun(headless(h), (key, s) => {
      again.push(key);
      expect(s, `forward again to ${key}`).toEqual(live.get(key));
    });
    expect(again).toEqual(keys);
  });

  it('the same from every screen: Back by k screens, then forward by the same commands and Continues, lands on the station that was left', async () => {
    const keys = screenKeys();
    for (const from of [8, 14, 22, 31, keys.length - 1]) {   // a spread of screens, card screens and bare plots among them
      const h = make();
      const live = new Map<string, Snap>();
      await forwardRun(headless(h), (key, s) => live.set(key, s));
      for (let at = keys.length - 1; at > from; at--) h.c.back();   // the station the run was in at screen `from`
      expect(snap(h), `Back to ${keys[from]}`).toEqual(live.get(keys[from]!));
      // run on from there as a student does and compare with the live run at every screen after it
      const [step, card] = keys[from]!.split('.').map(Number) as [number, number];
      for (let j = card; j < (step > 0 ? cardCount(step - 1) : 0); j++) h.c.continueCard();   // the cards of this step that are still ahead
      await forwardRun(headless(h), (key, s) => expect(s, `from ${keys[from]} forward: ${key}`).toEqual(live.get(key)), step);
    }
  });
});
