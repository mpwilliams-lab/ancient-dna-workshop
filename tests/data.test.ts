import { describe, expect, it } from 'vitest';
import { DATA, DataError, TRAIT_SPECS, validateData } from '../src/data';
import { GENE_IDS, PERIOD_IDS } from '../src/types';
import { FIXTURE, rawFixture } from './fixtures/fixture';

describe('validateData on the fixture', () => {
  it('accepts the fixture and keeps every field', () => {
    const d = validateData(rawFixture());
    expect(d).toEqual(rawFixture());
    expect(d.periods.map((p) => p.id)).toEqual([...PERIOD_IDS]);
    expect(d.traits.map((t) => t.gene)).toEqual([...GENE_IDS]);
    expect(d.admixture.beaker_steppe_pct).toBe(64);
  });

  it('DATA is the fixture under Vitest (the @workshop-data alias)', () => {
    expect(DATA).toEqual(FIXTURE);
    expect(DATA.logs).toEqual({ snps_total: 579720, snps_used: 496901, pca_samples_used: 1163, admix_snps: 78188, admix_individuals: 1194 });
  });

  it('fixture shape that later tasks rely on', () => {
    expect(FIXTURE.points.map((p) => p.points.length)).toEqual([3, 4, 3, 4, 3, 4, 3, 4]);
    expect(FIXTURE.points.find((p) => p.period === 'AngloSaxon')!.points.filter((q) => q.east)).toHaveLength(2);
    expect(FIXTURE.traits.map((t) => t.source)).toEqual(['ages', 'ages', 'local', 'local', 'text']);
    expect(FIXTURE.traits[3]!.points[0]!.period).toBe('FirstFarmers');
    expect(Object.keys(FIXTURE.admixture.people)).toEqual(['BellBeaker']);
    expect(Object.keys(FIXTURE.consumer)).toEqual([...PERIOD_IDS]);
    expect(FIXTURE.consumer.Today).toEqual([{ label: 'British', share: 0.75 }, { label: 'Scandinavian', share: 0.25 }]);
  });
});

type Breaker = [string, (d: any) => void, RegExp];

