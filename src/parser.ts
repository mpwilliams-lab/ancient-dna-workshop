// Command parser for the terminal (spec §4.1, §4.2).
// Pure module: no DOM, no data. Never throws: parse() and completions() catch everything.
// parseCore() and completionsCore() are the same functions without that safety net. Tests call them so that an internal
// exception fails a test instead of turning into a silent syntax error; app code calls parse() and completions().
// Error messages never echo the student's own text (keeps §6 rule 1 safe and long pastes short).
import type { GeneId, PeriodId } from './types';

export type Command =
  | { name: 'help' } | { name: 'load_genomes' } | { name: 'clear' }
  | { name: 'run_pca'; period: PeriodId | 'all' }
  | { name: 'run_admixture'; K: number; period?: PeriodId }
  | { name: 'allele_freq'; gene: GeneId }
  | { name: 'ancestry_test'; person: PeriodId | 'me' };
export type ParseError = { ok: false; kind: 'syntax' | 'unknown_command' | 'unknown_arg' | 'unknown_value' | 'missing_arg' | 'too_long'; message: string; suggestion?: string };
export type ParseResult = { ok: true; command: Command } | ParseError;

type CommandName = Command['name'];
type ParamName = 'period' | 'K' | 'gene' | 'person';
type ErrorKind = ParseError['kind'];

export const MAX_INPUT_LENGTH = 200;

/** Command names in help/Tab order. */
export const COMMAND_NAMES: readonly CommandName[] = ['help', 'load_genomes', 'run_pca', 'run_admixture', 'allele_freq', 'ancestry_test', 'clear'];
/** Periods in the order of spec §4.1's run_pca row (Today first; types.ts PERIOD_IDS is time order, hence the distinct name). */
export const PARSER_PERIOD_ORDER: readonly PeriodId[] = ['Today', 'FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking'];
/** Genes in the order of spec §4.1's allele_freq row. */
export const PARSER_GENE_ORDER: readonly GeneId[] = ['LCT', 'SLC45A2', 'HERC2', 'TYK2', 'HLA-DQ2'];

/** Accepted spellings (spec §4.1 aliases plus display labels and plurals). Keys are normalised with normKey. */
export const PERIOD_ALIASES: Readonly<Record<PeriodId, readonly string[]>> = {
  Today: ['Today', 'modern', 'modern day', 'present day', 'Britain today'],
  FirstFarmers: ['FirstFarmers', 'farmers', 'farmer', 'first farmer', 'stonehenge', 'stonehenge builders', 'First farmers / Stonehenge builders'],
  BellBeaker: ['BellBeaker', 'beaker', 'beakers', 'bell beakers'],
  BronzeAge: ['BronzeAge', 'bronze'],
  IronAge: ['IronAge', 'iron'],
  Roman: ['Roman', 'romans'],
  AngloSaxon: ['AngloSaxon', 'anglo-saxons', 'saxon', 'saxons'],
  Viking: ['Viking', 'vikings'],
};
export const GENE_ALIASES: Readonly<Record<GeneId, readonly string[]>> = {
  LCT: ['LCT', 'rs4988235', 'lactase', 'lactose', 'milk', 'lactase persistence'],
  SLC45A2: ['SLC45A2', 'rs16891982', 'skin', 'lighter skin', 'skin colour', 'skin color'],
  HERC2: ['HERC2', 'rs12913832', 'eyes', 'blue eyes', 'blue eye', 'eye colour', 'eye color'],
  TYK2: ['TYK2', 'rs34536443', 'TB', 'tuberculosis', 'TB risk'],
  'HLA-DQ2': ['HLA-DQ2', 'rs3891176', 'coeliac', 'celiac', 'coeliac risk', 'celiac risk', 'coeliac disease', 'celiac disease', 'DQ2', 'HLA'],
};

