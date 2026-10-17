// Plot state for the v3 script (spec v3 §2.3, CONTRACT §4.5). Pure: no DOM. The renderers (Tasks 8, 9) draw from the
// state and the helpers below; replay (Task 6) rebuilds the state by running reducePlot over the command log.
import type { AdmixShares, ChipIcon, ChipKey, FrameId, GeneId, PeriodId, WorkshopData } from './types';
import { GENE_IDS, PERIOD_FRAME } from './types';
import type { PlotAction } from './commands';
import {
  CHIP_TEXT, EUROPE_CAPTION, FINALE_CAPTION, PCA_CAPTION, REVEAL_PCA_CAPTION, ROMAN_FOCUS_CAPTION, chipIcon, zoomNote,
} from './content';

/** The period just run on the PCA: a period, the Europe view or the all-periods finale. */
export type PcaFocus = PeriodId | 'Europe' | 'all';

export interface PlotState {
  view: 'none' | 'pca' | 'admixture' | 'trait' | 'consumer';   // 'consumer' is set by Task 18 (consumerBars)
  layers: PeriodId[];            // time order; 'Today' only once run_pca(Today) or run_pca(all) has run
  focus?: PcaFocus;              // the period just run on the PCA
  frame: FrameId; showNorthSea: boolean;
  admixShown: PeriodId[]; admixNew: PeriodId[]; admixPeriod?: PeriodId;
  gene?: GeneId; person?: PeriodId | 'me';
}

export const INITIAL_PLOT: PlotState = {
  view: 'none', layers: [], frame: 'europe', showNorthSea: false, admixShown: [], admixNew: [],
};

/** Mean-bar ADMIXTURE with no PCA layer yet (spec v3 §2.3): First farmers / Stonehenge builders and Bell Beaker. */
const DEFAULT_BARS: readonly PeriodId[] = ['FirstFarmers', 'BellBeaker'];
const NORTH_SEA_TRIGGERS: readonly PeriodId[] = ['AngloSaxon', 'Viking'];
/** Focus periods that keep the Iron Age layer half-visible, so the comparison with it stays readable (spec v3 §2.3). */
const IRON_AGE_KEPT_FOR: readonly PcaFocus[] = ['Today', 'Roman', 'AngloSaxon'];

function inTimeOrder(data: WorkshopData, ids: Iterable<PeriodId>): PeriodId[] {
  const order = new Map(data.periods.map((p) => [p.id, p.order]));
  return [...new Set(ids)].filter((id) => order.has(id)).sort((a, b) => order.get(a)! - order.get(b)!);
}

function withoutAdmixPeriod(s: PlotState): PlotState {
  const { admixPeriod: _drop, ...rest } = s;
  return rest;
}

/**
 * Spec v3 §2.3. Pure: never mutates `s`; returns `s` itself when the action is not understood.
 * - run_pca(P): adds P (never Today automatically), focus = P, frame = the APP constant PERIOD_FRAME[P] (Today: britain;
 *   periods[].frame in the JSON is never read here), North Sea marker once AngloSaxon or Viking has run.
 * - run_pca(Europe): view pca, focus Europe, frame europe, layers unchanged.
 * - run_pca(all): all eight layers, focus all, frame europe, North Sea marker on.
 * - run_admixture(K = 3): bars = admixBars(s); the first mean-bar call outlines nothing, later calls outline new bars.
 * - run_admixture(K = 3, period = P), allele_freq: unchanged from v2.1. The consumer view arrives with Task 18.
 */
export function reducePlot(s: PlotState, a: PlotAction, data: WorkshopData): PlotState {
  const known = new Set(data.periods.map((p) => p.id));
  switch (a?.kind) {
    case 'pca': {
      if (a.period === 'all') {
        return { ...s, view: 'pca', layers: inTimeOrder(data, known), focus: 'all', frame: 'europe', showNorthSea: true };
      }
      if (a.period === 'Europe') return { ...s, view: 'pca', focus: 'Europe', frame: 'europe' };
      if (!known.has(a.period)) return s;
      return {
        ...s,
        view: 'pca',
        layers: inTimeOrder(data, [...s.layers, a.period]),   // Today is never added automatically (spec v3 §2.3)
        focus: a.period,
        frame: PERIOD_FRAME[a.period],                       // the app constant, never periods[].frame
        showNorthSea: s.showNorthSea || NORTH_SEA_TRIGGERS.includes(a.period),
      };
    }
    case 'admixture': {
      if (a.period !== undefined) {
        if (!known.has(a.period)) return s;
        return { ...s, view: 'admixture', admixPeriod: a.period };
      }
      const shown = inTimeOrder(data, admixBars(s));
      const firstCall = s.admixShown.length === 0;
      const added = firstCall ? [] : shown.filter((id) => !s.admixShown.includes(id));
      return { ...withoutAdmixPeriod(s), view: 'admixture', admixShown: shown, admixNew: added };
    }
    case 'trait': {
      if (!GENE_IDS.includes(a.gene)) return s;
      return { ...s, view: 'trait', gene: a.gene };
    }
    default:
      return s;
  }
}

/** Britain today is on the PCA once run_pca(Today) or run_pca(all) has run. */
export function todayShown(p: PlotState): boolean {
  return p.layers.includes('Today');
}

