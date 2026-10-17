// @vitest-environment node
// Checks the REAL synced data (src/data/workshop_data.json), not the fixture.
// Skipped in a plain `npm test`; run with `npm run check-data` after `npm run sync-data`.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CARDS, cardVars, distributionRows, formatCopies, SAMPLE_CARD_VARS } from '../src/cards';
import { revealNote, traitCaption } from '../src/content';
import { validateData } from '../src/data';
import { zoomFactor } from '../src/plotState';
import { steppePct } from '../src/plots/admixture';
import { GENE_IDS, TRAIT_MAP_ORDER, type GeneId } from '../src/types';
import { ruleViolations } from './contentRules';

const REAL = fileURLToPath(new URL('../src/data/workshop_data.json', import.meta.url));

describe.runIf(process.env.REAL_DATA === '1')('real workshop_data.json', () => {
  it('exists (run npm run sync-data first)', () => {
    expect(existsSync(REAL)).toBe(true);
  });

  const raw = () => JSON.parse(readFileSync(REAL, 'utf8'));

  it('passes validateData', () => {
    expect(() => validateData(raw())).not.toThrow();
  });

  it('is under the 250 KB target', () => {
    expect(readFileSync(REAL).byteLength).toBeLessThan(250 * 1024);
  });

  it('no string anywhere in the JSON breaks a §6 rule', () => {
    const strings: string[] = [];
    JSON.stringify(raw(), (k, v) => {
      if (k) strings.push(k);
      if (typeof v === 'string') strings.push(v);
      return v;
    });
    expect(strings.filter((s) => ruleViolations(s).length > 0)).toEqual([]);
  });

  // Spec §6 rule 6 as amended in v2.1 (approved by the instructor): whole-percent match, rounded half-up as in Task 4.
  it('TYK2 caption whole-percent present-day number matches the plotted present-day value (same rule as tyk2_caption in Task 4)', () => {
    const d = validateData(raw());
    const t = d.traits.find((x) => x.gene === 'TYK2')!;
    const p = [...t.points].sort((a, b) => a.t - b.t)[0]!;
    const m = /About (\d+)% today/.exec(traitCaption(t));
    expect(m).not.toBeNull();
    expect(p.lo).toBeLessThanOrEqual(p.f);
    expect(p.f).toBeLessThanOrEqual(p.hi);
    expect(Math.round(Number((100 * p.f).toFixed(2)))).toBe(Number(m![1]));
  });

  // ---- v3 data run (Task 7; spec §8) ----
  const real = () => validateData(raw());

  it('pca_people_unique is 950 and no more than the PCA genotype rows', () => {
    const d = real();
    expect(d.logs.pca_people_unique).toBe(950);
    expect(d.logs.pca_people_unique).toBeLessThanOrEqual(d.logs.pca_samples_used);
  });

  it('exports Today in the British frame and keeps the v2.1 frames exactly (RF2)', () => {
    const d = real();
    expect(d.periods.find((p) => p.id === 'Today')!.frame).toBe('britain');
    expect(d.frames).toEqual({
      europe: { xmin: -0.02943, xmax: 0.0775, ymin: -0.07073, ymax: 0.02116 },
      britain: { xmin: -0.01254, xmax: 0.00382, ymin: -0.00054, ymax: 0.01797 },
    });
  });

  it('every Iron Age point has a region, no other point has one, and southern England sits south of Scotland', () => {
    const d = real();
    for (const pp of d.points) for (const q of pp.points) expect(q.region !== undefined, pp.period).toBe(pp.period === 'IronAge');
    const iron = d.points.find((p) => p.period === 'IronAge')!.points;
    const meanY = (r: string) => {
      const ys = iron.filter((q) => q.region === r).map((q) => q.y);
      expect(ys.length, r).toBeGreaterThan(0);
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    };
    expect(meanY('ENG_S')).toBeLessThan(meanY('SCO'));
  });

  it('the corrected eastern-England flag marks 162 Anglo-Saxon burials (the number testthat pins)', () => {
    const as = real().points.find((p) => p.period === 'AngloSaxon')!.points;
    expect(as.filter((q) => q.east === true)).toHaveLength(162);
  });

  it('trait_maps carries exactly the CONTRACT §2.3 rows per gene, in order', () => {
    const d = real();
    for (const gene of GENE_IDS) expect(d.trait_maps[gene].map((r) => r.label_key), gene).toEqual([...TRAIT_MAP_ORDER[gene]]);
  });

  it('TYK2 Britain is 5 of 182 copies, 0.02747 (O1), which the one-decimal rule shows as 2.7', () => {
    const row = real().trait_maps.TYK2.find((r) => r.label_key === '1kg:GBR')!;
    expect(row.allele_count).toBe(5);
    expect(row.value).toBe(0.02747);
    expect(Math.round(row.value * 1000) / 10).toBe(2.7);
  });

  it('the well-preserved Iron Age and Bell Beaker clouds have the same spread (backs E3 bullet 3)', () => {
    const s = real().spread_check;
    expect(Math.abs(s.ia_hicov_median_d - s.bb_hicov_median_d)).toBeLessThan(0.0005);
  });

  it('keeps the CONTRACT §2.4 root key order', () => {
    const keys = Object.keys(raw());
    const base = ['version', 'periods', 'points', 'map_groups', 'north_sea', 'frames', 'admixture', 'consumer', 'traits',
      'trait_ticks', 'logs', 'trait_maps', 'spread_check'];
    expect(keys.slice(0, base.length)).toEqual(base);
    expect(keys.slice(base.length)).toEqual(keys.includes('europe_pops') ? ['europe_pops', 'europe_fit'] : []);
  });

  // ---- reveal callout and note (Task 9; spec §3.3, review S24) ----
  it('the Iron Age bar is the closest of all seven ancient periods to Britain today (three-share distance)', () => {
    const bars = validateData(raw()).admixture.bars;
    const today = bars.find((b) => b.period === 'Today')!;
    const dist = (b: (typeof bars)[number]) =>
      Math.hypot(b.STEPPE - today.STEPPE, b.FARMER - today.FARMER, b.WHG - today.WHG);
    const ranked = bars.filter((b) => b.period !== 'Today').map((b) => ({ id: b.period, d: dist(b) })).sort((a, b) => a.d - b.d);
    expect(ranked).toHaveLength(7);
    expect(ranked[0]!.id).toBe('IronAge');
    expect(ranked[0]!.d).toBeCloseTo(0.020, 3);
    expect(ranked[1]!.id).toBe('Viking');
    expect(ranked[1]!.d).toBeCloseTo(0.0275, 3);
  });

  it('the reveal note reads 56% for Britain today and 57% for the Iron Age on this build', () => {
    const bars = validateData(raw()).admixture.bars;
    const pct = (id: string) => steppePct(bars.find((b) => b.period === id)!);
    expect([pct('Today'), pct('IronAge')]).toEqual([56, 57]);
    expect(revealNote(pct('Today'), pct('IronAge'))).toBe(
      'Britain today: 56% steppe. Iron Age: 57% steppe. Of all the periods, the Iron Age bar is the closest match.');
  });
});

