import raw from '@workshop-data';
import {
  CONSUMER_LABELS, FRAME_IDS, GENE_IDS, MAP_GROUP_IDS, PERIOD_FRAME, PERIOD_IDS, TICK_KEYS,
} from './types';
import type {
  AdmixBar, AdmixShares, AxisTick, ConsumerShare, Frame, FrameId, GeneId, LogNumbers, MapGroup,
  PeriodId, PeriodInfo, PeriodPoints, PersonPt, Pt, Trait, TraitPoint, WorkshopData,
} from './types';

/** The variant each trait must plot (spec §5.4). A JSON that names any other variant or allele is rejected. */
export const TRAIT_SPECS: Readonly<Record<GeneId, { rsid: string; variant_id: string; allele: string }>> = {
  LCT: { rsid: 'rs4988235', variant_id: '2_136608646_G_A', allele: 'A' },
  SLC45A2: { rsid: 'rs16891982', variant_id: '5_33951693_C_G', allele: 'G' },
  HERC2: { rsid: 'rs12913832', variant_id: '15_28365618_A_G', allele: 'G' },
  TYK2: { rsid: 'rs34536443', variant_id: '19_10463118_G_C', allele: 'C' },
  'HLA-DQ2': { rsid: 'rs3891176', variant_id: '6_32634318_C_A', allele: 'A' },
};

export class DataError extends Error {
  constructor(path: string, problem: string) {
    super(`workshop_data.json invalid at ${path}: ${problem}`);
    this.name = 'DataError';
  }
}

const SUM_TOL = 0.011;   // shares are rounded in the JSON; they must sum to 1 within this
const FREQ_TOL = 1e-6;

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new DataError(path, 'expected an object');
  return v as Obj;
}
function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new DataError(path, 'expected an array');
  return v;
}
function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new DataError(path, `expected a finite number, got ${JSON.stringify(v)}`);
  return v;
}
function count(v: unknown, path: string): number {
  const n = num(v, path);
  if (!Number.isInteger(n) || n < 0) throw new DataError(path, `expected a whole number >= 0, got ${n}`);
  return n;
}
function frac(v: unknown, path: string): number {
  const f = num(v, path);
  if (f < -FREQ_TOL || f > 1 + FREQ_TOL) throw new DataError(path, `expected a value between 0 and 1, got ${f}`);
  return f;
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new DataError(path, 'expected a string');
  return v;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new DataError(path, `expected one of ${allowed.join(', ')}, got ${JSON.stringify(v)}`);
  }
  return v as T;
}
function pt(v: unknown, path: string): Pt {
  const o = obj(v, path);
  return { x: num(o.x, `${path}.x`), y: num(o.y, `${path}.y`) };
}
function sameSet(got: readonly string[], want: readonly string[], path: string): void {
  const g = [...got].sort();
  const w = [...want].sort();
  if (g.length !== w.length || g.some((x, i) => x !== w[i])) {
    throw new DataError(path, `expected exactly [${want.join(', ')}], got [${got.join(', ')}]`);
  }
}
function sumsToOne(values: number[], path: string): void {
  const s = values.reduce((a, b) => a + b, 0);
  if (Math.abs(s - 1) > SUM_TOL) throw new DataError(path, `shares sum to ${s}, expected 1`);
}

function validatePeriods(v: unknown): PeriodInfo[] {
  const list = arr(v, 'periods').map((p, i): PeriodInfo => {
    const path = `periods[${i}]`;
    const o = obj(p, path);
    const id = oneOf(o.id, PERIOD_IDS, `${path}.id`);
    const order = num(o.order, `${path}.order`);
    if (order !== PERIOD_IDS.indexOf(id)) throw new DataError(`${path}.order`, `${id} must have order ${PERIOD_IDS.indexOf(id)}, got ${order}`);
    const frame = oneOf(o.frame, FRAME_IDS, `${path}.frame`);
    if (frame !== PERIOD_FRAME[id]) throw new DataError(`${path}.frame`, `${id} must use frame ${PERIOD_FRAME[id]}, got ${frame}`);
    return { id, order, frame, n_pca: count(o.n_pca, `${path}.n_pca`), n_admix: count(o.n_admix, `${path}.n_admix`), centre: pt(o.centre, `${path}.centre`) };
  });
  sameSet(list.map((p) => p.id), PERIOD_IDS, 'periods');
  return list;
}

