// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import fixture from './fixtures/data.fixture.json';
import type { AxisTick, GeneId, Trait, WorkshopData } from '../src/types';
import { renderTrajectory, trajectoryScale } from '../src/plots/trajectory';
import {
  GENE_TRAIT_LABELS, HLA_TEXT_CARD, LOCAL_ANGLO_SAXON_POINT_LABEL, PERIOD_LABELS, TICK_LABELS,
  countNote, traitCaption, traitSourceLabel,
} from '../src/content';

const TICKS: AxisTick[] = [
  { t: 3950, key: 'BellBeaker' }, { t: 3100, key: 'BronzeAge' }, { t: 2300, key: 'IronAge' },
  { t: 1725, key: 'Roman' }, { t: 1212, key: 'AngloSaxon' }, { t: 600, key: 'Medieval' }, { t: -70, key: 'Today' },
];
const LCT_AGES: Trait = {
  gene: 'LCT', rsid: 'rs4988235', variant_id: '2_136608646_G_A', allele: 'A', source: 'ages', present_day: 0.72,
  points: [
    { t: 1500, f: 0.5, lo: 0.44, hi: 0.56 }, { t: 4500, f: 0.02, lo: 0, hi: 0.05 },
    { t: 3000, f: 0.1, lo: 0.06, hi: 0.15 }, { t: 0, f: 0.72, lo: 0.7, hi: 0.74 },
  ],
};
// Real local TYK2 bins (data-freq/uk_allele_freq_by_date_bin.csv, rs34536443; bin 6 dropped)
const TYK2_LOCAL: Trait = {
  gene: 'TYK2', rsid: 'rs34536443', variant_id: '19_10463118_G_C', allele: 'C', source: 'local', present_day: 0.0293,
  points: [
    { t: 4800, f: 0.0109, lo: 0.0019, hi: 0.059, n: 92, period: 'FirstFarmers' },
    { t: 3950, f: 0.1029, lo: 0.0508, hi: 0.1976, n: 68, period: 'BellBeaker' },
    { t: 3100, f: 0.1346, lo: 0.0668, hi: 0.2527, n: 52, period: 'BronzeAge' },
    { t: 2300, f: 0.1352, lo: 0.1001, hi: 0.1802, n: 281, period: 'IronAge' },
    { t: 1725, f: 0.0833, lo: 0.0232, hi: 0.2585, n: 24, period: 'Roman' },
    { t: 1212, f: 0.0645, lo: 0.0373, hi: 0.1094, n: 186, period: 'AngloSaxon' },
    { t: -70, f: 0.0293, lo: 0.0135, hi: 0.0624, n: 205, period: 'Today' },
  ],
};
const HERC2_LOCAL: Trait = {
  gene: 'HERC2', rsid: 'rs12913832', variant_id: '15_28365618_A_G', allele: 'G', source: 'local', present_day: 0.7934,
  points: [
    { t: 3950, f: 0.5846, lo: 0.4634, hi: 0.6964, n: 65, period: 'BellBeaker' },
    { t: 1212, f: 0.8253, lo: 0.7604, hi: 0.8755, n: 166, period: 'AngloSaxon' },
    { t: -70, f: 0.7934, lo: 0.7341, hi: 0.8424, n: 213, period: 'Today' },
  ],
};
const HLA_TEXT: Trait = {
  gene: 'HLA-DQ2', rsid: 'rs3891176', variant_id: '6_32634318_C_A', allele: 'A', source: 'text', present_day: null, points: [],
};

function makeData(traits: Trait[] = [LCT_AGES, HERC2_LOCAL, TYK2_LOCAL, HLA_TEXT]): WorkshopData {
  const d = structuredClone(fixture) as unknown as WorkshopData;
  d.trait_ticks = TICKS;
  d.traits = traits;
  return d;
}

function host(): HTMLElement {
  const h = document.createElement('div');
  document.body.append(h);
  return h;
}

afterEach(() => document.body.replaceChildren());

describe('trajectoryScale', () => {
  it('puts the oldest time on the left and today on the right (pinned)', () => {
    const sc = trajectoryScale(LCT_AGES.points, TICKS);
    expect(sc.tMax).toBe(4500);
    expect(sc.tMin).toBe(-70);
    expect(sc.toX(4500)).toBeCloseTo(84, 6);
    expect(sc.toX(-70)).toBeCloseTo(960, 6);
    expect(sc.yMax).toBe(0.75);
    expect(sc.toY(0)).toBe(440);
    expect(sc.toY(0.75)).toBeCloseTo(24, 6);
  });

  it('zooms the y range for rare variants (TYK2 tops out at 30%)', () => {
    const sc = trajectoryScale(TYK2_LOCAL.points, TICKS);
    expect(sc.yStep).toBe(0.1);
    expect(sc.yMax).toBeCloseTo(0.3, 9);
  });
});