/** Words that are not commands but point at one; they only ever produce a did-you-mean. */
const COMMAND_HINT_ALIASES: Readonly<Record<string, CommandName>> = {
  pca: 'run_pca', smartpca: 'run_pca',
  admixture: 'run_admixture', admix: 'run_admixture', runadmix: 'run_admixture', fastmixture: 'run_admixture',
  freq: 'allele_freq', frequency: 'allele_freq', allelefrequency: 'allele_freq', allelefrequencies: 'allele_freq', allele: 'allele_freq',
  ancestry: 'ancestry_test', dnatest: 'ancestry_test', consumertest: 'ancestry_test',
  load: 'load_genomes', loadgenome: 'load_genomes', genomes: 'load_genomes', loaddata: 'load_genomes',
  cls: 'clear', clearscreen: 'clear',
  man: 'help', commands: 'help',
};

const PARAMS: Readonly<Record<CommandName, readonly ParamName[]>> = {
  help: [], load_genomes: [], clear: [],
  run_pca: ['period'], run_admixture: ['K', 'period'], allele_freq: ['gene'], ancestry_test: ['person'],
};

// Zero-width space, non-joiner and joiner (U+200B to U+200D), word joiner (U+2060) and byte-order mark (U+FEFF).
// Written as escapes on purpose: raw invisible characters are easy to lose in an editor and impossible to review.
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/** Case-, space-, quote-, underscore-, hyphen-, dot- and slash-insensitive key. */
export function normKey(s: string): string {
  return s.normalize('NFKC').replace(ZERO_WIDTH, '').toLowerCase().replace(/[\s_\-.'"`‘’“”/\\]/g, '');
}

/** Optimal-string-alignment distance (a transposition counts 1). Returns limit + 1 as soon as it exceeds limit. */
export function editDistance(a: string, b: string, limit = Number.MAX_SAFE_INTEGER): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const n = a.length; const m = b.length;
  let prev2: number[] = []; let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
    prev2 = prev; prev = cur;
  }
  return prev[m];
}

function buildTable<T extends string>(aliases: Readonly<Partial<Record<T, readonly string[]>>>, extra: readonly [string, T][] = []): Map<string, T> {
  const m = new Map<string, T>();
  for (const id of Object.keys(aliases) as T[]) for (const a of aliases[id] ?? []) m.set(normKey(a), id);
  for (const [k, v] of extra) m.set(normKey(k), v);
  return m;
}

const PERIOD_TABLE = buildTable(PERIOD_ALIASES);
const PCA_TABLE = buildTable<PeriodId | 'all'>(PERIOD_ALIASES, [['all', 'all']]);
const GENE_TABLE = buildTable(GENE_ALIASES);
const PERSON_TABLE = buildTable<PeriodId | 'me'>(PERIOD_ALIASES, [['me', 'me'], ['myself', 'me']]);
const CMD_TABLE = new Map<string, CommandName>(COMMAND_NAMES.map((c) => [normKey(c), c]));
const CMD_FUZZY_TABLE = new Map<string, CommandName>([...CMD_TABLE, ...Object.entries(COMMAND_HINT_ALIASES)]);

function maxDistance(len: number): number { return len <= 2 ? 0 : len <= 4 ? 1 : 2; }

/** Closest table entry: edit distance <= 2 (scaled down for short words), else a unique prefix, else the longest contained alias. */
function closest<T>(key: string, table: Map<string, T>): T | undefined {
  if (key === '') return undefined;
  const limit = maxDistance(key.length);
  let best: T | undefined; let bestD = limit + 1;
  for (const [k, v] of table) {
    const d = editDistance(key, k, limit);
    if (d < bestD) { best = v; bestD = d; }
  }
  if (best !== undefined) return best;
  if (key.length >= 3) {
    const prefixed = new Set<T>();
    for (const [k, v] of table) if (k.startsWith(key)) prefixed.add(v);
    if (prefixed.size === 1) return [...prefixed][0];
  }
  let longest = '';
  for (const [k, v] of table) if (k.length >= 4 && k.length > longest.length && key.includes(k)) { longest = k; best = v; }
  return best;
}

