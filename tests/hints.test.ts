import { describe, it, expect } from 'vitest';
import type { Command } from '../src/parser';
import { formatCommand, parse } from '../src/parser';
import { PREDICT_HINT } from '../src/content';
import { SCRIPT, EXTRAS, matchesStep, advance, hintText, hintCommand, NEXT_PREFIX, EXTRA_PREFIX } from '../src/hints';
import { ruleViolations } from './contentRules';

const pca = (period: Extract<Command, { name: 'run_pca' }>['period']): Command => ({ name: 'run_pca', period });
const admix = (K = 3, period?: Extract<Command, { name: 'run_admixture' }>['period']): Command =>
  period === undefined ? { name: 'run_admixture', K } : { name: 'run_admixture', K, period };

describe('SCRIPT and EXTRAS (spec §3 / §4.3)', () => {
  it('SCRIPT is the exact 16-step guided script', () => {
    expect(SCRIPT.map(formatCommand)).toEqual([
      'ancestry_test(person = "me")',
      'load_genomes()',
      'run_pca(period = "Today")',
      'run_pca(period = "FirstFarmers")',
      'run_pca(period = "BellBeaker")',
      'run_admixture(K = 3)',
      'run_pca(period = "IronAge")',
      'run_pca(period = "Roman")',
      'run_pca(period = "AngloSaxon")',
      'run_admixture(K = 3)',
      'ancestry_test(person = "IronAge")',
      'allele_freq(gene = "LCT")',
      'allele_freq(gene = "SLC45A2")',
      'allele_freq(gene = "HERC2")',
      'allele_freq(gene = "TYK2")',
      'allele_freq(gene = "HLA-DQ2")',
    ]);
  });
  it('every SCRIPT and EXTRAS step parses back to itself (what Esc fills in runs as that step)', () => {
    for (const step of [...SCRIPT, ...EXTRAS]) expect(parse(formatCommand(step))).toEqual({ ok: true, command: step });
  });
  it('EXTRAS are the four extras in rotation order', () => {
    expect(EXTRAS.map(formatCommand)).toEqual([
      'run_pca(period = "BronzeAge")',
      'run_pca(period = "Viking")',
      'run_pca(period = "all")',
      'run_admixture(K = 3, period = "BellBeaker")',
    ]);
  });
});

