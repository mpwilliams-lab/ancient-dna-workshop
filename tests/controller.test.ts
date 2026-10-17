// @vitest-environment jsdom
// Controller v3 (Task 6): typing rules (unchanged from v2.1), the hint pointer, the session v2 log, restore by replay,
// headless card state and the Enter/Esc rules of spec §4.4 and §5.3. The DOM card view is Task 12.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkshopData } from '../src/types';
import {
  Controller, AUTOFILL_NOTE, INTERNAL_ERROR_LINE, MAX_BAD_TRIES, CARD_REPEAT_GUARD_MS, CONTROLLER_STRINGS, didYouMean, completeLine,
} from '../src/controller';
import { mountTerminal } from '../src/terminal';
import { formatCommand } from '../src/parser';
import { EXTRAS, EXTRA_PREFIX, SCRIPT, SCRIPT_STEPS, hintText } from '../src/hints';
import { INITIAL_PLOT, type PlotState } from '../src/plotState';
import { ALL_OFF } from '../src/features';
import { loadSession, visibleTranscript, type SessionV2, type TranscriptEntry } from '../src/session';
import { sessionBuildHash } from '../src/replay';
import {
  ADMIX_TODAY_HIDDEN, ADMIX_TODAY_SHOWN, CARD_HINT, EUROPE_ALREADY_SHOWN, EUROPE_HELD_BACK, PREDICT_HINT, REVEAL_HINT, RESTORED_NOTICE,
} from '../src/content';
import { ruleViolations } from './contentRules';
import {
  FakeTerminal, STEP, blockedStore, closeCards, data, flushMicrotasks, memStore, rig, runSteps, settle, type Rig,
} from './helpers/controllerRig';

/** The transcript's output lines that say "did you mean". */
const didYouMeanLines = (t: readonly TranscriptEntry[]): string[] =>
  t.filter((l) => l.kind === 'output' && /did you mean/i.test(l.text)).map((l) => l.text);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the script this file relies on (Task 4)', () => {
  it('has the step ids and cards the tests below use', () => {
    expect(SCRIPT).toHaveLength(19);
    expect(SCRIPT_STEPS.map((s) => s.id)).toEqual([
      'hook', 'load', 'europe', 'firstFarmers', 'bellBeaker', 'admix1', 'bronzeAge', 'ironAge', 'consumerIA',
      'revealPca', 'revealAdmix', 'roman', 'angloSaxon', 'finale', 'lct', 'slc45a2', 'herc2', 'tyk2', 'hla',
    ]);
    expect(SCRIPT_STEPS[7]!.cards).toEqual({ placement: 'after', ids: ['E1', 'E2', 'E3'] });
    expect(SCRIPT_STEPS[14]!.cards).toEqual({ placement: 'before', ids: ['H1', 'H2'] });
  });
});

describe('Controller start-up', () => {
  it('renders the initial plot once, without animation, and shows the first hint', () => {
    const r = rig();
    expect(r.renders).toEqual([INITIAL_PLOT]);
    expect(r.renderOpts).toEqual([{ animate: false }]);
    expect(r.c.hintIndex).toBe(0);
    expect(r.c.badTries).toBe(0);
    expect(r.term.hint).toContain(STEP(0));
    expect(r.events.filter((e) => e.startsWith('notice:'))).toEqual([]);
    expect(r.c.screen).toEqual({ step: 0, card: 0 });
    expect(r.c.cardOpen).toBeNull();
    expect(r.c.canGoBack).toBe(false);
  });

  it('exports its on-screen strings for the content scan, and the repeat guard', () => {
    expect(MAX_BAD_TRIES).toBe(3);
    expect(CARD_REPEAT_GUARD_MS).toBe(400);
    expect(CONTROLLER_STRINGS).toContain(AUTOFILL_NOTE);
    expect(CONTROLLER_STRINGS).toContain(INTERNAL_ERROR_LINE);
    expect(didYouMean('run_pca()')).toBe('Did you mean run_pca()?');
  });

  it('every controller on-screen string passes the content rules', () => {
    expect(CONTROLLER_STRINGS.length).toBe(3);
    for (const s of CONTROLLER_STRINGS) expect(ruleViolations(s), s).toEqual([]);
    for (const c of [...SCRIPT, ...EXTRAS]) {
      const line = didYouMean(formatCommand(c));
      expect(ruleViolations(line), line).toEqual([]);
    }
  });
});

