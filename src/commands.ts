import type { WorkshopData, PeriodId, GeneId, ConsumerShare } from './types';
import { PERIOD_IDS, GENE_IDS } from './types';
import type { Command } from './parser';
import {
  PERIOD_LABELS, MAP_GROUP_LABELS, SOURCE_LABELS, HELP_LINES, ME_RESULT, ME_HEADING, HOOK_QUESTION,
  CONSUMER_NOTE, CONSUMER_TAKEAWAY, HOOK_NOTE, ROMAN_LOG_LINE, K_REFUSAL, consumerTitle, traitSourceLabel,
} from './content';

export type PlotAction =
  | { kind: 'none' } | { kind: 'pca'; period: PeriodId | 'all' }
  | { kind: 'admixture'; period?: PeriodId } | { kind: 'trait'; gene: GeneId };
export interface CommandResult { lines: string[]; plot: PlotAction; refused: boolean; clear: boolean }

const NONE: PlotAction = { kind: 'none' };
const LABEL_WIDTH = 36;     // longest period label is 35 characters
const BAR_WIDTH = 20;
const UNAVAILABLE = 'That command is not available. Type help() to see the commands.';

function isPeriod(v: unknown): v is PeriodId { return typeof v === 'string' && (PERIOD_IDS as readonly string[]).includes(v); }
function isGene(v: unknown): v is GeneId { return typeof v === 'string' && (GENE_IDS as readonly string[]).includes(v); }
function ok(lines: string[], plot: PlotAction = NONE): CommandResult { return { lines, plot, refused: false, clear: false }; }
function refuse(lines: string[]): CommandResult { return { lines, plot: NONE, refused: true, clear: false }; }

/** 496901 -> "496,901" (locale-independent). */
export function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Whole percents by largest remainder, so they add up to round(100 * sum(shares)). Ties go to the earlier entry. */
export function roundPercents(shares: number[]): number[] {
  const raw = shares.map((s) => (Number.isFinite(s) ? Math.max(0, s) * 100 : 0));
  const target = Math.round(raw.reduce((a, b) => a + b, 0));
  const cells = raw.map((r, i) => ({ i, pct: Math.floor(r), rem: r - Math.floor(r) }));
  let missing = target - cells.reduce((a, c) => a + c.pct, 0);
  for (const c of [...cells].sort((a, b) => b.rem - a.rem || a.i - b.i)) {
    if (missing <= 0) break;
    c.pct += 1;
    missing -= 1;
  }
  return cells.map((c) => c.pct);
}

/** 92 -> "[##################..]" (20 characters between the brackets, plain ASCII). */
export function asciiBar(pct: number): string {
  const k = Math.min(BAR_WIDTH, Math.max(0, Math.round((Number.isFinite(pct) ? pct : 0) / 5)));
  return `[${'#'.repeat(k)}${'.'.repeat(BAR_WIDTH - k)}]`;
}

function nPca(data: WorkshopData, id: PeriodId): number { return data.periods.find((p) => p.id === id)?.n_pca ?? 0; }
function nAdmix(data: WorkshopData, id: PeriodId): number { return data.periods.find((p) => p.id === id)?.n_admix ?? 0; }
function periodRow(label: string, n: number): string { return `  ${label.padEnd(LABEL_WIDTH)}${formatCount(n)}`; }

function shareLines(shares: ConsumerShare[]): string[] {
  const sorted = [...shares].sort((a, b) => b.share - a.share);
  const pcts = roundPercents(sorted.map((s) => s.share));
  return sorted.map((s, i) => {
    const pct = pcts[i] ?? 0;
    return `  ${s.label.padEnd(12)} ${asciiBar(pct)} ${String(pct).padStart(3)}%`;
  });
}

function loadGenomes(data: WorkshopData): CommandResult {
  const L = data.logs;
  return ok([
    '$ load_genomes',
    `Reading genotypes: ${formatCount(L.snps_total)} SNPs`,
    `Quality filter: ${formatCount(L.snps_used)} SNPs kept`,
    `Map axes: built from ${formatCount(L.pca_samples_used)} present-day Europeans (Britain left out)`,
    `Ancestry run: ${formatCount(L.admix_individuals)} people, ${formatCount(L.admix_snps)} SNPs`,
    'People in Britain, by period:',
    ...PERIOD_IDS.map((id) => periodRow(PERIOD_LABELS[id], nPca(data, id))),
    'Genomes loaded.',
  ]);
}

