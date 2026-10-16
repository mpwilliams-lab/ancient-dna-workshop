import { describe, expect, it } from 'vitest';
import * as C from '../src/content';
import type { Trait, TraitPoint } from '../src/types';
import { ALLOWED_AGE_PHRASES, ruleViolations } from './contentRules';
import { cloneFixture, FIXTURE } from './fixtures/fixture';

const ALL = C.allRenderableStrings();
const trait = (gene: Trait['gene'], source: Trait['source']): Trait => ({ gene, rsid: '', variant_id: '', allele: '', source, points: [], present_day: null });

/** The point at the present-day end of a trajectory (smallest t, since t is years before present). */
function presentDayPoint(t: Trait): TraitPoint {
  return [...t.points].sort((a, b) => a.t - b.t)[0]!;
}
/** "About 3% today" -> 3 (a whole percent) */
function captionPresentDayPct(caption: string): number {
  const m = /About (\d+)% today/.exec(caption);
  if (!m) throw new Error(`no present-day number in: ${caption}`);
  return Number(m[1]);
}
/**
 * Spec §6 rule 6, as amended in v2.1 (approved by Matthew with the rest of v2.1): the card's present-day
 * number must match the plotted present-day value rounded to a whole percent. "About 3%" is a whole
 * percent, so it matches when the plotted value (inside its own interval) rounds to it. This is the same
 * comparison as the data build's tyk2_caption check (Task 4). Under the old v2 rule (not in force), the
 * card's number (3% = 0.03) had to lie inside the plotted present-day interval [lo, hi].
 */
function captionMatches(caption: string, p: TraitPoint): boolean {
  return p.lo <= p.f && p.f <= p.hi && wholePct(p.f) === captionPresentDayPct(caption);
}
/**
 * A plotted 4-dp frequency as a whole percent, rounded half-up like Task 4 (floor(100 * f + 0.5)).
 * toFixed(2) first: 100 * 0.145 is 14.499999999999998 in floating point, which a bare Math.round makes 14.
 */
function wholePct(f: number): number {
  return Math.round(Number((100 * f).toFixed(2)));
}

describe('allRenderableStrings()', () => {
  it('collects every exported string, including labels, help lines and both TYK2 captions', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(80);
    for (const s of [C.BEAKER_CALLOUT, C.ROMAN_CARD, C.WRAP_LINE, C.RESTORED_NOTICE, C.PREDICT_HINT, C.HLA_TEXT_CARD, C.NORTH_SEA_LABEL,
      C.TRAIT_CAPTIONS.TYK2_AGES, C.TRAIT_CAPTIONS.TYK2_LOCAL, C.AGES_SOURCE_LABEL, C.LOCAL_SOURCE_LABEL, C.beakerBridge(64),
      ...C.HELP_LINES, ...Object.values(C.PERIOD_LABELS), ...Object.values(C.SOURCE_LABELS), ...Object.values(C.TICK_LABELS),
      ...Object.values(C.MAP_GROUP_LABELS), 'British', 'Scandinavian']) {
      expect(ALL).toContain(s);
    }
  });

  it('every string is non-empty', () => {
    for (const s of ALL) expect(s.trim().length).toBeGreaterThan(0);
  });
});

describe('spec §6 rules over every renderable string', () => {
  it('no string breaks any rule', () => {
    const broken = ALL.map((s) => ({ s, v: ruleViolations(s) })).filter((x) => x.v.length > 0);
    expect(broken).toEqual([]);
  });

  it('the three allowed age phrases each appear exactly where the spec puts them', () => {
    expect(C.TRAIT_CAPTIONS.TYK2_AGES).toContain('about 2,000 years ago');
    expect(C.TRAIT_CAPTIONS.TYK2_LOCAL).toContain('about 2,000 years ago');
    expect(C.TRAIT_CAPTIONS.LCT).toContain('about 100 generations ago');
    expect(C.TRAIT_CAPTIONS['HLA-DQ2']).toContain('over the last 4,000 years');
    expect(ALLOWED_AGE_PHRASES).toEqual(['about 2,000 years ago', 'about 100 generations ago', 'over the last 4,000 years']);
  });
});

