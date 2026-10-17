// @vitest-environment jsdom
// replay.ts (Task 6, CONTRACT §4.6) and spec §4.5 test 7: a refreshed station must show exactly what the live one shows.
import { describe, expect, it } from 'vitest';
import type { CardId } from '../src/types';
import { formatCommand, type Command } from '../src/parser';
import { EXTRAS, SCRIPT, SCRIPT_STEPS, hintCommand } from '../src/hints';
import { ADMIX_TODAY_HIDDEN, ADMIX_TODAY_SHOWN, EUROPE_ALREADY_SHOWN, EUROPE_HELD_BACK } from '../src/content';
import {
  INITIAL_DERIVED, ReplayError, applyCommand, cardPlacement, derive, fnv1a32, isHousekeeping, sessionBuildHash, type Derived,
} from '../src/replay';
import { loadSession, visibleTranscript } from '../src/session';
import { data, flushMicrotasks, rig, runSteps, type Rig, type ShownLine } from './helpers/controllerRig';
import { mulberry32 } from './helpers/rng';

const pca = (period: Extract<Command, { name: 'run_pca' }>['period']): Command => ({ name: 'run_pca', period });
const fold = (cmds: Command[]): Derived => cmds.reduce((d, c) => applyCommand(d, c, data).derived, INITIAL_DERIVED);
const asSteps = (cmds: Command[]): { cmd: string }[] => cmds.map((c) => ({ cmd: formatCommand(c) }));

describe('applyCommand (CONTRACT §4.6)', () => {
  it("a guided step advances the pointer, records lastRan and returns that step's cards", () => {
    expect(SCRIPT_STEPS[2]).toEqual({ id: 'europe', cards: { placement: 'after', ids: ['A1'] } });
    const a = applyCommand(fold(SCRIPT.slice(0, 2)), SCRIPT[2]!, data);
    expect(a.derived.hintIndex).toBe(3);
    expect(a.derived.lastRan).toEqual(SCRIPT[2]);
    expect(a.cards).toEqual(['A1']);
    expect(a.placement).toBe('after');
    expect(a.derived.cardsFor).toEqual([[], [], ['A1']]);
    expect(a.derived.plot.view).toBe('pca');
    expect(a.derived.plot.focus).toBe('Europe');
    expect(a.derived.extrasTick).toBe(0);
  });

  it('trait steps return their "before" cards', () => {
    const a = applyCommand(fold(SCRIPT.slice(0, 14)), SCRIPT[14]!, data);
    expect(a.cards).toEqual(['H1', 'H2']);
    expect(a.placement).toBe('before');
  });

  it('an off-script command draws its plot but returns no cards and leaves the pointer', () => {
    const a = applyCommand(INITIAL_DERIVED, pca('Roman'), data);
    expect(a.cards).toEqual([]);
    expect(a.placement).toBeUndefined();
    expect(a.derived.hintIndex).toBe(0);
    expect(a.derived.plot.layers).toEqual(['Roman']);
    expect(a.derived.cardsFor).toEqual([[]]);
    expect(a.derived.lastRan).toEqual(pca('Roman'));
  });

  it('help(), clear() and refusals are not steps: the same Derived comes back, with no cards', () => {
    const notSteps: Command[] = [{ name: 'help' }, { name: 'clear' }, { name: 'run_admixture', K: 4 }];
    for (const c of notSteps) {
      const a = applyCommand(INITIAL_DERIVED, c, data);
      expect(a.derived).toBe(INITIAL_DERIVED);
      expect(a.cards).toEqual([]);
    }
    expect(applyCommand(INITIAL_DERIVED, { name: 'run_admixture', K: 4 }, data).result.refused).toBe(true);
    expect(applyCommand(INITIAL_DERIVED, { name: 'clear' }, data).result.clear).toBe(true);
    expect(isHousekeeping({ name: 'help' })).toBe(true);
    expect(isHousekeeping({ name: 'clear' })).toBe(true);
    expect(isHousekeeping({ name: 'load_genomes' })).toBe(false);
  });

  it('extrasTick grows by one only for a step run after the script has ended (spec §2.2)', () => {
    const done = fold(SCRIPT);
    expect(done.hintIndex).toBe(SCRIPT.length);
    expect(done.extrasTick).toBe(0); // the last guided step itself does not tick
    const one = applyCommand(done, EXTRAS[0]!, data).derived;
    expect(one.extrasTick).toBe(1);
    expect(applyCommand(one, { name: 'help' }, data).derived.extrasTick).toBe(1);
    expect(applyCommand(one, { name: 'clear' }, data).derived.extrasTick).toBe(1);
    expect(applyCommand(one, { name: 'run_admixture', K: 4 }, data).derived.extrasTick).toBe(1);
    expect(applyCommand(one, pca('Viking'), data).derived.extrasTick).toBe(2);
  });

  it('execute sees whether Britain today was on the plot BEFORE the step (Europe and ADMIXTURE log lines)', () => {
    expect(applyCommand(INITIAL_DERIVED, pca('Europe'), data).result.lines).toContain(EUROPE_HELD_BACK);
    const today = applyCommand(INITIAL_DERIVED, pca('Today'), data).derived;
    expect(applyCommand(today, pca('Europe'), data).result.lines).toContain(EUROPE_ALREADY_SHOWN);
    expect(applyCommand(INITIAL_DERIVED, { name: 'run_admixture', K: 3 }, data).result.lines).toContain(ADMIX_TODAY_HIDDEN);
    expect(applyCommand(today, { name: 'run_admixture', K: 3 }, data).result.lines).toContain(ADMIX_TODAY_SHOWN);
  });

  it('cardPlacement reads the placement from SCRIPT_STEPS', () => {
    expect(cardPlacement('A1')).toBe('after');
    expect(cardPlacement('E3')).toBe('after');
    expect(cardPlacement('H1')).toBe('before');
    expect(cardPlacement('L3')).toBe('before');
  });
});