function validatePoints(v: unknown, periods: PeriodInfo[]): PeriodPoints[] {
  const list = arr(v, 'points').map((pp, i): PeriodPoints => {
    const path = `points[${i}]`;
    const o = obj(pp, path);
    const period = oneOf(o.period, PERIOD_IDS, `${path}.period`);
    const points = arr(o.points, `${path}.points`).map((q, j): PersonPt => {
      const qp = `${path}.points[${j}]`;
      const qo = obj(q, qp);
      const out: PersonPt = pt(qo, qp);
      if (qo.east !== undefined) {
        if (period !== 'AngloSaxon') throw new DataError(`${qp}.east`, 'east is only allowed on AngloSaxon points');
        if (typeof qo.east !== 'boolean') throw new DataError(`${qp}.east`, 'expected true or false');
        out.east = qo.east;
      }
      return out;
    });
    const info = periods.find((p) => p.id === period)!;
    if (points.length !== info.n_pca) throw new DataError(`${path}.points`, `${period} has ${points.length} points but n_pca is ${info.n_pca}`);
    if (points.length === 0) throw new DataError(`${path}.points`, `${period} has no points`);
    return { period, points };
  });
  sameSet(list.map((p) => p.period), PERIOD_IDS, 'points');
  return list;
}

function validateMapGroups(v: unknown): MapGroup[] {
  const list = arr(v, 'map_groups').map((g, i): MapGroup => {
    const path = `map_groups[${i}]`;
    const o = obj(g, path);
    const id = oneOf(o.id, MAP_GROUP_IDS, `${path}.id`);
    const n = count(o.n, `${path}.n`);
    const points = arr(o.points, `${path}.points`).map((q, j) => pt(q, `${path}.points[${j}]`));
    if (points.length !== n) throw new DataError(`${path}.points`, `${id} has ${points.length} points but n is ${n}`);
    return { id, n, centre: pt(o.centre, `${path}.centre`), points };
  });
  sameSet(list.map((g) => g.id), MAP_GROUP_IDS, 'map_groups');
  return list;
}

function validateFrames(v: unknown): Record<FrameId, Frame> {
  const o = obj(v, 'frames');
  sameSet(Object.keys(o), FRAME_IDS, 'frames');
  const out = {} as Record<FrameId, Frame>;
  for (const id of FRAME_IDS) {
    const path = `frames.${id}`;
    const f = obj(o[id], path);
    const fr: Frame = { xmin: num(f.xmin, `${path}.xmin`), xmax: num(f.xmax, `${path}.xmax`), ymin: num(f.ymin, `${path}.ymin`), ymax: num(f.ymax, `${path}.ymax`) };
    if (!(fr.xmin < fr.xmax) || !(fr.ymin < fr.ymax)) throw new DataError(path, 'min must be smaller than max');
    out[id] = fr;
  }
  return out;
}

function shares(v: unknown, path: string): AdmixShares {
  const o = obj(v, path);
  const s: AdmixShares = { STEPPE: frac(o.STEPPE, `${path}.STEPPE`), FARMER: frac(o.FARMER, `${path}.FARMER`), WHG: frac(o.WHG, `${path}.WHG`) };
  sumsToOne([s.STEPPE, s.FARMER, s.WHG], path);
  return s;
}

