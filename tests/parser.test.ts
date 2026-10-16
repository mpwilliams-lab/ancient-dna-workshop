import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  COMMAND_NAMES, GENE_ALIASES, MAX_INPUT_LENGTH, PARSER_GENE_ORDER, PARSER_PERIOD_ORDER, PARSE_TEXT, PERIOD_ALIASES,
  completions, completionsCore, editDistance, formatCommand, leadInOf, normKey, parse, parseCore,
  type Command, type ParseResult,
} from '../src/parser';
import { ruleViolations } from './contentRules';

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
  ['run_pca(period = "Iron\u00A0Age")', { name: 'run_pca', period: 'IronAge' }],
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
  ['run_pca\u200B(period = "IronAge")', { name: 'run_pca', period: 'IronAge' }],
  ['\uFF52\uFF55\uFF4E_pca(period = "IronAge")', { name: 'run_pca', period: 'IronAge' }],
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
const ALPHABET = ['r', 'u', 'n', '_', 'p', 'c', 'a', 'e', 'i', 'o', 'K', '3', '(', ')', '"', "'", '=', ',', ' ', ' ', '\t', ':', '<', '-', '\u201C', '\u00E9', '\u{1F9EC}', '\\', '\0', '\n', 'run_pca', 'IronAge', 'period', '__proto__', 'all', 'me'];
const KINDS = ['syntax', 'unknown_command', 'unknown_arg', 'unknown_value', 'missing_arg', 'too_long'];
const BANNED = /\b(BCE|BC|BP|kya|ya)\b|years ago|generations ago|neolithic|mesolithic|pal(a)?eolithic|megalithic|ice age/i;

