// Every on-screen string lives here (spec §6, v3 §3). tests/content.test.ts scans allRenderableStrings()
// with tests/contentRules.ts, so any string added to this file is checked automatically.
import * as self from './content';
import type { AxisTick, ChipIcon, ChipKey, ConsumerShare, GeneId, MapGroupId, PeriodId, SourceId, Trait } from './types';
import { GENE_IDS, MAP_GROUP_IDS } from './types';
import { ALL_OFF, ALL_ON, FEATURES, type Features } from './features';

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

/** Open check 1 (spec v3 §11) passed: Silva et al. 2026 is shown. false selects every §3.3 fallback string. */
export const SILVA_2026_SHOWN: boolean = true;

// ---- Hook and today's map (spec §3) ----
export const ME_HEADING = 'Example customer (made up for this demo, not a real person)';
export const ME_RESULT: ConsumerShare[] = [
  { label: 'British', share: 0.92 },
  { label: 'Scandinavian', share: 0.08 },
];
export const HOOK_QUESTION = 'Can a test like this tell us who lived in Britain long ago?';
export const PCA_CAPTION = 'North is up. Dots close together share more ancestry.';

// ---- v3 §3.5: PCA captions, zoom note, legend headings ----
export const EUROPE_CAPTION = 'Each dot is a person living in Europe today. Britain is held back for now.';
/** Every British-frame PCA shows this in the caption strip; z = zoomFactor(data) (5 on the real data). */
export function zoomNote(z: number): string {
  return `Zoomed in about ${z}× on Britain`;
}
export const REVEAL_PCA_CAPTION =
  "Britain today lands right on top of the Iron Age cloud: much of the Iron Age people's DNA is still here. " +
  '(Our Britain today people come from England and Scotland, including Orkney; none are from Wales.)';
export const FINALE_CAPTION =
  'Every period, oldest first. The Beaker people and the Anglo-Saxons brought new people: DNA changed. ' +
  'The Romans brought new ideas to mostly the same families: culture changed, DNA barely did. ' +
  'Britain today arrives last, close to the Iron Age and later Britons.';
export const ROMAN_FOCUS_CAPTION = 'New rulers, mostly the same families: culture changed, DNA barely did';
export const LEGEND_ANCIENT = 'Ancient Britons';
export const LEGEND_LIVING = 'People living today';

// ---- v3 §3.5 chip rule: every chip starts "DNA changed" (double-helix icon) or "Culture changed" (pot icon) ----
export const CHIP_DNA_CHANGED = 'DNA changed: new people';
export const CHIP_CULTURE_CHANGED = 'Culture changed: new things';
export const CHIP_DNA_SLIGHT = 'DNA changed, but only slightly';
export const CHIP_CULTURE_ONLY = 'Culture changed, DNA did not: new ideas, same people';
export const CHIP_ROMAN = 'Culture changed, DNA barely did: new ideas, mostly the same people';
export const CHIP_DNA_CHANGED_EAST = 'DNA changed, most of all in the east: new people';
export const CHIP_TEXT: Readonly<Record<ChipKey, string>> = {
  CHIP_DNA_CHANGED,
  CHIP_CULTURE_CHANGED,
  CHIP_DNA_SLIGHT,
  CHIP_CULTURE_ONLY,
  CHIP_ROMAN,
  CHIP_DNA_CHANGED_EAST,
};
/** The icon follows the stem, so a chip can be read without colour (spec v3 §3.5, rule 13). */
export function chipIcon(key: ChipKey): ChipIcon {
  const text = CHIP_TEXT[key];
  if (text?.startsWith('DNA changed')) return 'dna';
  if (text?.startsWith('Culture changed')) return 'pot';
  throw new Error(`chipIcon: ${String(key)} does not start with "DNA changed" or "Culture changed"`);
}

// ---- Beat 1: Beaker arrival (spec v3 §3.2, rule 3). The v2.1 bridge line is deleted everywhere. ----
export const BEAKER_CALLOUT =
  "Within about ten generations of the Beaker people arriving, at least 9 in 10 parts of Britain's DNA came from the newcomers. " +
  "The First farmers / Stonehenge builders' share shrank to about 1 in 10 or less (Olalde et al. 2018).";

export const K_REFUSAL = "This workshop's run uses K = 3. Try run_admixture(K = 3).";

// ---- The reveal (spec v3 §3.3) ----
export const REVEAL_CALLOUT =
  "Most of Britain's ancestry today was already here by the Iron Age. " +
  'Later, Anglo-Saxon newcomers added a sizeable share, most of it in eastern England (Gretzinger et al. 2022).';
/** t and i are whole steppe percents from data.admixture.bars (Today and IronAge); 56 and 57 on the current build. */
export function revealNote(t: number, i: number): string {
  return `Britain today: ${t}% steppe. Iron Age: ${i}% steppe. Of all the periods, the Iron Age bar is the closest match.`;
}

