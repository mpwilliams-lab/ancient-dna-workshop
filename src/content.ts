// Every on-screen string lives here (spec §6). tests/content.test.ts scans allRenderableStrings()
// with tests/contentRules.ts, so any string added to this file is checked automatically.
import * as self from './content';
import type { AxisTick, ConsumerShare, GeneId, MapGroupId, PeriodId, SourceId, Trait } from './types';
import { GENE_IDS } from './types';

export const APP_TITLE = 'Ancient DNA of Britain';
export const PAGES_URL = 'https://mpwilliams-lab.github.io/ancient-dna-workshop/';

// ---- Labels ----
export const PERIOD_LABELS: Record<PeriodId, string> = {
  FirstFarmers: 'First farmers / Stonehenge builders',
  BellBeaker: 'Bell Beaker',
  BronzeAge: 'Bronze Age',
  IronAge: 'Iron Age',
  Roman: 'Roman',
  AngloSaxon: 'Anglo-Saxon',
  Viking: 'Viking',
  Today: 'Britain today',
};

export const MAP_GROUP_LABELS: Record<MapGroupId, string> = {
  Sardinian: 'Sardinian',
  Spanish: 'Spanish',
  ItalianNorth: 'North Italian',
  French: 'French',
  Norwegian: 'Norwegian',
};

export const SOURCE_LABELS: Record<SourceId, string> = {
  STEPPE: 'Steppe herders',
  FARMER: 'Early farmers',
  WHG: 'Hunter-gatherers',
};

export const TICK_LABELS: Record<AxisTick['key'], string> = {
  BellBeaker: 'Bell Beaker',
  BronzeAge: 'Bronze Age',
  IronAge: 'Iron Age',
  Roman: 'Roman',
  AngloSaxon: 'Anglo-Saxon',
  Medieval: 'Medieval',
  Today: 'Today',
};

export const GENE_TRAIT_LABELS: Record<GeneId, string> = {
  LCT: 'Lactase persistence (digesting milk as an adult)',
  SLC45A2: 'Lighter skin',
  HERC2: 'Blue eyes',
  TYK2: 'TB risk',
  'HLA-DQ2': 'Coeliac-disease risk',
};

export const NORTH_SEA_LABEL = 'North Sea coast (early medieval)';

/** "Roman (n = 15)": every PCA layer label that shows its sample size (spec §6 rule 4). */
export function withN(label: string, n: number): string {
  return `${label} (n = ${n})`;
}

// ---- Hook and today's map (spec §3) ----
export const ME_HEADING = 'Example customer (made up for this demo, not a real person)';
export const ME_RESULT: ConsumerShare[] = [
  { label: 'British', share: 0.92 },
  { label: 'Scandinavian', share: 0.08 },
];
export const HOOK_QUESTION = 'Can a test like this tell us who lived in Britain long ago?';
export const PCA_CAPTION = 'North is up. Dots close together share more ancestry.';

// ---- Beat 1: Beaker arrival (spec §3, §6 rule 3) ----
export const BEAKER_CALLOUT =
  "At least 90% ± 2% of Britain's gene pool was replaced by the Middle Bronze Age (Olalde et al. 2018).";

/** Spec §3 bridging line. pct must be data.admixture.beaker_steppe_pct (a whole number 0-100). */
export function beakerBridge(pct: number): string {
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new RangeError(`beakerBridge: expected a whole percent, got ${pct}`);
  return `The newcomers were themselves part steppe herder, part farmer, so the steppe colour rises to ${pct}%, not 90%.`;
}

export const K_REFUSAL = "This workshop's run uses K = 3. Try run_admixture(K = 3).";

// ---- Beat 2: Romans (spec §6 rule 4) ----
export const ROMAN_CARD =
  'New rulers, roads and Latin — mostly the same people (Silva et al. 2026; Martiniano et al. 2016).';

// ---- Beat 3: Anglo-Saxons (spec §3, §6 rule 5) ----
export const ANGLO_SAXON_TAKEAWAY =
  'A real migration: eastern-England burials carry up to 76% continental ancestry (Gretzinger et al. 2022). ' +
  'Yet the Anglo-Saxon bar looks almost the same as the Iron Age and Roman bars, because a tool only sees differences its reference groups can tell apart.';

// ---- Beat 4: consumer DNA (spec §3, §5.3, §6 rule 8) ----
export const CONSUMER_NOTE =
  'These labels show where similar people live today, not who anyone\'s ancestors were. ' +
  'The reference set has no Dutch, German or Danish group, so "Scandinavian" stands in for the North Sea region. It does not mean Vikings. ' +
  'These labels are illustrative, not a measurement.';
export const CONSUMER_TAKEAWAY =
  'Consumer tests compare you with living people: AncestryDNA\'s reference panel is "people with long family histories in a particular region or group" (AncestryDNA Ethnicity Estimate 2023 white paper). ' +
  'Only ancient DNA reveals the turnovers.';

// ---- Traits (spec §5.4, §6 rule 6) ----
export const TRAIT_CAPTIONS = {
  LCT: 'Milk-digesting DNA spread after the Beaker newcomers arrived. In Britain, selection for it was about 0.08 when the Beaker people arrived, falling to about 0.02 later (Mathieson & Terhorst 2022), and stayed strong until about 100 generations ago (Colbran et al. 2026).',
  SLC45A2: 'Arrived with newcomers, then kept rising: migration first, then selection (Akbari et al. 2026).',
  HERC2: 'Blue-eye DNA jumps around the Anglo-Saxon period. Migration or selection? Probably both — and the Europe-wide signal is weak.',
  TYK2_AGES: "A variant that raises TB risk was common in the Bronze and Iron Ages, then fell. Kerner et al. 2021 date the start of strong selection against it to about 2,000 years ago, with 20% lower fitness for people with two copies; Akbari et al.'s curve puts the turn a little earlier, so the exact timing is uncertain. About 3% today; reported at about 4% in the UK.",
  TYK2_LOCAL: 'A variant that raises TB risk was common in Bronze and Iron Age Britain, then fell. Strong natural selection against it started about 2,000 years ago, with 20% lower fitness for people with two copies (Kerner et al. 2021). About 3% today in this British sample; other studies report about 4% in the UK.',
  'HLA-DQ2': 'The main coeliac-disease risk type rose from about 0% to about 20% over the last 4,000 years across West Eurasia (Akbari et al. 2026).',
} as const;