describe('derive', () => {
  it('replays formatCommand strings to exactly the live fold, for every prefix of the script', () => {
    for (let n = 0; n <= SCRIPT.length; n += 1) {
      expect(derive(data, asSteps(SCRIPT), n)).toEqual(fold(SCRIPT.slice(0, n)));
    }
    expect(derive(data, [], 0)).toEqual(INITIAL_DERIVED);
  });

  it('records the cards of every guided step (SCRIPT_STEPS) and none for other steps', () => {
    expect(derive(data, asSteps(SCRIPT), SCRIPT.length).cardsFor).toEqual(SCRIPT_STEPS.map((s) => s.cards?.ids ?? []));
  });

  it('accepts any spelling the parser accepts', () => {
    expect(derive(data, [{ cmd: 'RUN_PCA(PERIOD="romans")' }], 1).plot.layers).toEqual(['Roman']);
  });

  const BAD: [string, { cmd: string }[], number][] = [
    ['an unparseable step', [{ cmd: 'run_pca(period = "Jurassic")' }], 1],
    ['help() as a step', [{ cmd: 'help()' }], 1],
    ['clear() as a step', [{ cmd: 'clear()' }], 1],
    ['a refused step', [{ cmd: 'run_admixture(K = 4)' }], 1],
    ['n past the end', [{ cmd: 'load_genomes()' }], 2],
    ['a negative n', [], -1],
    ['a fractional n', [{ cmd: 'load_genomes()' }], 0.5],
  ];
  it.each(BAD)('throws ReplayError for %s', (_name, steps, n) => {
    expect(() => derive(data, steps, n)).toThrow(ReplayError);
  });
});

describe('sessionBuildHash', () => {
  it('is FNV-1a 32-bit, written as 8 lower-case hex digits', () => {
    expect(fnv1a32('')).toBe('811c9dc5');
    expect(fnv1a32('a')).toBe('e40c292c');
    expect(fnv1a32('foobar')).toBe('bf9cf968');
    expect(sessionBuildHash()).toMatch(/^[0-9a-f]{8}$/);
    expect(sessionBuildHash()).toBe(sessionBuildHash(SCRIPT_STEPS));
  });

  it('hashes the step ids, placements and card ids', () => {
    const text = SCRIPT_STEPS.map((s) => `${s.id}:${s.cards?.placement ?? '-'}:${s.cards?.ids.join(',') ?? ''}`).join('|');
    expect(sessionBuildHash()).toBe(fnv1a32(text));
  });

  it('changes when a step or a card is cut, so stale sessions start fresh (timing cut 4, a dropped card)', () => {
    const base = sessionBuildHash();
    expect(sessionBuildHash(SCRIPT_STEPS.filter((s) => s.id !== 'bronzeAge'))).not.toBe(base);
    const noE3 = SCRIPT_STEPS.map((s) =>
      s.id === 'ironAge' ? { ...s, cards: { placement: 'after' as const, ids: ['E1', 'E2'] as CardId[] } } : s);
    expect(sessionBuildHash(noE3)).not.toBe(base);
  });
});