describe('the rule checker catches what it must (so a clean pass means something)', () => {
  it.each([
    ['2450 BCE', 'rule1:BCE/BC'],
    ['c. 2400 BC', 'rule1:BCE/BC'],
    ['4500 BP', 'rule1:BP'],
    ['45 kya', 'rule1:kya/ya'],
    ['about 5,000 years ago', 'rule1:years/generations ago'],
    ['about 150 generations ago', 'rule1:years/generations ago'],
    ['over 1,000 years', 'rule1:N years (a time span)'],
    ['Neolithic farmers', 'rule1:banned-word'],
    ['the Mesolithic', 'rule1:banned-word'],
    ['Palaeolithic', 'rule1:banned-word'],
    ['Paleolithic', 'rule1:banned-word'],
    ['Megalithic tombs', 'rule1:banned-word'],
    ['after the Ice Age', 'rule1:banned-word'],
    ['England_IA_o', 'rule1:group-id'],
    ['Yamnaya', 'rule1:group-id'],
    ['sample I12345', 'rule1:sample-id'],
    ['First farmers', 'rule2:earlier-group-label'],
    ['the first farmers of Britain', 'rule2:earlier-group-label'],
    ['90% of the gene pool was replaced', 'rule3:90-without-at-least'],
    ['The Beakers replaced 90% of the population', 'rule3:90-without-at-least'],
    ['a 90% turnover', 'rule3:90-without-at-least'],
    ['90% ± 2% (Olalde et al. 2018)', 'rule3:90-without-at-least'],
    ['23andMe uses 45 populations', 'rule8:23andme-number'],
    ['AncestryDNA goes back 1,000 years', 'rule8:ancestrydna-without-white-paper'],
  ])('%s -> %s', (text, rule) => {
    expect(ruleViolations(text)).toContain(rule);
  });

  it.each([
    'First farmers / Stonehenge builders',
    'run_pca(period = "FirstFarmers")',
    'Iron Age',
    'At least 90% ± 2% of the gene pool',
    'British 90%',
    'British       ██████████████████  90%',
    'The newcomers were themselves part steppe herder, part farmer, so the steppe colour rises to 64%, not 90%.',
    'Roman and later periods may show 43 CE',
    'SNPs used: 496,901',
    'a 23andMe test',
  ])('allows: %s', (text) => {
    expect(ruleViolations(text)).toEqual([]);
  });
});

describe('rule 2: the earlier group label', () => {
  it('is exactly "First farmers / Stonehenge builders"', () => {
    expect(C.PERIOD_LABELS.FirstFarmers).toBe('First farmers / Stonehenge builders');
  });
});

describe('rule 3: Beaker turnover', () => {
  it('callout is exact', () => {
    expect(C.BEAKER_CALLOUT).toBe("At least 90% ± 2% of Britain's gene pool was replaced by the Middle Bronze Age (Olalde et al. 2018).");
  });
  it('every string mentioning 90% says "at least", except the bridging line', () => {
    for (const s of ALL.filter((x) => /\b90\s*%/.test(x))) {
      const isBridge = s.startsWith('The newcomers were themselves');
      expect(isBridge || /at least 90% ± 2%/i.test(s)).toBe(true);
    }
  });
  it('bridging line uses the JSON value from the data', () => {
    expect(C.beakerBridge(FIXTURE.admixture.beaker_steppe_pct)).toBe(
      'The newcomers were themselves part steppe herder, part farmer, so the steppe colour rises to 64%, not 90%.',
    );
  });
  it.each([63.8, -1, 101, Number.NaN])('bridging line refuses a non-whole or out-of-range percent (%s)', (pct) => {
    expect(() => C.beakerBridge(pct)).toThrow(RangeError);
  });
});

describe('rule 4: Romans', () => {
  it('card is exact and cites both papers', () => {
    expect(C.ROMAN_CARD).toBe('New rulers, roads and Latin — mostly the same people (Silva et al. 2026; Martiniano et al. 2016).');
  });
  it('the Roman layer label shows its n', () => {
    expect(C.withN(C.PERIOD_LABELS.Roman, 15)).toBe('Roman (n = 15)');
  });
});

describe('rule 5: Anglo-Saxons', () => {
  it('is called a real migration, cites Gretzinger, and explains the flat bar as a limit of the tool', () => {
    expect(C.ANGLO_SAXON_TAKEAWAY).toContain('A real migration');
    expect(C.ANGLO_SAXON_TAKEAWAY).toContain('(Gretzinger et al. 2022)');
    expect(C.ANGLO_SAXON_TAKEAWAY).toContain('a tool only sees differences its reference groups can tell apart');
    expect(C.NORTH_SEA_LABEL).toBe('North Sea coast (early medieval)');
  });
});

