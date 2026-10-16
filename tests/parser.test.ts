import { describe, expect, it } from 'vitest';
import {
  COMMAND_NAMES, MAX_INPUT_LENGTH, PARSER_GENE_ORDER, PARSER_PERIOD_ORDER,
  completions, editDistance, formatCommand, normKey, parse,
  type Command, type ParseResult,
} from '../src/parser';

const ok = (command: Command): ParseResult => ({ ok: true, command });

// ---------- RF1: accepted spellings ----------
const ACCEPT: [string, Command][] = [
  // canonical forms
  ['help()', { name: 'help' }],
  ['load_genomes()', { name: 'load_genomes' }],
  ['clear()', { name: 'clear' }],
  ['run_pca(period = "Today")', { name: 'run_pca', period: 'Today' }],
  ['run_pca(period = "all")', { name: 'run_pca', period: 'all' }],
  ['run_admixture(K = 3)', { name: 'run_admixture', K: 3 }],
  ['run_admixture(K = 3, period = "BellBeaker")', { name: 'run_admixture', K: 3, period: 'BellBeaker' }],
  ['allele_freq(gene = "HLA-DQ2")', { name: 'allele_freq', gene: 'HLA-DQ2' }],
  ['ancestry_test(person = "me")', { name: 'ancestry_test', person: 'me' }],
  ['ancestry_test(person = "IronAge")', { name: 'ancestry_test', person: 'IronAge' }],
  // case
  ['RUN_PCA(PERIOD = "IRONAGE")', { name: 'run_pca', period: 'IronAge' }],
  ['Run_Pca(Period = "ironage")', { name: 'run_pca', period: 'IronAge' }],
  ['HELP()', { name: 'help' }],
  ['Allele_Freq(Gene = "lct")', { name: 'allele_freq', gene: 'LCT' }],
  ['run_admixture(k = 3)', { name: 'run_admixture', K: 3 }],
  // spacing (spaces, tabs, none, inside names and values)
  ['run_pca(period="IronAge")', { name: 'run_pca', period: 'IronAge' }],
  ['  run_pca ( period   =   "Iron Age" )  ', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca(\tperiod\t=\t"IronAge"\t)', { name: 'run_pca', period: 'IronAge' }],
  ['run pca(period = "Roman")', { name: 'run_pca', period: 'Roman' }],
  ['run _ pca(period = "Roman")', { name: 'run_pca', period: 'Roman' }],
  ['allele_freq(gene = "HLA DQ2")', { name: 'allele_freq', gene: 'HLA-DQ2' }],
  ['run_pca(period = "Iron Age")', { name: 'run_pca', period: 'IronAge' }],
  // quote styles
  ["run_pca(period = 'IronAge')", { name: 'run_pca', period: 'IronAge' }],
  ['run_pca(period = `IronAge`)', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca(period = “IronAge”)', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca(period = ‘IronAge’)', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca(period = IronAge)', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca(period = "IronAge\')', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca(period = "IronAge)', { name: 'run_pca', period: 'IronAge' }],
  // underscores and hyphens
  ['runpca(period = "IronAge")', { name: 'run_pca', period: 'IronAge' }],
  ['run__pca(period = "iron_age")', { name: 'run_pca', period: 'IronAge' }],
  ['run-pca(period = "IronAge")', { name: 'run_pca', period: 'IronAge' }],
  ['allele_freq(gene = "HLA_DQ2")', { name: 'allele_freq', gene: 'HLA-DQ2' }],
  ['allele_freq(gene = "hladq2")', { name: 'allele_freq', gene: 'HLA-DQ2' }],
  ['loadgenomes()', { name: 'load_genomes' }],
  // positional and bare forms (spec §4.1)
  ['run_pca("IronAge")', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca IronAge', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca iron age', { name: 'run_pca', period: 'IronAge' }],
  ['run pca iron age', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca period = IronAge', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca period=IronAge', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca: IronAge', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca all', { name: 'run_pca', period: 'all' }],
  ['help', { name: 'help' }],
  ['load_genomes', { name: 'load_genomes' }],
  ['load genomes', { name: 'load_genomes' }],
  ['clear', { name: 'clear' }],
  ['allele_freq LCT', { name: 'allele_freq', gene: 'LCT' }],
  ['allele_freq blue eyes', { name: 'allele_freq', gene: 'HERC2' }],
  ['ancestry_test me', { name: 'ancestry_test', person: 'me' }],
  ['ancestry test me', { name: 'ancestry_test', person: 'me' }],
  ['run_admixture 3', { name: 'run_admixture', K: 3 }],
  ['run_admixture 3 BellBeaker', { name: 'run_admixture', K: 3, period: 'BellBeaker' }],
  ['run_admixture K=3 period=BellBeaker', { name: 'run_admixture', K: 3, period: 'BellBeaker' }],
  ['run_admixture(3)', { name: 'run_admixture', K: 3 }],
  ['run_admixture(3, "BellBeaker")', { name: 'run_admixture', K: 3, period: 'BellBeaker' }],
  ['run_admixture(3 "BellBeaker")', { name: 'run_admixture', K: 3, period: 'BellBeaker' }],
  ['run_admixture(K = 3 period = "BellBeaker")', { name: 'run_admixture', K: 3, period: 'BellBeaker' }],
  ['run_admixture(period = "BellBeaker", K = 3)', { name: 'run_admixture', K: 3, period: 'BellBeaker' }],
  ['run_admixture(K = "3")', { name: 'run_admixture', K: 3 }],
  ['run_admixture(K = 3L)', { name: 'run_admixture', K: 3 }],
  ['run_admixture(K = three)', { name: 'run_admixture', K: 3 }],
  ['run_admixture(K = 3.0)', { name: 'run_admixture', K: 3 }],
  // other separators and forgiving punctuation
  ['run_pca(period: "IronAge")', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca(period <- "IronAge")', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca(period == "IronAge")', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca(period = "IronAge");', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca(period = "IronAge",)', { name: 'run_pca', period: 'IronAge' }],
  ['run_pca(period = "IronAge"', { name: 'run_pca', period: 'IronAge' }],
  ['> run_pca(period = "IronAge")', { name: 'run_pca', period: 'IronAge' }],
  ['$ help()', { name: 'help' }],
  ['help(run_pca)', { name: 'help' }],
  ['help me', { name: 'help' }],
  ['run_pca​(period = "IronAge")', { name: 'run_pca', period: 'IronAge' }],
  ['ｒｕｎ_pca(period = "IronAge")', { name: 'run_pca', period: 'IronAge' }],
  // K other than 3 parses fine: commands.ts refuses it, and a refusal is not an incorrect try (spec §4.2)
  ['run_admixture(K = 4)', { name: 'run_admixture', K: 4 }],
  ['run_admixture(K = 2, period = "Roman")', { name: 'run_admixture', K: 2, period: 'Roman' }],
  ['run_admixture(K = 2.5)', { name: 'run_admixture', K: 2.5 }],
  ['run_admixture(K = -1)', { name: 'run_admixture', K: -1 }],
  ['run_admixture(K = 0)', { name: 'run_admixture', K: 0 }],
];

describe('parse: accepted spellings (RF1)', () => {
  it.each(ACCEPT)('%s', (input, command) => {
    expect(parse(input)).toEqual(ok(command));
  });
  it('accepts exactly 200 characters and pins the table size', () => {
    const base = 'run_pca(period = "IronAge")';
    const padded = base.slice(0, -1) + ' '.repeat(MAX_INPUT_LENGTH - base.length) + ')';
    expect(padded.length).toBe(200);
    expect(parse(padded)).toEqual(ok({ name: 'run_pca', period: 'IronAge' }));
    expect(ACCEPT.length).toBe(80);
  });
});

// ---------- RF1: every alias in spec §4.1, plus display labels ----------
const PERIOD_ALIAS_CASES: [string, string][] = [
  ['today', 'Today'], ['modern', 'Today'], ['farmers', 'FirstFarmers'], ['stonehenge', 'FirstFarmers'],
  ['first farmers', 'FirstFarmers'], ['beaker', 'BellBeaker'], ['bronze age', 'BronzeAge'], ['iron age', 'IronAge'],
  ['iron', 'IronAge'], ['romans', 'Roman'], ['saxon', 'AngloSaxon'], ['anglo-saxon', 'AngloSaxon'], ['vikings', 'Viking'],
  // display labels students can read off the plot, and plurals
  ['Britain today', 'Today'], ['First farmers / Stonehenge builders', 'FirstFarmers'], ['Bell Beaker', 'BellBeaker'],
  ['Anglo-Saxons', 'AngloSaxon'], ['Anglo Saxon', 'AngloSaxon'], ['saxons', 'AngloSaxon'], ['beakers', 'BellBeaker'],
  ['bronze', 'BronzeAge'], ['viking', 'Viking'], ['roman', 'Roman'],
];
const GENE_ALIAS_CASES: [string, string][] = [
  ['rs4988235', 'LCT'], ['rs16891982', 'SLC45A2'], ['rs12913832', 'HERC2'], ['rs34536443', 'TYK2'], ['rs3891176', 'HLA-DQ2'],
  ['lactase', 'LCT'], ['milk', 'LCT'], ['skin', 'SLC45A2'], ['eyes', 'HERC2'], ['blue eyes', 'HERC2'],
  ['TB', 'TYK2'], ['tuberculosis', 'TYK2'], ['coeliac', 'HLA-DQ2'], ['celiac', 'HLA-DQ2'],
  ['RS4988235', 'LCT'], ['lactose', 'LCT'], ['tb', 'TYK2'], ['Coeliac disease', 'HLA-DQ2'],
];

describe('parse: aliases (RF1, spec §4.1)', () => {
  it.each(PERIOD_ALIAS_CASES)('period alias %s -> %s', (alias, id) => {
    expect(parse(`run_pca(period = "${alias}")`)).toEqual(ok({ name: 'run_pca', period: id } as Command));
    expect(parse(`ancestry_test(person = "${alias}")`)).toEqual(ok({ name: 'ancestry_test', person: id } as Command));
    expect(parse(`run_admixture(K = 3, period = "${alias}")`)).toEqual(ok({ name: 'run_admixture', K: 3, period: id } as Command));
  });
  it.each(GENE_ALIAS_CASES)('gene alias %s -> %s', (alias, id) => {
    expect(parse(`allele_freq(gene = "${alias}")`)).toEqual(ok({ name: 'allele_freq', gene: id } as Command));
    expect(parse(`allele_freq ${alias}`)).toEqual(ok({ name: 'allele_freq', gene: id } as Command));
  });
  it('every canonical id parses for its own command', () => {
    for (const p of PARSER_PERIOD_ORDER) expect(parse(`run_pca(period = "${p}")`)).toEqual(ok({ name: 'run_pca', period: p }));
    for (const g of PARSER_GENE_ORDER) expect(parse(`allele_freq(gene = "${g}")`)).toEqual(ok({ name: 'allele_freq', gene: g }));
  });
});

// ---------- RF1: errors, kinds and did-you-mean ----------
type Reject = [input: string, kind: string, suggestion: string | undefined];
const REJECT: Reject[] = [
  // typos in values, edit distance <= 2 (transpositions count 1)
  ['run_pca(period = "IronAg")', 'unknown_value', 'run_pca(period = "IronAge")'],
  ['run_pca(period = "Irnoage")', 'unknown_value', 'run_pca(period = "IronAge")'],
  ['run_pca(period = "Romna")', 'unknown_value', 'run_pca(period = "Roman")'],
  ['run_pca(period = "Vikng")', 'unknown_value', 'run_pca(period = "Viking")'],
  ['run_pca(period = "Belbeaker")', 'unknown_value', 'run_pca(period = "BellBeaker")'],
  ['run_pca(period = "BellBaeker")', 'unknown_value', 'run_pca(period = "BellBeaker")'],
  ['run_pca(period = "AngloSaxen")', 'unknown_value', 'run_pca(period = "AngloSaxon")'],
  ['run_pca(period = "FirstFamers")', 'unknown_value', 'run_pca(period = "FirstFarmers")'],
  ['run_pca(period = "Tody")', 'unknown_value', 'run_pca(period = "Today")'],
  ['run_pca(period = "alll")', 'unknown_value', 'run_pca(period = "all")'],
  ['run_pca(period = "anglo")', 'unknown_value', 'run_pca(period = "AngloSaxon")'],
  ['run_pca(period = "the roman period")', 'unknown_value', 'run_pca(period = "Roman")'],
  ['allele_freq(gene = "lactse")', 'unknown_value', 'allele_freq(gene = "LCT")'],
  ['allele_freq(gene = "HERC3")', 'unknown_value', 'allele_freq(gene = "HERC2")'],
  ['allele_freq(gene = "TYK")', 'unknown_value', 'allele_freq(gene = "TYK2")'],
  ['allele_freq(gene = "SLC45A")', 'unknown_value', 'allele_freq(gene = "SLC45A2")'],
  ['allele_freq(gene = "slc")', 'unknown_value', 'allele_freq(gene = "SLC45A2")'],
  ['allele_freq(gene = "rs4988236")', 'unknown_value', 'allele_freq(gene = "LCT")'],
  ['allele_freq(gene = "celiak")', 'unknown_value', 'allele_freq(gene = "HLA-DQ2")'],
  ['ancestry_test(person = "mee")', 'unknown_value', 'ancestry_test(person = "me")'],
  // value given to the wrong command: suggest the command that takes it
  ['run_pca(period = "LCT")', 'unknown_value', 'allele_freq(gene = "LCT")'],
  ['run_pca(period = "me")', 'unknown_value', 'ancestry_test(person = "me")'],
  ['allele_freq(gene = "IronAge")', 'unknown_value', 'run_pca(period = "IronAge")'],
  ['ancestry_test(person = "milk")', 'unknown_value', 'allele_freq(gene = "LCT")'],
  // unknown values with no close match
  ['run_pca(period = "Neolithic")', 'unknown_value', undefined],
  ['run_pca(period = "Medieval")', 'unknown_value', undefined],
  ['run_pca(period = "Tudor")', 'unknown_value', undefined],
  ['allele_freq(gene = "BRCA1")', 'unknown_value', undefined],
  ['ancestry_test(person = "all")', 'unknown_value', undefined],
  ['run_admixture(K = 3, period = "all")', 'unknown_value', 'run_admixture(K = 3)'],
  ['run_admixture(K = "x")', 'unknown_value', 'run_admixture(K = 3)'],
  ['run_admixture(K = 99999999)', 'unknown_value', 'run_admixture(K = 3)'],
  // typos in command names
  ['run_pac(period = "IronAge")', 'unknown_command', 'run_pca(period = "IronAge")'],
  ['runpcaa("Roman")', 'unknown_command', 'run_pca(period = "Roman")'],
  ['rn pca IronAge', 'unknown_command', 'run_pca(period = "IronAge")'],
  ['alele_freq(gene = "LCT")', 'unknown_command', 'allele_freq(gene = "LCT")'],
  ['ancestry_tset(person = "me")', 'unknown_command', 'ancestry_test(person = "me")'],
  ['lod_genomes()', 'unknown_command', 'load_genomes()'],
  ['hlep()', 'unknown_command', 'help()'],
  ['claer', 'unknown_command', 'clear()'],
  ['run_admxture(K = 3)', 'unknown_command', 'run_admixture(K = 3)'],
  ['pca IronAge', 'unknown_command', 'run_pca(period = "IronAge")'],
  ['admixture(K = 3)', 'unknown_command', 'run_admixture(K = 3)'],
  ['freq(LCT)', 'unknown_command', 'allele_freq(gene = "LCT")'],
  ['run_pac(period = "Neolithic")', 'unknown_command', 'run_pca'],
  // a value on its own: suggest the command that takes it
  ['IronAge', 'unknown_command', 'run_pca(period = "IronAge")'],
  ['"SLC45A2"', 'unknown_command', 'allele_freq(gene = "SLC45A2")'],
  ['iron age', 'unknown_command', 'run_pca(period = "IronAge")'],
  ['me', 'unknown_command', 'ancestry_test(person = "me")'],
  ['(Roman)', 'unknown_command', 'run_pca(period = "Roman")'],
  // unknown commands with no close match
  ['Neolithic', 'unknown_command', undefined],
  ['print("hello")', 'unknown_command', undefined],
  ['DROP TABLE students', 'unknown_command', undefined],
  ['<script>alert(1)</script>', 'unknown_command', undefined],
  ['__proto__', 'unknown_command', undefined],
  ['constructor()', 'unknown_command', undefined],
  ['\u{1F9B4}\u{1F9EC}', 'unknown_command', undefined],
  ['asdfghjkl', 'unknown_command', undefined],
  ['run', 'unknown_command', undefined],
  // unknown argument names
  ['run_pca(perod = "IronAge")', 'unknown_arg', 'run_pca(period = "IronAge")'],
  ['run_pca(time = "IronAge")', 'unknown_arg', 'run_pca(period = "IronAge")'],
  ['ancestry_test(period = "IronAge")', 'unknown_arg', 'ancestry_test(person = "IronAge")'],
  ['allele_freq(trait = "LCT")', 'unknown_arg', 'allele_freq(gene = "LCT")'],
  ['run_admixture(K = 3, perid = "Roman")', 'unknown_arg', 'run_admixture(K = 3, period = "Roman")'],
  ['run_admixture(K = 3, colour = "Roman")', 'unknown_arg', undefined],
  ['load_genomes(fast = TRUE)', 'unknown_arg', 'load_genomes()'],
  ['clear(all)', 'unknown_arg', 'clear()'],
  ['run_pca(__proto__ = 1)', 'unknown_arg', undefined],
  // missing arguments
  ['run_pca()', 'missing_arg', undefined],
  ['run_pca', 'missing_arg', undefined],
  ['run_pca(period = )', 'missing_arg', undefined],
  ['run_pca(period = "")', 'missing_arg', undefined],
  ['allele_freq()', 'missing_arg', undefined],
  ['ancestry_test()', 'missing_arg', undefined],
  ['run_admixture()', 'missing_arg', 'run_admixture(K = 3)'],
  ['run_admixture(period = "BellBeaker")', 'missing_arg', 'run_admixture(K = 3, period = "BellBeaker")'],
  // syntax
  ['', 'syntax', undefined],
  ['   ', 'syntax', undefined],
  [';;;', 'syntax', undefined],
  ['((( ', 'syntax', undefined],
  ['()', 'syntax', undefined],
  ['run_pca((IronAge))', 'syntax', 'run_pca(period = "IronAge")'],
  ['run_pca(period = "IronAge"))', 'syntax', 'run_pca(period = "IronAge")'],
  ['run_pca(period = "IronAge") run_pca(period = "Roman")', 'syntax', undefined],
  ['run_pca(period = "IronAge", period = "Roman")', 'syntax', 'run_pca(period = "IronAge")'],
  ['run_pca(IronAge, Roman)', 'syntax', 'run_pca(period = "IronAge")'],
  ['run_admixture(3, BellBeaker, Roman)', 'syntax', 'run_admixture(K = 3, period = "BellBeaker")'],
  // too long (2,000-character paste, and 201 characters)
  ['run_pca(period = "IronAge")'.repeat(75), 'too_long', undefined],
  ['a'.repeat(2000), 'too_long', undefined],
  [`run_pca(period = "IronAge")${' '.repeat(173)}x`, 'too_long', undefined],
];

describe('parse: errors and did-you-mean (RF1, spec §4.2)', () => {
  it.each(REJECT)('%s -> %s', (input, kind, suggestion) => {
    const r = parse(input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe(kind);
    expect(r.suggestion).toBe(suggestion);
    if (suggestion !== undefined) expect(r.message).toContain(`Did you mean ${suggestion}?`);
    else expect(r.message).not.toContain('Did you mean');
    expect(r.message.length).toBeGreaterThan(0);
  });

  it('pins the table size', () => {
    expect(REJECT.length).toBe(90);
  });

  it('every suggestion is itself a valid command (filling it in always works)', () => {
    for (const [input] of REJECT) {
      const r = parse(input);
      if (!r.ok && r.suggestion !== undefined && r.suggestion.includes('(')) expect(parse(r.suggestion).ok).toBe(true);
    }
  });

  it('pins the exact friendly messages', () => {
    expect(parse('run_pca(period = "Neolithic")')).toEqual({
      ok: false, kind: 'unknown_value',
      message: 'That is not a period in this workshop. Periods: Today, FirstFarmers, BellBeaker, BronzeAge, IronAge, Roman, AngloSaxon, Viking, all.',
    });
    expect(parse('run_pca(period = "IronAg")')).toEqual({
      ok: false, kind: 'unknown_value',
      message: 'That is not a period in this workshop. Did you mean run_pca(period = "IronAge")?',
      suggestion: 'run_pca(period = "IronAge")',
    });
    expect(parse('allele_freq(gene = "BRCA1")')).toMatchObject({ message: 'That is not a gene in this workshop. Genes: LCT, SLC45A2, HERC2, TYK2, HLA-DQ2.' });
    expect(parse('asdfghjkl')).toMatchObject({ message: "I don't know that command. Type help() to see the list." });
    expect(parse('run_pca()')).toMatchObject({ message: 'run_pca needs a period, for example run_pca(period = "Today").' });
    expect(parse('')).toMatchObject({ kind: 'syntax', message: 'Type a command and press Enter, or press Esc to fill in the hint.' });
    expect(parse('x'.repeat(201))).toEqual({ ok: false, kind: 'too_long', message: 'That is too long: commands are at most 200 characters.' });
  });

  it('never echoes the student’s text back (spec §6 rule 1; long pastes stay short)', () => {
    for (const input of ['run_pca(period = "Neolithic")', 'Mesolithic 5000 BC', 'run_pca(period = "Ice Age")', 'allele_freq(gene = "3000 years ago")']) {
      const r = parse(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).not.toMatch(/neolithic|mesolithic|ice age|years ago|\bBC\b/i);
    }
  });
});

// ---------- RF1: what counts as an incorrect try (spec §4.2; the controller counts every ok:false) ----------
describe('three-tries classification (spec §4.2)', () => {
  const COUNTS: [string, boolean][] = [
    ['run_pca(period = "Neolithic")', true],
    ['run_pac(period = "IronAge")', true],
    ['run_pca(perod = "IronAge")', true],
    ['run_pca()', true],
    ['))((', true],
    ['x'.repeat(2000), true],
    ['run_admixture(K = 4)', false],
    ['run_admixture(K = 3)', false],
    ['run_pca(period = "all")', false],
    ['RUN PCA iron age', false],
    ['help', false],
  ];
  it.each(COUNTS)('%s counts as an incorrect try: %s', (input, counts) => {
    expect(parse(input).ok).toBe(!counts);
  });
});

// ---------- RF1: junk never crashes ----------
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ALPHABET = ['r', 'u', 'n', '_', 'p', 'c', 'a', 'e', 'i', 'o', 'K', '3', '(', ')', '"', "'", '=', ',', ' ', ' ', '\t', ':', '<', '-', '“', 'é', '\u{1F9EC}', '\\', '\0', '\n', 'run_pca', 'IronAge', 'period', '__proto__', 'all', 'me'];
const KINDS = ['syntax', 'unknown_command', 'unknown_arg', 'unknown_value', 'missing_arg', 'too_long'];
const BANNED = /\b(BCE|BC|BP|kya|ya)\b|years ago|generations ago|neolithic|mesolithic|pal(a)?eolithic|megalithic|ice age/i;

describe('parse and completions: fuzzing (RF1)', () => {
  it('5,000 random inputs: no throw, valid shape, short friendly message, no banned words', () => {
    const rnd = mulberry32(20261022);
    for (let n = 0; n < 5000; n++) {
      const len = Math.floor(rnd() * 60);
      let s = '';
      for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
      const r = parse(s);
      if (r.ok) {
        expect(COMMAND_NAMES).toContain(r.command.name);
        expect(parse(formatCommand(r.command))).toEqual(r);
      } else {
        expect(KINDS).toContain(r.kind);
        expect(typeof r.message).toBe('string');
        expect(r.message.length).toBeGreaterThan(0);
        expect(r.message.length).toBeLessThanOrEqual(220);
        expect(r.message).not.toMatch(BANNED);
      }
      const c = completions(s);
      expect(Array.isArray(c)).toBe(true);
    }
  });

  it('non-string input and huge pastes return errors, never throw', () => {
    expect(parse(undefined as unknown as string)).toMatchObject({ ok: false, kind: 'syntax' });
    expect(parse(null as unknown as string)).toMatchObject({ ok: false, kind: 'syntax' });
    expect(parse('run_pca('.repeat(100000))).toMatchObject({ ok: false, kind: 'too_long' });
    expect(completions('a'.repeat(2000))).toEqual([]);
    expect(completions(undefined as unknown as string)).toEqual([]);
  });

  it('1,000 worst-case 200-character inputs parse in under 1 s total', () => {
    const inputs = Array.from({ length: 1000 }, (_, i) => `run_pca(period = "${'x'.repeat(170 + (i % 10))}")`.slice(0, 200));
    const t0 = performance.now();
    for (const s of inputs) parse(s);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

// ---------- formatCommand ----------
describe('formatCommand', () => {
  const CANONICAL: [Command, string][] = [
    [{ name: 'help' }, 'help()'],
    [{ name: 'load_genomes' }, 'load_genomes()'],
    [{ name: 'clear' }, 'clear()'],
    [{ name: 'run_pca', period: 'IronAge' }, 'run_pca(period = "IronAge")'],
    [{ name: 'run_pca', period: 'all' }, 'run_pca(period = "all")'],
    [{ name: 'run_admixture', K: 3 }, 'run_admixture(K = 3)'],
    [{ name: 'run_admixture', K: 3, period: 'BellBeaker' }, 'run_admixture(K = 3, period = "BellBeaker")'],
    [{ name: 'run_admixture', K: 4 }, 'run_admixture(K = 4)'],
    [{ name: 'allele_freq', gene: 'HLA-DQ2' }, 'allele_freq(gene = "HLA-DQ2")'],
    [{ name: 'ancestry_test', person: 'me' }, 'ancestry_test(person = "me")'],
  ];
  it.each(CANONICAL)('%j -> %s and back', (c, s) => {
    expect(formatCommand(c)).toBe(s);
    expect(parse(s)).toEqual(ok(c));
  });
  it('round-trips every command the workshop can run', () => {
    const all: Command[] = [
      { name: 'help' }, { name: 'load_genomes' }, { name: 'clear' },
      ...[...PARSER_PERIOD_ORDER, 'all' as const].map((period) => ({ name: 'run_pca', period }) as Command),
      { name: 'run_admixture', K: 3 },
      ...PARSER_PERIOD_ORDER.map((period) => ({ name: 'run_admixture', K: 3, period }) as Command),
      ...PARSER_GENE_ORDER.map((gene) => ({ name: 'allele_freq', gene }) as Command),
      ...['me' as const, ...PARSER_PERIOD_ORDER].map((person) => ({ name: 'ancestry_test', person }) as Command),
    ];
    expect(all.length).toBe(35);
    for (const c of all) expect(parse(formatCommand(c))).toEqual(ok(c));
  });
});

// ---------- completions (Tab) ----------
describe('completions (Tab)', () => {
  const CASES: [string, string[]][] = [
    ['', ['help()', 'load_genomes()', 'run_pca(period = "', 'run_admixture(K = 3)', 'allele_freq(gene = "', 'ancestry_test(person = "', 'clear()']],
    ['r', ['run_pca(period = "', 'run_admixture(K = 3)']],
    ['run_p', ['run_pca(period = "']],
    ['RUN PCA', ['run_pca(period = "']],
    ['he', ['help()']],
    ['al', ['allele_freq(gene = "']],
    ['a', ['allele_freq(gene = "', 'ancestry_test(person = "']],
    ['run_pca(period = "Ir', ['run_pca(period = "IronAge")']],
    ['run_pca(period = "b', ['run_pca(period = "BellBeaker")', 'run_pca(period = "BronzeAge")']],
    ['run_pca("ro', ['run_pca(period = "Roman")']],
    ['run_pca(', ['run_pca(period = "Today")', 'run_pca(period = "FirstFarmers")', 'run_pca(period = "BellBeaker")', 'run_pca(period = "BronzeAge")', 'run_pca(period = "IronAge")', 'run_pca(period = "Roman")', 'run_pca(period = "AngloSaxon")', 'run_pca(period = "Viking")', 'run_pca(period = "all")']],
    ['run_pca ir', ['run_pca(period = "IronAge")']],
    ['run_pca(period = "sto', ['run_pca(period = "FirstFarmers")']],
    ['run_pca(period = "sax', ['run_pca(period = "AngloSaxon")']],
    ['run_pca(period = "a', ['run_pca(period = "AngloSaxon")', 'run_pca(period = "all")']],
    ['allele_freq(gene = "H', ['allele_freq(gene = "HERC2")', 'allele_freq(gene = "HLA-DQ2")']],
    ['allele_freq(gene = "milk', ['allele_freq(gene = "LCT")']],
    ['allele_freq(gene = "rs49', ['allele_freq(gene = "LCT")']],
    ['allele_freq h', ['allele_freq(gene = "HERC2")', 'allele_freq(gene = "HLA-DQ2")']],
    ['ancestry_test(person = "m', ['ancestry_test(person = "me")']],
    ['ancestry_test(person = "i', ['ancestry_test(person = "IronAge")']],
    ['run_admixture(', ['run_admixture(K = 3)']],
    ['run_admixture(K = 3, p', ['run_admixture(K = 3, period = "']],
    ['run_admixture(K = 3, period = "Be', ['run_admixture(K = 3, period = "BellBeaker")']],
    ['help(', ['help()']],
    ['zzz', []],
    ['run_pca(period = "zzz', []],
    ['run_pca(period = "IronAge")', []],
    ['run_admixture(K = 4', []],
  ];
  it.each(CASES)('%j', (partial, expected) => {
    expect(completions(partial)).toEqual(expected);
  });
  it('every complete completion parses to a valid command', () => {
    for (const [partial] of CASES) for (const c of completions(partial)) if (c.endsWith(')')) expect(parse(c).ok).toBe(true);
  });
});

// ---------- helpers ----------
describe('normKey and editDistance', () => {
  it('normKey ignores case, spaces, quotes, underscores, hyphens, dots and slashes', () => {
    expect(normKey(' "Anglo-Saxon" ')).toBe('anglosaxon');
    expect(normKey('HLA_DQ2')).toBe('hladq2');
    expect(normKey('First farmers / Stonehenge builders')).toBe('firstfarmersstonehengebuilders');
    expect(normKey('“Iron Age”')).toBe('ironage');
  });
  it('editDistance is optimal string alignment with an early-exit limit', () => {
    expect(editDistance('roman', 'romna')).toBe(1);
    expect(editDistance('ironage', 'irnoage')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('neolithic', 'ironage', 2)).toBe(3);
    expect(editDistance('a'.repeat(200), 'b', 2)).toBe(3);
  });
});