function validateAdmixture(v: unknown, periods: PeriodInfo[]): WorkshopData['admixture'] {
  const o = obj(v, 'admixture');
  const bars = arr(o.bars, 'admixture.bars').map((b, i): AdmixBar => {
    const path = `admixture.bars[${i}]`;
    const bo = obj(b, path);
    const period = oneOf(bo.period, PERIOD_IDS, `${path}.period`);
    const n = count(bo.n, `${path}.n`);
    const info = periods.find((p) => p.id === period)!;
    if (n !== info.n_admix) throw new DataError(`${path}.n`, `${period} bar has n ${n} but n_admix is ${info.n_admix}`);
    return { period, n, ...shares(bo, path) };
  });
  sameSet(bars.map((b) => b.period), PERIOD_IDS, 'admixture.bars');
  bars.forEach((b, i) => {
    if (b.period !== PERIOD_IDS[i]) throw new DataError(`admixture.bars[${i}]`, `bars must be in time order (expected ${PERIOD_IDS[i]}, got ${b.period})`);
  });
  const peopleObj = obj(o.people, 'admixture.people');
  const people: Partial<Record<PeriodId, AdmixShares[]>> = {};
  for (const key of Object.keys(peopleObj)) {
    const period = oneOf(key, PERIOD_IDS, `admixture.people.${key}`);
    const list = arr(peopleObj[key], `admixture.people.${key}`).map((s, j) => shares(s, `admixture.people.${key}[${j}]`));
    const bar = bars.find((b) => b.period === period)!;
    if (list.length !== bar.n) throw new DataError(`admixture.people.${key}`, `${list.length} people but the bar has n ${bar.n}`);
    people[period] = list;
  }
  const pct = count(o.beaker_steppe_pct, 'admixture.beaker_steppe_pct');
  const beaker = bars.find((b) => b.period === 'BellBeaker')!;
  if (pct > 100 || Math.abs(pct - beaker.STEPPE * 100) > 0.5 + 1e-9) {
    throw new DataError('admixture.beaker_steppe_pct', `${pct} is not the BellBeaker bar's steppe share (${beaker.STEPPE}) rounded to a whole percent`);
  }
  return { bars, people, beaker_steppe_pct: pct };
}

/** Spec v2.1 §5.3: every period has consumer shares, Today included, so ancestry_test works for any period. */
function validateConsumer(v: unknown): Partial<Record<PeriodId, ConsumerShare[]>> {
  const o = obj(v, 'consumer');
  sameSet(Object.keys(o), PERIOD_IDS, 'consumer');
  const out: Partial<Record<PeriodId, ConsumerShare[]>> = {};
  for (const period of PERIOD_IDS) {
    const path = `consumer.${period}`;
    const list = arr(o[period], path).map((c, i): ConsumerShare => {
      const co = obj(c, `${path}[${i}]`);
      return { label: oneOf(co.label, CONSUMER_LABELS, `${path}[${i}].label`), share: frac(co.share, `${path}[${i}].share`) };
    });
    if (list.length === 0) throw new DataError(path, 'no labels');
    if (new Set(list.map((c) => c.label)).size !== list.length) throw new DataError(path, 'a label appears twice');
    sumsToOne(list.map((c) => c.share), path);
    for (let i = 1; i < list.length; i++) {
      if (list[i]!.share > list[i - 1]!.share) throw new DataError(path, 'shares must be sorted largest first');
    }
    out[period] = list;
  }
  return out;
}

function traitPoint(v: unknown, path: string): TraitPoint {
  const o = obj(v, path);
  const p: TraitPoint = { t: num(o.t, `${path}.t`), f: frac(o.f, `${path}.f`), lo: frac(o.lo, `${path}.lo`), hi: frac(o.hi, `${path}.hi`) };
  if (p.lo > p.f + FREQ_TOL || p.f > p.hi + FREQ_TOL) throw new DataError(path, `needs lo <= f <= hi, got ${p.lo} / ${p.f} / ${p.hi}`);
  if (o.n !== undefined) p.n = count(o.n, `${path}.n`);
  if (o.period !== undefined) p.period = oneOf(o.period, PERIOD_IDS, `${path}.period`);
  return p;
}

