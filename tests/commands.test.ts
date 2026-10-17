import { describe, it, expect } from 'vitest';
import fixtureRaw from './fixtures/data.fixture.json';
import type { WorkshopData, PeriodId, GeneId, ConsumerShare } from '../src/types';
import type { Command } from '../src/parser';
import { execute, formatCount, roundPercents, asciiBar, DEFAULT_EXEC_CONTEXT, type ExecContext } from '../src/commands';
import {
  PERIOD_LABELS, MAP_GROUP_LABELS, HELP_LINES, ME_RESULT, ME_HEADING, HOOK_QUESTION, HOOK_NOTE, CONSUMER_NOTE, CONSUMER_TAKEAWAY,
  ROMAN_LOG_LINE, K_REFUSAL, traitSourceLabel, EUROPE_HELD_BACK, EUROPE_ALREADY_SHOWN, TODAY_PLACED, ALL_PROJECTING,
  ALL_TODAY_LAST, ADMIX_TODAY_HIDDEN, ADMIX_TODAY_SHOWN, mapAxesLine, axesLine,
} from '../src/content';
import { FEATURES } from '../src/features';

const fixture = fixtureRaw as unknown as WorkshopData;
const PERIODS: PeriodId[] = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking', 'Today'];
const GENES: GeneId[] = ['LCT', 'SLC45A2', 'HERC2', 'TYK2', 'HLA-DQ2'];

// Measured 2026-10-15 from R/data-pca-time/smartpca_noGBR/noGBR.log
// ("number of samples used: 1163 number of snps used: 579720"; "killed in pass: 82819  used: 496901")
// and R/data-admixture/fmA/fm.log ("Loaded 1194 samples and 78188 SNPs.").
const REAL_LOGS = {
  snps_total: 579720, snps_used: 496901, pca_samples_used: 1163, admix_snps: 78188, admix_individuals: 1194, pca_people_unique: 950,
};
const real: WorkshopData = { ...fixture, logs: REAL_LOGS };

function withN(d: WorkshopData, id: PeriodId, n_pca: number, n_admix: number): WorkshopData {
  return { ...d, periods: d.periods.map((p) => (p.id === id ? { ...p, n_pca, n_admix } : p)) };
}
function withTraitSource(d: WorkshopData, gene: GeneId, source: 'ages' | 'local' | 'text'): WorkshopData {
  return { ...d, traits: d.traits.map((t) => (t.gene === gene ? { ...t, source } : t)) };
}
function withConsumer(d: WorkshopData, id: PeriodId, shares: ConsumerShare[] | undefined): WorkshopData {
  const consumer = { ...d.consumer };
  if (shares) consumer[id] = shares; else delete consumer[id];
  return { ...d, consumer };
}

// Every command the parser can produce (valid values), plus friendly-refusal cases.
const ALL_COMMANDS: Command[] = [
  { name: 'help' }, { name: 'load_genomes' }, { name: 'clear' },
  ...PERIODS.map((period): Command => ({ name: 'run_pca', period })),
  { name: 'run_pca', period: 'all' },
  { name: 'run_pca', period: 'Europe' },
  { name: 'run_admixture', K: 3 },
  ...PERIODS.map((period): Command => ({ name: 'run_admixture', K: 3, period })),
  { name: 'run_admixture', K: 2 }, { name: 'run_admixture', K: 4, period: 'IronAge' },
  ...GENES.map((gene): Command => ({ name: 'allele_freq', gene })),
  { name: 'ancestry_test', person: 'me' },
  ...PERIODS.map((person): Command => ({ name: 'ancestry_test', person })),
];

const formatCommandish = (c: Command): string => JSON.stringify(c);