describe('RF1: students typing loosely', () => {
  it.each([
    'run_pca(period = "IronAge")',
    'RUN_PCA(PERIOD="IRONAGE")',
    "run_pca( period = 'IronAge' )",
    '   Run_Pca(period="ironage")   ',
    'run_pca("IronAge")',
    'run_pca IronAge',
    'runpca(period = "IronAge")',
    'run_pca(period = "iron")',
  ])('accepts %j as run_pca IronAge', (input) => {
    const r = rig();
    r.c.submit(input);
    expect(r.c.badTries).toBe(0);
    expect(r.c.derived.plot.view).toBe('pca');
    expect(r.c.derived.plot.layers).toContain('IronAge');
    expect(r.c.derived.plot.frame).toBe('britain');
    expect(r.c.session.steps.map((s) => s.cmd)).toEqual(['run_pca(period = "IronAge")']);
  });

  it('resolves aliases through the controller', () => {
    const r = rig();
    r.c.submit('run_pca(period = "romans")');
    expect(r.c.derived.plot.layers).toContain('Roman');
    r.c.submit('allele_freq(gene = "lactase")');
    expect(r.c.derived.plot.view).toBe('trait');
    expect(r.c.derived.plot.gene).toBe('LCT');
    expect(r.c.badTries).toBe(0);
  });

  it.each([
    ['run_pcaa(period = "IronAge")', 'run_pca'],
    ['run_pca(period = "IronAg")', 'IronAge'],
    ['allele_freq(gene = "HERC")', 'HERC2'],
  ])('typo %j gets a friendly did-you-mean naming %j', (input, expected) => {
    const r = rig();
    r.c.submit(input);
    const said = r.term.output.join('\n');
    expect(said).toMatch(/did you mean/i);
    expect(said).toContain(expected);
    expect(didYouMeanLines(r.c.session.transcript)).toHaveLength(1);
    expect(r.c.badTries).toBe(1);
    expect(r.renders).toHaveLength(1);
    expect(r.c.session.steps).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each<[string, string, boolean]>([
    ['adds its own line when the parser message lacks it', 'That is not a period in this workshop.', true],
    ['adds nothing when the parser message already says it',
      'That is not a period in this workshop. Did you mean run_pca(period = "IronAge")?', false],
  ])('a stubbed parser error that %s: exactly one did-you-mean line', async (_label, message, controllerAdds) => {
    const suggestion = 'run_pca(period = "IronAge")';
    vi.resetModules();
    vi.doMock('../src/parser', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/parser')>()),
      parse: () => ({ ok: false, kind: 'unknown_value', message, suggestion }),
    }));
    try {
      const mod = await import('../src/controller');
      const term = new FakeTerminal([]);
      const c = new mod.Controller({ data, terminal: term, renderPlot: () => undefined, store: null }, null);
      c.submit('anything');
      expect(didYouMeanLines(c.session.transcript)).toHaveLength(1);
      expect(term.output.includes(mod.didYouMean(suggestion))).toBe(controllerAdds);
      expect(c.badTries).toBe(1);
    } finally {
      vi.doUnmock('../src/parser');
      vi.resetModules();
    }
  });

  it('an error is followed by the hint line', () => {
    const r = rig();
    r.c.submit('run_pca(period = "Neolithic")');
    expect(r.term.output[r.term.output.length - 1]).toBe(r.term.hint);
  });

  it('an unknown value counts as an incorrect try and leaves the plot alone', () => {
    const r = rig();
    r.c.submit('run_pca(period = "Neolithic")');
    expect(r.c.badTries).toBe(1);
    expect(r.c.derived.plot).toEqual(INITIAL_PLOT);
    expect(r.renders).toHaveLength(1);
  });

  const JUNK = [
    ')))(((', '"', "'", 'run_pca(', 'run_pca(period=)', 'run_pca(period = "")', 'run_pca(period = "IronAge"',
    'allele_freq(gene = )', '()', '=', ',,,,', 'NaN', 'undefined', 'null', '__proto__', 'constructor',
    'run_pca(period = "__proto__")', 'run_admixture(K = "three")', 'run_admixture(K = Infinity)', 'drop table students;',
    '<script>alert(1)</script>', '\u0000\u0001\u0002', '💥🧬', 'ancestry_test(person = "all")', '\\', '${process}',
  ];

  it('junk never crashes and never shows a stack trace', () => {
    const r = rig();
    for (const j of JUNK) expect(() => r.c.submit(j)).not.toThrow();
    const said = r.term.output.join('\n');
    expect(said.length).toBeGreaterThan(0);
    expect(said).not.toMatch(/TypeError|ReferenceError|RangeError|SyntaxError|\[object |\n\s+at /);
    expect(() => r.c.submit(undefined as unknown as string)).not.toThrow();
    expect(() => r.c.submit(42 as unknown as string)).not.toThrow();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('blank input with no card open and nothing animating does nothing and does not count', () => {
    const r = rig();
    r.c.submit('');
    r.c.submit('    ');
    r.c.submit('\t');
    expect(r.c.badTries).toBe(0);
    expect(r.events).toEqual(['render:none']);
    expect(r.c.session.history).toEqual([]);
  });

  it('a 2,000-character paste is refused safely and counts as one incorrect try', () => {
    const r = rig();
    const paste = 'run_pca(period = "IronAge")' + 'x'.repeat(2000 - 27);
    expect(paste.length).toBe(2000);
    expect(() => r.c.submit(paste)).not.toThrow();
    expect(r.c.badTries).toBe(1);
    const echo = r.events.find((e) => e.startsWith('echo:')) as string;
    expect(echo.length).toBe('echo:'.length + 201);
    expect(echo.endsWith('…')).toBe(true);
    expect(r.c.session.history[0]!.length).toBe(201);
    expect(r.c.derived.plot).toEqual(INITIAL_PLOT);
    expect(() => r.c.submit('a'.repeat(2000))).not.toThrow();
    expect(r.c.badTries).toBe(2);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('three incorrect tries in a row fill the hinted command and reset the counter', () => {
    const r = rig();
    r.c.submit('asdf');
    r.c.submit('run_pca(period = "Neolithic")');
    expect(r.c.badTries).toBe(2);
    expect(r.term.prompt).toBe('');
    r.c.submit(')))');
    expect(r.term.prompt).toBe(STEP(0));
    expect(r.term.prompt).toBe('ancestry_test(person = "me")');
    expect(r.c.badTries).toBe(0);
    expect(r.term.output).toContain(AUTOFILL_NOTE);
  });

  it('auto-fill inserts script[i] for the current pointer', () => {
    const r = rig();
    runSteps(r, 0, 2);
    expect(r.c.hintIndex).toBe(2);
    for (let k = 0; k < MAX_BAD_TRIES; k++) r.c.submit('nope');
    expect(r.term.prompt).toBe(STEP(2));
    expect(r.term.prompt).toBe('run_pca(period = "Europe")');
  });

  it('a friendly refusal (K = 4) is not an incorrect try and not a step', () => {
    const r = rig();
    r.c.submit('bad1');
    r.c.submit('run_admixture(K = 4)');
    expect(r.term.output.join('\n')).toContain('K = 3');
    expect(r.c.session.steps).toEqual([]);
    r.c.submit('bad2');
    expect(r.c.badTries).toBe(2);
    expect(r.term.prompt).toBe('');
    r.c.submit('bad3');
    expect(r.term.prompt).toBe(STEP(0));
  });

  it('a refusal neither draws nor moves the hint pointer', async () => {
    const r = rig();
    runSteps(r, 0, 5);
    expect(SCRIPT[5]).toEqual({ name: 'run_admixture', K: 3 });
    const before = r.c.derived.plot;
    const rendersBefore = r.renders.length;
    r.c.submit('run_admixture(K = 4)');
    expect(r.c.hintIndex).toBe(5);
    expect(r.c.derived.plot).toEqual(before);
    expect(r.renders).toHaveLength(rendersBefore);
    await flushMicrotasks();
    expect(r.renders).toHaveLength(rendersBefore);
  });

  it('a successful command resets the counter', () => {
    const r = rig();
    r.c.submit('bad1');
    r.c.submit('bad2');
    r.c.submit('help()');
    expect(r.c.badTries).toBe(0);
    r.c.submit('bad3');
    expect(r.c.badTries).toBe(1);
    expect(r.term.prompt).toBe('');
  });

  it('Esc fills script[i] and resets the counter', () => {
    const r = rig();
    r.c.submit('bad1');
    r.c.submit('bad2');
    r.c.escape();
    expect(r.term.prompt).toBe(STEP(0));
    expect(r.c.badTries).toBe(0);
    r.c.submit('bad3');
    expect(r.c.badTries).toBe(1);
  });

  it('Esc after the predict step still inserts the BellBeaker step', () => {
    const r = rig();
    runSteps(r, 0, 4);
    expect(SCRIPT[3]).toEqual({ name: 'run_pca', period: 'FirstFarmers' });
    expect(r.term.hint).toBe(PREDICT_HINT);
    r.c.escape();
    expect(r.term.prompt).toBe('run_pca(period = "BellBeaker")');
  });

  it('the Reveal line shows before step 9, after ancestry_test(person = "IronAge")', () => {
    const r = rig();
    runSteps(r, 0, 9);
    expect(SCRIPT[8]).toEqual({ name: 'ancestry_test', person: 'IronAge' });
    expect(r.term.hint).toBe(REVEAL_HINT);
    r.c.escape();
    expect(r.term.prompt).toBe('run_pca(period = "Today")');
  });

  it('after the last step, Esc inserts the extra the hint line shows; help() keeps the rotation, a step moves it', () => {
    const r = rig();
    runSteps(r, 0, SCRIPT.length);
    expect(r.c.hintIndex).toBe(SCRIPT.length);
    r.c.escape();
    expect(r.term.prompt).toBe(formatCommand(EXTRAS[0]!));
    expect(r.term.hint).toBe(EXTRA_PREFIX + formatCommand(EXTRAS[0]!));
    r.c.submit('help()');
    r.c.escape();
    expect(r.term.prompt).toBe(formatCommand(EXTRAS[0]!));
    r.c.submit(formatCommand(EXTRAS[0]!));
    r.c.escape();
    expect(r.term.prompt).toBe(formatCommand(EXTRAS[1]!));
    expect(r.term.hint).toContain(r.term.prompt);
  });
});

describe('hint pointer and plot wiring', () => {
  it('advances only on script[i]; other valid commands run but leave i', () => {
    const r = rig();
    r.c.submit(STEP(3));
    expect(r.c.hintIndex).toBe(0);
    expect(r.c.derived.plot.layers).toContain('FirstFarmers');
    r.c.submit(STEP(0));
    expect(r.c.hintIndex).toBe(1);
    expect(r.term.hint).toContain(STEP(1));
    r.c.submit(STEP(0));
    expect(r.c.hintIndex).toBe(1);
  });

  it.each(['help()', 'clear()'])('%s does not end the Predict beat', (cmd) => {
    const r = rig();
    runSteps(r, 0, 4);
    expect(r.term.hint).toBe(PREDICT_HINT);
    r.c.submit(cmd);
    expect(r.term.hint).toBe(PREDICT_HINT);
    expect(r.c.hintIndex).toBe(4);
  });

  it('renders the reduced plot after each drawing command, not after text-only ones', () => {
    const r = rig({ features: ALL_OFF }); // consumerBars off: ancestry_test draws nothing
    r.c.submit('load_genomes()');
    r.c.submit('ancestry_test(person = "me")');
    expect(r.renders).toHaveLength(1);
    r.c.submit('run_pca(period = "Roman")');
    r.c.submit('run_pca(period = "BellBeaker")');
    expect(r.renders).toHaveLength(3);
    expect(r.renders[1]!.frame).toBe('britain');
    expect(r.renders[2]!.frame).toBe('europe');
    expect(r.renders[2]!.layers).toEqual(expect.arrayContaining(['Roman', 'BellBeaker']));
    r.c.submit('run_admixture(K = 3)');
    expect(r.renders[3]!.view).toBe('admixture');
    expect(r.renderOpts.slice(1)).toEqual([undefined, undefined, undefined]); // live draws animate as usual
  });

  it('clear() clears the screen and appends a clear marker; nothing is deleted and the plot stays', () => {
    const r = rig();
    r.c.submit('run_pca(period = "Today")');
    const plot = r.c.derived.plot;
    const before = r.c.session.transcript.length;
    r.c.submit('clear()');
    expect(r.events).toContain('clear');
    const t = r.c.session.transcript;
    expect(t).toHaveLength(before + 2); // the clear() input line, then the marker
    expect(t[t.length - 1]).toMatchObject({ kind: 'clear', text: '' });
    expect(visibleTranscript(t, Infinity)).toEqual([]);
    expect(r.c.derived.plot).toEqual(plot);
    expect(r.renders).toHaveLength(2);
    expect(r.c.session.steps.map((s) => s.cmd)).toEqual(['run_pca(period = "Today")']);
  });

  it('records history (bad tries included) and the transcript with growing seqs', () => {
    const r = rig();
    r.c.submit('help()');
    r.c.submit('oops');
    r.c.submit('load_genomes()');
    expect(r.c.session.history).toEqual(['help()', 'oops', 'load_genomes()']);
    const t = r.c.session.transcript;
    expect(t.filter((l) => l.kind === 'input').map((l) => l.text)).toEqual(['help()', 'oops', 'load_genomes()']);
    expect(t.filter((l) => l.kind === 'output').length).toBeGreaterThan(3);
    expect(t.map((l) => l.seq)).toEqual(t.map((_, k) => k + 1));
    expect(r.c.session.nextSeq).toBe(t.length + 1);
  });

  it('history skips a line identical to the one before it, like the live terminal (Up/Down parity after a refresh); the transcript keeps both', () => {
    const r = rig();
    for (const line of ['help()', 'help()', 'oops', 'oops', 'help()', 'oops']) r.c.submit(line);
    expect(r.c.session.history).toEqual(['help()', 'oops', 'help()', 'oops']);
    expect(r.c.session.transcript.filter((l) => l.kind === 'input').map((l) => l.text))
      .toEqual(['help()', 'help()', 'oops', 'oops', 'help()', 'oops']);
    expect(rig({ restored: r.c.session }).term.history).toEqual(['help()', 'oops', 'help()', 'oops']);
  });

  it('history compares the line as typed, like the terminal: a line that differs only by a space is a new entry', () => {
    const r = rig();
    for (const line of ['help()', 'help() ', 'help()']) r.c.submit(line);
    expect(r.c.session.history).toEqual(['help()', 'help() ', 'help()']);
  });
});

describe('extrasTick (spec §2.2): only steps run after the script end move the extras rotation', () => {
  it('help(), clear(), Tab listings, bad tries and refusals never tick it; a step ticks it once', () => {
    const r = rig();
    runSteps(r, 0, SCRIPT.length);
    expect(r.c.derived.extrasTick).toBe(0);
    const first = EXTRA_PREFIX + formatCommand(EXTRAS[0]!);
    expect(r.term.hint).toBe(first);
    r.c.submit('help()');
    r.c.submit('clear()');
    r.c.tab('run_');
    r.c.submit('oops');
    r.c.submit('run_admixture(K = 4)');
    expect(r.c.derived.extrasTick).toBe(0);
    expect(r.term.hint).toBe(first);
    r.c.submit('load_genomes()');
    expect(r.c.derived.extrasTick).toBe(1);
    expect(r.term.hint).toBe(EXTRA_PREFIX + formatCommand(EXTRAS[1]!));
  });
});

describe('session v2 log (spec §4.2)', () => {
  it('a step is one successful command other than help() and clear(); it stores formatCommand of the parsed command', () => {
    const r = rig();
    r.c.submit('help()');
    r.c.submit('oops');
    r.c.submit('run_admixture(K = 4)');
    r.c.submit('clear()');
    r.c.submit('RUN_PCA(PERIOD="romans")');
    r.c.submit('ancestry_test(person = "me")');
    expect(r.c.session.steps.map((s) => s.cmd)).toEqual(['run_pca(period = "Roman")', 'ancestry_test(person = "me")']);
    expect(r.c.screen).toEqual({ step: 2, card: 0 });
    expect(r.c.canGoBack).toBe(true);
  });

  it("endSeq is the seq of the step's last output line", () => {
    const r = rig();
    r.c.submit('load_genomes()');
    r.c.submit('oops');
    const s = r.c.session;
    expect(s.transcript.find((e) => e.seq === s.steps[0]!.endSeq)?.text).toBe('Genomes loaded.');
    expect(s.transcript[s.transcript.length - 1]!.seq).toBeGreaterThan(s.steps[0]!.endSeq);
  });

  it('saves after every command and every card advance, with the build hash', () => {
    const r = rig();
    r.c.submit(STEP(0));
    expect(loadSession(r.store)?.steps.map((s) => s.cmd)).toEqual([STEP(0)]);
    r.c.submit('garbage');
    expect(loadSession(r.store)?.history).toEqual([STEP(0), 'garbage']);
    runSteps(r, 1, 7);
    r.c.submit(STEP(7));
    expect(loadSession(r.store)?.cursor).toEqual({ step: 8, card: 0 });
    r.c.continueCard();
    expect(loadSession(r.store)?.cursor).toEqual({ step: 8, card: 1 });
    expect(loadSession(r.store)?.build).toBe(sessionBuildHash());
  });

  it('derived hands out a copy: editing it does not touch the controller', () => {
    const r = rig();
    runSteps(r, 0, 3);
    const d = r.c.derived;
    d.cardsFor[2]!.push('L3');
    d.cardsFor.length = 0;
    expect(r.c.derived.cardsFor).toEqual([[], [], ['A1']]);
  });

  it('works with blocked storage and with no storage', () => {
    for (const store of [blockedStore, null]) {
      const r = rig({ store });
      expect(() => {
        r.c.submit(STEP(0));
        r.c.submit('junk');
        r.c.escape();
        r.c.tab('run_');
      }).not.toThrow();
      expect(r.c.hintIndex).toBe(1);
    }
  });
});

describe('restore by replay (spec §4.2)', () => {
  it('rebuilds plot, hint, lastRan, extras, cards, history and transcript from the log; draws once without animation', () => {
    const a = rig();
    runSteps(a, 0, 3);
    a.c.submit('run_pca(period = "Roman")');
    a.c.submit('oops');
    const saved = loadSession(a.store)!;
    const b = rig({ restored: saved, store: a.store });
    expect(b.c.hintIndex).toBe(3);
    expect(b.c.derived).toEqual(a.c.derived);
    expect(b.renders).toEqual([a.c.derived.plot]);
    expect(b.renderOpts).toEqual([{ animate: false }]);
    expect(b.term.history).toEqual(saved.history);
    expect(b.term.shownLines).toEqual(visibleTranscript(saved.transcript, Infinity).map(({ kind, text }) => ({ kind, text })));
    expect(b.events.filter((e) => e.startsWith('echo:') || e.startsWith('out:'))).toEqual([]); // drawn at once
    expect(b.c.session).toEqual(a.c.session);
    expect(b.term.hint).toBe(a.term.hint);
    expect(b.events.some((e) => e.includes(RESTORED_NOTICE))).toBe(false); // the shell prints the notice, never the controller
  });

  it('the Predict and Reveal lines survive a refresh (lastRan is replayed)', () => {
    const a = rig();
    runSteps(a, 0, 4);
    expect(rig({ restored: loadSession(a.store) }).term.hint).toBe(PREDICT_HINT);
    runSteps(a, 4, 9);
    expect(rig({ restored: loadSession(a.store) }).term.hint).toBe(REVEAL_HINT);
  });

  it('reopens the card the cursor points at', () => {
    const a = rig();
    runSteps(a, 0, 7);
    a.c.submit(STEP(7));
    a.c.continueCard();
    expect(a.c.cardOpen).toBe('E2');
    const b = rig({ restored: loadSession(a.store) });
    expect(b.c.cardOpen).toBe('E2');
    expect(b.cards.opens).toEqual([{ id: 'E2', index: 1, count: 3, placement: 'after' }]);
    expect(b.term.hint).toBe(CARD_HINT);
    expect(b.c.screen).toEqual({ step: 8, card: 1 });
  });

  it('a session saved after the whole guided script restores at SCRIPT.length, with the extras hint and no card', () => {
    const a = rig();
    runSteps(a, 0, SCRIPT.length);
    const saved = loadSession(a.store)!;
    expect(saved.steps).toHaveLength(SCRIPT.length);
    expect(saved.cursor.step).toBe(SCRIPT.length);
    const b = rig({ restored: saved });
    expect(b.c.hintIndex).toBe(SCRIPT.length);
    expect(b.term.hint).toBe(EXTRA_PREFIX + formatCommand(EXTRAS[0]!));
    expect(b.c.cardOpen).toBeNull();
    expect(b.c.derived).toEqual(a.c.derived);
  });

  it('a refresh while an after-card still waits for its log opens that card at once', () => {
    const a = rig();
    runSteps(a, 0, 2);
    a.term.holdPrints = true;
    a.c.submit(STEP(2));
    expect(a.c.cardOpen).toBeNull();
    const b = rig({ restored: loadSession(a.store) });
    expect(b.c.cardOpen).toBe('A1');
  });

  it('shows only the lines after the last clear() marker', () => {
    const a = rig();
    a.c.submit('load_genomes()');
    a.c.submit('clear()');
    a.c.submit('oops');
    const b = rig({ restored: loadSession(a.store) });
    expect(b.term.shownLines.map((l) => l.text)[0]).toBe('oops');
    expect(b.term.shownLines.some((l) => l.text === 'Genomes loaded.')).toBe(false);
  });

  it("clamps a card index past the step's cards", () => {
    const a = rig();
    a.c.submit(STEP(0));
    const s = { ...loadSession(a.store)!, cursor: { step: 1, card: 5 } };
    const b = rig({ restored: s });
    expect(b.c.screen).toEqual({ step: 1, card: 0 });
    expect(b.c.cardOpen).toBeNull();
  });

  const BROKEN: [string, SessionV2['steps'], SessionV2['cursor']][] = [
    ['an unknown value', [{ cmd: 'run_pca(period = "Neolithic")', endSeq: 1 }], { step: 1, card: 0 }],
    ['a refused command', [{ cmd: 'run_admixture(K = 4)', endSeq: 1 }], { step: 1, card: 0 }],
    ['help() as a step', [{ cmd: 'help()', endSeq: 1 }], { step: 1, card: 0 }],
    ['a cursor past the log', [{ cmd: 'load_genomes()', endSeq: 1 }], { step: 2, card: 0 }],
  ];
  it.each(BROKEN)('a log that cannot be replayed starts fresh without throwing (%s)', (_name, steps, cursor) => {
    const s: SessionV2 = {
      version: 2, build: sessionBuildHash(), history: ['x'], transcript: [{ seq: 1, kind: 'input', text: 'x' }], steps, cursor, nextSeq: 2,
    };
    let r!: Rig;
    expect(() => {
      r = rig({ restored: s });
    }).not.toThrow();
    expect(console.error).toHaveBeenCalledWith('restore failed; starting fresh', expect.any(Error));
    expect(r.c.hintIndex).toBe(0);
    expect(r.c.session.history).toEqual([]);
    expect(r.c.session.steps).toEqual([]);
    expect(r.events).toContain('clear');
    expect(r.renders).toEqual([INITIAL_PLOT]);
  });
});

describe('cards (spec §5.3) and the Enter/Esc rules (spec §4.4)', () => {
  it('"after" cards open only when the step\'s own log has finished, after its plot is drawn', async () => {
    const r = rig();
    runSteps(r, 0, 2);
    r.term.holdPrints = true;
    r.c.submit(STEP(2)); // run_pca(period = "Europe"): after-card A1
    expect(r.term.isPrinting()).toBe(true);
    expect(r.c.cardOpen).toBeNull();
    expect(r.cards.opens).toEqual([]);
    expect(r.term.hint).not.toBe(CARD_HINT);
    expect(r.c.screen).toEqual({ step: 3, card: 0 });
    await settle(r);
    expect(r.c.cardOpen).toBe('A1');
    expect(r.cards.opens).toEqual([{ id: 'A1', index: 0, count: 1, placement: 'after' }]);
    expect(r.events.lastIndexOf('render:pca')).toBeLessThan(r.events.indexOf('card:open:A1'));
    expect(r.term.hint).toBe(CARD_HINT);
  });

  it('a line typed while the log prints flushes it, skips the after-cards (still screens) and runs the line', async () => {
    const r = rig();
    runSteps(r, 0, 7);
    r.term.holdPrints = true;
    r.c.submit(STEP(7)); // run_pca(period = "IronAge"): E1, E2, E3
    r.c.submit('help()');
    expect(r.c.cardOpen).toBeNull();
    expect(r.c.screen).toEqual({ step: 8, card: 3 });
    await settle(r);
    expect(r.c.cardOpen).toBeNull();
    expect(r.cards.opens.filter((o) => o.id.startsWith('E'))).toEqual([]);
    expect(r.c.derived.cardsFor[7]).toEqual(['E1', 'E2', 'E3']);
    expect(r.renders[r.renders.length - 1]!.layers).toContain('IronAge');
  });

  it('"before" cards open as soon as the command is accepted and stay while the log prints', async () => {
    const r = rig();
    runSteps(r, 0, 14);
    r.term.holdPrints = true;
    const rendersBefore = r.renders.length;
    r.c.submit(STEP(14)); // allele_freq(gene = "LCT"): H1, H2 before
    expect(r.term.isPrinting()).toBe(true);
    expect(r.c.cardOpen).toBe('H1');
    expect(r.cards.opens[r.cards.opens.length - 1]).toEqual({ id: 'H1', index: 0, count: 2, placement: 'before' });
    expect(r.term.hint).toBe(CARD_HINT);
    expect(r.renders).toHaveLength(rendersBefore);
    await settle(r);
    expect(r.renders[r.renders.length - 1]!.view).toBe('trait');
    expect(r.c.cardOpen).toBe('H1');
  });

  it('a blank Enter advances one card; after the last card the step hint is back and a blank Enter does nothing', () => {
    const r = rig();
    runSteps(r, 0, 7);
    r.c.submit(STEP(7));
    expect(r.c.cardOpen).toBe('E1');
    r.c.submit('');
    expect(r.c.cardOpen).toBe('E2');
    expect(r.cards.opens[r.cards.opens.length - 1]).toEqual({ id: 'E2', index: 1, count: 3, placement: 'after' });
    r.c.submit('');
    r.c.submit('');
    expect(r.c.cardOpen).toBeNull();
    expect(r.events[r.events.length - 1]).toBe('card:close');
    expect(r.term.hint).toBe(hintText(8, SCRIPT[7]!, 0));
    expect(r.c.screen).toEqual({ step: 8, card: 3 });
    const events = [...r.events];
    r.c.submit('');
    expect(r.events).toEqual(events);
  });

  it('a blank Enter on a "before" card advances it without flushing the log that is still printing (RF4)', async () => {
    const r = rig();
    runSteps(r, 0, 14);
    r.term.holdPrints = true;
    r.c.submit(STEP(14)); // allele_freq(gene = "LCT"): H1, H2 open at once and the log is still printing
    expect(r.term.isPrinting()).toBe(true);
    expect(r.c.cardOpen).toBe('H1');
    const rendersBefore = r.renders.length;
    r.c.submit('');
    expect(r.c.cardOpen).toBe('H2');
    expect(r.term.isPrinting()).toBe(true);
    r.c.continueCard();
    expect(r.c.cardOpen).toBeNull();
    expect(r.c.screen).toEqual({ step: 15, card: 2 });
    expect(r.term.isPrinting()).toBe(true); // closing the last card does not flush it either
    expect(r.renders).toHaveLength(rendersBefore);
    await settle(r);
    expect(r.renders[r.renders.length - 1]!.view).toBe('trait');
  });

  it("Enter with text closes the step's remaining cards (they stay screens), then runs the line; a bad line counts", () => {
    const r = rig();
    runSteps(r, 0, 7);
    r.c.submit(STEP(7));
    r.c.continueCard(); // E2
    r.c.submit('run_pca(period = "Jurassic")');
    expect(r.c.cardOpen).toBeNull();
    expect(r.cards.current).toBeNull();
    expect(r.c.screen).toEqual({ step: 8, card: 3 });
    expect(r.c.badTries).toBe(1);
    expect(r.term.output[r.term.output.length - 1]).toBe(hintText(8, SCRIPT[7]!, 0));
    r.c.submit(STEP(8));
    expect(r.c.hintIndex).toBe(9);
    expect(r.c.badTries).toBe(0);
  });

  it('Esc advances one card while a card is open and never fills the prompt; with no card it fills script[i]', () => {
    const r = rig();
    runSteps(r, 0, 7);
    r.c.submit(STEP(7));
    r.c.escape();
    expect(r.c.cardOpen).toBe('E2');
    expect(r.term.prompt).toBe('');
    r.c.escape();
    r.c.escape();
    expect(r.c.cardOpen).toBeNull();
    expect(r.term.prompt).toBe('');
    r.c.escape();
    expect(r.term.prompt).toBe(STEP(8));
  });

  it('the repeat guard ignores repeat keydowns and any Enter or Esc within 400 ms of a card opening or the last advance', () => {
    let clock = 0;
    const r = rig({ now: () => clock });
    runSteps(r, 0, 7); // Continue clicks are never throttled
    clock = 10_000;
    r.c.submit(STEP(7)); // E1 opens at 10 000
    r.c.submit('', { repeat: false });
    expect(r.c.cardOpen).toBe('E1');
    clock = 10_399;
    r.c.escape({ repeat: false });
    expect(r.c.cardOpen).toBe('E1');
    clock = 10_400;
    r.c.submit('', { repeat: false });
    expect(r.c.cardOpen).toBe('E2');
    clock = 20_000;
    r.c.submit('', { repeat: true });
    r.c.escape({ repeat: true });
    expect(r.c.cardOpen).toBe('E2');
    r.c.escape({ repeat: false });
    expect(r.c.cardOpen).toBe('E3');
    clock = 20_100;
    r.c.submit('', { repeat: false });
    expect(r.c.cardOpen).toBe('E3');
    r.c.continueCard();
    expect(r.c.cardOpen).toBeNull();
  });

  it('ten repeated Enter keydowns on card 1 of 3 leave card 2 open; two Enters 100 ms apart advance one card', () => {
    let clock = 0;
    const r = rig({ now: () => clock });
    runSteps(r, 0, 7);
    clock = 1_000;
    r.c.submit(STEP(7));
    clock = 2_000;
    r.c.submit('', { repeat: false });
    for (let k = 0; k < 9; k += 1) r.c.submit('', { repeat: true });
    expect(r.c.cardOpen).toBe('E2');
    clock = 3_000;
    r.c.submit('', { repeat: false });
    clock = 3_100;
    r.c.submit('', { repeat: false });
    expect(r.c.cardOpen).toBe('E3');
  });

  it('Esc within 400 ms of the last card advance (a double or held Esc) does not fill the hinted command (spec §5.3)', () => {
    let clock = 0;
    const r = rig({ now: () => clock });
    runSteps(r, 0, 7);
    clock = 10_000;
    r.c.submit(STEP(7)); // E1, E2, E3
    r.c.continueCard();
    r.c.continueCard(); // Continue clicks are never throttled; E3 is open
    clock = 10_500;
    r.c.escape({ repeat: false }); // closes E3
    expect(r.c.cardOpen).toBeNull();
    clock = 10_600;
    r.c.escape({ repeat: false }); // the second press of a double Esc, 100 ms later
    r.c.escape({ repeat: true }); // and a held key
    expect(r.term.prompt).toBe('');
    clock = 10_899;
    r.c.escape({ repeat: false });
    expect(r.term.prompt).toBe('');
    clock = 10_900; // 400 ms after the advance: Esc fills script[i] again
    r.c.escape({ repeat: false });
    expect(r.term.prompt).toBe(STEP(8));
  });

  it('a repeat Esc after the last card closed is ignored even outside the 400 ms window (a held key repeats after about 500 ms)', () => {
    let clock = 0;
    const r = rig({ now: () => clock });
    runSteps(r, 0, 7);
    clock = 10_000;
    r.c.submit(STEP(7));
    r.c.continueCard();
    r.c.continueCard();
    clock = 10_500;
    r.c.escape({ repeat: false }); // closes E3
    clock = 11_100;
    r.c.escape({ repeat: true }); // the first auto-repeat, 600 ms later
    expect(r.term.prompt).toBe('');
    r.c.escape({ repeat: false }); // a fresh press fills as usual
    expect(r.term.prompt).toBe(STEP(8));
  });

  it('a Tab listing that flushes the running log opens the step\'s held after-cards, after the plot', async () => {
    const r = rig();
    runSteps(r, 0, 7);
    r.term.holdPrints = true;
    r.c.submit(STEP(7)); // run_pca(period = "IronAge"): E1, E2, E3 wait for the log
    expect(r.term.isPrinting()).toBe(true);
    expect(r.c.cardOpen).toBeNull();
    expect(r.c.tab('run_')).toBe('run_'); // no longer common prefix: lists the options
    expect(r.term.isPrinting()).toBe(false);
    expect(r.c.cardOpen).toBe('E1');
    expect(r.cards.opens[r.cards.opens.length - 1]).toEqual({ id: 'E1', index: 0, count: 3, placement: 'after' });
    expect(r.term.hint).toBe(CARD_HINT);
    expect(r.events.lastIndexOf('render:pca')).toBeLessThan(r.events.indexOf('card:open:E1'));
    expect(r.c.screen).toEqual({ step: 8, card: 0 }); // not skipped: the cards are still ahead of the cursor
    const opens = r.cards.opens.length;
    await settle(r);
    expect(r.cards.opens).toHaveLength(opens); // the log's own end does not open them a second time
    r.c.continueCard();
    expect(r.c.cardOpen).toBe('E2');
  });

  it('a typed line clears the held flag (pendingAfterToken), so the cards of later steps still open', async () => {
    const r = rig();
    runSteps(r, 0, 7);
    r.term.holdPrints = true;
    r.c.submit(STEP(7)); // E1, E2, E3 held while the log prints
    r.c.submit('help()'); // typed during the log: flushes it and skips the held cards
    expect(r.c.screen).toEqual({ step: 8, card: 3 });
    r.term.holdPrints = false;
    runSteps(r, 8, 11);
    r.c.submit(STEP(11)); // roman: the after-card F1
    expect(r.c.cardOpen).toBe('F1');
    expect(r.cards.current).toBe('F1');
  });

  it('a skipped after-card leaves no held flag behind for the before-cards of a later step (the step in between has no cards)', () => {
    const r = rig();
    runSteps(r, 0, 12);
    r.term.holdPrints = true;
    r.c.submit(STEP(12)); // angloSaxon: G1, G2 held while the log prints
    r.c.submit('help()'); // typed line: the held cards are skipped
    expect(r.c.screen).toEqual({ step: 13, card: 2 });
    r.term.holdPrints = false;
    runSteps(r, 13, 14); // the finale has no cards, so nothing else touches the held flag
    r.c.submit(STEP(14)); // allele_freq(gene = "LCT"): before-cards open on acceptance, never waiting for a log
    expect(r.c.cardOpen).toBe('H1');
    expect(r.cards.current).toBe('H1');
    expect(r.term.hint).toBe(CARD_HINT);
  });

  it('an off-script command draws its plot but opens no card; the card opens when its step is reached', () => {
    const r = rig();
    r.c.submit('run_pca(period = "Roman")');
    expect(r.c.cardOpen).toBeNull();
    expect(r.cards.opens).toEqual([]);
    expect(r.renders[r.renders.length - 1]!.layers).toEqual(['Roman']);
    runSteps(r, 0, 11);
    r.c.submit(STEP(11));
    expect(r.c.cardOpen).toBe('F1');
  });

  it("running a step's command again after passing it never reopens its cards", () => {
    const r = rig();
    runSteps(r, 0, 4);
    const opens = r.cards.opens.length;
    r.c.submit(STEP(3));
    expect(r.c.cardOpen).toBeNull();
    expect(r.cards.opens).toHaveLength(opens);
  });

  it('card advances leave the three-tries counter alone', () => {
    const r = rig();
    runSteps(r, 0, 7);
    r.c.submit(STEP(7));
    r.c.submit('');
    r.c.escape();
    r.c.continueCard();
    expect(r.c.badTries).toBe(0);
    r.c.submit('oops');
    r.c.submit('oops');
    expect(r.c.badTries).toBe(2);
    expect(r.term.prompt).toBe('');
  });

  it('during the finale animation a blank Enter jumps to the final frame, and so does a new command', () => {
    let animating = true;
    const finish = vi.fn(() => {
      animating = false;
    });
    const r = rig({ plotAnimating: () => animating, finishPlotAnimation: finish });
    r.c.submit('');
    expect(finish).toHaveBeenCalledTimes(1);
    animating = true;
    r.c.submit('load_genomes()');
    expect(finish).toHaveBeenCalledTimes(2);
    r.c.submit('');
    expect(finish).toHaveBeenCalledTimes(2);
  });

  it('without a card host the card state is still tracked', () => {
    const r = rig({ cards: false });
    runSteps(r, 0, 7);
    r.c.submit(STEP(7));
    expect(r.c.cardOpen).toBe('E1');
    expect(r.term.hint).toBe(CARD_HINT);
    expect(r.cards.opens.length).toBe(0);
    closeCards(r.c);
    expect(r.c.cardOpen).toBeNull();
  });

  it('onScreen reports every cursor change with canGoBack', () => {
    const seen: string[] = [];
    const r = rig({ onScreen: (s, back) => seen.push(`${s.step}.${s.card}:${back}`) });
    expect(seen).toEqual(['0.0:false']);
    r.c.submit(STEP(0));
    expect(seen[seen.length - 1]).toBe('1.0:true');
    runSteps(r, 1, 7);
    r.c.submit(STEP(7));
    r.c.continueCard();
    expect(seen[seen.length - 1]).toBe('8.1:true');
  });
});

describe('openCardForTest (the ?test hook, spec §5.4, CONTRACT §4.9)', () => {
  /** Everything a card could change if it were part of the session: step, cursor, hint index, transcript, plot, saved entry. */
  const snapshot = (r: Rig): string =>
    JSON.stringify([r.c.session, r.c.derived, r.c.screen, r.c.hintIndex, r.renders.length, loadSession(r.store)]);

  it('shows card 1 of 1 and the card hint, and changes no step, cursor, hint index, transcript, plot or saved session', () => {
    const screens: string[] = [];
    const r = rig({ onScreen: (s, back) => screens.push(`${s.step}.${s.card}:${back}`) });
    runSteps(r, 0, 2);
    expect(r.term.hint).toBe(hintText(2, SCRIPT[1]!, 0));
    const before = snapshot(r);
    const calls = screens.length;
    r.c.openCardForTest('L3');
    expect(r.cards.opens[r.cards.opens.length - 1]).toEqual({ id: 'L3', index: 0, count: 1, placement: 'after' });
    expect(r.c.cardOpen).toBe('L3');
    expect(r.term.hint).toBe(CARD_HINT);
    expect(snapshot(r)).toBe(before);
    expect(screens).toHaveLength(calls); // the cursor did not move, so the shell is told nothing
  });

  it('Continue, a blank Enter and Esc each close it and bring the step hint back; Esc does not fill the prompt', () => {
    const closers: [string, (c: Rig['c']) => void][] = [
      ['continueCard', (c) => c.continueCard()],
      ['blank Enter', (c) => c.submit('')],
      ['Esc', (c) => c.escape()],
    ];
    for (const [name, close] of closers) {
      const r = rig();
      runSteps(r, 0, 2);
      const before = snapshot(r);
      r.c.openCardForTest('A1');
      close(r.c);
      expect(r.c.cardOpen, name).toBeNull();
      expect(r.cards.current, name).toBeNull();
      expect(r.term.hint, name).toBe(hintText(2, SCRIPT[1]!, 0));
      expect(r.term.prompt, name).toBe('');
      expect(snapshot(r), name).toBe(before);
    }
  });

  it('opening and closing it writes nothing to the session store and does not arm the card repeat guard', () => {
    let clock = 5_000;
    const r = rig({ now: () => clock });
    runSteps(r, 0, 2);
    const writes: string[] = [];
    const setItem = r.store!.setItem.bind(r.store);
    r.store!.setItem = (k, v) => {
      writes.push(k);
      setItem(k, v);
    };
    r.c.openCardForTest('A1');
    r.c.continueCard();
    r.c.openCardForTest('B1');
    r.c.submit('');
    expect(writes).toEqual([]);
    r.c.escape({ repeat: false }); // no card is open and none was advanced: Esc fills the hinted command at once
    expect(r.term.prompt).toBe(STEP(2));
  });

  it('a blank Enter only closes it: it does not also end a running finale animation', () => {
    let animating = true;
    const finish = vi.fn(() => {
      animating = false;
    });
    const r = rig({ plotAnimating: () => animating, finishPlotAnimation: finish });
    r.c.openCardForTest('A1');
    r.c.submit('');
    expect(r.c.cardOpen).toBeNull();
    expect(finish).not.toHaveBeenCalled();
    r.c.submit('');
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('closing it is not a card advance: the repeat guard does not apply, and the three-tries counter is untouched', () => {
    let clock = 5_000;
    const r = rig({ now: () => clock });
    r.c.submit('oops');
    expect(r.c.badTries).toBe(1);
    r.c.openCardForTest('B1');
    r.c.escape({ repeat: false }); // no 400 ms wait for a test card
    expect(r.c.cardOpen).toBeNull();
    expect(r.c.badTries).toBe(1);
    r.c.openCardForTest('B1');
    clock += 1;
    r.c.submit('', { repeat: true });
    expect(r.c.cardOpen).toBeNull();
  });

  it('Enter with text closes it, then runs the line as usual (a bad line counts as a try)', () => {
    const r = rig();
    r.c.openCardForTest('A1');
    r.c.submit('oops');
    expect(r.c.cardOpen).toBeNull();
    expect(r.cards.current).toBeNull();
    expect(r.c.badTries).toBe(1);
    expect(r.c.session.history).toEqual(['oops']);
    expect(r.term.hint).toBe(hintText(0, null, 0));
    r.c.openCardForTest('A1');
    r.c.submit(STEP(0));
    expect(r.c.cardOpen).toBeNull();
    expect(r.c.hintIndex).toBe(1);
  });

  it('an unknown id is ignored', () => {
    const r = rig();
    const before = snapshot(r);
    r.c.openCardForTest('Z9' as never);
    expect(r.cards.opens).toEqual([]);
    expect(r.c.cardOpen).toBeNull();
    expect(snapshot(r)).toBe(before);
  });

  it('is ignored while a real card is open, and while a step\'s after-cards still wait for their log', () => {
    const r = rig();
    runSteps(r, 0, 7);
    r.term.holdPrints = true;
    r.c.submit(STEP(7)); // E1, E2, E3 held
    r.c.openCardForTest('L3');
    expect(r.cards.opens.filter((o) => o.id === 'L3')).toEqual([]);
    expect(r.c.cardOpen).toBeNull();
    r.term.flush();
    r.c.tab('run_'); // a Tab listing opens the held cards
    expect(r.c.cardOpen).toBe('E1');
    r.c.openCardForTest('L3');
    expect(r.c.cardOpen).toBe('E1');
    expect(r.cards.current).toBe('E1');
    expect(r.cards.opens.filter((o) => o.id === 'L3')).toEqual([]);
  });

  it('a second test card replaces the first; one Continue closes it', () => {
    const r = rig();
    r.c.openCardForTest('A1');
    r.c.openCardForTest('B1');
    expect(r.c.cardOpen).toBe('B1');
    expect(r.cards.current).toBe('B1');
    r.c.continueCard();
    expect(r.c.cardOpen).toBeNull();
    expect(r.cards.current).toBeNull();
  });

  it('works with no card host and with a card host that throws (the controller never throws into the page)', () => {
    const none = rig({ cards: false });
    none.c.openCardForTest('A1');
    expect(none.c.cardOpen).toBe('A1');
    expect(none.term.hint).toBe(CARD_HINT);
    none.c.continueCard();
    expect(none.c.cardOpen).toBeNull();
    const r = rig();
    r.cards.open = () => {
      throw new Error('boom');
    };
    expect(() => r.c.openCardForTest('A1')).not.toThrow();
    expect(() => r.c.continueCard()).not.toThrow();
    expect(r.c.cardOpen).toBeNull();
  });
});

describe('Tab completion', () => {
  it('completeLine accepts full-line or token completions', () => {
    expect(completeLine('run_p', 'run_pca(')).toBe('run_pca(');
    expect(completeLine('RUN_P', 'run_pca(')).toBe('run_pca(');
    expect(completeLine('run_pca(period = "Iro', 'IronAge')).toBe('run_pca(period = "IronAge');
    expect(completeLine('run_pca(period = "Iro', '"IronAge"')).toBe('run_pca(period = "IronAge"');
    expect(completeLine('run_pca(period = "Iro', 'run_pca(period = "IronAge")')).toBe('run_pca(period = "IronAge")');
    expect(completeLine('allele_freq(gene = HE', 'HERC2')).toBe('allele_freq(gene = HERC2');
    expect(completeLine('', 'help()')).toBe('help()');
  });

  it('completeLine keeps a copied prompt or hint label in front and completes what follows it', () => {
    expect(completeLine('> run_pca(period = "Iro', 'run_pca(period = "IronAge")')).toBe('> run_pca(period = "IronAge")');
    expect(completeLine('Next: run_pca(period = "Iro', 'run_pca(period = "IronAge")')).toBe('Next: run_pca(period = "IronAge")');
    expect(completeLine('Try an extra: allele_freq(gene = "H', 'allele_freq(gene = "HERC2")')).toBe('Try an extra: allele_freq(gene = "HERC2")');
    expect(completeLine('> > Next: ru', 'run_pca(period = "')).toBe('> > Next: run_pca(period = "');
    expect(completeLine('Next: ', 'help()')).toBe('Next: help()');
    expect(completeLine('next:run_p', 'run_pca(period = "')).toBe('next:run_pca(period = "');
    expect(completeLine('Next: run_pca(period = "Iro', 'IronAge')).toBe('Next: run_pca(period = "IronAge');
  });

  it('completes a command name and an argument value', () => {
    const r = rig();
    expect(r.c.tab('run_p').toLowerCase().startsWith('run_pca')).toBe(true);
    const out = r.c.tab('run_pca(period = "Iro');
    expect(out.startsWith('run_pca(period = "')).toBe(true);
    expect(out).toContain('IronAge');
  });

  it('Tab after a prompt or hint label completes the command after it, keeping what the student typed in front', () => {
    const r = rig();
    expect(r.c.tab('Next: run_pca(period = "Iro')).toBe('Next: run_pca(period = "IronAge")');
    expect(r.c.tab('Try an extra: run_pca(period = "Vik')).toBe('Try an extra: run_pca(period = "Viking")');
    expect(r.c.tab('> > help')).toBe('> > help()');
    expect(r.c.tab('Next: allele_freq(gene = "H')).toBe('Next: allele_freq(gene = "H');
    expect(r.term.output.join(' ')).toContain('allele_freq(gene = "HERC2")');
  });

  it('leaves unknown text alone, lists the options when there is no longer common prefix, and saves the listing', () => {
    const r = rig();
    expect(r.c.tab('zzzz')).toBe('zzzz');
    expect(r.c.tab('run_').toLowerCase()).toBe('run_');
    const said = r.term.output.join(' ');
    expect(said).toContain('run_pca');
    expect(said).toContain('run_admixture');
    expect(loadSession(r.store)?.transcript.some((e) => e.text.includes('run_admixture'))).toBe(true);
  });

  it('never throws on huge or odd input', () => {
    const r = rig();
    expect(() => r.c.tab('x'.repeat(2000))).not.toThrow();
    expect(() => r.c.tab('run_pca(period = "')).not.toThrow();
    expect(() => r.c.tab('"""')).not.toThrow();
  });
});

describe('Enter during printing (spec v2.1 §4.2, unchanged)', () => {
  it('flushes the running log, applies its plot, then runs the new command', async () => {
    const r = rig();
    r.term.holdPrints = true;
    r.c.submit('run_pca(period = "FirstFarmers")'); // off-script at step 0: no card
    expect(r.term.isPrinting()).toBe(true);
    expect(r.renders).toHaveLength(1);
    r.c.submit('run_pca(period = "IronAge")');
    const renderA = r.events.indexOf('render:pca');
    const echoB = r.events.indexOf('echo:run_pca(period = "IronAge")');
    expect(renderA).toBeGreaterThan(-1);
    expect(renderA).toBeLessThan(echoB);
    expect(r.renders).toHaveLength(2);
    expect(r.renders[1]!.frame).toBe('europe');
    expect(r.renders[1]!.layers).not.toContain('IronAge');
    await flushMicrotasks();
    expect(r.renders).toHaveLength(2);
    await settle(r);
    expect(r.renders).toHaveLength(3);
    expect(r.renders[2]!.frame).toBe('britain');
    expect(r.renders[2]!.layers).toContain('IronAge');
  });

  it('applies the plot when the log finishes on its own', async () => {
    const r = rig();
    r.term.holdPrints = true;
    r.c.submit('allele_freq(gene = "LCT")'); // off-script at step 0: no before-cards
    expect(r.renders).toHaveLength(1);
    expect(r.c.cardOpen).toBeNull();
    await settle(r);
    expect(r.renders).toHaveLength(2);
    expect(r.renders[1]!.gene).toBe('LCT');
  });

  it('a bad command mid-print still lands after the previous plot', () => {
    const r = rig();
    r.term.holdPrints = true;
    r.c.submit('run_pca(period = "Roman")');
    r.c.submit('run_pca(period = "Rome!!")');
    expect(r.events.indexOf('render:pca')).toBeLessThan(r.events.indexOf('echo:run_pca(period = "Rome!!")'));
    expect(r.c.badTries).toBe(1);
  });

  it('Esc and a single Tab completion mid-print do not disturb the log', () => {
    const r = rig();
    r.term.holdPrints = true;
    r.c.submit('load_genomes()');
    r.c.escape();
    expect(r.term.isPrinting()).toBe(true);
    expect(r.term.prompt).toBe(STEP(0));
    r.c.tab('run_p');
    expect(r.term.isPrinting()).toBe(true);
  });

  it('blank input mid-print is ignored completely: the log keeps printing; nothing is drawn, recorded or counted', async () => {
    const r = rig();
    r.term.holdPrints = true;
    r.c.submit('run_pca(period = "Today")');
    const events = [...r.events];
    const hint = r.term.hint;
    const saved = r.c.session;
    for (const blank of ['', '    ', '\t']) r.c.submit(blank);
    expect(r.term.isPrinting()).toBe(true);
    expect(r.events).toEqual(events);
    expect(r.term.hint).toBe(hint);
    expect(r.c.session).toEqual(saved);
    expect(r.c.badTries).toBe(0);
    await settle(r);
    expect(r.renders).toHaveLength(2);
    expect(r.renders[1]!.layers).toContain('Today');
  });

  it('the session saved mid-print already holds the new step', () => {
    const r = rig();
    r.term.holdPrints = true;
    r.c.submit('run_pca(period = "AngloSaxon")');
    const saved = loadSession(r.store)!;
    expect(saved.steps.map((s) => s.cmd)).toEqual(['run_pca(period = "AngloSaxon")']);
    expect(rig({ restored: saved }).c.derived.plot.showNorthSea).toBe(true);
  });
});

describe('fault isolation', () => {
  it('a throwing renderPlot never breaks the terminal', () => {
    const term = new FakeTerminal([]);
    const c = new Controller(
      { data, terminal: term, renderPlot: () => { throw new Error('svg failed'); }, store: null },
      null,
    );
    expect(() => c.submit('run_pca(period = "Today")')).not.toThrow();
    expect(() => c.submit(STEP(0))).not.toThrow();
    expect(c.hintIndex).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });

  it('a throwing card host never breaks the terminal', () => {
    const term = new FakeTerminal([]);
    const c = new Controller(
      {
        data, terminal: term, renderPlot: () => undefined, store: null,
        cards: { open: () => { throw new Error('card failed'); }, close: () => { throw new Error('card failed'); } },
      },
      null,
    );
    for (let k = 0; k < 3; k += 1) expect(() => c.submit(STEP(k))).not.toThrow();
    expect(c.cardOpen).toBe('A1');
    expect(() => c.continueCard()).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });

  it('a command that throws prints a friendly line and does not count', async () => {
    vi.resetModules();
    vi.doMock('../src/commands', () => ({
      execute: () => {
        throw new Error('bad data');
      },
    }));
    try {
      const mod = await import('../src/controller');
      const term = new FakeTerminal([]);
      const c = new mod.Controller({ data, terminal: term, renderPlot: () => undefined, store: null }, null);
      expect(() => c.submit('load_genomes()')).not.toThrow();
      expect(term.output).toEqual([mod.INTERNAL_ERROR_LINE]);
      expect(c.badTries).toBe(0);
      expect(c.hintIndex).toBe(0);
      expect(c.session.steps).toEqual([]);
      expect(console.error).toHaveBeenCalled();
    } finally {
      vi.doUnmock('../src/commands');
      vi.resetModules();
    }
  });

  it('broken data never escapes submit and never shows the error text', () => {
    const broken = new Proxy({} as WorkshopData, {
      get() {
        throw new Error('bad data');
      },
    });
    const term = new FakeTerminal([]);
    const c = new Controller({ data: broken, terminal: term, renderPlot: () => undefined, store: null }, null);
    expect(() => c.submit('load_genomes()')).not.toThrow();
    expect(term.output.length).toBeGreaterThan(0);
    expect(term.output.some((l) => l.includes('bad data'))).toBe(false);
    expect(c.badTries).toBe(0);
  });
});

describe('with the real DOM terminal and fake timers', () => {
  function wire(): { c: Controller; input: HTMLInputElement; out: HTMLElement; renders: PlotState[] } {
    document.body.innerHTML = '<div id="t"></div>';
    const root = document.getElementById('t') as HTMLElement;
    const renders: PlotState[] = [];
    let c: Controller | null = null;
    const view = mountTerminal(root, {
      onEnter: (l) => c?.submit(l),
      onEsc: () => c?.escape(),
      onTab: (p) => (c ? c.tab(p) : p),
    });
    c = new Controller({ data, terminal: view, renderPlot: (p) => renders.push(p), store: memStore() }, null);
    return {
      c,
      input: root.querySelector('.term-input') as HTMLInputElement,
      out: root.querySelector('.term-out') as HTMLElement,
      renders,
    };
  }
  const type = (input: HTMLInputElement, text: string, k = 'Enter'): void => {
    input.value = text;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  };
  const lines = (out: HTMLElement): string[] => Array.from(out.children).map((c) => c.textContent ?? '');

  it('Enter mid-print keeps log lines and plots in command order', async () => {
    vi.useFakeTimers();
    const w = wire();
    type(w.input, 'run_pca(period = "FirstFarmers")');
    const printedSoFar = lines(w.out).length;
    type(w.input, 'run_pca(period = "IronAge")');
    const all = lines(w.out);
    expect(all.indexOf('> run_pca(period = "IronAge")')).toBeGreaterThan(printedSoFar - 1);
    expect(all[0]).toBe('> run_pca(period = "FirstFarmers")');
    expect(w.renders).toHaveLength(2);
    expect(w.renders[1]!.frame).toBe('europe');
    await vi.runAllTimersAsync();
    expect(w.renders).toHaveLength(3);
    expect(w.renders[2]!.frame).toBe('britain');
  });

  it('a staggered command log finishes within 3 s and the transcript matches the screen', async () => {
    vi.useFakeTimers();
    const w = wire();
    type(w.input, 'load_genomes()');
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.c.session.transcript.filter((l) => l.kind === 'output').map((l) => l.text)).toEqual(lines(w.out).slice(1));
  });

  it("a guided step's after-card opens when the real staggered log ends", async () => {
    vi.useFakeTimers();
    const w = wire();
    type(w.input, STEP(0));
    await vi.runAllTimersAsync();
    type(w.input, STEP(1));
    await vi.runAllTimersAsync();
    type(w.input, STEP(2));
    expect(w.c.cardOpen).toBeNull();
    await vi.runAllTimersAsync();
    expect(w.c.cardOpen).toBe('A1');
  });

  it('three bad tries by keyboard fill the prompt; Enter then runs it', async () => {
    vi.useFakeTimers();
    const w = wire();
    type(w.input, 'qwerty');
    type(w.input, 'run_pca(period = "Jurassic")');
    type(w.input, '!!!');
    expect(w.input.value).toBe(STEP(0));
    type(w.input, w.input.value);
    await vi.runAllTimersAsync();
    expect(w.c.hintIndex).toBe(1);
    expect(w.c.badTries).toBe(0);
  });

  it('Esc and ArrowUp work from the keyboard', () => {
    vi.useFakeTimers();
    const w = wire();
    type(w.input, '', 'Escape');
    expect(w.input.value).toBe(STEP(0));
    type(w.input, 'help()');
    type(w.input, '', 'ArrowUp');
    expect(w.input.value).toBe('help()');
  });
});

// The two Task 4 controller tests that the v3 rewrite of this file would otherwise drop.
describe('v3 script wiring through the controller (kept from Task 4)', () => {
  it('passes whether Britain today is shown to execute: the Europe and ADMIXTURE lines follow the plot', () => {
    const r = rig();
    r.c.submit('run_pca(period = "Europe")');
    r.c.submit('run_admixture(K = 3)');
    expect(r.term.output).toContain(EUROPE_HELD_BACK);
    expect(r.term.output).toContain(ADMIX_TODAY_HIDDEN);
    expect(r.term.output).not.toContain(EUROPE_ALREADY_SHOWN);
    r.c.submit('run_pca(period = "Today")');
    r.c.submit('run_pca(period = "Europe")');
    r.c.submit('run_admixture(K = 3)');
    expect(r.term.output).toContain(EUROPE_ALREADY_SHOWN);
    expect(r.term.output).toContain(ADMIX_TODAY_SHOWN);
  });

  it('the guided script runs to the end through the controller: every step is logged, no bad tries', () => {
    const r = rig();
    runSteps(r, 0, SCRIPT.length);
    expect(r.c.hintIndex).toBe(SCRIPT.length);
    expect(r.c.badTries).toBe(0);
    expect(r.c.session.steps.map((s) => s.cmd)).toEqual(SCRIPT.map((c) => formatCommand(c)));
  });
});