// ---------- v3 (Task 5): the zoom factor the caption strip and card E3 print ----------
describe.runIf(process.env.REAL_DATA === '1')('real workshop_data.json: v3 plot state', () => {
  it('zoomFactor is 5 (frames unchanged by the Today frame change, RF2)', () => {
    const d = validateData(JSON.parse(readFileSync(REAL, 'utf8')));
    expect(zoomFactor(d)).toBe(5);
  });
});

// ---------- v3 (Task 10): the cards read their numbers from this file ----------
/** Spec §3.4 value lists, label and display, in screen order. */
const SPEC_ROWS: Record<GeneId, [string, string][]> = {
  LCT: [['Ireland', '96'], ['Norway', '84'], ['United Kingdom', '75'], ['Sweden', '73'], ['Netherlands', '68'], ['Finland', '58'],
    ['France', '58'], ['Germany', '52'], ['Estonia', '51'], ['Hungary', '46'], ['Portugal', '39'], ['Spain', '38'], ['Poland', '37'],
    ['Russia', '32'], ['Romania', '29'], ['North Macedonia', '24'], ['Belarus', '23'], ['Ukraine', '23'], ['Italy', '18'], ['Greece', '11']],
  SLC45A2: [['Britain', '98'], ['Tuscany', '97'], ['Finland', '96'], ['Spain', '82'], ['Middle East', '47'], ['Pakistan', '6'],
    ['Bangladesh', '4'], ['China', '1'], ['Kenya', '1'], ['Japan', '0'], ['Nigeria', '0']],
  HERC2: [['Finland', '91'], ['Britain', '82'], ['Tuscany', '42'], ['Spain', '32'], ['Middle East', '21'], ['Pakistan', '10'],
    ['Bangladesh', '10'], ['China', '0'], ['Japan', '0'], ['Nigeria', '0'], ['Kenya', '0']],
  // O1 (settled): the build writes the 1000 Genomes Britain value as 5 of 182 copies = 0.02747, so it shows 2.7, as in spec K2.
  TYK2: [['Europe (large sample)', '4.4'], ['Spain', '3.3'], ['Middle East', '3.1'], ['Finland', '2.9'], ['Tuscany', '2.8'],
    ['Britain', '2.7'], ['China', '0.0'], ['Japan', '0.0'], ['Nigeria', '0.0'], ['Kenya', '0.0']],
  'HLA-DQ2': [['Spain', '25'], ['Europe (large sample)', '22'], ['Tuscany', '21'], ['Britain', '16'], ['Finland', '9']],
};