describe('renderTrajectory: AGES series', () => {
  it('draws one line and one band through every point in time order (pinned path)', () => {
    const h = host();
    renderTrajectory(h, makeData(), 'LCT');
    const line = h.querySelectorAll('path.traj-line');
    expect(line).toHaveLength(1);
    expect(line[0].getAttribute('d')).toBe('M84 428.9L371.5 384.5L659.1 162.7L946.6 40.6');
    expect(h.querySelectorAll('path.traj-band')).toHaveLength(1);
    expect(h.querySelector('path.traj-band')?.getAttribute('d')).toMatch(/^M84 412.3L.*Z$/);
    expect(h.querySelectorAll('circle.traj-point')).toHaveLength(0);
  });

  it('labels the x-axis with period names only, from data.trait_ticks', () => {
    const h = host();
    renderTrajectory(h, makeData(), 'LCT');
    const labels = [...h.querySelectorAll('.x-tick-label')].map((t) => t.textContent);
    expect(labels).toEqual(TICKS.map((k) => TICK_LABELS[k.key]));
    for (const l of labels) expect(l).not.toMatch(/\d/);
    expect([...h.querySelectorAll('.y-tick')].map((t) => t.textContent)).toEqual(['0%', '25%', '50%', '75%']);
  });

  it('shows the title, the exact caption and the AGES source label', () => {
    const h = host();
    const d = makeData();
    renderTrajectory(h, d, 'LCT');
    expect(h.querySelector('.traj-title')?.textContent).toBe(GENE_TRAIT_LABELS.LCT);
    expect(h.querySelector('.traj-caption')?.textContent).toBe(traitCaption(LCT_AGES));
    expect(h.querySelector('.traj-source')?.textContent).toBe(traitSourceLabel(LCT_AGES));
    expect(h.querySelector('.traj')?.getAttribute('data-source')).toBe('ages');
  });
});

describe('renderTrajectory: local fallback', () => {
  it('draws points with whiskers, the named undated first-farmer point and the TYK2 count', () => {
    const h = host();
    renderTrajectory(h, makeData(), 'TYK2');
    expect(h.querySelectorAll('circle.traj-point')).toHaveLength(7);
    expect(h.querySelectorAll('line.traj-whisker')).toHaveLength(7);
    expect(h.querySelector('circle.traj-point')?.getAttribute('data-period')).toBe('FirstFarmers'); // left-most
    const labels = [...h.querySelectorAll('.traj-point-label')].map((t) => t.textContent);
    expect(labels).toContain(PERIOD_LABELS.FirstFarmers);
    expect(labels).toContain(LOCAL_ANGLO_SAXON_POINT_LABEL);
    expect(h.querySelector('.traj-count')?.textContent).toBe(countNote(0.1029, 68));
    expect(countNote(0.1029, 68)).toBe('about 10% (7 of 68)');
    expect(h.querySelector('.traj-caption')?.textContent).toBe(traitCaption(TYK2_LOCAL));
    expect(h.querySelector('.traj-source')?.textContent).toBe(traitSourceLabel(TYK2_LOCAL));
    expect(h.querySelector('path.traj-line')?.getAttribute('d')).not.toBe('');
  });

  it('only TYK2 gets the count label', () => {
    const h = host();
    renderTrajectory(h, makeData(), 'HERC2');
    expect(h.querySelectorAll('circle.traj-point')).toHaveLength(3);
    expect(h.querySelectorAll('line.traj-whisker')).toHaveLength(3); // spec §5.4: HERC2 local is always with CI whiskers
    expect(h.querySelector('.traj-count')).toBeNull();
  });
});

describe('renderTrajectory: HLA-DQ2 text card and bad input', () => {
  it('shows the HLA text card with its source label and no plot', () => {
    const h = host();
    renderTrajectory(h, makeData(), 'HLA-DQ2');
    expect(h.querySelector('.hla-card .hla-text')?.textContent).toBe(HLA_TEXT_CARD);
    expect(h.querySelector('.hla-card .traj-source')?.textContent).toBe(traitSourceLabel(HLA_TEXT));
    expect(h.querySelector('svg')).toBeNull();
  });

  it('re-rendering replaces the previous trait', () => {
    const h = host();
    renderTrajectory(h, makeData(), 'LCT');
    renderTrajectory(h, makeData(), 'HERC2');
    expect(h.querySelectorAll('.traj')).toHaveLength(1);
    expect(h.querySelector('.traj')?.getAttribute('data-gene')).toBe('HERC2');
  });

  it('a gene missing from the data leaves the panel empty instead of throwing', () => {
    const h = host();
    expect(() => renderTrajectory(h, makeData([LCT_AGES]), 'SLC45A2' as GeneId)).not.toThrow();
    expect(h.children).toHaveLength(0);
  });
});