// ---------- spec §4.5 test 7 (P1 part; the Back actions are further down, Task 17) ----------
const POOL: string[] = [
  ...SCRIPT, ...EXTRAS,
  pca('all'), pca('Today'), pca('Europe'), pca('Viking'),
  { name: 'allele_freq', gene: 'TYK2' } as Command,
  { name: 'ancestry_test', person: 'Viking' } as Command,
  { name: 'run_admixture', K: 3, period: 'BellBeaker' } as Command,
].map(formatCommand);
const BAD_LINES = ['nope', 'run_pca(period = "Jurassic")', 'run_pcaa(period = "IronAge")', ')))'];
const TABS = ['run_', 'allele_freq(gene = "H', 'run_p'];

async function act(r: Rig, rng: () => number, clock: { t: number }): Promise<string> {
  clock.t += rng() < 0.2 ? 100 : 500;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
  const x = rng();
  if (x < 0.3) {
    const line = formatCommand(hintCommand(r.c.hintIndex, r.c.derived.extrasTick));
    r.c.submit(line);
    return `hint ${line}`;
  }
  if (x < 0.4) {
    const line = pick(POOL);
    r.c.submit(line);
    return line;
  }
  if (x < 0.47) {
    const line = pick(BAD_LINES);
    r.c.submit(line);
    return line;
  }
  if (x < 0.5) {
    r.c.submit('run_admixture(K = 4)');
    return 'refused';
  }
  if (x < 0.53) {
    r.c.submit('help()');
    return 'help';
  }
  if (x < 0.56) {
    r.c.submit('clear()');
    return 'clear';
  }
  if (x < 0.61) {
    const p = pick(TABS);
    r.c.tab(p);
    return `tab ${p}`;
  }
  if (x < 0.75) {
    r.c.submit('', { repeat: false });
    return 'blank';
  }
  if (x < 0.79) {
    r.c.submit('', { repeat: true });
    return 'blank (repeat)';
  }
  if (x < 0.87) {
    r.c.escape({ repeat: false });
    return 'esc';
  }
  if (x < 0.95) {
    r.c.continueCard();
    return 'continue';
  }
  if (r.term.isPrinting()) {
    r.term.flush(); // the running log finishes on its own
    await flushMicrotasks();
    return 'log ends';
  }
  return 'idle';
}

/**
 * The lines the live terminal was really told to show since its last clear() or showLines() (a Back or a restore redraws it
 * whole), not what its transcript says it showed.
 */
function liveScreen(r: Rig): ShownLine[] {
  return r.term.screen.map((l) => ({ ...l }));
}

/** A refreshed station (back) must equal the live one on everything a student can see or press. */
function expectSameStation(back: Rig, live: Rig, label: string): void {
  const visible = visibleTranscript(live.c.session.transcript, Infinity).map(({ kind, text }) => ({ kind, text }));
  expect(back.c.derived, label).toEqual(live.c.derived); // plot, hint index, lastRan, extrasTick, cards per step
  expect(back.c.hintIndex, label).toBe(live.c.hintIndex);
  expect(back.term.hint, label).toBe(live.term.hint); // Predict, Reveal and CARD_HINT lines included
  expect(back.c.screen, label).toEqual(live.c.screen);
  expect(back.c.cardOpen, label).toBe(live.c.cardOpen);
  expect(back.c.session, label).toEqual(live.c.session);
  expect(back.term.shownLines, label).toEqual(visible);
  expect(back.renders[back.renders.length - 1], label).toEqual(live.c.derived.plot);
  // Two views of one transcript always agree, so these three compare with what the live station itself did:
  expect(back.term.shownLines, label).toEqual(liveScreen(live)); // the lines on screen after its last clear()
  expect(live.renders[live.renders.length - 1], label).toEqual(live.c.derived.plot); // the plot it drew is the derived plot
  expect(back.cards.current, label).toBe(live.cards.current); // the card its host shows
}