export function formatCommand(c: Command): string {
  switch (c.name) {
    case 'help': case 'load_genomes': case 'clear': return `${c.name}()`;
    case 'run_pca': return `run_pca(period = "${c.period}")`;
    case 'run_admixture': return c.period ? `run_admixture(K = ${c.K}, period = "${c.period}")` : `run_admixture(K = ${c.K})`;
    case 'allele_freq': return `allele_freq(gene = "${c.gene}")`;
    case 'ancestry_test': return `ancestry_test(person = "${c.person}")`;
  }
}

// ---- on-screen text (never includes the student's input) ----
const PCA_LIST = `${PARSER_PERIOD_ORDER.join(', ')}, all`;
export const PARSE_TEXT = {
  empty: 'Type a command and press Enter, or press Esc to fill in the hint.',
  tooLong: 'That is too long: commands are at most 200 characters.',
  syntax: 'I could not read that. Commands look like run_pca(period = "Today").',
  oneAtATime: 'Run one command at a time, in the form name(arg = "value").',
  duplicate: 'Give each argument only once.',
  unknownCommand: "I don't know that command.",
  seeHelp: 'Type help() to see the list.',
  noArgs: (n: CommandName) => `${n}() takes no arguments.`,
  unknownArg: (n: CommandName) => `${n} has no argument with that name.`,
  takes: (n: CommandName) => `It takes ${PARAMS[n].join(', ')}.`,
  tooMany: (n: CommandName) => (n === 'run_admixture' ? 'run_admixture takes K and one period.' : `${n} takes one value at a time.`),
  badPeriod: 'That is not a period in this workshop.',
  pcaList: `Periods: ${PCA_LIST}.`,
  periodList: `Periods: ${PARSER_PERIOD_ORDER.join(', ')}.`,
  badGene: 'That is not a gene in this workshop.',
  geneList: `Genes: ${PARSER_GENE_ORDER.join(', ')}.`,
  badPerson: 'That is not someone this test can check.',
  personList: `Choose "me" or a period: ${PARSER_PERIOD_ORDER.join(', ')}.`,
  badK: "K must be a number; this workshop's run uses K = 3.",
  needs: (n: CommandName, p: ParamName) => {
    if (n === 'run_pca') return 'run_pca needs a period, for example run_pca(period = "Today").';
    if (n === 'allele_freq') return 'allele_freq needs a gene, for example allele_freq(gene = "LCT").';
    if (n === 'ancestry_test') return 'ancestry_test needs a person, for example ancestry_test(person = "me").';
    return p === 'K' ? 'run_admixture needs K.' : 'run_admixture needs a period.';
  },
  didYouMean: (s: string) => `Did you mean ${s}?`,
} as const;

function fail(kind: ErrorKind, base: string, suggestion?: string, fallbackTail?: string): ParseError {
  if (suggestion !== undefined) return { ok: false, kind, message: `${base} ${PARSE_TEXT.didYouMean(suggestion)}`, suggestion };
  return { ok: false, kind, message: fallbackTail ? `${base} ${fallbackTail}` : base };
}

/**
 * What a did-you-mean offers for a command. The workshop runs K = 3 only, so run_admixture is always suggested with K = 3,
 * never with the student's own number (that keeps a message free of anything the student typed).
 */
function suggest(c: Command): string {
  return formatCommand(c.name === 'run_admixture' ? { ...c, K: 3 } : c);
}