// Spec §6 rule 1 scan, applied to log output (stricter than for static content: no CE dates in logs).
const ALLOWED_PHRASES = ['about 2,000 years ago', 'about 100 generations ago', 'over the last 4,000 years'];
const RULE1: [RegExp, string][] = [
  [/\bBCE?\b/, 'BC/BCE'],
  [/\bCE\b/, 'CE date in a log'],
  [/\bBP\b/, 'BP'],
  [/\bk?ya\b/i, 'kya/ya'],
  [/\byears?\s+ago\b/i, 'years ago'],
  [/\bgenerations?\s+ago\b/i, 'generations ago'],
  [/mesolithic|neolithic|pal(a)?eolithic|megalithic|ice\s*age/i, 'forbidden period word'],
  [/\b[A-Z][A-Za-z0-9]*_[A-Za-z0-9]+/, 'AADR Group ID'],
  [/\b[A-Z]{1,4}\d{3,}[A-Za-z]?\b/, 'sample ID'],
  [/\b(Yamnaya|Loschbour|WHG|STEPPE|FARMER)\b/, 'internal source name'],
];
function rule1Violations(line: string): string[] {
  let s = line;
  for (const a of ALLOWED_PHRASES) s = s.split(a).join('');
  return RULE1.filter(([re]) => re.test(s)).map(([, why]) => `${why}: ${line}`);
}
// Raw period ids may appear only inside command syntax such as ancestry_test(person = "IronAge").
function rawIdViolations(line: string): string[] {
  const s = line.replace(/[a-z_]+\([^)]*\)/g, '');
  return PERIODS.filter((p) => p !== 'Roman' && p !== 'Viking' && new RegExp(`\\b${p}\\b`).test(s)).map((p) => `raw id ${p}: ${line}`);
}

describe('formatting helpers', () => {
  it('formats counts with thousands separators', () => {
    expect(formatCount(496901)).toBe('496,901');
    expect(formatCount(579720)).toBe('579,720');
    expect(formatCount(1163)).toBe('1,163');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1234567)).toBe('1,234,567');
  });
  it('rounds shares to whole percents that always sum to 100', () => {
    expect(roundPercents([0.92, 0.08])).toEqual([92, 8]);
    expect(roundPercents([0.333, 0.333, 0.334])).toEqual([33, 33, 34]);
    expect(roundPercents([0.125, 0.125, 0.75])).toEqual([13, 12, 75]);
    expect(roundPercents([])).toEqual([]);
    expect(roundPercents([0, 0])).toEqual([0, 0]);
  });
  it('draws a 20-character ASCII bar', () => {
    expect(asciiBar(92)).toBe('[##################..]');
    expect(asciiBar(0)).toBe('[....................]');
    expect(asciiBar(100)).toBe('[####################]');
    expect(asciiBar(250)).toBe('[####################]');
    expect(asciiBar(-5)).toBe('[....................]');
  });
});

describe('execute: plot actions', () => {
  it('maps every command to its plot action', () => {
    expect(execute({ name: 'help' }, fixture).plot).toEqual({ kind: 'none' });
    expect(execute({ name: 'load_genomes' }, fixture).plot).toEqual({ kind: 'none' });
    expect(execute({ name: 'clear' }, fixture).plot).toEqual({ kind: 'none' });
    for (const period of [...PERIODS, 'all' as const, 'Europe' as const]) {
      expect(execute({ name: 'run_pca', period }, fixture).plot).toEqual({ kind: 'pca', period });
    }
    expect(execute({ name: 'run_admixture', K: 3 }, fixture).plot).toEqual({ kind: 'admixture' });
    for (const period of PERIODS) {
      expect(execute({ name: 'run_admixture', K: 3, period }, fixture).plot).toEqual({ kind: 'admixture', period });
    }
    for (const gene of GENES) {
      expect(execute({ name: 'allele_freq', gene }, fixture).plot).toEqual({ kind: 'trait', gene });
    }
    expect(execute({ name: 'ancestry_test', person: 'me' }, fixture).plot).toEqual({ kind: 'none' });
    expect(execute({ name: 'ancestry_test', person: 'IronAge' }, fixture).plot).toEqual({ kind: 'none' });
  });
  it('only clear() clears, and valid commands are not refused', () => {
    expect(execute({ name: 'clear' }, fixture)).toEqual({ lines: [], plot: { kind: 'none' }, refused: false, clear: true });
    for (const c of ALL_COMMANDS.filter((x) => x.name !== 'clear')) expect(execute(c, fixture).clear).toBe(false);
    expect(execute({ name: 'run_pca', period: 'Roman' }, fixture).refused).toBe(false);
    expect(execute({ name: 'allele_freq', gene: 'HLA-DQ2' }, fixture).refused).toBe(false);
  });
});

