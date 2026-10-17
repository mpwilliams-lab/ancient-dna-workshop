import type { CardId, StepId } from './types';
import type { Command } from './parser';
import { formatCommand } from './parser';
import { PREDICT_HINT, REVEAL_HINT } from './content';

/** One guided step's id and the cards it opens (spec v3 §2.1, CONTRACT §3, §4.4). */
export interface ScriptStep { id: StepId; cards?: { placement: 'after' | 'before'; ids: CardId[] } }

const after = (...ids: CardId[]): ScriptStep['cards'] => ({ placement: 'after', ids });
const before = (...ids: CardId[]): ScriptStep['cards'] => ({ placement: 'before', ids });

/**
 * The 19-step guided script of spec v3 §2.1, one row per step. SCRIPT and SCRIPT_STEPS are both read from this table,
 * so they stay parallel by construction (a timing cut that drops a step drops its row, Task 31).
 */
const GUIDED: readonly { cmd: Command; step: ScriptStep }[] = [
  { cmd: { name: 'ancestry_test', person: 'me' }, step: { id: 'hook' } },
  { cmd: { name: 'load_genomes' }, step: { id: 'load' } },
  { cmd: { name: 'run_pca', period: 'Europe' }, step: { id: 'europe', cards: after('A1') } },
  { cmd: { name: 'run_pca', period: 'FirstFarmers' }, step: { id: 'firstFarmers', cards: after('B1') } },
  { cmd: { name: 'run_pca', period: 'BellBeaker' }, step: { id: 'bellBeaker', cards: after('C1') } },
  { cmd: { name: 'run_admixture', K: 3 }, step: { id: 'admix1', cards: after('D1', 'D2') } },
  { cmd: { name: 'run_pca', period: 'BronzeAge' }, step: { id: 'bronzeAge' } },
  { cmd: { name: 'run_pca', period: 'IronAge' }, step: { id: 'ironAge', cards: after('E1', 'E2', 'E3') } },
  { cmd: { name: 'ancestry_test', person: 'IronAge' }, step: { id: 'consumerIA' } },
  { cmd: { name: 'run_pca', period: 'Today' }, step: { id: 'revealPca' } },
  { cmd: { name: 'run_admixture', K: 3 }, step: { id: 'revealAdmix' } },
  { cmd: { name: 'run_pca', period: 'Roman' }, step: { id: 'roman', cards: after('F1') } },
  { cmd: { name: 'run_pca', period: 'AngloSaxon' }, step: { id: 'angloSaxon', cards: after('G1', 'G2') } },
  { cmd: { name: 'run_pca', period: 'all' }, step: { id: 'finale' } },
  { cmd: { name: 'allele_freq', gene: 'LCT' }, step: { id: 'lct', cards: before('H1', 'H2') } },
  { cmd: { name: 'allele_freq', gene: 'SLC45A2' }, step: { id: 'slc45a2', cards: before('I1', 'I2') } },
  { cmd: { name: 'allele_freq', gene: 'HERC2' }, step: { id: 'herc2', cards: before('J1', 'J2', 'J3') } },
  { cmd: { name: 'allele_freq', gene: 'TYK2' }, step: { id: 'tyk2', cards: before('K1', 'K2') } },
  { cmd: { name: 'allele_freq', gene: 'HLA-DQ2' }, step: { id: 'hla', cards: before('L1', 'L2', 'L3') } },
];

/** The guided commands, in order (spec v3 §2.1). The Predict and Reveal beats are hint lines, not steps. */
export const SCRIPT: Command[] = GUIDED.map((g) => g.cmd);
/** Parallel to SCRIPT: each step's id and cards. Cards open only when a command advances the pointer through the step. */
export const SCRIPT_STEPS: ScriptStep[] = GUIDED.map((g) => g.step);

/** Shown in rotation once the script is finished (spec v3 §2.1 extras). */
export const EXTRAS: Command[] = [
  { name: 'run_pca', period: 'Viking' },
  { name: 'run_admixture', K: 3, period: 'BellBeaker' },
  { name: 'ancestry_test', person: 'Today' },
  { name: 'run_admixture', K: 3 },
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

/**
 * The hint line text. `lastRan` is null before anything has run; undefined is treated the same.
 * Two predict beats (spec v3 §2.2): PREDICT_HINT when script[i] is run_pca(BellBeaker) right after run_pca(FirstFarmers),
 * and REVEAL_HINT when script[i] is run_pca(Today) right after ancestry_test(IronAge). CARD_HINT is not produced here:
 * the controller shows it while a card is open.
 */
export function hintText(i: number, lastRan: Command | null, extrasTick: number): string {
  const step = SCRIPT[clampIndex(i)];
  if (step === undefined) return EXTRA_PREFIX + formatCommand(extraAt(extrasTick));
  const predictStep = step.name === 'run_pca' && step.period === 'BellBeaker';
  if (predictStep && lastRan?.name === 'run_pca' && lastRan.period === 'FirstFarmers') return PREDICT_HINT;
  const revealStep = step.name === 'run_pca' && step.period === 'Today';
  if (revealStep && lastRan?.name === 'ancestry_test' && lastRan.person === 'IronAge') return REVEAL_HINT;
  return NEXT_PREFIX + formatCommand(step);
}

/** The cards of guided step i (undefined for a step without cards or an index outside the script). */
export function stepCards(i: number): ScriptStep['cards'] {
  return Number.isInteger(i) ? SCRIPT_STEPS[i]?.cards : undefined;
}
