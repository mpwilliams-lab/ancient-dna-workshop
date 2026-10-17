import { describe, expect, it } from 'vitest';
import { DATA, DataError, TRAIT_SPECS, validateData } from '../src/data';
import { GENE_IDS, PERIOD_IDS, REGION_IDS, TRAIT_MAP_LABEL_KEYS, TRAIT_MAP_ORDER } from '../src/types';
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
    expect(DATA.logs).toEqual({
      snps_total: 579720, snps_used: 496901, pca_samples_used: 1163, admix_snps: 78188, admix_individuals: 1194, pca_people_unique: 950,
    });
  });

  it('fixture shape that later tasks rely on', () => {
    expect(FIXTURE.points.map((p) => p.points.length)).toEqual([3, 4, 3, 4, 3, 4, 3, 4]);
    expect(FIXTURE.points.find((p) => p.period === 'AngloSaxon')!.points.filter((q) => q.east)).toHaveLength(2);
    expect(FIXTURE.traits.map((t) => t.source)).toEqual(['ages', 'ages', 'local', 'local', 'text']);
    expect(FIXTURE.traits[3]!.points[0]!.period).toBe('FirstFarmers');
    expect(Object.keys(FIXTURE.admixture.people)).toEqual(['BellBeaker']);
    expect(Object.keys(FIXTURE.consumer)).toEqual([...PERIOD_IDS]);
    expect(FIXTURE.consumer.Today).toEqual([{ label: 'British', share: 0.75 }, { label: 'Scandinavian', share: 0.25 }]);
    // v3 (Task 7)
    expect(FIXTURE.periods.find((p) => p.id === 'Today')!.frame).toBe('britain');
    for (const pp of FIXTURE.points) {
      for (const q of pp.points) expect(q.region !== undefined, pp.period).toBe(pp.period === 'IronAge');
    }
    expect(FIXTURE.points.find((p) => p.period === 'IronAge')!.points.map((q) => q.region)).toEqual(['ENG_S', 'ENG_M', 'SCO', 'WAL']);
    for (const gene of GENE_IDS) expect(FIXTURE.trait_maps[gene].map((r) => r.label_key), gene).toEqual([...TRAIT_MAP_ORDER[gene]]);
    expect(FIXTURE.spread_check).toEqual({ ia_hicov_median_d: 0.00304, bb_hicov_median_d: 0.00301 });
    expect(FIXTURE.europe_pops).toBeUndefined();
    expect(FIXTURE.named).toBeUndefined();
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
  ['pca_people_unique missing', (d) => { delete d.logs.pca_people_unique; }, /logs\.pca_people_unique: expected a finite number/],
  ['pca_people_unique above pca_samples_used', (d) => { d.logs.pca_people_unique = 2000; }, /pca_people_unique cannot exceed pca_samples_used/],
  ['region on a non-IronAge point', (d) => { d.points[2].points[0].region = 'ENG_S'; }, /region is only allowed on IronAge points/],
  ['an IronAge point without a region', (d) => { delete d.points[3].points[0].region; }, /points\[3\]\.points\[0\]\.region: every IronAge point needs a region/],
  ['an unknown region', (d) => { d.points[3].points[1].region = 'NIR'; }, /points\[3\]\.points\[1\]\.region: expected one of ENG_S/],
  ['trait_maps missing a gene', (d) => { delete d.trait_maps.TYK2; }, /trait_maps: expected exactly/],
  ['a trait-map key the gene does not use', (d) => { d.trait_maps.TYK2[1].label_key = '1kg:PJL'; }, /trait_maps\.TYK2\[1\]\.label_key: expected one of/],
  ['a trait-map key twice', (d) => { d.trait_maps.LCT[1].label_key = 'country:Ireland'; }, /trait_maps\.LCT\[1\]\.label_key: country:Ireland appears twice/],
  ['a trait-map value above 1', (d) => { d.trait_maps.LCT[0].value = 1.2; }, /trait_maps\.LCT\[0\]\.value: expected a frequency between 0 and 1/],
  ['a negative trait-map value', (d) => { d.trait_maps.HERC2[0].value = -0.01; }, /trait_maps\.HERC2\[0\]\.value: expected a frequency between 0 and 1/],
  ['a dataset that does not match the key', (d) => { d.trait_maps.LCT[0].dataset = '1000g'; }, /trait_maps\.LCT\[0\]\.dataset: country:Ireland must come from liebert2017/],
  ['a gnomAD row with coordinates', (d) => { d.trait_maps.SLC45A2[4].lat = 30; }, /trait_maps\.SLC45A2\[4\]: gnomAD rows have no coordinates/],
  ['a country row without lat', (d) => { delete d.trait_maps.LCT[1].lat; }, /trait_maps\.LCT\[1\]\.lat: expected a finite number/],
  ['a latitude out of range', (d) => { d.trait_maps.LCT[2].lat = 95; }, /trait_maps\.LCT\[2\]\.lat: expected a latitude/],
  ['an allele count on a country row', (d) => { d.trait_maps.LCT[0].allele_count = 10; }, /trait_maps\.LCT\[0\]\.allele_count: country rows have no allele count/],
  ['a zero row that is not snapshot-proven', (d) => { d.trait_maps.SLC45A2[9].allele_count = 3; }, /trait_maps\.SLC45A2\[9\]\.allele_count: a zero frequency needs allele_count 0/],
  ['a gene with no rows', (d) => { d.trait_maps['HLA-DQ2'] = []; }, /trait_maps\.HLA-DQ2: no rows/],
  ['spread_check missing', (d) => { delete d.spread_check; }, /spread_check: expected an object/],
  ['spread_check not positive', (d) => { d.spread_check.bb_hicov_median_d = 0; }, /spread_check\.bb_hicov_median_d: must be greater than 0/],
  ['europe_fit without europe_pops', (d) => { d.europe_fit = { n_pops: 0, n_people: 0, r_lat: 0, r_lon: 0 }; }, /europe_pops and europe_fit come together/],
  ['a named point with another key', (d) => { d.named = [{ key: 'I1234', period: 'Roman', x: 0, y: 0 }]; }, /named\[0\]\.key: expected one of york_traveller/],
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

describe('v3 optional fields (CONTRACT §2.1)', () => {
  const europe = () => ({
    europe_pops: [
      { id: 'Italian_North', label: 'North Italian', n: 37, lat: 45.1, lon: 10.2, x: 0.0049, y: -0.0167, map_x: -3.9, map_y: 45.6, isolate: false, map_label: true },
      { id: 'French', label: 'French', n: 60, lat: 46.6, lon: 2.4, x: 0.002, y: 0.004, map_x: -8.6, map_y: 46.9, isolate: false, map_label: false },
      { id: 'Sardinian', label: 'Sardinian', n: 27, lat: 40.1, lon: 9.0, x: -0.01, y: -0.03, map_x: -4.6, map_y: 39.0, isolate: true, map_label: false },
    ],
    europe_fit: { n_pops: 2, n_people: 97, r_lat: 0.91, r_lon: 0.74 },
  });

  it('accepts europe_pops with a matching europe_fit, and a york_traveller named point', () => {
    const d = { ...rawFixture(), ...europe(), named: [{ key: 'york_traveller', period: 'Roman', x: 0.0412, y: -0.0301 }] };
    const v = validateData(d);
    expect(v.europe_pops).toHaveLength(3);
    expect(v.europe_fit).toEqual({ n_pops: 2, n_people: 97, r_lat: 0.91, r_lon: 0.74 });
    expect(v.named).toEqual([{ key: 'york_traveller', period: 'Roman', x: 0.0412, y: -0.0301 }]);
  });

  it.each<[string, (d: any) => void, RegExp]>([
    ['n_pops not the non-isolate count', (d) => { d.europe_fit.n_pops = 3; }, /europe_fit\.n_pops: expected 2 \(non-isolate populations\), got 3/],
    ['n_people not their sum', (d) => { d.europe_fit.n_people = 124; }, /europe_fit\.n_people: expected 97 \(people in the non-isolate populations\), got 124/],
    ['a labelled isolate', (d) => { d.europe_pops[2].map_label = true; }, /europe_pops\[2\]\.map_label: an isolate is never labelled/],
    ['a correlation above 1', (d) => { d.europe_fit.r_lat = 1.2; }, /europe_fit\.r_lat: expected a correlation between -1 and 1/],
    ['an empty label', (d) => { d.europe_pops[0].label = ''; }, /europe_pops\[0\]\.label: expected a non-empty string/],
    ['europe_pops without europe_fit', (d) => { delete d.europe_fit; }, /europe_pops and europe_fit come together/],
  ])('rejects %s', (_name, breakIt, message) => {
    const d = { ...rawFixture(), ...europe() };
    breakIt(d);
    expect(() => validateData(d)).toThrow(message);
  });

  it('REGION_IDS and TRAIT_MAP_LABEL_KEYS are the contract lists', () => {
    expect(REGION_IDS).toEqual(['ENG_S', 'ENG_M', 'ENG_N', 'SCO', 'WAL']);
    expect(TRAIT_MAP_LABEL_KEYS).toHaveLength(33);
    for (const gene of GENE_IDS) for (const k of TRAIT_MAP_ORDER[gene]) expect(TRAIT_MAP_LABEL_KEYS).toContain(k);
    expect(TRAIT_MAP_ORDER.TYK2).not.toContain('1kg:PJL');
    expect(TRAIT_MAP_ORDER.TYK2).not.toContain('1kg:FIN');
    expect(TRAIT_MAP_ORDER['HLA-DQ2']).toEqual(['1kg:IBS', 'gnomad:nfe', '1kg:TSI', '1kg:GBR', '1kg:FIN']);
  });
});