function runPca(data: WorkshopData, period: PeriodId | 'all'): CommandResult {
  const L = data.logs;
  const head = [
    '$ smartpca -p britain.par',
    `Genotypes: ${formatCount(L.snps_total)} SNPs; ${formatCount(L.snps_used)} used after quality filter`,
    `Axes: ${formatCount(L.pca_samples_used)} present-day Europeans (Britain left out)`,
  ];
  let body: string[];
  if (period === 'all') {
    body = ['Projecting every period onto the axes:', ...PERIOD_IDS.map((id) => periodRow(PERIOD_LABELS[id], nPca(data, id)))];
  } else {
    body = [`Projecting ${PERIOD_LABELS[period]} onto the axes: ${formatCount(nPca(data, period))} people`];
    if (period === 'Today') {
      body.push(`Map groups: ${data.map_groups.map((g) => `${MAP_GROUP_LABELS[g.id]} (${formatCount(g.n)})`).join(', ')}`);
    }
    if (period === 'Roman') body.push(ROMAN_LOG_LINE); // spec v3 §3.5 (replaces the v2.1 Roman card), §6 rule 4
  }
  return ok([...head, ...body, 'Done: PC1 and PC2 written.'], { kind: 'pca', period });
}

function runAdmixture(data: WorkshopData, K: number, period: PeriodId | undefined): CommandResult {
  if (K !== 3) return refuse([K_REFUSAL]);
  const L = data.logs;
  const lines = [
    '$ fastmixture --bfile britain --K 3 --supervised sources.txt',
    `Reading data... loaded ${formatCount(L.admix_individuals)} samples and ${formatCount(L.admix_snps)} SNPs.`,
    `Reference groups: ${SOURCE_LABELS.STEPPE}, ${SOURCE_LABELS.FARMER}, ${SOURCE_LABELS.WHG}`,
    'Estimating ancestry shares (mini-batch EM)...',
    'Converged.',
    period === undefined
      ? 'Drawing one average bar per period.'
      : `Showing one bar per person: ${PERIOD_LABELS[period]} (${formatCount(nAdmix(data, period))} people in this ancestry run)`,
  ];
  return ok(lines, period === undefined ? { kind: 'admixture' } : { kind: 'admixture', period });
}

function alleleFreq(data: WorkshopData, gene: GeneId): CommandResult {
  const t = data.traits.find((x) => x.gene === gene);
  if (!t) return refuse([`No frequency data for ${gene} in this build.`]);
  return ok([
    `Reading allele frequencies: ${t.gene} (${t.rsid}), allele ${t.allele}`,
    `Source: ${traitSourceLabel(t)}`,
    t.source === 'text' ? 'Showing a summary card for this variant.' : 'Plotting frequency through time, with its uncertainty.',
  ], { kind: 'trait', gene });
}

function ancestryTest(data: WorkshopData, person: PeriodId | 'me'): CommandResult {
  if (person === 'me') {
    // The hook screen shows only one sentence of the note: the rest is the Beat 4 debrief and waits for a period's result.
    return ok([
      ME_HEADING,
      'Compared with: people living in Europe today',
      ...shareLines(ME_RESULT),
      HOOK_QUESTION,
      HOOK_NOTE,
    ]);
  }
  // Every period, Today included, has a consumer entry (spec v2.1 §5.3), so Today is not a special case.
  const shares = data.consumer[person];
  if (!shares || shares.length === 0) return refuse([`No consumer-test result for ${PERIOD_LABELS[person]} in this build.`]);
  return ok([
    consumerTitle(PERIOD_LABELS[person], nPca(data, person)),
    'Compared with: people living in Europe today',
    ...shareLines(shares),
    CONSUMER_TAKEAWAY,
    CONSUMER_NOTE,
  ]);
}

/** Runs one parsed command against the precomputed data. Never throws. */
export function execute(c: Command, data: WorkshopData): CommandResult {
  try {
    switch (c.name) {
      case 'help': return ok([...HELP_LINES]);
      case 'load_genomes': return loadGenomes(data);
      case 'clear': return { lines: [], plot: NONE, refused: false, clear: true };
      case 'run_pca':
        if (c.period === 'all' || isPeriod(c.period)) return runPca(data, c.period);
        break;
      case 'run_admixture':
        if (c.period === undefined || isPeriod(c.period)) return runAdmixture(data, c.K, c.period);
        break;
      case 'allele_freq':
        if (isGene(c.gene)) return alleleFreq(data, c.gene);
        break;
      case 'ancestry_test':
        if (c.person === 'me' || isPeriod(c.person)) return ancestryTest(data, c.person);
        break;
    }
  } catch {
    // fall through to the friendly refusal
  }
  return refuse([UNAVAILABLE]);
}