describe('matchesStep', () => {
  it('needs the same name and arguments', () => {
    expect(matchesStep(pca('IronAge'), pca('IronAge'))).toBe(true);
    expect(matchesStep(pca('Roman'), pca('IronAge'))).toBe(false);
    expect(matchesStep(pca('all'), pca('Today'))).toBe(false);
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
  it('the guided script in order walks i from 0 to 16', () => {
    let i = 0;
    for (const step of SCRIPT) i = advance(i, step);
    expect(i).toBe(16);
  });
  it('steps run early, extras and run_pca("all") leave i unchanged', () => {
    expect(advance(0, pca('Roman'))).toBe(0);
    expect(advance(0, pca('all'))).toBe(0);
    expect(advance(0, admix(3))).toBe(0);
    expect(advance(2, pca('BellBeaker'))).toBe(2);
    expect(advance(6, pca('FirstFarmers'))).toBe(6);
    expect(advance(3, pca('BronzeAge'))).toBe(3);
    for (let i = 0; i <= 16; i++) expect(advance(i, pca('all'))).toBe(i);
  });
  it('the duplicated run_admixture step: once per matching position only', () => {
    let i = 5;
    i = advance(i, admix(3));
    expect(i).toBe(6);
    i = advance(i, admix(3));          // running it again does not skip run_pca(IronAge)
    expect(i).toBe(6);
    i = advance(advance(advance(i, pca('IronAge')), pca('Roman')), pca('AngloSaxon'));
    expect(i).toBe(9);
    i = advance(i, admix(3, 'AngloSaxon')); // extra period still counts
    expect(i).toBe(10);
  });
  it('a refused K is never a match', () => {
    expect(advance(5, admix(4))).toBe(5);
    expect(advance(9, admix(2))).toBe(9);
  });
  it('after the last step i stays at 16', () => {
    expect(advance(16, { name: 'allele_freq', gene: 'HLA-DQ2' })).toBe(16);
    expect(advance(16, EXTRAS[0]!)).toBe(16);
  });
  it('a corrupt index is clamped instead of crashing', () => {
    expect(advance(-3, SCRIPT[0]!)).toBe(1);
    expect(advance(Number.NaN, SCRIPT[0]!)).toBe(1);
    expect(advance(99, SCRIPT[0]!)).toBe(16);
    expect(advance(2.7, SCRIPT[2]!)).toBe(3);
  });
});

describe('hintText and hintCommand', () => {
  it('shows script[i] with the Next prefix', () => {
    expect(NEXT_PREFIX).toBe('Next: ');
    expect(hintText(0, null, 0)).toBe('Next: ancestry_test(person = "me")');
    expect(hintText(5, pca('BellBeaker'), 0)).toBe('Next: run_admixture(K = 3)');
    expect(hintText(15, null, 7)).toBe('Next: allele_freq(gene = "HLA-DQ2")');
  });
  it('shows the predict line right after run_pca(FirstFarmers) when BellBeaker is next', () => {
    expect(hintText(4, pca('FirstFarmers'), 0)).toBe(PREDICT_HINT);
    expect(hintText(4, null, 0)).toBe('Next: run_pca(period = "BellBeaker")');
    expect(hintText(4, { name: 'help' }, 0)).toBe('Next: run_pca(period = "BellBeaker")');
    expect(hintText(4, pca('Today'), 0)).toBe('Next: run_pca(period = "BellBeaker")'); // only FirstFarmers triggers it
    expect(hintText(4, pca('IronAge'), 0)).toBe('Next: run_pca(period = "BellBeaker")');
    expect(hintText(2, pca('FirstFarmers'), 0)).toBe('Next: run_pca(period = "Today")'); // FirstFarmers run early
  });
  it('a missing lastRan (undefined as well as null) never throws and gives the plain hint', () => {
    expect(hintText(4, undefined as unknown as null, 0)).toBe('Next: run_pca(period = "BellBeaker")');
  });
  it('after the last step rotates through the extras', () => {
    expect(EXTRA_PREFIX).toBe('Try an extra: ');
    expect([0, 1, 2, 3, 4, 5, -1].map((t) => hintText(16, null, t))).toEqual([
      'Try an extra: run_pca(period = "BronzeAge")',
      'Try an extra: run_pca(period = "Viking")',
      'Try an extra: run_pca(period = "all")',
      'Try an extra: run_admixture(K = 3, period = "BellBeaker")',
      'Try an extra: run_pca(period = "BronzeAge")',
      'Try an extra: run_pca(period = "Viking")',
      'Try an extra: run_admixture(K = 3, period = "BellBeaker")',
    ]);
  });
  it('hintCommand is what Esc and the three-tries auto-fill insert', () => {
    expect(hintCommand(0, 0)).toEqual({ name: 'ancestry_test', person: 'me' });
    expect(hintCommand(4, 0)).toEqual(pca('BellBeaker'));
    expect(hintCommand(16, 2)).toEqual(pca('all'));
    expect(hintCommand(99, 1)).toEqual(pca('Viking'));
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
  });
  it('the prefixes, every script hint and every extras hint obey spec §6 (ruleViolations is empty)', () => {
    const texts = [
      NEXT_PREFIX,
      EXTRA_PREFIX,
      ...SCRIPT.map((_, i) => hintText(i, null, 0)),
      ...EXTRAS.map((_, t) => hintText(SCRIPT.length, null, t)),
      hintText(4, pca('FirstFarmers'), 0), // the predict line
    ];
    expect(texts).toHaveLength(2 + 16 + 4 + 1);
    for (const s of texts) expect(ruleViolations(s), s).toEqual([]);
  });
});