// ---- Romans (spec v3 §3.3, §3.5) ----
/** The run_pca(period = "Roman") log line (replaces the v2.1 Roman card). */
export const ROMAN_LOG_LINE: string = SILVA_2026_SHOWN
  ? 'New rulers, mostly the same families (Silva et al. 2026; Scheib et al. 2024; Martiniano et al. 2016).'
  : 'New rulers, mostly the same families (Scheib et al. 2024; Martiniano et al. 2016).';

// ---- Anglo-Saxons (spec v3 §3.5, rule 5) ----
export const ANGLO_SAXON_TAKEAWAY =
  'A real migration: Anglo-Saxon-period burials sampled in England carry about 76% continental ancestry on average (Gretzinger et al. 2022). ' +
  "Yet the Anglo-Saxon bar looks almost the same as the Iron Age bar: both groups were part steppe herder, part farmer, so this three-colour test can't tell them apart.";
/** PCA legend item (src/plots/pca.ts) for the black-outlined Anglo-Saxon points flagged as eastern England. */
export const EAST_ENGLAND_LEGEND = 'Anglo-Saxon burials, eastern England (outlined)';

// ---- Beat 4: consumer DNA (spec §3, §5.3, §6 rule 8; v3 §3.3) ----
/** The one sentence of CONSUMER_NOTE that the hook screen (ancestry_test(person = "me")) shows; the rest is the Beat 4 debrief. */
export const HOOK_NOTE = 'These labels are illustrative, not a measurement.';
export const CONSUMER_NOTE =
  'These labels show where similar people live today, not who anyone\'s ancestors were. ' +
  'The reference set has no Dutch, German or Danish group, so "Scandinavian" stands in for the North Sea region. It does not mean Vikings. ' +
  HOOK_NOTE;
export const CONSUMER_TAKEAWAY =
  'Consumer tests compare you with living people: AncestryDNA\'s reference panel is "people with long family histories in a particular region or group" (AncestryDNA Ethnicity Estimate 2023 white paper). ' +
  'Only ancient DNA reveals the turnovers.';
/** The terminal heading of a period's consumer result; also the consumer-bars plot title (Task 18). */
export function consumerTitle(label: string, n: number): string {
  return `Consumer-style ancestry test: ${label} (${n} people)`;
}
export const CONSUMER_PLOT_SUBTITLE = 'Compared with people living in Europe today';
export const CONSUMER_PLOT_NOTE = "These labels show where similar people live today, not who anyone's ancestors were.";

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

/** Spec v3 §3.4: the HLA text card (fallback only). Akbari's "19-fold" conflicts with its own figure legend, so it gives no number. */
export const HLA_TEXT_CARD =
  `${TRAIT_CAPTIONS['HLA-DQ2']} Today about 1 in 5 copies of this stretch of DNA carry it, and people with two copies are much more likely to get coeliac disease or gluten sensitivity (Akbari et al. 2026). ` +
  "Our British ancient-DNA data do not cover this spot, so there is no plot here: the numbers come from Akbari et al.'s West Eurasian study.";
/** Spec v3 §3.4 L-reveal: a second caption line under the HLA-DQ2 trajectory (drawn by Task 9). */
export const HLA_REVEAL_LINE =
  'One leading idea, still a hypothesis: immune versions like this helped people fight infections, and coeliac disease is the price a few people pay (Zhernakova et al. 2010; Akbari et al. 2026).';

// ---- Wrap (spec §3, §6 rule 7) ----
export const WRAP_LINE =
  'We are looking at the genetic family tree: the physical pattern of who is related to whom in the DNA. That holds no matter which timeline you use.';
export const WRAP_QR_CAPTION = 'Take the app home: scan the code or visit';
export const WRAP_CREDIT = 'WWU Biology · Walla Walla University';

// ---- Terminal (spec §4, §7; v3 §3.5) ----
export const RESTORED_NOTICE = 'Restored previous session — reload with ?reset to start fresh';
export const PREDICT_HINT = 'Predict: where will the Beaker newcomers land? Then run run_pca(period = "BellBeaker")';
export const REVEAL_HINT = 'Predict: where will Britain today land? Then run run_pca(period = "Today")';
/** The hint line while a card is open. The controller shows it (Task 6); hintText never returns it. */
export const CARD_HINT = 'Press Enter to continue (or click Continue).';
export const HINT_PREFIX = 'Try: ';

// ---- Cards, buttons and credits (v3 §3.5) ----
export const BACK_BUTTON = 'Back';
export const BACK_BUTTON_LABEL = 'Back one screen';
export const CARD_CONTINUE = 'Continue';
export const CARD_CONTINUE_TO_PLOT = 'Show the plot';
export const CARD_CONTINUE_DONE = 'See the plot';
/** "2 of 3"; i is 1-based. */
export function cardCounter(i: number, n: number): string {
  return `${i} of ${n}`;
}
export const CREDITS_LINK = 'Image credits';
export const CREDITS_TITLE = 'Image and data credits';
export const CREDITS_CLOSE = 'Close';
export const CREDITS_FOOTER =
  'Map outlines: Made with Natural Earth (public domain). Allele frequencies: 1000 Genomes Project; gnomAD; Akbari et al. 2026 (AGES). ' +
  "Lactase data: Liebert et al. 2017, Human Genetics (CC BY 4.0). The app's code licence does not cover these images; each keeps its own licence.";