describe('parse and completions: fuzzing (RF1)', () => {
  // This stream is good at odd characters, but it can only spell run_pca and never yields an ok result (0 of 5,000),
  // so the "fuzzing from the real vocabulary" block at the end of this file does the deep coverage.
  it('5,000 random inputs: no throw, valid shape, short friendly message, no banned words', () => {
    const rnd = mulberry32(20261022);
    const thrown: string[] = [];
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
      // The same two calls without the safety net: an internal exception is a failure here, not a silent syntax error.
      try { parseCore(s); completionsCore(s); } catch (e) { thrown.push(`${JSON.stringify(s)}: ${String(e)}`); }
    }
    expect(thrown).toEqual([]);
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

// =====================================================================================================
// Added after the Task 7 review. Everything below is new. The tables and tests above are unchanged, except
// that the places that held raw invisible characters now spell them as escapes.
// =====================================================================================================

// ---------- source hygiene ----------
// Invisible and irregular-whitespace characters must be written as escapes, never typed raw: an editor or a sync
// tool can strip them without a trace, and nobody can review what they cannot see.
describe('source hygiene', () => {
  const RAW_INVISIBLE = /[\u000B\u000C\u0085\u00A0\u1680\u180E\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3000\uFEFF]/;
  it.each(['../src/parser.ts', './parser.test.ts'])('%s has no raw invisible or irregular-whitespace characters', (relative) => {
    const lines = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').split('\n');
    const offending = lines.flatMap((line, i) => (RAW_INVISIBLE.test(line) ? [i + 1] : []));
    expect(offending).toEqual([]);
  });
});

// ---------- invisible characters ----------
describe('invisible characters are ignored', () => {
  const WANT = ok({ name: 'run_pca', period: 'IronAge' });
  // Every character in the parser's ZERO_WIDTH class (U+200C sits inside its U+200B-U+200D range).
  const ZERO_WIDTHS: [label: string, ch: string][] = [
    ['U+200B zero-width space', '\u200B'],
    ['U+200C zero-width non-joiner', '\u200C'],
    ['U+200D zero-width joiner', '\u200D'],
    ['U+2060 word joiner', '\u2060'],
    ['U+FEFF byte-order mark', '\uFEFF'],
  ];
  it.each(ZERO_WIDTHS)('%s is ignored in a name, an argument name, a value, the bare form and at both ends', (_label, ch) => {
    expect(parse(`run_pca${ch}(period = "IronAge")`)).toEqual(WANT);
    expect(parse(`run_pca(per${ch}iod = "IronAge")`)).toEqual(WANT);
    expect(parse(`run_pca(period = "Iron${ch}Age")`)).toEqual(WANT);
    expect(parse(`run${ch}_pca${ch} IronAge`)).toEqual(WANT);
    expect(parse(`${ch}run_pca(period = "IronAge")${ch}`)).toEqual(WANT);
  });
  it('a non-breaking space is an ordinary space (NFKC folds it, so clean() needs no replacement of its own)', () => {
    const nb = '\u00A0';
    expect(parse(`run_pca${nb}(period${nb}=${nb}"IronAge")`)).toEqual(WANT);
    expect(parse(`run${nb}pca${nb}iron${nb}age`)).toEqual(WANT);
    expect(parse(`run_admixture${nb}3${nb}BellBeaker`)).toEqual(ok({ name: 'run_admixture', K: 3, period: 'BellBeaker' }));
  });
});

// ---------- a comma or semicolon after the closing parenthesis ----------
describe('a trailing comma or semicolon after the closing parenthesis is forgiven', () => {
  const ROWS: [string, Command][] = [
    ['run_pca(period = "IronAge"),', { name: 'run_pca', period: 'IronAge' }],
    ['run_pca(period = "IronAge") ,', { name: 'run_pca', period: 'IronAge' }],
    ['run_pca(period = "IronAge");,', { name: 'run_pca', period: 'IronAge' }],
    ['run_pca(period = "IronAge",),', { name: 'run_pca', period: 'IronAge' }],
    ['run_pca IronAge,', { name: 'run_pca', period: 'IronAge' }],
    ['run_admixture(K = 3, period = "BellBeaker"),', { name: 'run_admixture', K: 3, period: 'BellBeaker' }],
    ['allele_freq(gene = "LCT"),;', { name: 'allele_freq', gene: 'LCT' }],
    ['help(),', { name: 'help' }],
  ];
  it.each(ROWS)('%s', (input, command) => {
    expect(parse(input)).toEqual(ok(command));
  });
});

// ---------- suggestions never carry the student's own K ----------
describe("did-you-mean never carries the student's own K", () => {
  // [input, kind, suggestion, the student's own number (which must not come back)]
  const ROWS: [string, string, string, string][] = [
    ['run_admixture(K = 5000, period = "all")', 'unknown_value', 'run_admixture(K = 3)', '5000'],
    ['run_admixture(K = 4, period = "all")', 'unknown_value', 'run_admixture(K = 3)', '4'],
    ['run_admixture(K = 4, perid = "Roman")', 'unknown_arg', 'run_admixture(K = 3, period = "Roman")', '4'],
    ['run_admixture(K = 4, period = "Romna")', 'unknown_value', 'run_admixture(K = 3, period = "Roman")', '4'],
    ['run_admxture(K = 2.5, period = "Roman")', 'unknown_command', 'run_admixture(K = 3, period = "Roman")', '2.5'],
    ['admixture(K = 4)', 'unknown_command', 'run_admixture(K = 3)', '4'],
    ['run_admixture(K = 4))', 'syntax', 'run_admixture(K = 3)', '4'],
    ['run_admixture(4, BellBeaker, Roman)', 'syntax', 'run_admixture(K = 3, period = "BellBeaker")', '4'],
  ];
  it.each(ROWS)('%s', (input, kind, suggestion, theirs) => {
    const r = parse(input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe(kind);
    expect(r.suggestion).toBe(suggestion);
    expect(r.message).toContain(`Did you mean ${suggestion}?`);
    expect(r.message).not.toContain(theirs);
    expect(parse(suggestion).ok).toBe(true);
  });
  it('a K other than 3 still parses: commands.ts refuses it, and a refusal is not an incorrect try', () => {
    expect(parse('run_admixture(K = 4)')).toEqual(ok({ name: 'run_admixture', K: 4 }));
  });
});

// ---------- the section 6 content rules over the parser's own text ----------
const WORKSHOP_COMMANDS: Command[] = [
  { name: 'help' }, { name: 'load_genomes' }, { name: 'clear' },
  ...[...PARSER_PERIOD_ORDER, 'all' as const].map((period) => ({ name: 'run_pca', period }) as Command),
  { name: 'run_admixture', K: 3 },
  ...PARSER_PERIOD_ORDER.map((period) => ({ name: 'run_admixture', K: 3, period }) as Command),
  ...PARSER_GENE_ORDER.map((gene) => ({ name: 'allele_freq', gene }) as Command),
  ...['me' as const, ...PARSER_PERIOD_ORDER].map((person) => ({ name: 'ancestry_test', person }) as Command),
];
const PARAM_NAMES = ['period', 'K', 'gene', 'person'];

/** Every string the parser can put on screen: each static PARSE_TEXT entry, and each function entry called with every command and parameter. */
function everyParseTextString(): string[] {
  const out: string[] = [];
  for (const value of Object.values(PARSE_TEXT)) {
    if (typeof value === 'string') { out.push(value); continue; }
    const produce = value as unknown as (...args: string[]) => string;
    for (const name of COMMAND_NAMES) for (const param of PARAM_NAMES) out.push(produce(name, param));
    for (const suggestion of [...COMMAND_NAMES, ...WORKSHOP_COMMANDS.map(formatCommand)]) {
      try { out.push(produce(suggestion)); } catch { /* an entry that takes a command name, not a suggestion */ }
    }
  }
  return out;
}

describe('PARSE_TEXT obeys the section 6 content rules', () => {
  it('has only string and function entries, so the enumeration sees all of it', () => {
    for (const [key, value] of Object.entries(PARSE_TEXT)) expect(['string', 'function'], key).toContain(typeof value);
  });
  it('every string it can produce is free of section 6 violations', () => {
    const strings = [...new Set(everyParseTextString())];
    expect(strings.length).toBeGreaterThan(60);
    expect(strings.filter((s) => ruleViolations(s).length > 0)).toEqual([]);
  });
  it('the messages parse() returns for the rejected inputs above are free of violations too', () => {
    const offending: string[] = [];
    for (const [input] of REJECT) {
      const r = parse(input);
      if (!r.ok && ruleViolations(r.message).length > 0) offending.push(input);
    }
    expect(offending).toEqual([]);
  });
});

// ---------- the safety net and its seam ----------
describe('the safety net and its seam', () => {
  it('parseCore and completionsCore return exactly what parse and completions return', () => {
    for (const s of ['', 'help', 'run_pca(period = "IronAge")', 'run_pca(period = "Neolithic")', 'run_pca(period = "Ir', 'r', 'x'.repeat(300)]) {
      expect(parseCore(s)).toEqual(parse(s));
      expect(completionsCore(s)).toEqual(completions(s));
    }
  });

  it('if the code underneath throws, parse and completions still answer, and the cores show the exception', () => {
    const spy = vi.spyOn(String.prototype, 'normalize').mockImplementation(() => { throw new Error('forced failure'); });
    let parsed: unknown; let listed: unknown; let coreError: unknown; let listError: unknown;
    try {
      parsed = parse('help()');
      listed = completions('r');
      try { parseCore('help()'); } catch (e) { coreError = e; }
      try { completionsCore('r'); } catch (e) { listError = e; }
    } finally {
      spy.mockRestore();
    }
    expect(parsed).toEqual({ ok: false, kind: 'syntax', message: PARSE_TEXT.syntax });
    expect(listed).toEqual([]);
    expect(String(coreError)).toContain('forced failure');
    expect(String(listError)).toContain('forced failure');
  });
});

// ---------- fuzzing from the real vocabulary ----------
// The character-level fuzz above spells run_pca and nothing else, so none of its 5,000 inputs parses (okCount 0) and most
// of the parser is out of its reach. This one is built from the real command names, the parser's own alias tables, argument
// names, separators, quote characters, digits and number words, then mutated at random. It calls parseCore and
// completionsCore, which have no safety net, so an internal exception is a test failure instead of a silent syntax error.
type Rnd = () => number;
const choose = <T>(rnd: Rnd, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const chance = (rnd: Rnd, p: number): boolean => rnd() < p;

const LDQUO = '\u201C'; const RDQUO = '\u201D'; const LSQUO = '\u2018'; const RSQUO = '\u2019';
const NBSP = '\u00A0'; const ZWSP = '\u200B';

const PERIOD_WORDS: string[] = [...Object.values(PERIOD_ALIASES).flat(), ...PARSER_PERIOD_ORDER];
const GENE_WORDS: string[] = [...Object.values(GENE_ALIASES).flat(), ...PARSER_GENE_ORDER];
const JUNK_WORDS = ['Neolithic', 'Medieval', 'Tudor', 'Mesolithic', 'BRCA1', 'the roman period', 'anglo', 'IronAg', 'Romna', 'lactse', 'celiak', 'rs4988236', '', '__proto__', 'constructor'];
const PCA_WORDS = [...PERIOD_WORDS, 'all'];
const PERSON_WORDS = [...PERIOD_WORDS, 'me', 'myself'];
const K_WORDS = ['3', '3', '3', '3L', '3.0', 'three', 'Three', '4', '2', '10', '2.5', '-1', '0', '03', '123456.123456', '99999999', '1e3', 'x', 'one', 'eleven'];
// Values that belong to another command, or to none, so the cross-command and no-suggestion paths run too.
const PCA_WRONG = [...GENE_WORDS, 'me', ...JUNK_WORDS];
const GENE_WRONG = [...PERIOD_WORDS, 'me', ...JUNK_WORDS];
const PERSON_WRONG = [...GENE_WORDS, 'all', ...JUNK_WORDS];
const ADMIX_WRONG = ['all', ...GENE_WORDS, ...JUNK_WORDS];
const ALL_WORDS = [...COMMAND_NAMES, ...PCA_WORDS, ...GENE_WORDS, ...K_WORDS, 'me', 'period', 'gene', 'person', 'K'];
const ARG_NAME_TYPOS = ['perod', 'time', 'trait', 'colour', 'Gene', 'PERSON', 'k', '__proto__'];
const SEPARATORS = ['=', '=', '=', '==', ':', '<-', ' = ', ' = ', ' == ', ' : ', ' <- ', '= ', ' ='];
const QUOTE_PAIRS: [string, string][] = [['"', '"'], ['"', '"'], ["'", "'"], ['`', '`'], [LDQUO, RDQUO], [LSQUO, RSQUO], ['', ''], ['', ''], ['"', ''], ['', '"'], ['"', "'"]];
const OPENS = ['(', '(', '(', '(', ' (', '( '];
const CLOSES = [')', ')', ')', ')', ' )', '', ');', '),', '))'];
const JOINERS = [', ', ', ', ',', ' ', ' , ', ',,'];
const PROMPTS = ['', '', '', '', '> ', '$ ', ' ', '\t'];
const SUFFIXES = ['', '', '', ';', ',', ' ', ' ;', ';;'];
const NOISE = ['"', "'", '`', '(', ')', ',', ';', '=', ':', '<', '-', '_', ' ', '\t', '.', '/', '\\', '>', '$', '0', '1', '3', 'x', 'e', '\n', '\0', LDQUO, RDQUO, NBSP, ZWSP, '\u{1F9EC}'];

const spellings = (name: string): string[] => [name, name, name, name.toUpperCase(), name.replace(/_/g, ''), name.replace(/_/g, ' '), name.replace(/_/g, '-'), name.replace(/_/g, ' _ ')];
const quoted = (rnd: Rnd, word: string): string => { const [open, close] = choose(rnd, QUOTE_PAIRS); return open + word + close; };

/** One argument as a student might type it: `name = "value"`, or just `"value"`. */
function piece(rnd: Rnd, argName: string, word: string): string {
  const value = quoted(rnd, word);
  if (chance(rnd, 0.3)) return value;
  return (chance(rnd, 0.85) ? argName : choose(rnd, ARG_NAME_TYPOS)) + choose(rnd, SEPARATORS) + value;
}

function argPieces(rnd: Rnd, name: Command['name']): string[] {
  switch (name) {
    case 'help':
      return chance(rnd, 0.6) ? [] : [piece(rnd, 'topic', choose(rnd, ALL_WORDS))];
    case 'load_genomes':
    case 'clear':
      return chance(rnd, 0.8) ? [] : [piece(rnd, 'fast', 'TRUE')];
    case 'run_pca':
      return [piece(rnd, 'period', choose(rnd, chance(rnd, 0.85) ? PCA_WORDS : PCA_WRONG))];
    case 'allele_freq':
      return [piece(rnd, 'gene', choose(rnd, chance(rnd, 0.85) ? GENE_WORDS : GENE_WRONG))];
    case 'ancestry_test':
      return [piece(rnd, 'person', choose(rnd, chance(rnd, 0.85) ? PERSON_WORDS : PERSON_WRONG))];
    case 'run_admixture': {
      if (chance(rnd, 0.05)) return [];
      const k = piece(rnd, 'K', choose(rnd, K_WORDS));
      if (chance(rnd, 0.4)) return [k];
      const p = piece(rnd, 'period', chance(rnd, 0.1) ? 'all' : choose(rnd, chance(rnd, 0.9) ? PERIOD_WORDS : ADMIX_WRONG));
      return chance(rnd, 0.85) ? [k, p] : [p, k];
    }
  }
}

function vocabularyInput(rnd: Rnd): string {
  if (chance(rnd, 0.03)) {
    // a value on its own, which suggests the command that takes it
    return choose(rnd, ['', '(', '"']) + choose(rnd, [...PCA_WORDS, ...GENE_WORDS, 'me', 'myself']) + choose(rnd, ['', ')', '"']);
  }
  const name = choose(rnd, COMMAND_NAMES);
  const head = choose(rnd, spellings(name));
  const pieces = argPieces(rnd, name);
  const body = chance(rnd, 0.75)
    ? head + choose(rnd, OPENS) + pieces.join(choose(rnd, JOINERS)) + choose(rnd, CLOSES)
    : [head, ...pieces].join(' ');
  return choose(rnd, PROMPTS) + body + choose(rnd, SUFFIXES);
}

function mutated(rnd: Rnd, s: string): string {
  let out = s;
  const count = 1 + Math.floor(rnd() * 3);
  for (let m = 0; m < count; m++) {
    const i = Math.floor(rnd() * (out.length + 1));
    switch (Math.floor(rnd() * 9)) {
      case 0: out = out.slice(0, i) + out.slice(i + 1); break;                                                  // delete a character
      case 1: out = out.slice(0, i) + choose(rnd, NOISE) + out.slice(i); break;                                 // insert noise
      case 2: out = out.slice(0, i) + choose(rnd, NOISE) + out.slice(i + 1); break;                             // replace with noise
      case 3: if (i + 1 < out.length) out = out.slice(0, i) + out[i + 1] + out[i] + out.slice(i + 2); break;   // transpose two characters
      case 4: out = out.slice(0, i) + out.charAt(i) + out.slice(i); break;                                      // double a character
      case 5: out = out.slice(0, i); break;                                                                     // truncate
      case 6: out = out.slice(0, i) + out.slice(i).toUpperCase(); break;                                        // shout the tail
      case 7: out = out.slice(0, i) + choose(rnd, ALL_WORDS) + out.slice(i); break;                             // splice in a word
      default: out = out.slice(0, i) + out.slice(i).toLowerCase(); break;
    }
  }
  return out;
}

function fuzzInput(rnd: Rnd): string {
  let s = vocabularyInput(rnd);
  if (chance(rnd, 0.45)) s = mutated(rnd, s);
  if (chance(rnd, 0.004)) s = s.repeat(1 + Math.ceil(MAX_INPUT_LENGTH / Math.max(1, s.length)));   // over the 200-character cap
  return s;
}

/** The keys a command object may have (run_admixture's period is optional). */
const COMMAND_KEYS: Record<string, readonly string[]> = {
  help: ['name'], load_genomes: ['name'], clear: ['name'],
  run_pca: ['name', 'period'], run_admixture: ['name', 'K', 'period'], allele_freq: ['name', 'gene'], ancestry_test: ['name', 'person'],
};

interface FuzzRun {
  inputs: number;
  ok: number;
  commands: Record<string, number>;
  pca: Record<string, number>;
  genes: Record<string, number>;
  persons: Record<string, number>;
  admixture: { k3: number; kOther: number; withPeriod: number; withoutPeriod: number };
  kinds: Record<string, number>;
  suggestions: number;
  bareSuggestions: number;
  completionLists: number;
  exceptions: string[]; exceptionCount: number;
  problems: string[]; problemCount: number;
}
const newRun = (): FuzzRun => ({
  inputs: 0, ok: 0, commands: {}, pca: {}, genes: {}, persons: {},
  admixture: { k3: 0, kOther: 0, withPeriod: 0, withoutPeriod: 0 },
  kinds: {}, suggestions: 0, bareSuggestions: 0, completionLists: 0,
  exceptions: [], exceptionCount: 0, problems: [], problemCount: 0,
});
const bump = (counts: Record<string, number>, key: string): void => { counts[key] = (counts[key] ?? 0) + 1; };

/**
 * Runs one input through the unguarded cores and checks every invariant. Failures are recorded, not thrown, so one run reports
 * them all. So is an exception from any call made along the way (the first parse, the repeat, the round trip, the re-parse of a
 * suggestion or a completion): it is recorded against the input that caused it, and the tests below fail with that list.
 */
function checkInput(s: string, run: FuzzRun, constantMessages: ReadonlySet<string>): void {
  const label = JSON.stringify(s.length > 90 ? `${s.slice(0, 90)}...` : s);
  const bad = (what: string): void => { run.problemCount++; if (run.problems.length < 20) run.problems.push(`${label}: ${what}`); };
  try {
    checkAll(s, run, constantMessages, bad);
    run.inputs++;   // counted only if nothing threw, so an input that crashed can never make a test pass vacuously
  } catch (e) {
    run.exceptionCount++;
    if (run.exceptions.length < 20) run.exceptions.push(`${label}: ${String(e)}`);
  }
}

function checkAll(s: string, run: FuzzRun, constantMessages: ReadonlySet<string>, bad: (what: string) => void): void {
  const r = parseCore(s);
  const list = completionsCore(s);
  if (!isDeepStrictEqual(parseCore(s), r)) bad('the same input gave two different answers');
  if (!isDeepStrictEqual(parse(s), r)) bad('parse and parseCore disagree');

  if (r.ok) {
    const c = r.command;
    run.ok++;
    bump(run.commands, c.name);
    const keys = Object.keys(c);
    if (!keys.includes('name') || keys.some((k) => !COMMAND_KEYS[c.name].includes(k))) bad(`unexpected shape ${JSON.stringify(c)}`);
    if (c.name === 'run_pca') {
      bump(run.pca, c.period);
      if (!keys.includes('period') || ![...PARSER_PERIOD_ORDER, 'all'].includes(c.period)) bad(`bad run_pca ${JSON.stringify(c)}`);
    } else if (c.name === 'allele_freq') {
      bump(run.genes, c.gene);
      if (!keys.includes('gene') || !PARSER_GENE_ORDER.includes(c.gene)) bad(`bad allele_freq ${JSON.stringify(c)}`);
    } else if (c.name === 'ancestry_test') {
      bump(run.persons, c.person);
      if (!keys.includes('person') || !['me', ...PARSER_PERIOD_ORDER].includes(c.person)) bad(`bad ancestry_test ${JSON.stringify(c)}`);
    } else if (c.name === 'run_admixture') {
      if (c.K === 3) run.admixture.k3++; else run.admixture.kOther++;
      if (c.period === undefined) run.admixture.withoutPeriod++; else run.admixture.withPeriod++;
      if (!Number.isFinite(c.K) || keys.includes('period') !== (c.period !== undefined)
        || (c.period !== undefined && !PARSER_PERIOD_ORDER.includes(c.period))) bad(`bad run_admixture ${JSON.stringify(c)}`);
    }
    // the guided-script round trip: what formatCommand writes, parse reads back identically
    if (!isDeepStrictEqual(parseCore(formatCommand(c)), r)) bad(`does not round-trip through formatCommand: ${formatCommand(c)}`);
  } else {
    bump(run.kinds, r.kind);
    if (!KINDS.includes(r.kind)) bad(`unknown kind ${String(r.kind)}`);
    if (typeof r.message !== 'string' || r.message.length === 0 || r.message.length > 220) bad(`message length ${String(r.message).length}`);
    if (BANNED.test(r.message)) bad('banned word in the message');
    if (ruleViolations(r.message).length > 0) bad('section 6 violation in the message');
    if (s.length > MAX_INPUT_LENGTH * 4 && r.kind !== 'too_long') bad('a huge paste is not too_long');
    if (r.kind === 'too_long' && s.length <= MAX_INPUT_LENGTH) bad('too_long for a short input');
    const tail = r.suggestion === undefined ? '' : `Did you mean ${r.suggestion}?`;
    if (r.suggestion === undefined && r.message.includes('Did you mean')) bad('did-you-mean without a suggestion');
    if (r.suggestion !== undefined && !r.message.endsWith(tail)) bad('the message does not end with its did-you-mean');
    // no echo, by construction: apart from the suggestion, a message is PARSE_TEXT and nothing else
    const head = r.suggestion === undefined ? r.message : r.message.slice(0, Math.max(0, r.message.length - tail.length)).trimEnd();
    if (!constantMessages.has(head)) bad(`the message is not built from PARSE_TEXT: ${JSON.stringify(head)}`);
    if (r.suggestion !== undefined) {
      run.suggestions++;
      if (r.suggestion.includes('(')) {
        const p = parseCore(r.suggestion);
        if (!p.ok || formatCommand(p.command) !== r.suggestion) bad(`the suggestion is not a canonical command: ${r.suggestion}`);
        else if (p.command.name === 'run_admixture' && p.command.K !== 3) bad(`the suggestion carries the student's K: ${r.suggestion}`);
      } else {
        run.bareSuggestions++;
        if (!(COMMAND_NAMES as readonly string[]).includes(r.suggestion)) bad(`the bare suggestion is not a command name: ${r.suggestion}`);
      }
    }
  }

  if (!Array.isArray(list) || list.some((x) => typeof x !== 'string')) {
    bad('completions is not a list of strings');
  } else {
    if (new Set(list).size !== list.length) bad('duplicate completions');
    if (list.length > 0) run.completionLists++;
    for (const x of list) {
      if (x.length > MAX_INPUT_LENGTH) bad('a completion is longer than the cap');
      if (x.endsWith(')')) {
        const p = parseCore(x);
        if (!p.ok || formatCommand(p.command) !== x) bad(`a finished completion is not a canonical command: ${x}`);
      } else if (!x.endsWith('"')) {
        bad(`a completion is neither a finished command nor a stem: ${x}`);
      }
    }
  }
}

const FUZZ_INPUTS = 30000;

function runFuzz(seed: number, count: number): FuzzRun {
  const rnd = mulberry32(seed);
  const run = newRun();
  const bases = [...new Set(everyParseTextString())];
  const constantMessages = new Set<string>(bases);
  for (const a of bases) for (const b of bases) constantMessages.add(`${a} ${b}`);
  for (let n = 0; n < count; n++) checkInput(fuzzInput(rnd), run, constantMessages);
  return run;
}

describe('fuzzing from the real vocabulary', () => {
  let run: FuzzRun;
  beforeAll(() => { run = runFuzz(20261023, FUZZ_INPUTS); }, 120_000);

  it('no internal exception escapes parseCore or completionsCore (the safety net would have hidden it)', () => {
    expect(run.exceptions).toEqual([]);
    expect(run.exceptionCount).toBe(0);
  });
  it('every invariant holds: shape, round trip, repeatability, messages, suggestions and completions', () => {
    expect(run.inputs).toBe(FUZZ_INPUTS);   // an input that threw was never checked, so this cannot pass vacuously
    expect(run.problems).toEqual([]);
    expect(run.problemCount).toBe(0);
  });
  it('is not a junk stream: okCount is large, and so is the number of near-misses', () => {
    expect(run.inputs).toBe(FUZZ_INPUTS);
    expect(run.ok).toBeGreaterThan(FUZZ_INPUTS / 10);
    expect(run.inputs - run.ok).toBeGreaterThan(FUZZ_INPUTS / 10);
  });
  it('every command is hit', () => {
    for (const name of COMMAND_NAMES) expect(run.commands[name] ?? 0, name).toBeGreaterThan(200);
  });
  it('the period, gene, person and K bindings are all hit', () => {
    for (const period of [...PARSER_PERIOD_ORDER, 'all']) expect(run.pca[period] ?? 0, `run_pca ${period}`).toBeGreaterThan(20);
    for (const gene of PARSER_GENE_ORDER) expect(run.genes[gene] ?? 0, `allele_freq ${gene}`).toBeGreaterThan(20);
    for (const person of ['me', ...PARSER_PERIOD_ORDER]) expect(run.persons[person] ?? 0, `ancestry_test ${person}`).toBeGreaterThan(20);
    expect(run.admixture.k3).toBeGreaterThan(200);
    expect(run.admixture.kOther).toBeGreaterThan(200);
    expect(run.admixture.withPeriod).toBeGreaterThan(200);
    expect(run.admixture.withoutPeriod).toBeGreaterThan(200);
  });
  it('every error kind is hit, with suggestions of both shapes', () => {
    for (const kind of KINDS) expect(run.kinds[kind] ?? 0, kind).toBeGreaterThan(20);
    expect(run.suggestions).toBeGreaterThan(1000);
    expect(run.bareSuggestions).toBeGreaterThan(100);
  });
  it('Tab completion is exercised: lists come back for a good share of the inputs', () => {
    expect(run.completionLists).toBeGreaterThan(FUZZ_INPUTS / 20);
  });
});

// =====================================================================================================
// Added in the final-review fix wave. A student who types the hint line as it is shown ("Next: ..." or
// "Try an extra: ...") or copies a prompt along with a command (once, twice, spaced) must not be told the
// command is unknown: that is an incorrect try, and three in a row fill in the command they just typed.
// =====================================================================================================
describe('lead-ins: copied prompts and the hint line labels are forgiven (RF1)', () => {
  // Written as escapes on purpose (see "source hygiene" above): no raw tab characters in this file.
  const LEAD_INS: string[] = [
    '> ', '$ ', '>', '$', '> > ', '>> ', '>>>', '$ $ ', '$>', ' > $ ', '\t> ',
    'Next: ', 'Next:', 'next: ', 'NEXT: ', 'Next : ', 'Next   :   ', 'Next:\t',
    'Try an extra: ', 'Try an extra:', 'try an extra: ', 'TRY AN EXTRA: ', 'Try  an   extra : ', 'Try\tan\textra:',
    '> Next: ', '$ Try an extra: ', 'Next: > ', '> > Next: > ', 'Next: Next: ', 'Try an extra: Next: ',
  ];

  it('accepts `> > help()` (a repeated, spaced prompt) and the other spellings of the same thing', () => {
    expect(parse('> > help()')).toEqual(ok({ name: 'help' }));
    const rows: [string, Command][] = [
      ['> > help()', { name: 'help' }],
      ['>> help()', { name: 'help' }],
      ['>>help()', { name: 'help' }],
      ['$ $ help()', { name: 'help' }],
      ['> $ > help()', { name: 'help' }],
      ['Next: ancestry_test(person = "me")', { name: 'ancestry_test', person: 'me' }],
      ['Try an extra: run_pca(period = "BronzeAge")', { name: 'run_pca', period: 'BronzeAge' }],
      ['Try an extra: run_admixture(K = 3, period = "BellBeaker")', { name: 'run_admixture', K: 3, period: 'BellBeaker' }],
      ['next:run_pca(period = "IronAge")', { name: 'run_pca', period: 'IronAge' }],
      ['NEXT : RUN_PCA(PERIOD = "IRONAGE")', { name: 'run_pca', period: 'IronAge' }],
      ['try   an   extra :   run_pca iron age', { name: 'run_pca', period: 'IronAge' }],
      ['> Next: allele_freq(gene = "HLA-DQ2")', { name: 'allele_freq', gene: 'HLA-DQ2' }],
      ['Next: ancestry_test(person = "me");', { name: 'ancestry_test', person: 'me' }],
      ['Ｎｅｘｔ： help()', { name: 'help' }], // fullwidth "Next:" (NFKC folds it, like the fullwidth command in ACCEPT)
    ];
    for (const [input, command] of rows) expect(parseCore(input), input).toEqual(ok(command));
  });

  it('every command the workshop can run still parses to itself behind every lead-in', () => {
    expect(WORKSHOP_COMMANDS.length).toBe(35);
    for (const lead of LEAD_INS) {
      for (const c of WORKSHOP_COMMANDS) expect(parseCore(lead + formatCommand(c)), JSON.stringify(lead + formatCommand(c))).toEqual(ok(c));
    }
  });

  it('every accepted spelling in the ACCEPT table parses the same behind every lead-in', () => {
    for (const lead of LEAD_INS) {
      for (const [input, command] of ACCEPT) expect(parseCore(lead + input), JSON.stringify(lead + input)).toEqual(ok(command));
    }
  });

  it('every REJECT row is rejected the same way behind every lead-in (kind, suggestion and message unchanged)', () => {
    for (const lead of LEAD_INS) {
      for (const [input] of REJECT) {
        const behind = parseCore(lead + input);
        const alone = parseCore(input);
        expect(behind, JSON.stringify(lead + input)).toEqual(alone);
      }
    }
  });

  it('a lead-in with nothing after it is the empty-input message, like a bare prompt', () => {
    const empty = { ok: false, kind: 'syntax', message: PARSE_TEXT.empty };
    for (const lead of ['>', '> >', '$', 'Next:', 'Next: ', 'next :', 'Try an extra:', 'Try an extra: ', '> Next: ', 'Next: >']) {
      expect(parseCore(lead), JSON.stringify(lead)).toEqual(empty);
    }
  });

  it('a label needs its colon and its own words: only the real hint labels are forgiven', () => {
    // Unchanged behaviour on purpose: these are not what the hint line shows, so they are not forgiven.
    for (const input of ['Next ancestry_test(person = "me")', 'Try an extra run_pca(period = "BronzeAge")', 'Try: run_pca(period = "BronzeAge")']) {
      const r = parseCore(input);
      expect(r.ok, input).toBe(false);
    }
  });

  it('a label does not make a bad command good, and its messages never echo the student', () => {
    const r = parseCore('Next: run_pca(period = "Neolithic")');
    expect(r).toEqual(parseCore('run_pca(period = "Neolithic")'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toMatch(/neolithic|next/i);
    expect(parseCore('Try an extra: Neolithic')).toEqual(parseCore('Neolithic'));
  });

  it('a label is only a lead-in: after the command it is not stripped, so a second command stays one-at-a-time', () => {
    const r = parseCore('run_pca(period = "Roman") Next: help()');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('syntax');
  });

  it('completions skip the same lead-ins, so Tab works on a line that starts with the hint label', () => {
    const partials = ['', 'r', 'run_p', 'RUN PCA', 'he', 'a', 'run_pca(', 'run_pca(period = "Ir', 'run_pca ir', 'allele_freq(gene = "H', 'ancestry_test(person = "m', 'run_admixture(K = 3, p', 'zzz', 'run_pca(period = "IronAge")'];
    for (const lead of LEAD_INS) {
      for (const partial of partials) expect(completionsCore(lead + partial), JSON.stringify(lead + partial)).toEqual(completionsCore(partial));
    }
    expect(completionsCore('Next: run_p')).toEqual(['run_pca(period = "']);
    expect(completions('> > run_pca(period = "Ir')).toEqual(['run_pca(period = "IronAge")']);
  });

  it('3,000 random vocabulary inputs mean the same with a lead-in in front (parse and completions)', () => {
    const rnd = mulberry32(20261031);
    let compared = 0;
    for (let n = 0; n < 3000; n++) {
      const body = fuzzInput(rnd);
      const lead = choose(rnd, LEAD_INS);
      if ((lead + body).length > MAX_INPUT_LENGTH) continue; // the cap counts the lead-in too, so those inputs are not comparable
      expect(parseCore(lead + body), JSON.stringify(lead + body)).toEqual(parseCore(body));
      expect(completionsCore(lead + body), JSON.stringify(lead + body)).toEqual(completionsCore(body));
      compared++;
    }
    expect(compared).toBeGreaterThan(2000);
  });
});

// ---------- leadInOf: the part of a raw line that completeLine keeps in front ----------
describe('leadInOf (what a completion keeps in front of the command)', () => {
  it('returns the prompts, labels and spaces in front of the command, exactly as typed', () => {
    expect(leadInOf('run_pca')).toBe('');
    expect(leadInOf('')).toBe('');
    expect(leadInOf('> run_pca')).toBe('> ');
    expect(leadInOf('> > help()')).toBe('> > ');
    expect(leadInOf('$>help')).toBe('$>');
    expect(leadInOf('Next: run_p')).toBe('Next: ');
    expect(leadInOf('next:run_p')).toBe('next:');
    expect(leadInOf('  Try  an   extra : allele_freq')).toBe('  Try  an   extra : ');
    expect(leadInOf('> Next: > run_pca')).toBe('> Next: > ');
    expect(leadInOf('Next: ')).toBe('Next: ');
    // not a lead-in: no colon, a different label, or the label in the middle
    expect(leadInOf('Next run_pca')).toBe('');
    expect(leadInOf('Try: run_pca')).toBe('');
    expect(leadInOf('run_pca Next: ')).toBe('');
    expect(leadInOf('nextrun_pca(period = "Roman")')).toBe('');
  });
  it('agrees with what parse and completions skip: the rest of the line is what they read', () => {
    for (const line of ['> run_pca(period = "Roman")', 'Next: help()', 'Try an extra: run_pca(period = "all")', '> > Next: ancestry_test(person = "me")']) {
      const rest = line.slice(leadInOf(line).length);
      expect(parseCore(line)).toEqual(parseCore(rest));
    }
  });
});
