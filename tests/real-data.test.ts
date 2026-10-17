// @vitest-environment node
// Checks the REAL synced data (src/data/workshop_data.json), not the fixture.
// Skipped in a plain `npm test`; run with `npm run check-data` after `npm run sync-data`.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { traitCaption } from '../src/content';
import { validateData } from '../src/data';
import { zoomFactor } from '../src/plotState';
import { GENE_IDS, TRAIT_MAP_ORDER } from '../src/types';
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

  // Spec §6 rule 6 as amended in v2.1 (approved by Matthew): whole-percent match, rounded half-up as in Task 4.
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
});

// ---------- v3 (Task 5): the zoom factor the caption strip and card E3 print ----------
describe.runIf(process.env.REAL_DATA === '1')('real workshop_data.json: v3 plot state', () => {
  it('zoomFactor is 5 (frames unchanged by the Today frame change, RF2)', () => {
    const d = validateData(JSON.parse(readFileSync(REAL, 'utf8')));
    expect(zoomFactor(d)).toBe(5);
  });
});
