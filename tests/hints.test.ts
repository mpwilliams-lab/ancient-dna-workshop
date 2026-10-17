import { describe, it, expect } from 'vitest';
import type { Command } from '../src/parser';
import { formatCommand, parse } from '../src/parser';
import { PREDICT_HINT, REVEAL_HINT } from '../src/content';
import { CARD_IDS, STEP_IDS } from '../src/types';
import {
  SCRIPT, SCRIPT_STEPS, EXTRAS, matchesStep, advance, hintText, hintCommand, stepCards, NEXT_PREFIX, EXTRA_PREFIX,
} from '../src/hints';
import { ruleViolations } from './contentRules';

const pca = (period: Extract<Command, { name: 'run_pca' }>['period']): Command => ({ name: 'run_pca', period });
const admix = (K = 3, period?: Extract<Command, { name: 'run_admixture' }>['period']): Command =>
  period === undefined ? { name: 'run_admixture', K } : { name: 'run_admixture', K, period };
const consumerIA: Command = { name: 'ancestry_test', person: 'IronAge' };
const N = 19;

describe('SCRIPT, SCRIPT_STEPS and EXTRAS (spec v3 §2.1, CONTRACT §3)', () => {
  it('SCRIPT is the exact 19-step guided script', () => {
    expect(SCRIPT.map(formatCommand)).toEqual([
      'ancestry_test(person = "me")',
      'load_genomes()',
      'run_pca(period = "Europe")',
      'run_pca(period = "FirstFarmers")',
      'run_pca(period = "BellBeaker")',
      'run_admixture(K = 3)',
      'run_pca(period = "BronzeAge")',
      'run_pca(period = "IronAge")',
      'ancestry_test(person = "IronAge")',
      'run_pca(period = "Today")',
      'run_admixture(K = 3)',
      'run_pca(period = "Roman")',
      'run_pca(period = "AngloSaxon")',
      'run_pca(period = "all")',
      'allele_freq(gene = "LCT")',
      'allele_freq(gene = "SLC45A2")',
      'allele_freq(gene = "HERC2")',
      'allele_freq(gene = "TYK2")',
      'allele_freq(gene = "HLA-DQ2")',
    ]);
  });
  it('SCRIPT_STEPS is parallel to SCRIPT and carries the 19 step ids in order', () => {
    expect(SCRIPT_STEPS).toHaveLength(SCRIPT.length);
    expect(SCRIPT.length).toBe(N);
    expect(SCRIPT_STEPS.map((s) => s.id)).toEqual([...STEP_IDS]);
  });
  it('the cards and their placement per step are the CONTRACT §3 table', () => {
    const table = SCRIPT_STEPS.map((s) => (s.cards ? `${s.id}:${s.cards.placement}:${s.cards.ids.join(',')}` : s.id));
    expect(table).toEqual([
      'hook', 'load', 'europe:after:A1', 'firstFarmers:after:B1', 'bellBeaker:after:C1', 'admix1:after:D1,D2', 'bronzeAge',
      'ironAge:after:E1,E2,E3', 'consumerIA', 'revealPca', 'revealAdmix', 'roman:after:F1', 'angloSaxon:after:G1,G2', 'finale',
      'lct:before:H1,H2', 'slc45a2:before:I1,I2', 'herc2:before:J1,J2,J3', 'tyk2:before:K1,K2', 'hla:before:L1,L2,L3',
    ]);
  });
  it('every CardId appears exactly once, in script order, and every card id exists', () => {
    const all = SCRIPT_STEPS.flatMap((s) => s.cards?.ids ?? []);
    expect(all).toEqual([...CARD_IDS]);
    expect(new Set(all).size).toBe(23);
    for (const id of all) expect(CARD_IDS).toContain(id);
  });
  it('stepCards(i) is SCRIPT_STEPS[i].cards, and undefined off the script', () => {
    expect(stepCards(2)).toEqual({ placement: 'after', ids: ['A1'] });
    expect(stepCards(7)).toEqual({ placement: 'after', ids: ['E1', 'E2', 'E3'] });
    expect(stepCards(16)).toEqual({ placement: 'before', ids: ['J1', 'J2', 'J3'] });
    for (const i of [0, 1, 6, 8, 9, 10, 13]) expect(stepCards(i), `step ${i}`).toBeUndefined();
    for (const i of [-1, N, 99, 2.5, Number.NaN]) expect(stepCards(i), `index ${i}`).toBeUndefined();
  });
  it('every SCRIPT and EXTRAS step parses back to itself (session v2 replays formatCommand strings)', () => {
    for (const step of [...SCRIPT, ...EXTRAS]) expect(parse(formatCommand(step))).toEqual({ ok: true, command: step });
  });
  it('EXTRAS are the four v3 extras in rotation order', () => {
    expect(EXTRAS.map(formatCommand)).toEqual([
      'run_pca(period = "Viking")',
      'run_admixture(K = 3, period = "BellBeaker")',
      'ancestry_test(person = "Today")',
      'run_admixture(K = 3)',
    ]);
  });
});