describe('execute: log templates', () => {
  it('help prints HELP_LINES', () => {
    expect(execute({ name: 'help' }, fixture).lines).toEqual(HELP_LINES);
  });
  it('load_genomes reads every number from data.logs and periods', () => {
    const d = withN(real, 'IronAge', 281, 270);
    const lines = execute({ name: 'load_genomes' }, d).lines;
    expect(lines).toContain('Reading genotypes: 579,720 SNPs');
    expect(lines).toContain('Quality filter: 496,901 SNPs kept');
    expect(lines).toContain('Ancestry run: 1,194 people, 78,188 SNPs');
    expect(lines).toContain(`  ${PERIOD_LABELS.IronAge.padEnd(36)}281`);
    expect(lines).toContain(`  ${PERIOD_LABELS.FirstFarmers.padEnd(36)}${d.periods[0]!.n_pca}`);
    expect(lines[lines.length - 1]).toBe('Genomes loaded.');
  });
  it('run_pca prints a smartpca-style log with the period label and its n', () => {
    const d = withN(real, 'Roman', 15, 8);
    const lines = execute({ name: 'run_pca', period: 'Roman' }, d).lines;
    expect(lines[0]).toBe('$ smartpca -p britain.par');
    expect(lines).toContain('Genotypes: 579,720 SNPs; 496,901 used after quality filter');
    expect(lines).toContain('Projecting Roman onto the axes: 15 people');
    expect(lines[lines.length - 1]).toBe('Done: PC1 and PC2 written.');
  });
  it('run_pca(Roman) shows the Roman log line just before Done; no other run_pca does (spec v3 §3.5, §6 rule 4)', () => {
    const lines = execute({ name: 'run_pca', period: 'Roman' }, real).lines;
    expect(lines[lines.length - 2]).toBe(ROMAN_LOG_LINE);
    expect(lines[lines.length - 1]).toBe('Done: PC1 and PC2 written.');
    for (const p of [...PERIODS.filter((x) => x !== 'Roman'), 'all' as const]) {
      expect(execute({ name: 'run_pca', period: p }, real).lines).not.toContain(ROMAN_LOG_LINE);
    }
  });
  it('run_pca(Today) projects Britain today with its n and says it is placed like the ancient Britons (v3 §3.5)', () => {
    const lines = execute({ name: 'run_pca', period: 'Today' }, withN(real, 'Today', 107, 106)).lines;
    expect(lines.slice(-3)).toEqual(['Projecting Britain today onto the axes: 107 people', TODAY_PLACED, 'Done: PC1 and PC2 written.']);
    expect(lines.join('\n')).not.toContain('Map groups:');
  });
  it('run_pca(Europe) names the five map groups and holds Britain today back until it is shown (v3 §3.5)', () => {
    const held = execute({ name: 'run_pca', period: 'Europe' }, real).lines;
    expect(held.slice(-3)).toEqual([
      `Projecting present-day Europeans onto the axes: 5 map groups (${MAP_GROUP_LABELS.Sardinian}, ${MAP_GROUP_LABELS.Spanish}, ` +
        `${MAP_GROUP_LABELS.ItalianNorth}, ${MAP_GROUP_LABELS.French}, ${MAP_GROUP_LABELS.Norwegian})`,
      EUROPE_HELD_BACK,
      'Done: PC1 and PC2 written.',
    ]);
    expect(held[0]).toBe('$ smartpca -p britain.par');
    const shown = execute({ name: 'run_pca', period: 'Europe' }, real, { todayShown: true, features: FEATURES }).lines;
    expect(shown[shown.length - 2]).toBe(EUROPE_ALREADY_SHOWN);
    expect(shown).not.toContain(EUROPE_HELD_BACK);
  });
  it('run_pca(all) projects every period oldest first, Britain today last, then says so (v3 §3.5)', () => {
    const lines = execute({ name: 'run_pca', period: 'all' }, withN(real, 'BellBeaker', 77, 70)).lines;
    const start = lines.indexOf(ALL_PROJECTING);
    expect(start).toBeGreaterThan(0);
    const rows = lines.slice(start + 1, start + 1 + PERIODS.length);
    expect(rows.map((l) => l.slice(2, 38).trimEnd())).toEqual(PERIODS.map((p) => PERIOD_LABELS[p]));
    expect(rows[rows.length - 1]!.startsWith(`  ${PERIOD_LABELS.Today}`)).toBe(true);
    expect(lines).toContain(`  ${PERIOD_LABELS.BellBeaker.padEnd(36)}77`);
    expect(lines.slice(-2)).toEqual([ALL_TODAY_LAST, 'Done: PC1 and PC2 written.']);
  });
  it('execute defaults to DEFAULT_EXEC_CONTEXT: Britain today not shown, the shipped flags', () => {
    expect(DEFAULT_EXEC_CONTEXT).toEqual({ todayShown: false, features: FEATURES });
    const ctx: ExecContext = DEFAULT_EXEC_CONTEXT;
    for (const c of ALL_COMMANDS) expect(execute(c, real, ctx)).toEqual(execute(c, real));
  });
  it('run_admixture(K = 3) prints a fastmixture-style log, and no bridge line (spec v3 §3.2)', () => {
    const lines = execute({ name: 'run_admixture', K: 3 }, real).lines;
    expect(lines[0]).toBe('$ fastmixture --bfile britain --K 3 --supervised sources.txt');
    expect(lines).toContain('Reading data... loaded 1,194 samples and 78,188 SNPs.');
    expect(lines).toContain('Reference groups: Steppe herders, Early farmers, Hunter-gatherers');
    expect(lines).toContain('Drawing one average bar per period.');
    expect(lines.join('\n')).not.toMatch(/not 90%|rises to/);
  });
  it('the mean-bar run_admixture ends with whether Britain today is among the bars (v3 §3.5)', () => {
    const hidden = execute({ name: 'run_admixture', K: 3 }, real).lines;
    expect(hidden.slice(-2)).toEqual(['Drawing one average bar per period.', ADMIX_TODAY_HIDDEN]);
    const shown = execute({ name: 'run_admixture', K: 3 }, real, { todayShown: true, features: FEATURES }).lines;
    expect(shown.slice(-2)).toEqual(['Drawing one average bar per period.', ADMIX_TODAY_SHOWN]);
    // the per-person view ends with its own line whatever is shown
    for (const todayShown of [false, true]) {
      const per = execute({ name: 'run_admixture', K: 3, period: 'IronAge' }, real, { todayShown, features: FEATURES }).lines;
      expect(per[per.length - 1]).toMatch(/^Showing one bar per person: Iron Age/);
    }
  });
  it('todayShown changes only the Europe and mean-bar ADMIXTURE lines, never the plot action', () => {
    for (const c of ALL_COMMANDS) {
      const a = execute(c, real, { todayShown: false, features: FEATURES });
      const b = execute(c, real, { todayShown: true, features: FEATURES });
      expect(b.plot, formatCommandish(c)).toEqual(a.plot);
      const depends = (c.name === 'run_pca' && c.period === 'Europe') || (c.name === 'run_admixture' && c.K === 3 && c.period === undefined);
      if (!depends) expect(b.lines, formatCommandish(c)).toEqual(a.lines);
      else expect(b.lines, formatCommandish(c)).not.toEqual(a.lines);
    }
  });
  it('run_admixture with a period shows that period with its ADMIXTURE n (never called the PCA sample)', () => {
    const d = withN(real, 'BellBeaker', 77, 70);
    const lines = execute({ name: 'run_admixture', K: 3, period: 'BellBeaker' }, d).lines;
    expect(lines).toContain('Showing one bar per person: Bell Beaker (70 people in this ancestry run)');
    expect(lines.join('\n')).not.toContain('77');
    expect(lines[lines.length - 1]).toBe('Showing one bar per person: Bell Beaker (70 people in this ancestry run)');
  });
  it('refuses K other than 3 in a friendly way, without a plot', () => {
    for (const K of [0, 1, 2, 4, 10, -1, 2.5, Number.NaN, 1e9]) {
      const r = execute({ name: 'run_admixture', K }, real);
      expect(r.refused).toBe(true);
      expect(r.plot).toEqual({ kind: 'none' });
      expect(r.lines).toEqual([K_REFUSAL]);
    }
  });
  it('allele_freq prints the gene, rsid, allele and source label', () => {
    for (const gene of GENES) {
      const t = fixture.traits.find((x) => x.gene === gene)!;
      const lines = execute({ name: 'allele_freq', gene }, fixture).lines;
      expect(lines[0]).toBe(`Reading allele frequencies: ${gene} (${t.rsid}), allele ${t.allele}`);
      expect(lines).toContain(`Source: ${traitSourceLabel(t)}`);
    }
    const d = withTraitSource(withTraitSource(fixture, 'HLA-DQ2', 'text'), 'LCT', 'ages');
    expect(execute({ name: 'allele_freq', gene: 'HLA-DQ2' }, d).lines).toContain('Showing a summary card for this variant.');
    expect(execute({ name: 'allele_freq', gene: 'LCT' }, d).lines).toContain('Plotting frequency through time, with its uncertainty.');
  });
  it('allele_freq for a gene missing from the data refuses without crashing', () => {
    const d = { ...fixture, traits: fixture.traits.filter((t) => t.gene !== 'TYK2') };
    const r = execute({ name: 'allele_freq', gene: 'TYK2' }, d);
    expect(r).toEqual({ lines: ['No frequency data for TYK2 in this build.'], plot: { kind: 'none' }, refused: true, clear: false });
  });
});

