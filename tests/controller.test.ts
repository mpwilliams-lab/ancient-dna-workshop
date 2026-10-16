// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtureJson from './fixtures/data.fixture.json';
import type { WorkshopData } from '../src/types';
import {
  Controller,
  AUTOFILL_NOTE,
  INTERNAL_ERROR_LINE,
  MAX_BAD_TRIES,
  CONTROLLER_STRINGS,
  didYouMean,
  completeLine,
} from '../src/controller';
import { mountTerminal, type TerminalView } from '../src/terminal';
import { formatCommand } from '../src/parser';
import { SCRIPT, EXTRAS } from '../src/hints';
import { INITIAL_PLOT, type PlotState } from '../src/plotState';
import { loadSession, type Session, type SessionStorageLike } from '../src/session';
import { RESTORED_NOTICE } from '../src/content';
import { ruleViolations } from './contentRules';

const data = fixtureJson as unknown as WorkshopData;

/** Records every terminal call into a shared event log. With holdPrints, staggered prints stay "printing" until flush(). */
class FakeTerminal implements TerminalView {
  hint = '';
  prompt = '';
  history: string[] = [];
  holdPrints = false;
  private printing: { lines: string[]; resolve: () => void } | null = null;
  constructor(readonly events: string[]) {}
  printLines(lines: string[], opts?: { stagger?: boolean }): Promise<void> {
    if (this.printing) this.flush();
    if (opts?.stagger && this.holdPrints && lines.length > 0) {
      return new Promise<void>((resolve) => {
        this.printing = { lines, resolve };
      });
    }
    for (const l of lines) this.events.push(`out:${l}`);
    return Promise.resolve();
  }
  flush(): void {
    const p = this.printing;
    if (!p) return;
    this.printing = null;
    for (const l of p.lines) this.events.push(`out:${l}`);
    p.resolve();
  }
  isPrinting(): boolean {
    return this.printing !== null;
  }
  echoInput(text: string): void {
    this.events.push(`echo:${text}`);
  }
  setHint(text: string): void {
    this.hint = text;
  }
  fillPrompt(text: string): void {
    this.prompt = text;
  }
  clearScreen(): void {
    this.events.push('clear');
  }
  notice(text: string): void {
    this.events.push(`notice:${text}`);
  }
  setHistory(lines: string[]): void {
    this.history = [...lines];
  }
  get output(): string[] {
    return this.events.filter((e) => e.startsWith('out:')).map((e) => e.slice(4));
  }
}

function memStore(): SessionStorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

const blockedStore: SessionStorageLike = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('quota', 'QuotaExceededError');
  },
  removeItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
};

interface Rig {
  c: Controller;
  term: FakeTerminal;
  events: string[];
  renders: PlotState[];
  store: SessionStorageLike & { map: Map<string, string> };
}