/** SVG opacity values are strings (as the renderer's GHOST_OPACITY). */
export type LayerOpacity = '1' | '0.6' | '0.3';

/**
 * Focus fading (spec v3 §2.3): the focus layer 1; Iron Age 0.6 when the focus is Today, Roman or AngloSaxon; every other
 * period layer 0.3. No fading at all when the focus is undefined, Europe or all.
 */
export function layerOpacity(p: PlotState, id: PeriodId): LayerOpacity {
  const f = p.focus;
  if (f === undefined || f === 'Europe' || f === 'all' || f === id) return '1';
  if (id === 'IronAge' && IRON_AGE_KEPT_FOR.includes(f)) return '0.6';
  return '0.3';
}

/** round(min(spanX_europe / spanX_britain, spanY_europe / spanY_britain)) from the JSON frames; 5 on the real data. */
export function zoomFactor(data: WorkshopData): number {
  const e = data.frames.europe;
  const b = data.frames.britain;
  return Math.round(Math.min((e.xmax - e.xmin) / (b.xmax - b.xmin), (e.ymax - e.ymin) / (b.ymax - b.ymin)));
}

export type PcaCaptionItem =
  | { kind: 'caption'; key: 'PCA_CAPTION' | 'EUROPE_CAPTION' | 'REVEAL_PCA_CAPTION' | 'ROMAN_FOCUS_CAPTION' | 'FINALE_CAPTION'; text: string }
  | { kind: 'chip'; key: ChipKey; text: string; icon: ChipIcon }
  | { kind: 'zoom'; text: string };

function chip(key: ChipKey): PcaCaptionItem {
  return { kind: 'chip', key, text: CHIP_TEXT[key], icon: chipIcon(key) };
}

/**
 * The PCA caption strip, in order (spec v3 §2.3, §3.5; CONTRACT §4.5): PCA_CAPTION; EUROPE_CAPTION while the focus is
 * Europe and Britain today is not shown; then the focus item (BellBeaker chip, Roman caption, AngloSaxon chip, the reveal
 * caption when the focus is Today and Iron Age is on the map, the finale caption for all); then the zoom note in the
 * British frame.
 */
export function pcaCaptions(p: PlotState, data: WorkshopData): PcaCaptionItem[] {
  const out: PcaCaptionItem[] = [{ kind: 'caption', key: 'PCA_CAPTION', text: PCA_CAPTION }];
  if (p.focus === 'Europe' && !todayShown(p)) out.push({ kind: 'caption', key: 'EUROPE_CAPTION', text: EUROPE_CAPTION });
  switch (p.focus) {
    case 'BellBeaker': out.push(chip('CHIP_DNA_CHANGED')); break;
    case 'Roman': out.push({ kind: 'caption', key: 'ROMAN_FOCUS_CAPTION', text: ROMAN_FOCUS_CAPTION }); break;
    case 'AngloSaxon': out.push(chip('CHIP_DNA_CHANGED_EAST')); break;
    case 'Today':
      if (p.layers.includes('IronAge')) out.push({ kind: 'caption', key: 'REVEAL_PCA_CAPTION', text: REVEAL_PCA_CAPTION });
      break;
    case 'all': out.push({ kind: 'caption', key: 'FINALE_CAPTION', text: FINALE_CAPTION }); break;
    default: break;
  }
  if (p.frame === 'britain') out.push({ kind: 'zoom', text: zoomNote(zoomFactor(data)) });
  return out;
}

/**
 * The mean bars a run_admixture(K = 3) draws from this state (spec v3 §2.3): the PCA layers in time order (Britain today
 * only if shown), or First farmers / Stonehenge builders and Bell Beaker when no period has been mapped yet.
 */
export function admixBars(p: PlotState): PeriodId[] {
  return p.layers.length > 0 ? [...p.layers] : [...DEFAULT_BARS];
}

/**
 * Whole-percent steppe share of a bar (or a person), as printed on screen. The one rounding rule: the "{pct}% steppe"
 * bar labels, the reveal note and admixCallout all read it, so the note cannot disagree with the bars. plots/admixture.ts
 * re-exports it.
 */
export function steppePct(s: AdmixShares): number {
  return Math.round(s.STEPPE * 100);
}

export type AdmixCallout = { kind: 'beaker' } | { kind: 'reveal'; todaySteppe: number; ironSteppe: number } | { kind: 'none' };

/**
 * Which callout the ADMIXTURE view shows (spec v3 §2.3, §3.3): none for the per-person view; the reveal callout and note
 * when Britain today and the Iron Age are both among the bars; otherwise the Beaker callout, which is also the fallback
 * when the JSON lacks the Britain today bar or the Iron Age bar. The two steppe numbers are steppePct of
 * data.admixture.bars (56 and 57 on the current build).
 */
export function admixCallout(p: PlotState, data: WorkshopData): AdmixCallout {
  if (p.admixPeriod !== undefined) return { kind: 'none' };
  const bars = p.admixShown.length > 0 ? p.admixShown : admixBars(p);
  if (bars.includes('Today') && bars.includes('IronAge')) {
    const today = data.admixture.bars.find((b) => b.period === 'Today');
    const iron = data.admixture.bars.find((b) => b.period === 'IronAge');
    if (today && iron) return { kind: 'reveal', todaySteppe: steppePct(today), ironSteppe: steppePct(iron) };
  }
  return { kind: 'beaker' };
}