describe('matchesStep', () => {
  it('needs the same name and arguments', () => {
    expect(matchesStep(pca('IronAge'), pca('IronAge'))).toBe(true);
    expect(matchesStep(pca('Roman'), pca('IronAge'))).toBe(false);
    expect(matchesStep(pca('all'), pca('Today'))).toBe(false);
    expect(matchesStep(pca('Europe'), pca('Europe'))).toBe(true);
    expect(matchesStep(pca('Today'), pca('Europe'))).toBe(false);
    expect(matchesStep({ name: 'ancestry_test', person: 'IronAge' }, { name: 'ancestry_test', person: 'me' })).toBe(false);
    expect(matchesStep({ name: 'allele_freq', gene: 'LCT' }, { name: 'allele_freq', gene: 'LCT' })).toBe(true);
    expect(matchesStep({ name: 'load_genomes' }, { name: 'load_genomes' })).toBe(true);
    expect(matchesStep({ name: 'help' }, { name: 'load_genomes' })).toBe(false);
  });
  it('an extra optional period on run_admixture still matches; a different K does not', () => {
    expect(matchesStep(admix(3, 'AngloSaxon'), admix(3))).toBe(true);
    expect(matchesStep(admix(3), admix(3))).toBe(true);
    expect(matchesStep(admix(4), admix(3))).toBe(false);
    expect(matchesStep(admix(3), admix(3, 'BellBeaker'))).toBe(false);
    expect(matchesStep(admix(3, 'IronAge'), admix(3, 'BellBeaker'))).toBe(false);
    expect(matchesStep(admix(3, 'BellBeaker'), admix(3, 'BellBeaker'))).toBe(true);
  });
});

describe('advance (RF2: out-of-order commands)', () => {
  it('the guided script in order walks i from 0 to 19', () => {
    let i = 0;
    for (const step of SCRIPT) i = advance(i, step);
    expect(i).toBe(N);
  });
  it('steps run early, extras and off-script runs leave i unchanged', () => {
    expect(advance(0, pca('Roman'))).toBe(0);
    expect(advance(0, pca('all'))).toBe(0);
    expect(advance(0, pca('Europe'))).toBe(0);
    expect(advance(0, admix(3))).toBe(0);
    expect(advance(2, pca('Today'))).toBe(2);          // Today run early: no reveal step yet
    expect(advance(2, pca('BellBeaker'))).toBe(2);
    expect(advance(7, pca('FirstFarmers'))).toBe(7);
    expect(advance(3, pca('BronzeAge'))).toBe(3);
    expect(advance(6, pca('Viking'))).toBe(6);
    for (let i = 0; i <= N; i++) if (i !== 13) expect(advance(i, pca('all')), `i=${i}`).toBe(i);
    expect(advance(13, pca('all'))).toBe(14);         // the finale step
  });
  it('the two run_admixture steps: once per matching position only', () => {
    let i = 5;
    i = advance(i, admix(3));
    expect(i).toBe(6);
    i = advance(i, admix(3));          // running it again does not skip run_pca(BronzeAge)
    expect(i).toBe(6);
    i = advance(advance(advance(advance(i, pca('BronzeAge')), pca('IronAge')), consumerIA), pca('Today'));
    expect(i).toBe(10);
    i = advance(i, admix(3, 'AngloSaxon')); // an extra period still counts
    expect(i).toBe(11);
  });
  it('a refused K is never a match', () => {
    expect(advance(5, admix(4))).toBe(5);
    expect(advance(10, admix(2))).toBe(10);
  });
  it('after the last step i stays at 19', () => {
    expect(advance(N, { name: 'allele_freq', gene: 'HLA-DQ2' })).toBe(N);
    for (const e of EXTRAS) expect(advance(N, e)).toBe(N);
  });
  it('a corrupt index is clamped instead of crashing', () => {
    expect(advance(-3, SCRIPT[0]!)).toBe(1);
    expect(advance(Number.NaN, SCRIPT[0]!)).toBe(1);
    expect(advance(99, SCRIPT[0]!)).toBe(N);
    expect(advance(2.7, SCRIPT[2]!)).toBe(3);
  });
});