// ---- input cleaning and splitting ----
// NFKC already folds a non-breaking space (and every other no-break or wide space) to a plain U+0020, so none needs a replacement of its own.
function clean(input: string): string {
  return input.normalize('NFKC').replace(ZERO_WIDTH, '').replace(/\t/g, ' ').replace(CONTROL, '');
}
const QUOTES = /["'`‘’“”]/g;
function stripQuotes(s: string): string { return s.replace(QUOTES, '').trim(); }

interface RawArg { name: string | null; raw: string }
function splitArgs(argText: string): RawArg[] {
  const out: RawArg[] = [];
  for (const piece of argText.split(',')) {
    // Forgive missing commas: `K = 3 period = "BellBeaker"` splits before each `word =`.
    for (const sub of piece.split(/\s+(?=[A-Za-z_][A-Za-z0-9_]*\s*(?:==|=|<-|:))/)) {
      const s = sub.trim();
      if (s === '') continue;
      const m = /^([^=:<"'`‘’“”]*?)\s*(?:==|=|<-|:)\s*(.*)$/s.exec(s);
      if (m) out.push({ name: m[1].trim() === '' ? null : m[1].trim(), raw: m[2] });
      else out.push({ name: null, raw: s });
    }
  }
  return out;
}

// ---- argument binding ----
type Problem = { kind: ErrorKind; base: string; tail?: string; fixable: boolean };
type ValueOf = { period?: PeriodId | 'all'; K?: number; gene?: GeneId; person?: PeriodId | 'me' };
interface Bound { values: ValueOf; problems: Problem[]; cross?: Command }

const NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
function parseK(raw: string): number | undefined {
  const s = stripQuotes(raw).replace(/\s+/g, '');
  const m = /^(-?\d{1,6}(?:\.\d{1,6})?)L?$/i.exec(s);
  if (m) return Number(m[1]);
  const w = s.toLowerCase();
  return Object.prototype.hasOwnProperty.call(NUMBER_WORDS, w) ? NUMBER_WORDS[w] : undefined;
}

/** Another command that an unknown value clearly belongs to (e.g. a gene typed into run_pca). */
function crossCommand(key: string, from: CommandName): Command | undefined {
  if (from !== 'allele_freq') { const g = GENE_TABLE.get(key); if (g) return { name: 'allele_freq', gene: g }; }
  if (from !== 'run_pca' && from !== 'ancestry_test') { const p = PCA_TABLE.get(key); if (p) return { name: 'run_pca', period: p }; }
  if (from !== 'ancestry_test' && (key === 'me' || key === 'myself')) return { name: 'ancestry_test', person: 'me' };
  return undefined;
}

function bind(name: CommandName, args: RawArg[]): Bound {
  const params = PARAMS[name];
  const problems: Problem[] = [];
  const values: ValueOf = {};
  if (params.length === 0) {
    if (name !== 'help' && args.length > 0) problems.push({ kind: 'unknown_arg', base: PARSE_TEXT.noArgs(name), fixable: true });
    return { values, problems };
  }
  // Split `3 BellBeaker` (bare run_admixture) into two positional values.
  const expanded: RawArg[] = [];
  for (const a of args) {
    const m = name === 'run_admixture' && a.name === null ? /^\s*["'`]?\s*(-?\d+(?:\.\d+)?L?)\s*["'`]?\s+(\S.*)$/s.exec(a.raw) : null;
    if (m) expanded.push({ name: null, raw: m[1] }, { name: null, raw: m[2] });
    else expanded.push(a);
  }
  const raws = new Map<ParamName, string>();
  const positional: string[] = [];
  for (const a of expanded) {
    if (a.name === null) { positional.push(a.raw); continue; }
    const key = normKey(a.name);
    let target = params.find((p) => normKey(p) === key);
    if (!target) {
      const fix = params.length === 1 ? params[0] : closest(key, new Map(params.map((p) => [normKey(p), p] as [string, ParamName])));
      problems.push({ kind: 'unknown_arg', base: PARSE_TEXT.unknownArg(name), tail: PARSE_TEXT.takes(name), fixable: fix !== undefined });
      if (!fix) continue;
      target = fix;
    }
    if (raws.has(target)) { problems.push({ kind: 'syntax', base: PARSE_TEXT.duplicate, fixable: true }); continue; }
    raws.set(target, a.raw);
  }
  for (const raw of positional) {
    const target = params.find((p) => !raws.has(p));
    if (!target) { problems.push({ kind: 'syntax', base: PARSE_TEXT.tooMany(name), fixable: true }); continue; }
    raws.set(target, raw);
  }
  let cross: Command | undefined;
  for (const p of params) {
    const raw = raws.get(p);
    const required = !(name === 'run_admixture' && p === 'period');
    const key = raw === undefined ? '' : normKey(raw);
    if (key === '') {
      if (!required) continue;
      if (p === 'K') { values.K = 3; problems.push({ kind: 'missing_arg', base: PARSE_TEXT.needs(name, p), fixable: true }); }
      else problems.push({ kind: 'missing_arg', base: PARSE_TEXT.needs(name, p), fixable: false });
      continue;
    }
    if (p === 'K') {
      const k = parseK(raw as string);
      if (k !== undefined && Number.isFinite(k)) values.K = k;
      else { values.K = 3; problems.push({ kind: 'unknown_value', base: PARSE_TEXT.badK, fixable: true }); }
      continue;
    }
    if (p === 'gene') {
      const g = GENE_TABLE.get(key);
      if (g) { values.gene = g; continue; }
      const fix = closest(key, GENE_TABLE);
      if (fix) values.gene = fix; else cross = crossCommand(key, name);
      problems.push({ kind: 'unknown_value', base: PARSE_TEXT.badGene, tail: PARSE_TEXT.geneList, fixable: fix !== undefined || cross !== undefined });
      continue;
    }
    if (p === 'person') {
      const v = PERSON_TABLE.get(key);
      if (v) { values.person = v; continue; }
      const fix = key === 'all' ? undefined : closest(key, PERSON_TABLE);
      if (fix) values.person = fix; else cross = crossCommand(key, name);
      problems.push({ kind: 'unknown_value', base: PARSE_TEXT.badPerson, tail: PARSE_TEXT.personList, fixable: fix !== undefined || cross !== undefined });
      continue;
    }
    // period
    if (name === 'run_pca') {
      const v = PCA_TABLE.get(key);
      if (v) { values.period = v; continue; }
      const fix = closest(key, PCA_TABLE);
      if (fix) values.period = fix; else cross = crossCommand(key, name);
      problems.push({ kind: 'unknown_value', base: PARSE_TEXT.badPeriod, tail: PARSE_TEXT.pcaList, fixable: fix !== undefined || cross !== undefined });
    } else {
      const v = PERIOD_TABLE.get(key);
      if (v) { values.period = v; continue; }
      const fix = key === 'all' ? undefined : closest(key, PERIOD_TABLE);
      if (fix) values.period = fix;
      else if (key !== 'all') cross = crossCommand(key, name);
      // `period = "all"` on run_admixture: the fix is to drop the period (all bars are the default view).
      problems.push({ kind: 'unknown_value', base: PARSE_TEXT.badPeriod, tail: PARSE_TEXT.periodList, fixable: fix !== undefined || key === 'all' || cross !== undefined });
    }
  }
  return { values, problems, cross };
}

function build(name: CommandName, v: ValueOf): Command | undefined {
  switch (name) {
    case 'help': case 'load_genomes': case 'clear': return { name };
    case 'run_pca': return v.period ? { name, period: v.period } : undefined;
    case 'run_admixture': {
      if (v.K === undefined) return undefined;
      return v.period && v.period !== 'all' ? { name, K: v.K, period: v.period } : { name, K: v.K };
    }
    case 'allele_freq': return v.gene ? { name, gene: v.gene } : undefined;
    case 'ancestry_test': return v.person ? { name, person: v.person } : undefined;
  }
}

const KIND_ORDER: readonly ErrorKind[] = ['syntax', 'unknown_arg', 'unknown_value', 'missing_arg'];

/** Parse the argument text for a known command. Returns the command or the most important problem, with a fully corrected suggestion when every problem is fixable. */
function parseArgs(name: CommandName, argText: string): ParseResult {
  const b = bind(name, splitArgs(argText));
  if (b.problems.length === 0) {
    const c = build(name, b.values);
    if (c) return { ok: true, command: c };
    return fail('missing_arg', PARSE_TEXT.syntax);
  }
  const first = [...b.problems].sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind))[0];
  const allFixable = b.problems.every((p) => p.fixable);
  const fixed = allFixable ? (b.cross ?? build(name, b.values)) : undefined;
  return fail(first.kind, first.base, fixed ? suggest(fixed) : undefined, first.tail);
}

/** Text that is only a value (`IronAge`, `"LCT"`, `me`) suggests the command that takes it. */
function commandForValue(text: string): Command | undefined {
  const key = normKey(text.replace(/[()]/g, ''));
  if (key === '') return undefined;
  const p = PCA_TABLE.get(key); if (p) return { name: 'run_pca', period: p };
  const g = GENE_TABLE.get(key); if (g) return { name: 'allele_freq', gene: g };
  if (key === 'me' || key === 'myself') return { name: 'ancestry_test', person: 'me' };
  return undefined;
}

function unknownCommand(fixedName: CommandName | undefined, argText: string, whole: string): ParseError {
  const byValue = commandForValue(whole);
  if (byValue) return fail('unknown_command', PARSE_TEXT.unknownCommand, suggest(byValue));
  if (!fixedName) return fail('unknown_command', PARSE_TEXT.unknownCommand, undefined, PARSE_TEXT.seeHelp);
  const r = parseArgs(fixedName, argText);
  if (r.ok) return fail('unknown_command', PARSE_TEXT.unknownCommand, suggest(r.command));
  if (r.suggestion !== undefined) return fail('unknown_command', PARSE_TEXT.unknownCommand, r.suggestion);
  return fail('unknown_command', PARSE_TEXT.unknownCommand, fixedName);
}

/** parse() without its safety net (see the header). Tests call it; app code calls parse(). */
export function parseCore(input: string): ParseResult {
  if (typeof input !== 'string') return fail('syntax', PARSE_TEXT.empty);
  if (input.length > MAX_INPUT_LENGTH * 4) return fail('too_long', PARSE_TEXT.tooLong);
  let t = clean(input).trim();
  if (t.length > MAX_INPUT_LENGTH) return fail('too_long', PARSE_TEXT.tooLong);
  // Forgive a copied prompt (> or $) in front, and any run of ; , and spaces after the command.
  t = t.replace(/^[>$]+\s*/, '').replace(/[;,\s]+$/, '');
  if (t === '') return fail('syntax', PARSE_TEXT.empty);

  const open = t.indexOf('(');
  if (open >= 0) {
    const head = t.slice(0, open);
    const headKey = normKey(head);
    const close = t.lastIndexOf(')');
    const inner = close > open ? t.slice(open + 1, close) : t.slice(open + 1);
    const trailing = close > open ? t.slice(close + 1).trim() : '';
    const name = CMD_TABLE.get(headKey);
    if (!name) {
      if (headKey === '') {
        const byValue = commandForValue(t);
        return byValue ? fail('unknown_command', PARSE_TEXT.unknownCommand, suggest(byValue)) : fail('syntax', PARSE_TEXT.syntax);
      }
      return unknownCommand(closest(headKey, CMD_FUZZY_TABLE), inner.replace(/[()]/g, ''), t);
    }
    if (trailing !== '' || /[()]/.test(inner)) {
      const retry = parseArgs(name, t.slice(open + 1).replace(/[()]/g, ''));
      return fail('syntax', PARSE_TEXT.oneAtATime, retry.ok ? suggest(retry.command) : undefined);
    }
    return parseArgs(name, inner);
  }

  // Bare form: `run_pca IronAge`, `run pca iron age`, `run_admixture 3 BellBeaker`.
  const tokens = t.replace(/(==|=|<-|:)/g, ' $1 ').split(/\s+/).filter((s) => s !== '');
  for (let k = Math.min(3, tokens.length); k >= 1; k--) {
    const name = CMD_TABLE.get(normKey(tokens.slice(0, k).join('')));
    if (name) return parseArgs(name, tokens.slice(k).join(' '));
  }
  let fixedName: CommandName | undefined; let used = 1;
  for (let k = 1; k <= Math.min(2, tokens.length) && !fixedName; k++) {
    fixedName = closest(normKey(tokens.slice(0, k).join('')), CMD_FUZZY_TABLE);
    used = k;
  }
  return unknownCommand(fixedName, tokens.slice(used).join(' '), t);
}

export function parse(input: string): ParseResult {
  try {
    return parseCore(input);
  } catch {
    return fail('syntax', PARSE_TEXT.syntax);
  }
}

// ---- Tab completion ----
const COMMAND_STEMS: Readonly<Record<CommandName, string>> = {
  help: 'help()', load_genomes: 'load_genomes()', clear: 'clear()',
  run_pca: 'run_pca(period = "', run_admixture: 'run_admixture(K = 3)',
  allele_freq: 'allele_freq(gene = "', ancestry_test: 'ancestry_test(person = "',
};

function matchValues<T extends string>(partial: string, ids: readonly T[], aliases: Map<string, T>): T[] {
  const vp = normKey(partial);
  const hits = new Set<T>();
  for (const id of ids) if (normKey(id).startsWith(vp)) hits.add(id);
  if (vp.length >= 3) for (const [k, v] of aliases) if (k.startsWith(vp)) hits.add(v);
  return ids.filter((id) => hits.has(id));
}

function completeValues(name: CommandName, inner: string): string[] {
  if (PARAMS[name].length === 0) return [COMMAND_STEMS[name]];
  const segments = inner.split(',');
  const last = segments[segments.length - 1];
  const m = /^\s*([A-Za-z_]+)\s*(?:==|=|<-|:)\s*(.*)$/s.exec(last);
  let param: ParamName | undefined; let valuePart: string;
  if (m) { param = PARAMS[name].find((p) => normKey(p) === normKey(m[1])); valuePart = m[2]; }
  else {
    param = PARAMS[name][segments.length - 1]; valuePart = last;
    if (name === 'run_admixture' && segments.length === 2 && normKey(last) !== '' && 'period'.startsWith(normKey(last))) return ['run_admixture(K = 3, period = "'];
  }
  if (!param) return [];
  if (param === 'K') return '3'.startsWith(normKey(valuePart)) ? ['run_admixture(K = 3)'] : [];
  if (param === 'gene') return matchValues(valuePart, PARSER_GENE_ORDER, GENE_TABLE).map((gene) => formatCommand({ name: 'allele_freq', gene }));
  if (param === 'person') return matchValues<PeriodId | 'me'>(valuePart, ['me', ...PARSER_PERIOD_ORDER], PERSON_TABLE).map((person) => formatCommand({ name: 'ancestry_test', person }));
  if (name === 'run_pca') return matchValues<PeriodId | 'all'>(valuePart, [...PARSER_PERIOD_ORDER, 'all'], PCA_TABLE).map((period) => formatCommand({ name: 'run_pca', period }));
  return matchValues(valuePart, PARSER_PERIOD_ORDER, PERIOD_TABLE).map((period) => formatCommand({ name: 'run_admixture', K: 3, period }));
}

/** completions() without its safety net (see the header). Tests call it; app code calls completions(). */
export function completionsCore(partial: string): string[] {
  if (typeof partial !== 'string' || partial.length > MAX_INPUT_LENGTH) return [];
  const lead = clean(partial).replace(/^\s*[>$]*\s*/, '');
  const open = lead.indexOf('(');
  if (open < 0) {
    const key = normKey(lead);
    const names = COMMAND_NAMES.filter((n) => normKey(n).startsWith(key));
    if (names.length > 0) return names.map((n) => COMMAND_STEMS[n]);
    const tokens = lead.split(/\s+/).filter((s) => s !== '');
    for (let k = Math.min(3, tokens.length); k >= 1; k--) {
      const name = CMD_TABLE.get(normKey(tokens.slice(0, k).join('')));
      if (name) return completeValues(name, tokens.slice(k).join(' '));
    }
    return [];
  }
  const name = CMD_TABLE.get(normKey(lead.slice(0, open)));
  const inner = lead.slice(open + 1);
  if (!name || /[()]/.test(inner)) return [];
  return completeValues(name, inner);
}

export function completions(partial: string): string[] {
  try {
    return completionsCore(partial);
  } catch {
    return [];
  }
}