function rig(restored: Session | null = null, store = memStore()): Rig {
  const events: string[] = [];
  const renders: PlotState[] = [];
  const term = new FakeTerminal(events);
  const c = new Controller(
    {
      data,
      terminal: term,
      renderPlot: (p) => {
        renders.push(p);
        events.push(`render:${p.view}`);
      },
      store,
    },
    restored,
  );
  return { c, term, events, renders, store };
}

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const STEP = (k: number): string => formatCommand(SCRIPT[k]);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Controller start-up', () => {
  it('renders the initial plot once and shows the first hint', () => {
    const r = rig();
    expect(r.renders).toEqual([INITIAL_PLOT]);
    expect(r.c.hintIndex).toBe(0);
    expect(r.c.badTries).toBe(0);
    expect(r.term.hint).toContain(STEP(0));
    expect(r.events.filter((e) => e.startsWith('notice:'))).toEqual([]);
  });

  it('exports its on-screen strings for the §6 content scan', () => {
    expect(MAX_BAD_TRIES).toBe(3);
    expect(CONTROLLER_STRINGS).toContain(AUTOFILL_NOTE);
    expect(CONTROLLER_STRINGS).toContain(INTERNAL_ERROR_LINE);
    expect(didYouMean('run_pca()')).toBe('Did you mean run_pca()?');
  });

  it('every controller on-screen string passes the §6 content rules', () => {
    expect(CONTROLLER_STRINGS.length).toBe(3);
    for (const s of CONTROLLER_STRINGS) expect(ruleViolations(s), s).toEqual([]);
    // did-you-mean is shown with a real command filled in; check every command the hints can suggest.
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
    expect(r.c.session.plot.view).toBe('pca');
    expect(r.c.session.plot.layers).toContain('IronAge');
    expect(r.c.session.plot.frame).toBe('britain');
  });

  it('resolves aliases through the controller', () => {
    const r = rig();
    r.c.submit('run_pca(period = "romans")');
    expect(r.c.session.plot.layers).toContain('Roman');
    r.c.submit('allele_freq(gene = "lactase")');
    expect(r.c.session.plot.view).toBe('trait');
    expect(r.c.session.plot.gene).toBe('LCT');
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
    expect(r.c.badTries).toBe(1);
    expect(r.renders).toHaveLength(1);
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
    expect(r.c.session.plot).toEqual(INITIAL_PLOT);
    expect(r.renders).toHaveLength(1);
  });

  const JUNK = [
    ')))(((',
    '"',
    "'",
    'run_pca(',
    'run_pca(period=)',
    'run_pca(period = "")',
    'run_pca(period = "IronAge"',
    'allele_freq(gene = )',
    '()',
    '=',
    ',,,,',
    'NaN',
    'undefined',
    'null',
    '__proto__',
    'constructor',
    'run_pca(period = "__proto__")',
    'run_admixture(K = "three")',
    'run_admixture(K = Infinity)',
    'drop table students;',
    '<script>alert(1)</script>',
    '\u0000\u0001\u0002',
    '💥🧬',
    'ancestry_test(person = "all")',
    '\\',
    '${process}',
  ];

  it('junk never crashes and never shows a stack trace', () => {
    const r = rig();
    for (const j of JUNK) expect(() => r.c.submit(j)).not.toThrow();
    const said = r.term.output.join('\n');
    expect(said.length).toBeGreaterThan(0);
    expect(said).not.toMatch(/TypeError|ReferenceError|RangeError|SyntaxError|\[object |\n\s+at /);
    expect(() => r.c.submit(undefined as unknown as string)).not.toThrow();
    expect(() => r.c.submit(42 as unknown as string)).not.toThrow();
  });

  it('blank input does nothing and does not count', () => {
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
    expect(r.c.session.history[0].length).toBe(201);
    expect(r.c.session.plot).toEqual(INITIAL_PLOT);
    expect(() => r.c.submit('a'.repeat(2000))).not.toThrow();
    expect(r.c.badTries).toBe(2);
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
    r.c.submit(STEP(0));
    r.c.submit(STEP(1));
    expect(r.c.hintIndex).toBe(2);
    for (let k = 0; k < MAX_BAD_TRIES; k++) r.c.submit('nope');
    expect(r.term.prompt).toBe(STEP(2));
  });

  it('a friendly refusal (K = 4) is not an incorrect try', () => {
    const r = rig();
    r.c.submit('bad1');
    r.c.submit('run_admixture(K = 4)');
    expect(r.term.output.join('\n')).toContain('K = 3');
    r.c.submit('bad2');
    expect(r.c.badTries).toBe(2);
    expect(r.term.prompt).toBe('');
    r.c.submit('bad3');
    expect(r.term.prompt).toBe(STEP(0));
  });

  it('a refusal neither draws nor moves the hint pointer', () => {
    const r = rig();
    for (let k = 0; k < 5; k++) r.c.submit(STEP(k));
    expect(SCRIPT[5]).toEqual({ name: 'run_admixture', K: 3 });
    const before = r.c.session.plot;
    r.c.submit('run_admixture(K = 4)');
    expect(r.c.hintIndex).toBe(5);
    expect(r.c.session.plot).toEqual(before);
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
    for (let k = 0; k < 4; k++) r.c.submit(STEP(k));
    expect(SCRIPT[3]).toEqual({ name: 'run_pca', period: 'FirstFarmers' });
    expect(r.term.hint).toMatch(/^Predict:/);
    r.c.escape();
    expect(r.term.prompt).toBe('run_pca(period = "BellBeaker")');
  });

  it('after the last step, Esc inserts the extra the hint line shows', () => {
    const r = rig();
    for (let k = 0; k < SCRIPT.length; k++) r.c.submit(STEP(k));
    expect(r.c.hintIndex).toBe(SCRIPT.length);
    r.c.escape();
    expect(EXTRAS.map((e) => formatCommand(e))).toContain(r.term.prompt);
    expect(r.term.hint).toContain(r.term.prompt);
    const first = r.term.prompt;
    r.c.submit('help()');
    r.c.escape();
    expect(r.term.hint).toContain(r.term.prompt);
    expect(r.term.prompt).not.toBe(first);
  });
});