describe('hintText and hintCommand', () => {
  it('shows script[i] with the Next prefix', () => {
    expect(NEXT_PREFIX).toBe('Next: ');
    expect(hintText(0, null, 0)).toBe('Next: ancestry_test(person = "me")');
    expect(hintText(2, { name: 'load_genomes' }, 0)).toBe('Next: run_pca(period = "Europe")');
    expect(hintText(5, pca('BellBeaker'), 0)).toBe('Next: run_admixture(K = 3)');
    expect(hintText(18, null, 7)).toBe('Next: allele_freq(gene = "HLA-DQ2")');
  });
  it('shows the Predict line right after run_pca(FirstFarmers) when BellBeaker is next (v2.1, unchanged)', () => {
    expect(SCRIPT[4]).toEqual(pca('BellBeaker'));
    expect(hintText(4, pca('FirstFarmers'), 0)).toBe(PREDICT_HINT);
    expect(hintText(4, null, 0)).toBe('Next: run_pca(period = "BellBeaker")');
    expect(hintText(4, { name: 'help' }, 0)).toBe('Next: run_pca(period = "BellBeaker")');
    expect(hintText(4, pca('Europe'), 0)).toBe('Next: run_pca(period = "BellBeaker")'); // only FirstFarmers triggers it
    expect(hintText(4, pca('IronAge'), 0)).toBe('Next: run_pca(period = "BellBeaker")');
    expect(hintText(3, pca('FirstFarmers'), 0)).toBe('Next: run_pca(period = "FirstFarmers")'); // not at the BellBeaker step
  });
  it('shows the Reveal line right after ancestry_test(IronAge) when run_pca(Today) is next (v3 §2.2)', () => {
    expect(SCRIPT[9]).toEqual(pca('Today'));
    expect(REVEAL_HINT).toBe('Predict: where will Britain today land? Then run run_pca(period = "Today")');
    expect(hintText(9, consumerIA, 0)).toBe(REVEAL_HINT);
    expect(hintText(9, null, 0)).toBe('Next: run_pca(period = "Today")');
    expect(hintText(9, { name: 'help' }, 0)).toBe('Next: run_pca(period = "Today")');
    expect(hintText(9, pca('IronAge'), 0)).toBe('Next: run_pca(period = "Today")');                 // only the consumer test triggers it
    expect(hintText(9, { name: 'ancestry_test', person: 'me' }, 0)).toBe('Next: run_pca(period = "Today")');
    expect(hintText(8, consumerIA, 0)).toBe('Next: ancestry_test(person = "IronAge")');           // not at the Today step
  });
  it('a missing lastRan (undefined as well as null) never throws and gives the plain hint', () => {
    expect(hintText(4, undefined as unknown as null, 0)).toBe('Next: run_pca(period = "BellBeaker")');
    expect(hintText(9, undefined as unknown as null, 0)).toBe('Next: run_pca(period = "Today")');
  });
  it('after the last step rotates through the extras', () => {
    expect(EXTRA_PREFIX).toBe('Try an extra: ');
    expect([0, 1, 2, 3, 4, 5, -1].map((t) => hintText(N, null, t))).toEqual([
      'Try an extra: run_pca(period = "Viking")',
      'Try an extra: run_admixture(K = 3, period = "BellBeaker")',
      'Try an extra: ancestry_test(person = "Today")',
      'Try an extra: run_admixture(K = 3)',
      'Try an extra: run_pca(period = "Viking")',
      'Try an extra: run_admixture(K = 3, period = "BellBeaker")',
      'Try an extra: run_admixture(K = 3)',
    ]);
  });
  it('hintCommand is what Esc and the three-tries auto-fill insert', () => {
    expect(hintCommand(0, 0)).toEqual({ name: 'ancestry_test', person: 'me' });
    expect(hintCommand(2, 0)).toEqual(pca('Europe'));
    expect(hintCommand(4, 0)).toEqual(pca('BellBeaker'));
    expect(hintCommand(9, 0)).toEqual(pca('Today'));
    expect(hintCommand(N, 2)).toEqual({ name: 'ancestry_test', person: 'Today' });
    expect(hintCommand(99, 1)).toEqual(admix(3, 'BellBeaker'));
    expect(hintCommand(Number.NaN, 0)).toEqual(SCRIPT[0]);
  });
  it('Esc always inserts what the hint line shows, for every index and extras tick', () => {
    for (let i = 0; i <= SCRIPT.length; i++) {
      for (let t = 0; t <= 4; t++) {
        const shown = hintText(i, null, t);
        const filled = formatCommand(hintCommand(i, t));
        expect(shown.endsWith(filled), `i=${i} t=${t}: "${shown}" does not end with "${filled}"`).toBe(true);
      }
    }
    // The Predict and Reveal lines also end with the command Esc inserts.
    expect(hintText(4, pca('FirstFarmers'), 0).endsWith(formatCommand(hintCommand(4, 0)))).toBe(true);
    expect(hintText(9, consumerIA, 0).endsWith(formatCommand(hintCommand(9, 0)))).toBe(true);
  });
  it('the prefixes, every script hint, every extras hint and both predict lines obey the content rules', () => {
    const texts = [
      NEXT_PREFIX,
      EXTRA_PREFIX,
      ...SCRIPT.map((_, i) => hintText(i, null, 0)),
      ...EXTRAS.map((_, t) => hintText(SCRIPT.length, null, t)),
      hintText(4, pca('FirstFarmers'), 0), // the Predict line
      hintText(9, consumerIA, 0),          // the Reveal line
    ];
    expect(texts).toHaveLength(2 + N + 4 + 2);
    for (const s of texts) expect(ruleViolations(s), s).toEqual([]);
  });
});