/** Spec §6 rule 6. TYK2 has two versions: one for the AGES curve and one for the local fallback. */
export function traitCaption(t: Trait): string {
  if (t.gene === 'TYK2') return t.source === 'ages' ? TRAIT_CAPTIONS.TYK2_AGES : TRAIT_CAPTIONS.TYK2_LOCAL;
  return TRAIT_CAPTIONS[t.gene];
}

export const AGES_SOURCE_LABEL = 'across West Eurasia, including Britain (Akbari et al. 2026, AGES)';
export const LOCAL_SOURCE_LABEL = 'Britain, computed from AADR data';

/** Spec §5.4 source labels. The HLA-DQ2 text card quotes Akbari et al.'s West Eurasian result, so it gets the AGES label. */
export function traitSourceLabel(t: Trait): string {
  return t.source === 'local' ? LOCAL_SOURCE_LABEL : AGES_SOURCE_LABEL;
}

/** Spec §5.4: the local 410-1066 point label. */
export const LOCAL_ANGLO_SAXON_POINT_LABEL = 'Anglo-Saxon period (includes some Viking-era burials)';

/** Spec §5.4: "about 10% (7 of 68)" for a local point with frequency f from n people. */
export function countNote(f: number, n: number): string {
  return `about ${Math.round(f * 100)}% (${Math.round(f * n)} of ${n})`;
}

export const HLA_TEXT_CARD =
  `${TRAIT_CAPTIONS['HLA-DQ2']} Today about 1 in 5 copies of this stretch of DNA carry it, and people with two copies are about 19 times more likely to get coeliac disease or gluten sensitivity (Akbari et al. 2026). ` +
  "Our British ancient-DNA data do not cover this spot, so there is no plot here: the numbers come from Akbari et al.'s West Eurasian study.";

// ---- Wrap (spec §3, §6 rule 7) ----
export const WRAP_LINE =
  'We are looking at the genetic family tree: the physical pattern of who is related to whom in the DNA. That holds no matter which timeline you use.';
export const WRAP_QR_CAPTION = 'Take the app home: scan the code or visit';
export const WRAP_CREDIT = 'WWU Biology · Walla Walla University';

// ---- Terminal (spec §4, §7) ----
export const RESTORED_NOTICE = 'Restored previous session — reload with ?reset to start fresh';
export const PREDICT_HINT = 'Predict: where will the Beaker newcomers land? Then run run_pca(period = "BellBeaker")';
export const HINT_PREFIX = 'Try: ';
export const HELP_LINES: string[] = [
  'Commands (type one, then press Enter):',
  '  help()                                      show this list',
  '  load_genomes()                              load the genomes',
  '  run_pca(period = "IronAge")                 map one period: Today, FirstFarmers, BellBeaker,',
  '                                              BronzeAge, IronAge, Roman, AngloSaxon, Viking or all',
  '  run_admixture(K = 3)                        ancestry bars for the periods you have mapped',
  '  run_admixture(K = 3, period = "BellBeaker") one thin bar per person in that period',
  '  allele_freq(gene = "LCT")                   a trait through time: LCT, SLC45A2, HERC2, TYK2, HLA-DQ2',
  '  ancestry_test(person = "me")                a consumer-style test: "me" or any period',
  '  clear()                                     clear the text (the plot stays)',
  'Keys: Tab completes, Up/Down shows earlier commands, Esc fills in the hint.',
];

// ---- Rule-test hook ----
function collect(v: unknown, out: string[]): void {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collect(x, out));
  else if (v !== null && typeof v === 'object') Object.values(v).forEach((x) => collect(x, out));
}

/** Every static string in this module plus every output of its text functions (spec §6 rule tests). */
export function allRenderableStrings(): string[] {
  const out: string[] = [];
  for (const value of Object.values(self)) {
    if (typeof value !== 'function') collect(value, out);
  }
  const sources: Trait['source'][] = ['ages', 'local', 'text'];
  for (const gene of GENE_IDS) {
    for (const source of sources) {
      if (source === 'text' && gene !== 'HLA-DQ2') continue;
      const t: Trait = { gene, rsid: '', variant_id: '', allele: '', source, points: [], present_day: null };
      out.push(traitCaption(t), traitSourceLabel(t));
    }
  }
  for (const pct of [0, 64, 100]) out.push(beakerBridge(pct));
  out.push(countNote(7 / 68, 68), withN(PERIOD_LABELS.Roman, 15));
  out.push(steppePctLabel(65), admixPeopleTitle(PERIOD_LABELS.BellBeaker, 64));
  return out;
}

// ---- Plot text (added by Task 12: bars, trajectories, router) ----
export const PLOT_EMPTY = 'Your plots will appear here.';
export function steppePctLabel(pct: number): string {
  return `${pct}% steppe`;
}
export function admixPeopleTitle(label: string, n: number): string {
  return `${label}: one bar per person (n = ${n})`;
}
export const TRAIT_Y_LABEL = 'How common the variant is';