describe('rule 6: trait captions', () => {
  it('LCT is exact', () => {
    expect(C.traitCaption(trait('LCT', 'ages'))).toBe(
      'Milk-digesting DNA spread after the Beaker newcomers arrived. In Britain, selection for it was about 0.08 when the Beaker people arrived, falling to about 0.02 later (Mathieson & Terhorst 2022), and stayed strong until about 100 generations ago (Colbran et al. 2026).',
    );
    expect(C.traitSourceLabel(trait('LCT', 'ages'))).toBe('across West Eurasia, including Britain (Akbari et al. 2026, AGES)');
  });
  it('SLC45A2 is exact', () => {
    expect(C.traitCaption(trait('SLC45A2', 'local'))).toBe('Arrived with newcomers, then kept rising: migration first, then selection (Akbari et al. 2026).');
  });
  it('HERC2 is exact and makes no selection claim', () => {
    const s = C.traitCaption(trait('HERC2', 'ages'));
    expect(s).toBe('Blue-eye DNA jumps around the Anglo-Saxon period. Migration or selection? Probably both — and the Europe-wide signal is weak.');
    expect(s).not.toMatch(/natural selection/i);
    expect(s).not.toMatch(/selected for/i);
    expect(C.traitCaption(trait('HERC2', 'local'))).toBe(s);
  });
  it('TYK2 picks the AGES or local version by source', () => {
    expect(C.traitCaption(trait('TYK2', 'ages'))).toBe(
      "A variant that raises TB risk was common in the Bronze and Iron Ages, then fell. Kerner et al. 2021 date the start of strong selection against it to about 2,000 years ago, with 20% lower fitness for people with two copies; Akbari et al.'s curve puts the turn a little earlier, so the exact timing is uncertain. About 3% today; reported at about 4% in the UK.",
    );
    expect(C.traitCaption(trait('TYK2', 'local'))).toBe(
      'A variant that raises TB risk was common in Bronze and Iron Age Britain, then fell. Strong natural selection against it started about 2,000 years ago, with 20% lower fitness for people with two copies (Kerner et al. 2021). About 3% today in this British sample; other studies report about 4% in the UK.',
    );
  });
  it('TYK2 local caption: its whole-percent present-day number matches the plotted present-day value (fixture)', () => {
    const t = FIXTURE.traits.find((x) => x.gene === 'TYK2')!;
    expect(t.source).toBe('local');
    const caption = C.traitCaption(t);
    expect(captionPresentDayPct(caption)).toBe(3);
    expect(captionMatches(caption, presentDayPoint(t))).toBe(true);
  });
  it('TYK2 AGES caption: the real AGES present-day row (0.0343 in [0.0312, 0.0374]) matches "About 3%"; a 4.5% end does not', () => {
    const d = cloneFixture();
    const t = d.traits.find((x) => x.gene === 'TYK2')!;
    t.source = 'ages';
    t.points = [{ t: 3000, f: 0.09, lo: 0.08, hi: 0.1 }, { t: 1000, f: 0.05, lo: 0.04, hi: 0.06 }, { t: 0, f: 0.0343, lo: 0.0312, hi: 0.0374 }];
    const caption = C.traitCaption(t);
    expect(caption).toBe(C.TRAIT_CAPTIONS.TYK2_AGES);
    expect(captionMatches(caption, presentDayPoint(t))).toBe(true);
    expect(captionMatches(caption, { t: 0, f: 0.0451, lo: 0.0393, hi: 0.0509 })).toBe(false);
    // half-up on the plotted 4-dp value (as Task 4): 0.0250 reads as 3%, 0.0350 as 4%, 0.145 as 15%; a value outside its own interval never matches
    expect(captionMatches(caption, { t: 0, f: 0.025, lo: 0.02, hi: 0.03 })).toBe(true);
    expect(captionMatches(caption, { t: 0, f: 0.035, lo: 0.0301, hi: 0.0399 })).toBe(false);
    expect(captionMatches('About 15% today', { t: 0, f: 0.145, lo: 0.14, hi: 0.15 })).toBe(true);
    expect(captionMatches(caption, { t: 0, f: 0.03, lo: 0.031, hi: 0.04 })).toBe(false);
  });
  it('HLA-DQ2 is exact, and the text card starts with it', () => {
    const s = 'The main coeliac-disease risk type rose from about 0% to about 20% over the last 4,000 years across West Eurasia (Akbari et al. 2026).';
    expect(C.traitCaption(trait('HLA-DQ2', 'ages'))).toBe(s);
    expect(C.traitCaption(trait('HLA-DQ2', 'text'))).toBe(s);
    expect(C.HLA_TEXT_CARD.startsWith(s)).toBe(true);
    expect(C.traitSourceLabel(trait('HLA-DQ2', 'text'))).toBe(C.AGES_SOURCE_LABEL);
  });
  it('local source label and local point labels', () => {
    expect(C.traitSourceLabel(trait('HERC2', 'local'))).toBe('Britain, computed from AADR data');
    expect(C.LOCAL_ANGLO_SAXON_POINT_LABEL).toBe('Anglo-Saxon period (includes some Viking-era burials)');
    const bb = FIXTURE.traits[3]!.points.find((p) => p.period === 'BellBeaker')!;
    expect(C.countNote(bb.f, bb.n!)).toBe('about 10% (7 of 68)');
  });
});