describe('execute: ancestry_test', () => {
  // Final review (ruled): the hook screen used to print the whole Beat 4 debrief (CONSUMER_NOTE) after the example result,
  // about twenty minutes before Beat 4. Only its last sentence belongs on the hook screen.
  it('me shows ME_HEADING, the ME_RESULT bars, HOOK_QUESTION and only the short illustrative sentence (spec §3 hook)', () => {
    const lines = execute({ name: 'ancestry_test', person: 'me' }, fixture).lines;
    expect(lines).toEqual([
      ME_HEADING,
      'Compared with: people living in Europe today',
      '  British      [##################..]  92%',
      '  Scandinavian [##..................]   8%',
      HOOK_QUESTION,
      HOOK_NOTE,
    ]);
    expect(HOOK_NOTE).toBe('These labels are illustrative, not a measurement.');
    expect(ME_RESULT.map((s) => s.label)).toEqual(['British', 'Scandinavian']);
  });
  it('me does not preview the Beat 4 debrief: the full CONSUMER_NOTE is not on the hook screen, only its last sentence', () => {
    const text = execute({ name: 'ancestry_test', person: 'me' }, fixture).lines.join('\n');
    expect(text).not.toContain(CONSUMER_NOTE);
    for (const piece of ['where similar people live today', 'who anyone', 'Dutch, German or Danish', 'North Sea', 'Vikings']) {
      expect(text, piece).not.toContain(piece);
    }
    expect(text).toContain(HOOK_NOTE);
    // one source: the short sentence is the closing sentence of the full note, not a second hand-typed copy
    expect(CONSUMER_NOTE.endsWith(HOOK_NOTE)).toBe(true);
    expect(CONSUMER_NOTE.length).toBeGreaterThan(HOOK_NOTE.length * 3);
  });
  it('a period keeps the full CONSUMER_NOTE (Beat 4), with every sentence the hook screen leaves out', () => {
    for (const person of PERIODS) {
      const lines = execute({ name: 'ancestry_test', person }, fixture).lines;
      expect(lines[lines.length - 1], person).toBe(CONSUMER_NOTE);
      for (const piece of ['where similar people live today', 'Dutch, German or Danish', 'It does not mean Vikings.', HOOK_NOTE]) {
        expect(lines.join('\n'), `${person}: ${piece}`).toContain(piece);
      }
    }
  });
  it('a period shows sorted ASCII bars that sum to 100, its n, CONSUMER_TAKEAWAY and the note (spec §3 beat 4)', () => {
    const d = withConsumer(withN(fixture, 'IronAge', 281, 270), 'IronAge', [
      { label: 'Scandinavian', share: 0.333 }, { label: 'British', share: 0.334 }, { label: 'French', share: 0.333 },
    ]);
    const r = execute({ name: 'ancestry_test', person: 'IronAge' }, d);
    expect(r.refused).toBe(false);
    expect(r.lines[0]).toBe('Consumer-style ancestry test: Iron Age (281 people)');
    expect(r.lines.slice(2, 5)).toEqual([
      '  British      [#######.............]  34%',
      '  Scandinavian [#######.............]  33%',
      '  French       [#######.............]  33%',
    ]);
    expect(r.lines[r.lines.length - 2]).toBe(CONSUMER_TAKEAWAY);
    expect(r.lines[r.lines.length - 1]).toBe(CONSUMER_NOTE);
  });
  it('Today shows the bars from data.consumer.Today like any period, not a refusal (spec v2.1 §5.3)', () => {
    const d = withConsumer(withN(fixture, 'Today', 107, 106), 'Today', [
      { label: 'Scandinavian', share: 0.1 }, { label: 'British', share: 0.9 },
    ]);
    const r = execute({ name: 'ancestry_test', person: 'Today' }, d);
    expect(r).toEqual({
      lines: [
        'Consumer-style ancestry test: Britain today (107 people)',
        'Compared with: people living in Europe today',
        '  British      [##################..]  90%',
        '  Scandinavian [##..................]  10%',
        CONSUMER_TAKEAWAY,
        CONSUMER_NOTE,
      ],
      plot: { kind: 'none' },
      refused: false,
      clear: false,
    });
  });
  it('every period, Today included, uses the same template', () => {
    const shares: ConsumerShare[] = [{ label: 'British', share: 0.75 }, { label: 'French', share: 0.25 }];
    for (const p of PERIODS) {
      const r = execute({ name: 'ancestry_test', person: p }, withConsumer(withN(fixture, p, 40, 30), p, shares));
      expect(r.refused).toBe(false);
      expect(r.lines).toEqual([
        `Consumer-style ancestry test: ${PERIOD_LABELS[p]} (40 people)`,
        'Compared with: people living in Europe today',
        '  British      [###############.....]  75%',
        '  French       [#####...............]  25%',
        CONSUMER_TAKEAWAY,
        CONSUMER_NOTE,
      ]);
    }
  });
  it('a period with no consumer data refuses without crashing (Today too)', () => {
    const r = execute({ name: 'ancestry_test', person: 'Viking' }, withConsumer(fixture, 'Viking', undefined));
    expect(r).toEqual({ lines: ['No consumer-test result for Viking in this build.'], plot: { kind: 'none' }, refused: true, clear: false });
    const t = execute({ name: 'ancestry_test', person: 'Today' }, withConsumer(fixture, 'Today', undefined));
    expect(t).toEqual({ lines: ['No consumer-test result for Britain today in this build.'], plot: { kind: 'none' }, refused: true, clear: false });
  });
});