/**
 * Lets any running log finish on its own, then restores a fresh controller from what the live one saved. A session saved
 * in the middle of a log must restore to the station the live one reaches when that log ends (decision 2: held
 * after-cards open at once), so that refresh is checked too.
 */
async function expectRestoreMatches(live: Rig, label: string): Promise<void> {
  const mid = live.term.isPrinting() ? rig({ restored: loadSession(live.store) }) : null;
  if (live.term.isPrinting()) live.term.flush();
  await flushMicrotasks();
  if (mid) expectSameStation(mid, live, `${label} [refreshed mid-print]`);
  expectSameStation(rig({ restored: loadSession(live.store) }), live, label);
}

describe('spec §4.5 test 7: restore(serialize(session)) equals the live controller', () => {
  it('holds at every checked point of 200 fixed-seed random sessions (valid, invalid, help, clear, Tab and card actions)', async () => {
    for (let run = 0; run < 200; run += 1) {
      const rng = mulberry32(0x5eed + run);
      const clock = { t: 0 };
      const live = rig({ now: () => clock.t });
      if (run % 4 === 0) runSteps(live, 0, SCRIPT.length); // a quarter of the runs start after the guided script (extras)
      live.term.holdPrints = true;
      const trail: string[] = [];
      for (let k = 0; k < 30; k += 1) {
        trail.push(await act(live, rng, clock));
        if (rng() < 0.5) await expectRestoreMatches(live, `run ${run}: ${trail.join(' | ')}`);
      }
      await expectRestoreMatches(live, `run ${run} (end): ${trail.join(' | ')}`);
    }
  }, 180_000);

  it('also holds when the random actions begin at any point of the guided script, "before" card steps included', async () => {
    const tables = JSON.stringify([SCRIPT, SCRIPT_STEPS, EXTRAS]);
    for (let run = 0; run < 200; run += 1) {
      const rng = mulberry32(0xbeef + run);
      const clock = { t: 0 };
      const live = rig({ now: () => clock.t });
      runSteps(live, 0, Math.floor(rng() * (SCRIPT.length + 1)));
      live.term.holdPrints = true;
      const trail: string[] = [];
      for (let k = 0; k < 30; k += 1) {
        trail.push(await act(live, rng, clock));
        if (rng() < 0.5) await expectRestoreMatches(live, `start-anywhere run ${run}: ${trail.join(' | ')}`);
      }
      await expectRestoreMatches(live, `start-anywhere run ${run} (end): ${trail.join(' | ')}`);
    }
    expect(JSON.stringify([SCRIPT, SCRIPT_STEPS, EXTRAS])).toBe(tables); // nothing above mutated the shared script tables
  }, 180_000);
});

// ---- spec §4.5 test 7 with Back actions (Task 17) ----

/** Every screen of a session, in the order a student meets them: the start, then per step its cards and its bare plot. */
function screensOf(cardsFor: readonly (readonly CardId[])[]): { step: number; card: number }[] {
  const all = [{ step: 0, card: 0 }];
  cardsFor.forEach((cards, k) => {
    for (let j = 0; j <= cards.length; j += 1) if (cards.length === 0 && j === 1) break; else all.push({ step: k + 1, card: j });
  });
  return all;
}

/** The screen a student is on: the open card, else the step's bare plot (a step whose after-cards wait for their log is on its bare plot). */
function onScreen(r: Rig): { step: number; card: number } {
  const { step, card } = r.c.screen;
  if (r.c.cardOpen !== null) return { step, card };
  return { step, card: r.c.derived.cardsFor[step - 1]?.length ?? 0 };
}

/**
 * One random action, or a Back (about one in five). A Back is checked against a model that shares no code with back.ts: the
 * session's screens as a list, and Back moves one place down it. Everything it rolls back is then compared with a refreshed
 * station by expectRestoreMatches, as after any other action.
 */