// ---- Terminal log lines (v3 §3.5, CONTRACT §4.1). commands.ts imports them, so the content scan reaches them. ----
/** load_genomes(); n = logs.pca_people_unique rounded to 10 (wired by Task 7). */
export function mapAxesLine(n: number): string {
  return `Map axes: built from about ${n} present-day Europeans. Britons are left out, then placed on the map the same way as ancient Britons.`;
}
/** Every run_pca (wired by Task 7). */
export function axesLine(n: number): string {
  return `Axes: about ${n} present-day Europeans. Britons are left out, then placed on the map the same way as ancient Britons.`;
}
/** run_pca(period = "Europe") (wired by Task 4): the map-group labels in map_groups order. */
export function europeProjectingLine(labels: string[]): string {
  return `Projecting present-day Europeans onto the axes: ${labels.length} map groups (${labels.join(', ')})`;
}
export const EUROPE_HELD_BACK = 'Britain today: held back for now.';
export const EUROPE_ALREADY_SHOWN = 'Britain today: already on the map.';
export const TODAY_PLACED = 'Britain today: placed on the map the same way as the ancient Britons.';
export const ALL_PROJECTING = 'Projecting every period onto the axes, oldest first:';
export const ALL_TODAY_LAST = 'Britain today: placed last.';
export const ADMIX_TODAY_HIDDEN = 'Britain today is not shown yet.';
export const ADMIX_TODAY_SHOWN = 'Now with Britain today.';
/** Appended to ancestry_test(...) only with features.consumerBars (Task 18). */
export const CONSUMER_BARS_LOG = 'Drawing the result as bars.';

// ---- help() (v3 §3.5) ----
// Every line is at most 60 characters: the terminal pane is about 69 characters wide at 1366 x 768, and a longer line wraps
// under its own command. Each command has a line to itself with its description indented below it (tests/content.test.ts).
/** help() for a flag set: " (bars)" only with consumerBars, the Back line only with back (spec v3 §3.5, §10.3). */
export function helpLines(features: Features = FEATURES): string[] {
  return [
    'Commands (type one, then press Enter):',
    '  help()',
    '      show this list',
    '  load_genomes()',
    '      load the genomes',
    '  run_pca(period = "IronAge")',
    '      map one period: Europe, FirstFarmers, BellBeaker,',
    '      BronzeAge, IronAge, Roman, AngloSaxon, Viking,',
    '      Today or all',
    '  run_admixture(K = 3)',
    '      ancestry bars for the periods you have mapped',
    '  run_admixture(K = 3, period = "BellBeaker")',
    '      one thin bar per person in that period',
    '  allele_freq(gene = "LCT")',
    '      a trait through time: LCT, SLC45A2, HERC2,',
    '      TYK2, HLA-DQ2',
    '  ancestry_test(person = "me")',
    `      a consumer-style test: "me" or any period${features.consumerBars ? ' (bars)' : ''}`,
    '  clear()',
    '      clear the text (the plot stays)',
    'Keys: Tab completes, Up/Down shows earlier commands,',
    '      Esc fills in the hint.',
    ...(features.back ? ['      Back button: step back one screen.'] : []),
  ];
}
/** help() as shipped (CONTRACT §4.1: stays exported and equals helpLines(FEATURES)). */
export const HELP_LINES: string[] = helpLines(FEATURES);

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
  out.push(countNote(7 / 68, 68), withN(PERIOD_LABELS.Roman, 15));
  out.push(steppePctLabel(65), admixPeopleTitle(PERIOD_LABELS.BellBeaker, 64));
  out.push(zoomNote(5), revealNote(56, 57), cardCounter(2, 3), consumerTitle(PERIOD_LABELS.IronAge, 371));
  out.push(mapAxesLine(950), axesLine(950), europeProjectingLine(MAP_GROUP_IDS.map((id) => MAP_GROUP_LABELS[id])));
  out.push(...helpLines(ALL_ON), ...helpLines(ALL_OFF));
  out.push(...SHELL_STRINGS);
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

// ---- Shell strings (Task 13); APP_TITLE, WRAP_QR_CAPTION and WRAP_CREDIT are declared above (Task 6) ----
export const WRAP_BUTTON = 'Take this home';
export const WRAP_CLOSE = 'Back to the terminal';
export const SHELL_STRINGS: string[] = [APP_TITLE, WRAP_BUTTON, WRAP_QR_CAPTION, WRAP_CREDIT, WRAP_CLOSE];