describe('execute: never crashes on malformed input', () => {
  it('returns a friendly refusal for commands the parser should never produce', () => {
    const junk = [
      { name: 'bogus' }, { name: 'run_pca', period: 'Neolithic' }, { name: 'run_pca' },
      { name: 'allele_freq', gene: 'XYZ' }, { name: 'ancestry_test', person: 'Bob' }, {}, null,
    ] as unknown as Command[];
    for (const c of junk) {
      const r = execute(c, fixture);
      expect(r.refused).toBe(true);
      expect(r.plot).toEqual({ kind: 'none' });
      expect(r.lines).toEqual(['That command is not available. Type help() to see the commands.']);
    }
  });
});

describe('execute: spec §6 rule 1 holds for every log line of every period', () => {
  for (const [name, d] of [['fixture', fixture], ['real log numbers', real]] as const) {
    it(`no ages, banned words, Group IDs, sample IDs or raw ids (${name})`, () => {
      const bad: string[] = [];
      for (const c of ALL_COMMANDS) {
        const lines = [...execute(c, d).lines, ...execute(c, d, { todayShown: true, features: FEATURES }).lines];
        for (const line of lines) {
          bad.push(...rule1Violations(line));
          if (c.name !== 'help') bad.push(...rawIdViolations(line)); // help() may list argument values
        }
      }
      expect(bad).toEqual([]);
    });
  }
  it('the scan itself catches violations (self-test)', () => {
    expect(rule1Violations('about 4,500 years ago')).not.toEqual([]);
    expect(rule1Violations('2450 BCE')).not.toEqual([]);
    expect(rule1Violations('England_IA')).not.toEqual([]);
    expect(rule1Violations('I2416')).not.toEqual([]);
    expect(rule1Violations('Neolithic')).not.toEqual([]);
    expect(rule1Violations('started about 2,000 years ago')).toEqual([]);
    expect(rawIdViolations('Projecting IronAge')).not.toEqual([]);
    expect(rawIdViolations('Try ancestry_test(person = "IronAge")')).toEqual([]);
  });
});

