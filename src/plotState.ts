import type { WorkshopData, PeriodId, FrameId, GeneId } from './types';
import { GENE_IDS } from './types';
import type { PlotAction } from './commands';

export interface PlotState {
  view: 'none' | 'pca' | 'admixture' | 'trait';
  layers: PeriodId[]; frame: FrameId; showNorthSea: boolean;
  admixShown: PeriodId[]; admixNew: PeriodId[]; admixPeriod?: PeriodId; gene?: GeneId;
}

export const INITIAL_PLOT: PlotState = {
  view: 'none', layers: [], frame: 'europe', showNorthSea: false, admixShown: [], admixNew: [],
};

const DEFAULT_BARS: readonly PeriodId[] = ['FirstFarmers', 'BellBeaker', 'Today'];
const NORTH_SEA_TRIGGERS: readonly PeriodId[] = ['AngloSaxon', 'Viking'];

function inTimeOrder(data: WorkshopData, ids: Iterable<PeriodId>): PeriodId[] {
  const order = new Map(data.periods.map((p) => [p.id, p.order]));
  return [...new Set(ids)].filter((id) => order.has(id)).sort((a, b) => order.get(a)! - order.get(b)!);
}

function withoutAdmixPeriod(s: PlotState): PlotState {
  const { admixPeriod: _drop, ...rest } = s;
  return rest;
}

/** Spec §4.4. Pure: never mutates `s`; returns `s` itself when nothing changes or the action is not understood. */
export function reducePlot(s: PlotState, a: PlotAction, data: WorkshopData): PlotState {
  const known = new Set(data.periods.map((p) => p.id));
  switch (a?.kind) {
    case 'pca': {
      if (a.period === 'all') {
        return { ...s, view: 'pca', layers: inTimeOrder(data, known), frame: 'europe', showNorthSea: true };
      }
      const info = data.periods.find((p) => p.id === a.period);
      if (!info) return s;
      return {
        ...s,
        view: 'pca',
        layers: inTimeOrder(data, [...s.layers, a.period, 'Today']),   // Today's Europe base layer is always included
        frame: info.frame,                                              // depends only on the period just run
        showNorthSea: s.showNorthSea || NORTH_SEA_TRIGGERS.includes(a.period),
      };
    }
    case 'admixture': {
      if (a.period !== undefined) {
        if (!known.has(a.period)) return s;
        return { ...s, view: 'admixture', admixPeriod: a.period };
      }
      const shown = s.layers.length > 0 ? inTimeOrder(data, s.layers) : inTimeOrder(data, DEFAULT_BARS);
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