const BREAKERS: Breaker[] = [
  ['not an object', () => {}, /./],
  ['wrong version', (d) => { d.version = 2; }, /version: expected 1/],
  ['a period missing', (d) => { d.periods.pop(); }, /periods: expected exactly/],
  ['an unknown period id', (d) => { d.periods[0].id = 'Neolithic'; }, /periods\[0\]\.id: expected one of/],
  ['a duplicated period', (d) => { d.periods[7] = { ...d.periods[6] }; }, /periods\[7\]\.order|periods: expected exactly/],
  ['wrong order number', (d) => { d.periods[2].order = 5; }, /BronzeAge must have order 2/],
  ['wrong frame', (d) => { d.periods[3].frame = 'europe'; }, /IronAge must use frame britain/],
  ['wrong frame, Europe-frame period', (d) => { d.periods[0].frame = 'britain'; }, /FirstFarmers must use frame europe/],
  ['unknown frame on Today', (d) => { d.periods[7].frame = 'world'; }, /periods\[7\]\.frame: expected one of europe, britain/],
  ['NaN centre (JS NaN)', (d) => { d.periods[0].centre.x = NaN; }, /periods\[0\]\.centre\.x: expected a finite number/],
  ['NaN coordinate written as a string by R', (d) => { d.points[1].points[0].y = 'NaN'; }, /points\[1\]\.points\[0\]\.y: expected a finite number, got "NaN"/],
  ['null coordinate', (d) => { d.map_groups[2].points[1].x = null; }, /map_groups\[2\]\.points\[1\]\.x: expected a finite number, got null/],
  ['Infinity coordinate', (d) => { d.north_sea.centre.y = Infinity; }, /north_sea\.centre\.y: expected a finite number/],
  ['points count differs from n_pca', (d) => { d.points[4].points.pop(); }, /Roman has 2 points but n_pca is 3/],
  ['east flag outside AngloSaxon', (d) => { d.points[3].points[0].east = true; }, /east is only allowed on AngloSaxon points/],
  ['a points period missing', (d) => { d.points.splice(2, 1); }, /points: expected exactly/],
  ['a map group missing', (d) => { d.map_groups.pop(); }, /map_groups: expected exactly/],
  ['unknown map group', (d) => { d.map_groups[0].id = 'Sardinia'; }, /map_groups\[0\]\.id: expected one of/],
  ['inverted frame', (d) => { d.frames.britain.xmin = 1; }, /frames\.britain: min must be smaller than max/],
  ['extra frame', (d) => { d.frames.world = { xmin: 0, xmax: 1, ymin: 0, ymax: 1 }; }, /frames: expected exactly/],
  ['admixture shares not summing to 1', (d) => { d.admixture.bars[1].STEPPE = 0.9; }, /admixture\.bars\[1\]: shares sum to/],
  ['bars out of time order', (d) => { const b = d.admixture.bars; [b[0], b[1]] = [b[1], b[0]]; }, /bars must be in time order/],
  ['bar n differs from n_admix', (d) => { d.admixture.bars[4].n = 9; }, /Roman bar has n 9 but n_admix is 2/],
  ['per-person list length differs from bar n', (d) => { d.admixture.people.BellBeaker.pop(); }, /3 people but the bar has n 4/],
  ['beaker_steppe_pct typed by hand', (d) => { d.admixture.beaker_steppe_pct = 90; }, /90 is not the BellBeaker bar's steppe share/],
  ['beaker_steppe_pct not whole', (d) => { d.admixture.beaker_steppe_pct = 63.8; }, /beaker_steppe_pct: expected a whole number/],
  ['consumer missing Today (spec v2.1)', (d) => { delete d.consumer.Today; }, /consumer: expected exactly \[FirstFarmers, BellBeaker, BronzeAge, IronAge, Roman, AngloSaxon, Viking, Today\]/],
  ['consumer with an extra key', (d) => { d.consumer.Medieval = [{ label: 'British', share: 1 }]; }, /consumer: expected exactly/],
  ['consumer label unknown', (d) => { d.consumer.IronAge[1].label = 'Norwegian'; }, /consumer\.IronAge\[1\]\.label: expected one of/],
  ['consumer shares unsorted', (d) => { d.consumer.IronAge.reverse(); }, /shares must be sorted largest first/],
  ['consumer shares not summing to 1', (d) => { d.consumer.Roman[0].share = 0.5; }, /consumer\.Roman: shares sum to 0\.5/],
  ['four traits', (d) => { d.traits.pop(); }, /expected exactly 5 traits, got 4/],
  ['traits out of order', (d) => { const t = d.traits; [t[0], t[1]] = [t[1], t[0]]; }, /traits must be in the order/],
  ['an unknown gene', (d) => { d.traits[4].gene = 'NOD2'; }, /traits\[4\]\.gene: expected one of/],
  ['text card on a non-HLA trait', (d) => { d.traits[0].source = 'text'; d.traits[0].points = []; }, /only HLA-DQ2 may be a text card; LCT must be ages or local/],
  ['wrong variant for a gene', (d) => { d.traits[2].rsid = 'rs1426654'; }, /HERC2 must plot rs12913832/],
  ['wrong allele for a gene', (d) => { d.traits[0].allele = 'G'; }, /LCT must plot rs4988235 \(2_136608646_G_A\) allele A/],
  ['text card with points', (d) => { d.traits[4].points = [{ t: 0, f: 0.2, lo: 0.1, hi: 0.3 }]; }, /a text card has no points/],
  ['plotted trait with one point', (d) => { d.traits[1].points = [d.traits[1].points[0]]; }, /needs at least 2 points/],
  ['frequency above 1', (d) => { d.traits[0].points[3].hi = 1.4; }, /traits\[0\]\.points\[3\]\.hi: expected a value between 0 and 1/],
  ['f outside its interval', (d) => { d.traits[2].points[0].f = 0.99; }, /needs lo <= f <= hi/],
  ['NaN frequency', (d) => { d.traits[3].points[2].f = 'NaN'; }, /traits\[3\]\.points\[2\]\.f: expected a finite number/],
  ['plotted trait without present_day', (d) => { d.traits[3].present_day = null; }, /TYK2 \(local\) needs a present-day frequency/],
  ['a tick missing', (d) => { d.trait_ticks.pop(); }, /trait_ticks: expected exactly/],
  ['ticks not getting more recent', (d) => { d.trait_ticks[2].t = 9000; }, /tick times must decrease/],
  ['zero SNPs in the log', (d) => { d.logs.snps_used = 0; }, /logs\.snps_used: must be greater than 0/],
  ['more SNPs used than exist', (d) => { d.logs.snps_used = d.logs.snps_total + 1; }, /cannot exceed snps_total/],
];

describe('validateData rejects bad data', () => {
  it.each(BREAKERS)('%s', (_name, breakIt, message) => {
    const d = _name === 'not an object' ? 'CHROM\tPOS' : rawFixture();
    breakIt(d);
    expect(() => validateData(d)).toThrow(DataError);
    expect(() => validateData(d)).toThrow(message);
  });

  it('accepts Britain today in either frame (spec v3 §2.3: the Sun 18 run writes britain), and keeps the JSON value', () => {
    for (const frame of ['europe', 'britain'] as const) {
      const d = rawFixture();
      d.periods[7].frame = frame;
      expect(validateData(d).periods[7]).toMatchObject({ id: 'Today', frame });
    }
  });

  it('error messages start with the file name so the console says what broke', () => {
    expect(() => validateData(null)).toThrow('workshop_data.json invalid at (root): expected an object');
  });

  it('accepts a beaker_steppe_pct rounded either way at .5 (R rounds half to even)', () => {
    const d = rawFixture();
    d.admixture.bars[1] = { period: 'BellBeaker', n: 4, STEPPE: 0.645, FARMER: 0.276, WHG: 0.079 };
    d.admixture.beaker_steppe_pct = 64;
    expect(validateData(d).admixture.beaker_steppe_pct).toBe(64);
    d.admixture.beaker_steppe_pct = 65;
    expect(validateData(d).admixture.beaker_steppe_pct).toBe(65);
  });

  it('accepts an AGES-sourced HLA-DQ2 trait (the TSV arrived) and a local LCT fallback', () => {
    const d = rawFixture();
    d.traits[4] = { ...d.traits[4], source: 'ages', points: [{ t: 4000, f: 0.01, lo: 0, hi: 0.03 }, { t: 0, f: 0.2, lo: 0.17, hi: 0.23 }], present_day: 0.2 };
    d.traits[0] = { ...d.traits[0], source: 'local', points: d.traits[2].points, present_day: 0.7897 };
    const v = validateData(d);
    expect(v.traits[4]!.source).toBe('ages');
    expect(v.traits[0]!.source).toBe('local');
  });

  it('pins the five variants from spec §5.4', () => {
    expect(TRAIT_SPECS).toEqual({
      LCT: { rsid: 'rs4988235', variant_id: '2_136608646_G_A', allele: 'A' },
      SLC45A2: { rsid: 'rs16891982', variant_id: '5_33951693_C_G', allele: 'G' },
      HERC2: { rsid: 'rs12913832', variant_id: '15_28365618_A_G', allele: 'G' },
      TYK2: { rsid: 'rs34536443', variant_id: '19_10463118_G_C', allele: 'C' },
      'HLA-DQ2': { rsid: 'rs3891176', variant_id: '6_32634318_C_A', allele: 'A' },
    });
  });
});