describe('rule 7: wrap line', () => {
  it('is verbatim', () => {
    expect(C.WRAP_LINE).toBe(
      'We are looking at the genetic family tree: the physical pattern of who is related to whom in the DNA. That holds no matter which timeline you use.',
    );
  });
});

describe('rule 8: consumer tests', () => {
  it('AncestryDNA is quoted only from its white paper and 23andMe never gets a number', () => {
    for (const s of ALL) {
      if (/AncestryDNA/.test(s)) expect(s).toMatch(/white paper/);
      if (/23andMe/.test(s)) expect(s.replace(/23andMe/g, '')).not.toMatch(/\d/);
    }
    expect(C.CONSUMER_TAKEAWAY).toContain('"people with long family histories in a particular region or group"');
  });
  it('the example customer is clearly labelled and sums to 1', () => {
    expect(C.ME_RESULT).toEqual([{ label: 'British', share: 0.92 }, { label: 'Scandinavian', share: 0.08 }]);
    expect(C.ME_HEADING).toMatch(/not a real person/);
    expect(C.CONSUMER_NOTE).toContain('It does not mean Vikings.');
    expect(C.CONSUMER_NOTE).toContain('These labels are illustrative, not a measurement.');
  });
});

describe('labels (contract)', () => {
  it('period labels', () => {
    expect(C.PERIOD_LABELS).toEqual({
      FirstFarmers: 'First farmers / Stonehenge builders', BellBeaker: 'Bell Beaker', BronzeAge: 'Bronze Age', IronAge: 'Iron Age',
      Roman: 'Roman', AngloSaxon: 'Anglo-Saxon', Viking: 'Viking', Today: 'Britain today',
    });
  });
  it('source, map-group and tick labels', () => {
    expect(C.SOURCE_LABELS).toEqual({ STEPPE: 'Steppe herders', FARMER: 'Early farmers', WHG: 'Hunter-gatherers' });
    expect(C.MAP_GROUP_LABELS).toEqual({ Sardinian: 'Sardinian', Spanish: 'Spanish', ItalianNorth: 'North Italian', French: 'French', Norwegian: 'Norwegian' });
    expect(C.TICK_LABELS).toEqual({ BellBeaker: 'Bell Beaker', BronzeAge: 'Bronze Age', IronAge: 'Iron Age', Roman: 'Roman', AngloSaxon: 'Anglo-Saxon', Medieval: 'Medieval', Today: 'Today' });
  });
  it('terminal strings', () => {
    expect(C.RESTORED_NOTICE).toBe('Restored previous session — reload with ?reset to start fresh');
    expect(C.PREDICT_HINT).toBe('Predict: where will the Beaker newcomers land? Then run run_pca(period = "BellBeaker")');
    expect(C.HELP_LINES.join('\n')).toMatch(/run_pca\(period = "IronAge"\)/);
    for (const name of ['help()', 'load_genomes()', 'run_pca(', 'run_admixture(K = 3)', 'allele_freq(gene = ', 'ancestry_test(person = "me")', 'clear()']) {
      expect(C.HELP_LINES.join('\n')).toContain(name);
    }
    expect(C.K_REFUSAL).toBe("This workshop's run uses K = 3. Try run_admixture(K = 3).");
  });
});
