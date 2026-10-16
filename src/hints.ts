import type { Command } from './parser';
import { formatCommand } from './parser';
import { PREDICT_HINT } from './content';

/** The guided script of spec §3, in order (§4.3). The predict beat is not a step. */
export const SCRIPT: Command[] = [
  { name: 'ancestry_test', person: 'me' },
  { name: 'load_genomes' },
  { name: 'run_pca', period: 'Today' },
  { name: 'run_pca', period: 'FirstFarmers' },
  { name: 'run_pca', period: 'BellBeaker' },
  { name: 'run_admixture', K: 3 },
  { name: 'run_pca', period: 'IronAge' },
  { name: 'run_pca', period: 'Roman' },
  { name: 'run_pca', period: 'AngloSaxon' },
  { name: 'run_admixture', K: 3 },
  { name: 'ancestry_test', person: 'IronAge' },
  { name: 'allele_freq', gene: 'LCT' },
  { name: 'allele_freq', gene: 'SLC45A2' },
  { name: 'allele_freq', gene: 'HERC2' },
  { name: 'allele_freq', gene: 'TYK2' },
  { name: 'allele_freq', gene: 'HLA-DQ2' },
];

/** Shown in rotation once the script is finished (§4.3). */
export const EXTRAS: Command[] = [
  { name: 'run_pca', period: 'BronzeAge' },
  { name: 'run_pca', period: 'Viking' },
  { name: 'run_pca', period: 'all' },
  { name: 'run_admixture', K: 3, period: 'BellBeaker' },
];

export const NEXT_PREFIX = 'Next: ';
export const EXTRA_PREFIX = 'Try an extra: ';

/** Same name and arguments. An extra `period` on run_admixture still matches a step without one. */
export function matchesStep(ran: Command, step: Command): boolean {
  if (!ran || typeof ran !== 'object') return false;
  switch (step.name) {
    case 'help': case 'load_genomes': case 'clear':
      return ran.name === step.name;
    case 'run_pca':
      return ran.name === 'run_pca' && ran.period === step.period;
    case 'run_admixture':
      return ran.name === 'run_admixture' && ran.K === step.K && (step.period === undefined || ran.period === step.period);
    case 'allele_freq':
      return ran.name === 'allele_freq' && ran.gene === step.gene;
    case 'ancestry_test':
      return ran.name === 'ancestry_test' && ran.person === step.person;
  }
}

function clampIndex(i: number): number {
  if (!Number.isFinite(i)) return Number.isNaN(i) ? 0 : i > 0 ? SCRIPT.length : 0;
  return Math.min(SCRIPT.length, Math.max(0, Math.floor(i)));
}

/** i advances by one only when the command run equals script[i]; anything else leaves it unchanged. */
export function advance(i: number, ran: Command): number {
  const k = clampIndex(i);
  const step = SCRIPT[k];
  return step !== undefined && matchesStep(ran, step) ? k + 1 : k;
}

function extraAt(extrasTick: number): Command {
  const t = Number.isFinite(extrasTick) ? Math.floor(extrasTick) : 0;
  return EXTRAS[((t % EXTRAS.length) + EXTRAS.length) % EXTRAS.length] ?? EXTRAS[0]!;
}

/** The command Esc and the three-tries auto-fill insert: script[i], or the current extra after the end. */
export function hintCommand(i: number, extrasTick: number): Command {
  return SCRIPT[clampIndex(i)] ?? extraAt(extrasTick);
}

/** The hint line text. */
export function hintText(i: number, lastRan: Command | null, extrasTick: number): string {
  const step = SCRIPT[clampIndex(i)];
  if (step === undefined) return EXTRA_PREFIX + formatCommand(extraAt(extrasTick));
  const predictStep = step.name === 'run_pca' && step.period === 'BellBeaker';
  if (predictStep && lastRan !== null && lastRan.name === 'run_pca' && lastRan.period === 'FirstFarmers') return PREDICT_HINT;
  return NEXT_PREFIX + formatCommand(step);
}