describe('axes lines read logs.pca_people_unique (Task 7, spec §3.5)', () => {
  const MAP_AXES = 'Map axes: built from about 950 present-day Europeans. Britons are left out, then placed on the map the same way as ancient Britons.';
  const AXES = 'Axes: about 950 present-day Europeans. Britons are left out, then placed on the map the same way as ancient Britons.';

  it('the content functions give the spec wording', () => {
    expect(mapAxesLine(950)).toBe(MAP_AXES);
    expect(axesLine(950)).toBe(AXES);
  });

  it('load_genomes prints the map-axes line, and the old 1,163 line is gone', () => {
    const lines = execute({ name: 'load_genomes' }, real).lines;
    expect(lines).toContain(MAP_AXES);
    expect(lines.join('\n')).not.toContain('1,163');
    expect(lines.join('\n')).not.toContain('(Britain left out)');
  });

  it('every run_pca prints the axes line, Europe and all included', () => {
    const periods = ['Europe', 'all', ...PERIODS] as const;
    for (const period of periods) {
      const lines = execute({ name: 'run_pca', period }, real).lines;
      expect(lines, period).toContain(AXES);
      expect(lines.join('\n'), period).not.toContain('1,163');
    }
  });

  it('rounds pca_people_unique to the nearest 10', () => {
    const at = (n: number) => execute({ name: 'load_genomes' }, { ...real, logs: { ...REAL_LOGS, pca_people_unique: n } }).lines;
    expect(at(947)).toContain(mapAxesLine(950));
    expect(at(955)).toContain(mapAxesLine(960));
    expect(at(944)).toContain(mapAxesLine(940));
  });
});
