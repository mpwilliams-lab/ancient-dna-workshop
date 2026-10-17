import { describe, expect, it } from 'vitest';
import { CARDS, cardStrings, fillCard, SAMPLE_CARD_VARS } from '../src/cards';
import * as C from '../src/content';
import { PARSER_GENE_ORDER, PARSER_PCA_ORDER, parse } from '../src/parser';
import * as Shared from '../src/sharedText';
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
 * Spec §6 rule 6, as amended in v2.1 (approved by the instructor with the rest of v2.1): the card's present-day
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
    for (const s of [C.BEAKER_CALLOUT, C.ROMAN_LOG_LINE, C.WRAP_LINE, C.RESTORED_NOTICE, C.PREDICT_HINT, C.HLA_TEXT_CARD, C.NORTH_SEA_LABEL,
      C.TRAIT_CAPTIONS.TYK2_AGES, C.TRAIT_CAPTIONS.TYK2_LOCAL, C.AGES_SOURCE_LABEL, C.LOCAL_SOURCE_LABEL,
      C.REVEAL_CALLOUT, C.REVEAL_PCA_CAPTION, C.FINALE_CAPTION, C.HLA_REVEAL_LINE, C.CREDITS_FOOTER, C.REVEAL_HINT, C.CARD_HINT,
      ...Object.values(C.CHIP_TEXT), C.zoomNote(5), C.revealNote(56, 57), C.cardCounter(2, 3), C.mapAxesLine(950), C.axesLine(950),
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
    ['90% of the gene pool was replaced', 'rule3:turnover-90'],
    ['The Beakers replaced 90% of the population', 'rule3:turnover-90'],
    ['a 90% turnover', 'rule3:turnover-90'],
    ['90% ± 2% (Olalde et al. 2018)', 'rule3:turnover-90'],
    ['At least 90% ± 2% of the gene pool', 'rule3:turnover-90'],
    ["9 in 10 parts of Britain's DNA came from the newcomers (Olalde et al. 2018).", 'rule3:9-in-10-without-at-least'],
    ['The newcomers replaced about 9 in 10 people', 'rule3:9-in-10-without-at-least'],
    ['The newcomers were themselves part steppe herder, part farmer, so the steppe colour rises to 64%, not 90%.', 'rule3:bridge-line'],
    ['Britain today is called modern England here', 'rule11:england-for-britain-today'],
    ['England today', 'rule11:england-for-britain-today'],
    ['a paternity question', 'rule14:never-on-screen'],
    ['a Y-chromosome mismatch', 'rule14:never-on-screen'],
    ['an affair', 'rule14:never-on-screen'],
    ['illegitimate', 'rule14:never-on-screen'],
    ['23andMe uses 45 populations', 'rule8:23andme-number'],
    ['AncestryDNA goes back 1,000 years', 'rule8:ancestrydna-without-white-paper'],
  ])('%s -> %s', (text, rule) => {
    expect(ruleViolations(text)).toContain(rule);
  });

  it.each([
    'First farmers / Stonehenge builders',
    'run_pca(period = "FirstFarmers")',
    'Iron Age',
    'British 90%',
    'British       ██████████████████  90%',
    "at least 9 in 10 parts of Britain's DNA came from the newcomers (Olalde et al. 2018)",
    'Afterwards, more than 9 in 10 of 52 men did (Olalde et al. 2018).',
    "his DNA score for keeping a beat was lower than about 9 in 10 people's",
    'people in England today carry about a quarter to a half of this ancestry',
    'Britain today',
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

describe('rule 3: Beaker turnover (v3 §3.2; open check 13)', () => {
  it('callout is exact and breaks no rule', () => {
    expect(C.BEAKER_CALLOUT).toBe(
      "Within about ten generations of the Beaker people arriving, at least 9 in 10 parts of Britain's DNA came from the newcomers. The First farmers / Stonehenge builders' share shrank to about 1 in 10 or less (Olalde et al. 2018).",
    );
    expect(ruleViolations(C.BEAKER_CALLOUT)).toEqual([]);
  });
  it('no renderable string shows a turnover 90%, and the bridge line is gone everywhere', () => {
    expect(ALL.filter((s) => /\b90\s*%/.test(s) && /replac|turnover|gene pool|Olalde/i.test(s))).toEqual([]);
    expect(ALL.filter((s) => /not 90\s*%|rises to \d+%/i.test(s))).toEqual([]);
    expect('beakerBridge' in C).toBe(false);
    expect('ROMAN_CARD' in C).toBe(false);
  });
  it('every "9 in 10" in a turnover string reads "at least" or "more than"', () => {
    for (const s of ALL.filter((x) => /\b9 in 10\b/.test(x) && /replac|turnover|gene pool|Olalde/i.test(x))) {
      expect(s.replace(/\b(?:at least|more than) 9 in 10\b/gi, ''), s).not.toMatch(/\b9 in 10\b/);
    }
  });
});

describe('rule 4: Romans (v3 §3.5)', () => {
  it('the Roman log line is exact and cites all three papers while open check 1 passes', () => {
    expect(C.SILVA_2026_SHOWN).toBe(true);
    expect(C.ROMAN_LOG_LINE).toBe('New rulers, mostly the same families (Silva et al. 2026; Scheib et al. 2024; Martiniano et al. 2016).');
    expect(C.ROMAN_FOCUS_CAPTION).toBe('New rulers, mostly the same families: culture changed, DNA barely did');
  });
  it('the Roman layer label shows its n', () => {
    expect(C.withN(C.PERIOD_LABELS.Roman, 15)).toBe('Roman (n = 15)');
  });
});

describe('rule 5: Anglo-Saxons', () => {
  it('the corrected takeaway is exact: an average of about 76%, not "up to" (v3 §3.5)', () => {
    expect(C.ANGLO_SAXON_TAKEAWAY).toBe(
      "A real migration: Anglo-Saxon-period burials sampled in England carry about 76% continental ancestry on average (Gretzinger et al. 2022). Yet the Anglo-Saxon bar looks almost the same as the Iron Age bar: both groups were part steppe herder, part farmer, so this three-colour test can't tell them apart.",
    );
    expect(C.ANGLO_SAXON_TAKEAWAY).not.toMatch(/up to 76%/);
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
    // v3 §3.4: corrected text, no "19 times" (open check 7)
    expect(C.HLA_TEXT_CARD).toBe(
      `${s} Today about 1 in 5 copies of this stretch of DNA carry it, and people with two copies are much more likely to get coeliac disease or gluten sensitivity (Akbari et al. 2026). Our British ancient-DNA data do not cover this spot, so there is no plot here: the numbers come from Akbari et al.'s West Eurasian study.`,
    );
    expect(C.HLA_TEXT_CARD).not.toMatch(/19/);
    expect(C.HLA_REVEAL_LINE).toBe(
      'One leading idea, still a hypothesis: immune versions like this helped people fight infections, and coeliac disease is the price a few people pay (Zhernakova et al. 2010; Akbari et al. 2026).',
    );
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

// ---------- final review: help() layout, the hook's one-sentence note, the PCA legend label ----------
describe('help() layout (a line over 60 characters wraps badly in the terminal pane)', () => {
  const MAX_LINE = 60;
  const indent = (s: string): number => s.length - s.trimStart().length;
  const COMMANDS = [
    'help()', 'load_genomes()', 'run_pca(period = "IronAge")', 'run_admixture(K = 3)', 'run_admixture(K = 3, period = "BellBeaker")',
    'allele_freq(gene = "LCT")', 'ancestry_test(person = "me")', 'clear()',
  ];
  /** The lines under a command that are indented deeper than it, joined: its description. */
  const describedAs = (command: string): string => {
    const i = C.HELP_LINES.findIndex((l) => l.trim() === command);
    const out: string[] = [];
    for (let j = i + 1; j < C.HELP_LINES.length && indent(C.HELP_LINES[j]!) > indent(C.HELP_LINES[i]!); j++) out.push(C.HELP_LINES[j]!.trim());
    return out.join(' ');
  };

  it('every line is at most 60 characters', () => {
    expect(C.HELP_LINES.length).toBeGreaterThan(10);
    for (const line of C.HELP_LINES) expect(line.length, `"${line}"`).toBeLessThanOrEqual(MAX_LINE);
  });

  it('puts each command on a line of its own, with a short indented description straight below it', () => {
    for (const command of COMMANDS) {
      const at = C.HELP_LINES.map((l, i) => [l, i] as const).filter(([l]) => l.trim() === command);
      expect(at, command).toHaveLength(1);
      const [line, i] = at[0]!;
      const below = C.HELP_LINES[i + 1];
      expect(below, `${command} has a line below it`).toBeDefined();
      expect(below!.trim().length, command).toBeGreaterThan(0);
      expect(indent(below!), `${command}: description indent`).toBeGreaterThan(indent(line));
      // nothing but the command on its line: no description beside it
      expect(line.trim(), command).toBe(command);
    }
  });

  it('lists only commands that run: every command line parses', () => {
    for (const command of COMMANDS) expect(parse(command), command).toMatchObject({ ok: true });
  });

  it('keeps every period, every gene and the keys that the old layout named', () => {
    const periods = describedAs('run_pca(period = "IronAge")');
    for (const id of [...PARSER_PCA_ORDER, 'all']) expect(periods, id).toMatch(new RegExp(`(^|[^A-Za-z])${id}([^A-Za-z]|$)`));
    const genes = describedAs('allele_freq(gene = "LCT")');
    for (const id of PARSER_GENE_ORDER) expect(genes, id).toContain(id);
    expect(describedAs('ancestry_test(person = "me")')).toMatch(/"me"/);
    const text = C.HELP_LINES.join('\n');
    expect(text).toMatch(/Commands \(type one, then press Enter\):/);
    for (const key of ['Tab completes', 'Up/Down shows earlier commands', 'Esc fills in the hint']) expect(text, key).toContain(key);
  });

  it('is still free of §6 violations line by line', () => {
    for (const line of C.HELP_LINES) expect(ruleViolations(line), line).toEqual([]);
  });
});

describe('the hook screen keeps one sentence of the consumer note', () => {
  it('HOOK_NOTE is the sentence "These labels are illustrative, not a measurement." and closes the full CONSUMER_NOTE', () => {
    expect(C.HOOK_NOTE).toBe('These labels are illustrative, not a measurement.');
    expect(C.CONSUMER_NOTE.endsWith(C.HOOK_NOTE)).toBe(true);
    expect(C.CONSUMER_NOTE.split(C.HOOK_NOTE)).toHaveLength(2); // exactly once, so there is a single source for the sentence
    expect(ALL).toContain(C.HOOK_NOTE);
    expect(ruleViolations(C.HOOK_NOTE)).toEqual([]);
  });
});

describe('the PCA legend label for the outlined eastern-England points', () => {
  it('is "Anglo-Saxon burials, eastern England (outlined)" (v3 §3.5), is scanned with the rest, and breaks no rule', () => {
    expect(C.EAST_ENGLAND_LEGEND).toBe('Anglo-Saxon burials, eastern England (outlined)');
    expect(ALL).toContain(C.EAST_ENGLAND_LEGEND);
    expect(ruleViolations(C.EAST_ENGLAND_LEGEND)).toEqual([]);
  });
});

// ---------- v3 §3.5: every new key, verbatim (Task 3) ----------
describe('v3 captions, chips, callouts, buttons, hints and log lines are verbatim', () => {
  it('PCA captions, zoom note and legend headings', () => {
    expect(C.EUROPE_CAPTION).toBe('Each dot is a person living in Europe today. Britain is held back for now.');
    expect(C.zoomNote(5)).toBe('Zoomed in about 5× on Britain');
    expect(C.REVEAL_PCA_CAPTION).toBe(
      "Britain today lands right on top of the Iron Age cloud: much of the Iron Age people's DNA is still here. (Our Britain today people come from England and Scotland, including Orkney; none are from Wales.)",
    );
    expect(C.FINALE_CAPTION).toBe(
      'Every period, oldest first. The Beaker people and the Anglo-Saxons brought new people: DNA changed. The Romans brought new ideas to mostly the same families: culture changed, DNA barely did. Britain today arrives last, close to the Iron Age and later Britons.',
    );
    expect(C.LEGEND_ANCIENT).toBe('Ancient Britons');
    expect(C.LEGEND_LIVING).toBe('People living today');
  });
  it('the six chips; each starts with one of the two stems and gets the matching icon (rule 13)', () => {
    expect(C.CHIP_TEXT).toEqual({
      CHIP_DNA_CHANGED: 'DNA changed: new people',
      CHIP_CULTURE_CHANGED: 'Culture changed: new things',
      CHIP_DNA_SLIGHT: 'DNA changed, but only slightly',
      CHIP_CULTURE_ONLY: 'Culture changed, DNA did not: new ideas, same people',
      CHIP_ROMAN: 'Culture changed, DNA barely did: new ideas, mostly the same people',
      CHIP_DNA_CHANGED_EAST: 'DNA changed, most of all in the east: new people',
    });
    expect(C.CHIP_DNA_CHANGED).toBe(C.CHIP_TEXT.CHIP_DNA_CHANGED);
    for (const [key, text] of Object.entries(C.CHIP_TEXT) as [keyof typeof C.CHIP_TEXT, string][]) {
      expect(text, key).toMatch(/^(DNA changed|Culture changed)/);
      expect(C.chipIcon(key), key).toBe(text.startsWith('DNA changed') ? 'dna' : 'pot');
    }
    expect(() => C.chipIcon('NOT_A_CHIP' as never)).toThrow();
  });
  it('reveal callout and note', () => {
    expect(C.REVEAL_CALLOUT).toBe(
      "Most of Britain's ancestry today was already here by the Iron Age. Later, Anglo-Saxon newcomers added a sizeable share, most of it in eastern England (Gretzinger et al. 2022).",
    );
    expect(C.revealNote(56, 57)).toBe('Britain today: 56% steppe. Iron Age: 57% steppe. Of all the periods, the Iron Age bar is the closest match.');
  });
  it('hints, card buttons, counter and credits strings', () => {
    expect(C.REVEAL_HINT).toBe('Predict: where will Britain today land? Then run run_pca(period = "Today")');
    expect(C.CARD_HINT).toBe('Press Enter to continue (or click Continue).');
    expect([C.BACK_BUTTON, C.BACK_BUTTON_LABEL]).toEqual(['Back', 'Back one screen']);
    expect([C.CARD_CONTINUE, C.CARD_CONTINUE_TO_PLOT, C.CARD_CONTINUE_DONE]).toEqual(['Continue', 'Show the plot', 'See the plot']);
    expect(C.cardCounter(2, 3)).toBe('2 of 3');
    expect([C.CREDITS_LINK, C.CREDITS_TITLE, C.CREDITS_CLOSE]).toEqual(['Image credits', 'Image and data credits', 'Close']);
    expect(C.CREDITS_FOOTER).toBe(
      "Map outlines: Made with Natural Earth (public domain). Allele frequencies: 1000 Genomes Project; gnomAD; Akbari et al. 2026 (AGES). Lactase data: Liebert et al. 2017, Human Genetics (CC BY 4.0). The app's code licence does not cover these images; each keeps its own licence.",
    );
  });
  it('consumer plot strings', () => {
    expect(C.CONSUMER_PLOT_SUBTITLE).toBe('Compared with people living in Europe today');
    expect(C.CONSUMER_PLOT_NOTE).toBe("These labels show where similar people live today, not who anyone's ancestors were.");
    expect(C.consumerTitle('Iron Age', 371)).toBe('Consumer-style ancestry test: Iron Age (371 people)');
  });
  it('terminal log lines (CONTRACT §4.1)', () => {
    expect(C.mapAxesLine(950)).toBe(
      'Map axes: built from about 950 present-day Europeans. Britons are left out, then placed on the map the same way as ancient Britons.',
    );
    expect(C.axesLine(950)).toBe(
      'Axes: about 950 present-day Europeans. Britons are left out, then placed on the map the same way as ancient Britons.',
    );
    expect(C.europeProjectingLine(['Sardinian', 'Spanish', 'North Italian', 'French', 'Norwegian'])).toBe(
      'Projecting present-day Europeans onto the axes: 5 map groups (Sardinian, Spanish, North Italian, French, Norwegian)',
    );
    expect(C.EUROPE_HELD_BACK).toBe('Britain today: held back for now.');
    expect(C.EUROPE_ALREADY_SHOWN).toBe('Britain today: already on the map.');
    expect(C.TODAY_PLACED).toBe('Britain today: placed on the map the same way as the ancient Britons.');
    expect(C.ALL_PROJECTING).toBe('Projecting every period onto the axes, oldest first:');
    expect(C.ALL_TODAY_LAST).toBe('Britain today: placed last.');
    expect(C.ADMIX_TODAY_HIDDEN).toBe('Britain today is not shown yet.');
    expect(C.ADMIX_TODAY_SHOWN).toBe('Now with Britain today.');
    expect(C.CONSUMER_BARS_LOG).toBe('Drawing the result as bars.');
  });
  it('every new string is in allRenderableStrings and breaks no rule', () => {
    const fresh = [
      C.EUROPE_CAPTION, C.REVEAL_PCA_CAPTION, C.FINALE_CAPTION, C.ROMAN_FOCUS_CAPTION, C.LEGEND_ANCIENT, C.LEGEND_LIVING,
      ...Object.values(C.CHIP_TEXT), C.REVEAL_CALLOUT, C.REVEAL_HINT, C.CARD_HINT, C.BACK_BUTTON, C.BACK_BUTTON_LABEL,
      C.CARD_CONTINUE, C.CARD_CONTINUE_TO_PLOT, C.CARD_CONTINUE_DONE, C.CREDITS_LINK, C.CREDITS_TITLE, C.CREDITS_CLOSE,
      C.CREDITS_FOOTER, C.CONSUMER_PLOT_SUBTITLE, C.CONSUMER_PLOT_NOTE, C.HLA_REVEAL_LINE, C.EUROPE_HELD_BACK,
      C.EUROPE_ALREADY_SHOWN, C.TODAY_PLACED, C.ALL_PROJECTING, C.ALL_TODAY_LAST, C.ADMIX_TODAY_HIDDEN, C.ADMIX_TODAY_SHOWN,
      C.CONSUMER_BARS_LOG, C.ROMAN_LOG_LINE, C.zoomNote(5), C.revealNote(56, 57), C.cardCounter(2, 3),
      C.consumerTitle('Iron Age', 371), C.mapAxesLine(950), C.axesLine(950),
      C.europeProjectingLine(['Sardinian', 'Spanish', 'North Italian', 'French', 'Norwegian']),
    ];
    for (const s of fresh) {
      expect(ALL, s).toContain(s);
      expect(ruleViolations(s), s).toEqual([]);
    }
  });
});

describe('help(): the run_pca entry (v3 §3.5, Task 4)', () => {
  it('is the four-line text of the spec, with Europe first and Britain today last', () => {
    const i = C.HELP_LINES.indexOf('  run_pca(period = "IronAge")');
    expect(C.HELP_LINES.slice(i, i + 4)).toEqual([
      '  run_pca(period = "IronAge")',
      '      map one period: Europe, FirstFarmers, BellBeaker,',
      '      BronzeAge, IronAge, Roman, AngloSaxon, Viking,',
      '      Today or all',
    ]);
  });
});

describe('cards and trait-map labels are scanned with the rest (Task 10, spec §5.1)', () => {
  it('allRenderableStrings() holds every card string, templates filled with the current build numbers', () => {
    for (const card of Object.values(CARDS)) {
      for (const s of cardStrings(card)) expect(ALL).toContain(fillCard(s, SAMPLE_CARD_VARS));
    }
  });
  it('re-exports the leaf-module values, and they are scanned', () => {
    expect(C.TRAIT_MAP_LABELS).toBe(Shared.TRAIT_MAP_LABELS);
    expect(C.IRELAND_FOOTNOTE).toBe('Ireland: small sample.');
    expect(C.MAP_SOURCE_SUFFIX).toBe('Map outline: Made with Natural Earth.');
    expect(C.SILVA_2026_SHOWN).toBe(Shared.SILVA_2026_SHOWN);
    for (const s of [C.IRELAND_FOOTNOTE, C.MAP_SOURCE_SUFFIX, ...Object.values(C.TRAIT_MAP_LABELS)]) expect(ALL).toContain(s);
  });
});
