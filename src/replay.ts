// The ONE forward step (spec v3 §4.2, CONTRACT §4.6). Live runs and replay (refresh, Back) both go through
// applyCommand, so a refreshed station shows the same plot, hint line, extras rotation and cards as the live one.
import type { CardId, WorkshopData } from './types';
import { parse, type Command } from './parser';
import { execute, type CommandResult } from './commands';
import { SCRIPT, SCRIPT_STEPS, advance, type ScriptStep } from './hints';
import { INITIAL_PLOT, reducePlot, todayShown, type PlotState } from './plotState';
import { FEATURES, type Features } from './features';

export interface Derived {
  plot: PlotState;
  hintIndex: number;
  lastRan: Command | null;
  extrasTick: number;
  cardsFor: CardId[][];   // one entry per step applied: the cards of the script step it advanced through, else []
}

export const INITIAL_DERIVED: Derived = { plot: INITIAL_PLOT, hintIndex: 0, lastRan: null, extrasTick: 0, cardsFor: [] };

export interface Applied { derived: Derived; result: CommandResult; cards: CardId[]; placement?: 'after' | 'before' }

/** help() and clear() print but are never steps (spec §4.1). */
export function isHousekeeping(c: Command): boolean {
  return c.name === 'help' || c.name === 'clear';
}

/**
 * Runs one parsed command. A refused command, help() or clear() returns `d` itself with no cards: the caller prints
 * the lines but records no step. Otherwise: extrasTick += 1 iff the pointer was already past the script; the cards are
 * SCRIPT_STEPS[i].cards iff advance moves i -> i + 1; execute sees todayShown of the plot BEFORE this command.
 */
export function applyCommand(d: Derived, cmd: Command, data: WorkshopData, features: Features = FEATURES): Applied {
  const result = execute(cmd, data, { todayShown: todayShown(d.plot), features });
  if (result.refused || isHousekeeping(cmd)) return { derived: d, result, cards: [] };
  const i = d.hintIndex;
  const next = advance(i, cmd);
  const spec = next === i + 1 ? SCRIPT_STEPS[i]?.cards : undefined;
  const cards: CardId[] = spec ? [...spec.ids] : [];
  const derived: Derived = {
    plot: result.plot.kind === 'none' ? d.plot : reducePlot(d.plot, result.plot, data),
    hintIndex: next,
    lastRan: cmd,
    extrasTick: i >= SCRIPT.length ? d.extrasTick + 1 : d.extrasTick,
    cardsFor: [...d.cardsFor, cards],
  };
  return spec ? { derived, result, cards, placement: spec.placement } : { derived, result, cards };
}

/** Placement of a card, read from the script step that owns it. */
export function cardPlacement(id: CardId, steps: readonly ScriptStep[] = SCRIPT_STEPS): 'after' | 'before' {
  return steps.find((s) => s.cards?.ids.includes(id))?.cards?.placement ?? 'after';
}

export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayError';
  }
}

/** Replays steps[0..n). Deterministic: execute reads only the bundled data. Throws ReplayError on anything a saved step can never be. */
export function derive(data: WorkshopData, steps: readonly { cmd: string }[], n: number, features: Features = FEATURES): Derived {
  if (!Number.isInteger(n) || n < 0 || n > steps.length) throw new ReplayError(`cannot replay to step ${n} of ${steps.length}`);
  let d = INITIAL_DERIVED;
  for (let k = 0; k < n; k += 1) {
    const raw = steps[k]?.cmd;
    const res = typeof raw === 'string' ? parse(raw) : null;
    if (!res || !res.ok) throw new ReplayError(`step ${k + 1} does not parse`);
    if (isHousekeeping(res.command)) throw new ReplayError(`step ${k + 1} is ${res.command.name}(), which is never a step`);
    const a = applyCommand(d, res.command, data, features);
    if (a.result.refused) throw new ReplayError(`step ${k + 1} was refused`);
    d = a.derived;
  }
  return d;
}

/** FNV-1a 32-bit over the UTF-16 code units of `text`, as 8 lower-case hex digits. */
export function fnv1a32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Hash of the script's step ids, placements and card ids. A cut that drops a step or a card changes it. */
export function sessionBuildHash(steps: readonly ScriptStep[] = SCRIPT_STEPS): string {
  return fnv1a32(steps.map((s) => `${s.id}:${s.cards?.placement ?? '-'}:${s.cards?.ids.join(',') ?? ''}`).join('|'));
}