// ---------- the hint line typed exactly as shown ----------
// A student who types the whole hint line, label and all, is doing what the screen asks. The label is forgiven the way a
// copied prompt is.
describe('the hint line, typed exactly as shown, runs the command it names (RF1)', () => {
  const TICKS = 2 * EXTRAS.length + 1; // a full rotation twice, so the wrap-around is covered too

  it('parse(hintText(i, null, t)) is ok, with the same command as hintCommand(i, t), for every guided step and every extras tick', () => {
    let checked = 0;
    for (let i = 0; i <= SCRIPT.length; i++) {
      for (let t = 0; t < TICKS; t++) {
        const shown = hintText(i, null, t);
        expect(parse(shown), `i=${i} t=${t}: ${shown}`).toEqual({ ok: true, command: hintCommand(i, t) });
        checked++;
      }
    }
    expect(checked).toBe((SCRIPT.length + 1) * TICKS);
  });

  it('the two labels are the ones the parser forgives, and every extra is shown with its own label', () => {
    expect(NEXT_PREFIX).toBe('Next: ');
    expect(EXTRA_PREFIX).toBe('Try an extra: ');
    for (let t = 0; t < EXTRAS.length; t++) {
      expect(hintText(SCRIPT.length, null, t)).toBe(`Try an extra: ${formatCommand(EXTRAS[t]!)}`);
      expect(parse(hintText(SCRIPT.length, null, t))).toEqual({ ok: true, command: EXTRAS[t] });
    }
  });

  it('still runs when a prompt is copied in front of it, however many and however spaced, in any case', () => {
    const fronts = ['', '> ', '$ ', '> > ', '>> ', ' > $ ', '\t> '];
    for (let i = 0; i <= SCRIPT.length; i++) {
      for (let t = 0; t < EXTRAS.length; t++) {
        const shown = hintText(i, null, t);
        const want = { ok: true, command: hintCommand(i, t) };
        for (const front of fronts) {
          expect(parse(front + shown), JSON.stringify(front + shown)).toEqual(want);
          expect(parse(front + shown.toLowerCase()), JSON.stringify(front + shown.toLowerCase())).toEqual(want);
          expect(parse(front + shown.toUpperCase()), JSON.stringify(front + shown.toUpperCase())).toEqual(want);
        }
      }
    }
  });

  it('the Predict and Reveal lines are sentences: each is answered with a did-you-mean for the command it names', () => {
    const p = parse(PREDICT_HINT);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.suggestion).toBe('run_pca(period = "BellBeaker")');
    const r = parse(REVEAL_HINT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.suggestion).toBe('run_pca(period = "Today")');
  });
});