function validateTraits(v: unknown): Trait[] {
  const list = arr(v, 'traits');
  if (list.length !== GENE_IDS.length) throw new DataError('traits', `expected exactly ${GENE_IDS.length} traits, got ${list.length}`);
  return list.map((t, i): Trait => {
    const path = `traits[${i}]`;
    const o = obj(t, path);
    const gene = oneOf(o.gene, GENE_IDS, `${path}.gene`);
    if (gene !== GENE_IDS[i]) throw new DataError(`${path}.gene`, `traits must be in the order ${GENE_IDS.join(', ')} (expected ${GENE_IDS[i]}, got ${gene})`);
    const spec = TRAIT_SPECS[gene];
    const rsid = str(o.rsid, `${path}.rsid`);
    const variant_id = str(o.variant_id, `${path}.variant_id`);
    const allele = str(o.allele, `${path}.allele`);
    if (rsid !== spec.rsid || variant_id !== spec.variant_id || allele !== spec.allele) {
      throw new DataError(path, `${gene} must plot ${spec.rsid} (${spec.variant_id}) allele ${spec.allele}, got ${rsid} (${variant_id}) allele ${allele}`);
    }
    const source = oneOf(o.source, ['ages', 'local', 'text'] as const, `${path}.source`);
    if (source === 'text' && gene !== 'HLA-DQ2') throw new DataError(`${path}.source`, `only HLA-DQ2 may be a text card; ${gene} must be ages or local`);
    const points = arr(o.points, `${path}.points`).map((p, j) => traitPoint(p, `${path}.points[${j}]`));
    if (source === 'text' && points.length > 0) throw new DataError(`${path}.points`, 'a text card has no points');
    if (source !== 'text' && points.length < 2) throw new DataError(`${path}.points`, `${gene} (${source}) needs at least 2 points to draw a line`);
    let present_day: number | null;
    if (o.present_day === null) {
      if (source !== 'text') throw new DataError(`${path}.present_day`, `${gene} (${source}) needs a present-day frequency`);
      present_day = null;
    } else {
      present_day = frac(o.present_day, `${path}.present_day`);
    }
    return { gene, rsid, variant_id, allele, source, points, present_day };
  });
}

function validateTicks(v: unknown): AxisTick[] {
  const list = arr(v, 'trait_ticks').map((k, i): AxisTick => {
    const path = `trait_ticks[${i}]`;
    const o = obj(k, path);
    return { t: num(o.t, `${path}.t`), key: oneOf(o.key, TICK_KEYS, `${path}.key`) };
  });
  sameSet(list.map((k) => k.key), TICK_KEYS, 'trait_ticks');
  list.forEach((k, i) => {
    if (k.key !== TICK_KEYS[i]) throw new DataError(`trait_ticks[${i}]`, `ticks must be in the order ${TICK_KEYS.join(', ')}`);
    if (i > 0 && !(k.t < list[i - 1]!.t)) throw new DataError(`trait_ticks[${i}].t`, 'tick times must decrease from Bell Beaker to Today');
  });
  return list;
}

function validateLogs(v: unknown): LogNumbers {
  const o = obj(v, 'logs');
  const out: LogNumbers = {
    snps_total: count(o.snps_total, 'logs.snps_total'),
    snps_used: count(o.snps_used, 'logs.snps_used'),
    pca_samples_used: count(o.pca_samples_used, 'logs.pca_samples_used'),
    admix_snps: count(o.admix_snps, 'logs.admix_snps'),
    admix_individuals: count(o.admix_individuals, 'logs.admix_individuals'),
  };
  for (const [k, n] of Object.entries(out)) if (n === 0) throw new DataError(`logs.${k}`, 'must be greater than 0');
  if (out.snps_used > out.snps_total) throw new DataError('logs.snps_used', 'cannot exceed snps_total');
  return out;
}

/** Checks every field the app relies on and returns a typed copy. Throws DataError naming the first bad field. */
export function validateData(raw: unknown): WorkshopData {
  const o = obj(raw, '(root)');
  if (o.version !== 1) throw new DataError('version', `expected 1, got ${JSON.stringify(o.version)}`);
  const periods = validatePeriods(o.periods);
  const ns = obj(o.north_sea, 'north_sea');
  return {
    version: 1,
    periods,
    points: validatePoints(o.points, periods),
    map_groups: validateMapGroups(o.map_groups),
    north_sea: { n: count(ns.n, 'north_sea.n'), centre: pt(ns.centre, 'north_sea.centre') },
    frames: validateFrames(o.frames),
    admixture: validateAdmixture(o.admixture, periods),
    consumer: validateConsumer(o.consumer),
    traits: validateTraits(o.traits),
    trait_ticks: validateTicks(o.trait_ticks),
    logs: validateLogs(o.logs),
  };
}

/** The workshop data bundled into the page. Under Vitest '@workshop-data' resolves to tests/fixtures/data.fixture.json. */
export const DATA: WorkshopData = validateData(raw);