async function actOrBack(r: Rig, rng: () => number, clock: { t: number }): Promise<string> {
  if (rng() >= 0.2) return act(r, rng, clock);
  clock.t += rng() < 0.2 ? 100 : 500;
  const here = onScreen(r);
  const list = screensOf(r.c.derived.cardsFor);
  const at = list.findIndex((p) => p.step === here.step && p.card === here.card);
  expect(at, `the screen ${JSON.stringify(here)} is one of the session's screens`).toBeGreaterThanOrEqual(0);
  const before = r.c.session;
  const triesBefore = r.c.badTries;
  const promptBefore = r.term.prompt;
  r.c.back();
  const after = r.c.session;
  const target = list[Math.max(0, at - 1)]!;
  if (at === 0) {
    // The start: Back is disabled there, so a stray call changes nothing at all (not even the prompt or the tries).
    expect(after, 'Back at the start changes nothing').toEqual(before);
    expect([r.c.badTries, r.term.prompt], 'Back at the start leaves the prompt and the tries alone').toEqual([triesBefore, promptBefore]);
    return 'back (start)';
  }
  expect(r.c.screen, 'Back moves one place down the list of screens').toEqual(target);
  expect(r.term.isPrinting(), 'Back flushes a running log').toBe(false);
  expect(after.steps.length, 'the steps after the target screen are dropped').toBe(target.step);
  expect(after.steps, 'what is left is a prefix of what there was').toEqual(before.steps.slice(0, target.step));
  expect(after.history, 'Up/Down history is not rolled back').toEqual(before.history);
  expect(after.nextSeq, 'the sequence counter is not rolled back').toBe(before.nextSeq);
  expect(r.c.badTries, 'Back resets the three tries').toBe(0);
  expect(r.term.prompt, 'Back clears the prompt').toBe('');
  const cards = r.c.derived.cardsFor[target.step - 1] ?? [];
  expect(r.c.cardOpen, 'a card screen has its card open, a bare plot none').toBe(target.card < cards.length ? cards[target.card] : null);
  expect(r.cards.current, 'the card host shows exactly that card').toBe(r.c.cardOpen);
  return `back -> ${target.step}.${target.card}`;
}

describe('spec §4.5 test 7 with Back actions: restore(serialize(session)) equals the live controller after every kind of action, Back included', () => {
  it('holds at every checked point of 200 fixed-seed random sessions, and every Back lands one screen earlier', async () => {
    let backs = 0;
    for (let run = 0; run < 200; run += 1) {
      const rng = mulberry32(0xb4c1 + run);
      const clock = { t: 0 };
      const live = rig({ now: () => clock.t });
      if (run % 4 === 0) runSteps(live, 0, SCRIPT.length);
      live.term.holdPrints = true;
      const trail: string[] = [];
      for (let k = 0; k < 40; k += 1) {
        const did = await actOrBack(live, rng, clock);
        if (did.startsWith('back ->')) backs += 1;
        trail.push(did);
        if (rng() < 0.5) await expectRestoreMatches(live, `back run ${run}: ${trail.join(' | ')}`);
      }
      await expectRestoreMatches(live, `back run ${run} (end): ${trail.join(' | ')}`);
    }
    expect(backs, 'the runs really pressed Back, and really moved').toBeGreaterThan(800);
  }, 180_000);

  it('also holds when the random actions begin at any point of the guided script, "before" card steps included', async () => {
    const tables = JSON.stringify([SCRIPT, SCRIPT_STEPS, EXTRAS]);
    for (let run = 0; run < 200; run += 1) {
      const rng = mulberry32(0xcafe + run);
      const clock = { t: 0 };
      const live = rig({ now: () => clock.t });
      runSteps(live, 0, Math.floor(rng() * (SCRIPT.length + 1)));
      live.term.holdPrints = true;
      const trail: string[] = [];
      for (let k = 0; k < 40; k += 1) {
        trail.push(await actOrBack(live, rng, clock));
        if (rng() < 0.5) await expectRestoreMatches(live, `back start-anywhere run ${run}: ${trail.join(' | ')}`);
      }
      await expectRestoreMatches(live, `back start-anywhere run ${run} (end): ${trail.join(' | ')}`);
    }
    expect(JSON.stringify([SCRIPT, SCRIPT_STEPS, EXTRAS])).toBe(tables); // Back never mutates the shared script tables
  }, 180_000);
});