describe('hint pointer and plot wiring', () => {
  it('advances only on script[i]; other valid commands run but leave i', () => {
    const r = rig();
    r.c.submit(STEP(3));
    expect(r.c.hintIndex).toBe(0);
    expect(r.c.session.plot.layers).toContain('FirstFarmers');
    r.c.submit(STEP(0));
    expect(r.c.hintIndex).toBe(1);
    expect(r.term.hint).toContain(STEP(1));
    r.c.submit(STEP(0));
    expect(r.c.hintIndex).toBe(1);
  });

  it('renders the reduced plot after each drawing command, not after text-only ones', () => {
    const r = rig();
    r.c.submit('load_genomes()');
    r.c.submit('ancestry_test(person = "me")');
    expect(r.renders).toHaveLength(1);
    r.c.submit('run_pca(period = "Roman")');
    r.c.submit('run_pca(period = "BellBeaker")');
    expect(r.renders).toHaveLength(3);
    expect(r.renders[1].frame).toBe('britain');
    expect(r.renders[2].frame).toBe('europe');
    expect(r.renders[2].layers).toEqual(expect.arrayContaining(['Roman', 'BellBeaker']));
    r.c.submit('run_admixture(K = 3)');
    expect(r.renders[3].view).toBe('admixture');
  });

  it('clear() clears the screen and transcript, not the plot', () => {
    const r = rig();
    r.c.submit('run_pca(period = "Today")');
    const plot = r.c.session.plot;
    r.c.submit('clear()');
    expect(r.events).toContain('clear');
    expect(r.c.session.transcript).toEqual([]);
    expect(r.c.session.plot).toEqual(plot);
    expect(r.renders).toHaveLength(2);
  });

  it('records history (bad tries included) and the transcript', () => {
    const r = rig();
    r.c.submit('help()');
    r.c.submit('oops');
    r.c.submit('load_genomes()');
    expect(r.c.session.history).toEqual(['help()', 'oops', 'load_genomes()']);
    const inputs = r.c.session.transcript.filter((l) => l.kind === 'input').map((l) => l.text);
    expect(inputs).toEqual(['help()', 'oops', 'load_genomes()']);
    expect(r.c.session.transcript.filter((l) => l.kind === 'output').length).toBeGreaterThan(3);
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

  it('completes a command name', () => {
    const r = rig();
    expect(r.c.tab('run_p').toLowerCase().startsWith('run_pca')).toBe(true);
  });

  it('completes an argument value inside the call', () => {
    const r = rig();
    const out = r.c.tab('run_pca(period = "Iro');
    expect(out.startsWith('run_pca(period = "')).toBe(true);
    expect(out).toContain('IronAge');
  });

  it('leaves unknown text alone', () => {
    const r = rig();
    expect(r.c.tab('zzzz')).toBe('zzzz');
  });

  it('lists the options when there is no longer common prefix', () => {
    const r = rig();
    expect(r.c.tab('run_').toLowerCase()).toBe('run_');
    const said = r.term.output.join(' ');
    expect(said).toContain('run_pca');
    expect(said).toContain('run_admixture');
  });

  it('never throws on huge or odd input', () => {
    const r = rig();
    expect(() => r.c.tab('x'.repeat(2000))).not.toThrow();
    expect(() => r.c.tab('run_pca(period = "')).not.toThrow();
    expect(() => r.c.tab('"""')).not.toThrow();
  });
});

describe('Enter during printing (spec §4.2)', () => {
  it('flushes the running log, applies its plot, then runs the new command', async () => {
    const r = rig();
    r.term.holdPrints = true;
    r.c.submit('run_pca(period = "Today")');
    expect(r.term.isPrinting()).toBe(true);
    expect(r.renders).toHaveLength(1);
    r.c.submit('run_pca(period = "IronAge")');
    const renderA = r.events.indexOf('render:pca');
    const echoB = r.events.indexOf('echo:run_pca(period = "IronAge")');
    expect(renderA).toBeGreaterThan(-1);
    expect(renderA).toBeLessThan(echoB);
    const lastLineOfA = r.events.slice(0, echoB).filter((e) => e.startsWith('out:'));
    expect(lastLineOfA.length).toBeGreaterThan(0);
    expect(r.renders).toHaveLength(2);
    expect(r.renders[1].frame).toBe('europe');
    expect(r.renders[1].layers).not.toContain('IronAge');
    await flushMicrotasks();
    expect(r.renders).toHaveLength(2);
    r.term.flush();
    await flushMicrotasks();
    expect(r.renders).toHaveLength(3);
    expect(r.renders[2].frame).toBe('britain');
    expect(r.renders[2].layers).toContain('IronAge');
  });

  it('applies the plot when the log finishes on its own', async () => {
    const r = rig();
    r.term.holdPrints = true;
    r.c.submit('allele_freq(gene = "LCT")');
    expect(r.renders).toHaveLength(1);
    r.term.flush();
    await flushMicrotasks();
    expect(r.renders).toHaveLength(2);
    expect(r.renders[1].gene).toBe('LCT');
  });

  it('a bad command mid-print still lands after the previous plot', () => {
    const r = rig();
    r.term.holdPrints = true;
    r.c.submit('run_pca(period = "Roman")');
    r.c.submit('run_pca(period = "Rome!!")');
    expect(r.events.indexOf('render:pca')).toBeLessThan(r.events.indexOf('echo:run_pca(period = "Rome!!")'));
    expect(r.c.badTries).toBe(1);
  });

  it('Esc and Tab mid-print do not disturb the log', () => {
    const r = rig();
    r.term.holdPrints = true;
    r.c.submit('load_genomes()');
    r.c.escape();
    expect(r.term.isPrinting()).toBe(true);
    expect(r.term.prompt).toBe(STEP(0));
    r.c.tab('run_p');
    expect(r.term.isPrinting()).toBe(true);
  });

  it('the session saved mid-print already holds the new plot', () => {
    const r = rig();
    r.term.holdPrints = true;
    r.c.submit('run_pca(period = "AngloSaxon")');
    const saved = loadSession(r.store) as Session;
    expect(saved.plot.layers).toContain('AngloSaxon');
    expect(saved.plot.showNorthSea).toBe(true);
  });
});

describe('session save and restore (RF4)', () => {
  it('saves after every command, including incorrect tries', () => {
    const r = rig();
    r.c.submit(STEP(0));
    expect(loadSession(r.store)?.hintIndex).toBe(1);
    r.c.submit('garbage');
    expect(loadSession(r.store)?.history).toEqual([STEP(0), 'garbage']);
  });

  it('works with blocked storage and with no storage', () => {
    for (const store of [blockedStore, null]) {
      const events: string[] = [];
      const term = new FakeTerminal(events);
      const c = new Controller({ data, terminal: term, renderPlot: () => undefined, store }, null);
      expect(() => {
        c.submit(STEP(0));
        c.submit('junk');
        c.escape();
      }).not.toThrow();
      expect(c.hintIndex).toBe(1);
    }
  });

  it('restores transcript, history, hint pointer and plot, and never prints RESTORED_NOTICE (the shell does)', () => {
    const a = rig();
    a.c.submit(STEP(0));
    a.c.submit(STEP(1));
    a.c.submit('run_pca(period = "Roman")');
    const saved = loadSession(a.store);
    expect(saved).not.toBeNull();
    const b = rig(saved, a.store);
    expect(b.c.hintIndex).toBe(2);
    expect(b.renders).toEqual([saved!.plot]);
    expect(b.term.history).toEqual([STEP(0), STEP(1), 'run_pca(period = "Roman")']);
    expect(b.events.filter((e) => e.startsWith('echo:'))).toEqual([
      `echo:${STEP(0)}`,
      `echo:${STEP(1)}`,
      'echo:run_pca(period = "Roman")',
    ]);
    expect(b.c.session.transcript).toEqual(saved!.transcript);
    expect(b.events.filter((e) => e.startsWith('notice:'))).toEqual([]);
    expect(b.events.some((e) => e.includes(RESTORED_NOTICE))).toBe(false);
    expect(b.term.hint).toContain(STEP(2));
    b.c.submit(STEP(2));
    const again = rig(loadSession(b.store), b.store);
    expect(again.c.hintIndex).toBe(3);
    expect(again.events.some((e) => e.includes(RESTORED_NOTICE))).toBe(false);
    expect(again.c.session.transcript.some((l) => l.text === RESTORED_NOTICE)).toBe(false);
  });

  it('clamps a bad hint index and survives a malformed restored session', () => {
    const high = rig({ history: [], transcript: [], hintIndex: 999, plot: INITIAL_PLOT });
    expect(high.c.hintIndex).toBe(SCRIPT.length);
    const low = rig({ history: [], transcript: [], hintIndex: -5, plot: INITIAL_PLOT });
    expect(low.c.hintIndex).toBe(0);
    const weird = {
      history: [1, null, 'help()'],
      transcript: [null, { kind: 'output', text: 'ok' }, { kind: 'input' }],
      hintIndex: Number.NaN,
      plot: INITIAL_PLOT,
    } as unknown as Session;
    const w = rig(weird);
    expect(w.c.hintIndex).toBe(0);
    expect(w.c.session.history).toEqual(['help()']);
    expect(w.events).toContain('out:ok');
    expect(() => w.c.submit('help()')).not.toThrow();
  });
});

describe('fault isolation', () => {
  it('a throwing renderPlot never breaks the terminal', () => {
    const events: string[] = [];
    const term = new FakeTerminal(events);
    const c = new Controller(
      {
        data,
        terminal: term,
        renderPlot: () => {
          throw new Error('svg failed');
        },
        store: null,
      },
      null,
    );
    expect(() => c.submit('run_pca(period = "Today")')).not.toThrow();
    expect(() => c.submit(STEP(0))).not.toThrow();
    expect(c.hintIndex).toBe(1);
  });

  it('a command that throws prints a friendly line and does not count', async () => {
    // Task 8's execute() catches its own errors, so a throwing execute is simulated with a module mock.
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
    type(w.input, 'run_pca(period = "Today")');
    const printedSoFar = lines(w.out).length;
    type(w.input, 'run_pca(period = "IronAge")');
    const all = lines(w.out);
    const echoB = all.indexOf('> run_pca(period = "IronAge")');
    expect(echoB).toBeGreaterThan(printedSoFar - 1);
    expect(all[0]).toBe('> run_pca(period = "Today")');
    expect(w.renders).toHaveLength(2);
    expect(w.renders[1].frame).toBe('europe');
    await vi.runAllTimersAsync();
    expect(w.renders).toHaveLength(3);
    expect(w.renders[2].frame).toBe('britain');
  });

  it('a staggered command log finishes within 3 s', async () => {
    vi.useFakeTimers();
    const w = wire();
    type(w.input, 'load_genomes()');
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.c.session.transcript.filter((l) => l.kind === 'output').map((l) => l.text)).toEqual(
      lines(w.out).slice(1),
    );
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