describe.runIf(process.env.REAL_DATA === '1')('cards on the real data (Task 10)', () => {
  const data = () => validateData(JSON.parse(readFileSync(REAL, 'utf8')));

  it('E3 and F1 templates: about 5× zoom, 5× as many, 371 against 77, 17 Roman-group people', () => {
    const d = data();
    expect(cardVars(d)).toMatchObject({ zoom: '5', ratio: '5', n_IronAge: '371', n_BellBeaker: '77', n_Roman: '17' });
    expect(cardVars(d).zoom).toBe(String(zoomFactor(d)));   // RF2: the card's number is the plot's number
  });

  it('A1 source numbers come from the Europe fit (26 groups, 716 people, after the TSI override) and equal SAMPLE_CARD_VARS', () => {
    const d = data();
    expect(d.europe_fit).toMatchObject({ n_pops: 26, n_people: 716, r_lat: 0.8868, r_lon: 0.8298 });
    expect(cardVars(d)).toMatchObject({ n_pops: '26', n_people: '716' });
    expect(cardVars(d)).toEqual(SAMPLE_CARD_VARS);   // the numbers allRenderableStrings() scans are the real build's
  });

  it('A1 map labels (open check 14): the eight labelled groups, no "Tuscan" among them, every label passes the rules', () => {
    const labelled = data().europe_pops!.filter((p) => p.map_label).map((p) => p.label);
    expect([...labelled].sort()).toEqual(
      ['Czech', 'Estonian', 'Hungarian', 'Lithuanian', 'Romanian', 'Serbian', 'Sicilian', 'South Italian'],
    );
    for (const label of labelled) expect(ruleViolations(label), label).toEqual([]);
  });

  it.each(Object.keys(SPEC_ROWS) as GeneId[])('%s distribution rows equal spec §3.4 after rounding', (gene) => {
    expect(distributionRows(data(), gene).map((r) => [r.label, r.display])).toEqual(SPEC_ROWS[gene]);
  });

  it('every card value equals its trait_maps value after rounding, and only rows in trait_maps are shown', () => {
    const d = data();
    for (const card of Object.values(CARDS)) {
      if (!card.values) continue;
      const rows = distributionRows(d, card.values);
      expect(rows).toHaveLength(d.trait_maps[card.values].length);
      for (const r of rows) {
        const src = d.trait_maps[card.values].find((x) => x.label_key === r.key)!;
        expect(r.display).toBe(formatCopies(card.values, src.value));
      }
    }
  });

  it('H2 prints the UK 75 and "about 94 adults in 100", and both follow from the UK row (one copy is enough)', () => {
    const uk = data().trait_maps.LCT.find((r) => r.label_key === 'country:UK')!;
    expect(formatCopies('LCT', uk.value)).toBe('75');
    expect(Math.round(100 * (1 - (1 - uk.value) ** 2))).toBe(94);
    expect(CARDS.H2.lines![1]).toContain('about 94 adults in 100');
    expect(CARDS.H2.lines![2]).toContain("the UK's 75");
  });

  it('open check 15: the LCT trajectory present-day value is below the UK 0.75 (backs H2 line 3)', () => {
    const lct = data().traits.find((t) => t.gene === 'LCT')!;
    expect(lct.present_day).not.toBeNull();
    expect(lct.present_day!).toBeLessThan(0.75);
  });
});
