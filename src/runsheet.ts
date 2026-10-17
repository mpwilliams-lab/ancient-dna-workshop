// Builds the instructor run sheet (D/docs/run-sheet.md) from the same script, cards, strings and data the app uses.
// Say-lines (spec §3.6) live ONLY here: no module under src/ imports this file, so they never reach the screen
// (tests/runsheet-content.test.ts checks the import graph, allRenderableStrings() and the built page).
import type { CardId, ConsumerShare, PeriodId, StepId, WorkshopData } from './types';
import type { Command } from './parser';
import { formatCommand } from './parser';
import { EXTRA_PREFIX, EXTRAS, NEXT_PREFIX, SCRIPT, SCRIPT_STEPS } from './hints';
import { CARDS, cardVars } from './cards';
import { execute, round10, roundPercents } from './commands';
import { INITIAL_PLOT, reducePlot, steppePct } from './plotState';
import {
  CARD_HINT, CONSUMER_TAKEAWAY, HOOK_QUESTION, ME_RESULT, NORTH_SEA_LABEL, PAGES_URL, PERIOD_LABELS, PREDICT_HINT, RESTORED_NOTICE,
  REVEAL_HINT, traitCaption, traitSourceLabel, WRAP_BUTTON, WRAP_CLOSE, WRAP_LINE,
} from './content';

/** The live site. Re-exported from content.ts so the sheet always names the address the wrap screen and QR code use. */
export { PAGES_URL };
export const OFFLINE_NAME = 'ancient-dna-workshop.html';

/** The exported offline file as it was when the sheet was generated: its size in bytes and its sha256 (64 lower-case hex digits). Read by the CLI, never typed. */
export interface OfflineFileInfo { bytes: number; sha256: string }

function isOfflineFileInfo(x: unknown): x is OfflineFileInfo {
  if (x === null || typeof x !== 'object') return false;
  const { bytes, sha256 } = x as Partial<Record<keyof OfflineFileInfo, unknown>>;
  return typeof bytes === 'number' && Number.isInteger(bytes) && bytes >= 0 && typeof sha256 === 'string' && /^[0-9a-f]{64}$/.test(sha256);
}

export interface Beat { index: number | null; id: StepId | 'wrap'; min: number; title: string; commands: Command[]; cards: CardId[]; say: string[] }

/** Spec §2.1 minutes (instructor talk included). 19 steps + wrap = 48.5. */
export const STEP_MINUTES: Readonly<Record<StepId | 'wrap', number>> = {
  hook: 1.5, load: 0.5, europe: 3.0, firstFarmers: 3.0, bellBeaker: 3.0, admix1: 4.0, bronzeAge: 1.0, ironAge: 4.0,
  consumerIA: 1.5, revealPca: 1.5, revealAdmix: 1.0, roman: 3.0, angloSaxon: 3.5, finale: 2.0, lct: 3.5, slc45a2: 2.5,
  herc2: 3.0, tyk2: 2.5, hla: 3.0, wrap: 1.5,
};

/** Instructor-facing beat names (never on screen). */
export const BEAT_TITLES: Readonly<Record<StepId | 'wrap', string>> = {
  hook: 'Hook: a consumer DNA test',
  load: 'Load the genomes',
  europe: 'Europe first: genes mirror geography',
  firstFarmers: 'First farmers / Stonehenge builders',
  bellBeaker: 'The Beaker newcomers',
  admix1: 'First ADMIXTURE: the Beaker turnover',
  bronzeAge: 'Bronze Age',
  ironAge: 'Iron Age',
  consumerIA: 'A consumer test for the Iron Age',
  revealPca: 'Reveal: Britain today on the map',
  revealAdmix: 'Reveal: Britain today in the bars',
  roman: 'Romans',
  angloSaxon: 'Anglo-Saxons',
  finale: 'Finale: every period',
  lct: 'Milk (LCT)',
  slc45a2: 'Skin colour (SLC45A2)',
  herc2: 'Eye colour (HERC2)',
  tyk2: 'TB risk (TYK2)',
  hla: 'Coeliac risk (HLA-DQ2)',
  wrap: 'Wrap',
};

/** Spec §3.6 instructor-only say-lines, verbatim. Never on screen. */
export const SAY_LINES: Readonly<Partial<Record<StepId | 'when' | 'richard3FatherLine' | 'traitPuzzle', string[]>>> = {
  firstFarmers: ['The Beaker newcomers later buried their dead in round mounds around Stonehenge and beside Thornborough. Nobody is sure exactly when Brodgar and Castlerigg were built.'],
  bellBeaker: [
    "These are real people's graves, shown in a museum. We treat them with respect.",
    'Same burial rules, flipped: in central Europe, Corded Ware men were laid on their right side and Beaker men on their left (Bourgeois & Kroon 2017; Fokkens & Nicolis 2012).',
    'The bell-beaker pot style probably began in Portugal, among people with little steppe ancestry, and spread mostly as an idea (Olalde et al. 2018; Fokkens & Nicolis 2012).',
    "The Amesbury Archer's DNA has more farmer ancestry than most Beaker people buried around him (Patterson et al. 2022).",
  ],
  admix1: [
    "The Beaker newcomers were themselves part steppe, part farmer, so their steppe colour is smaller than 9 in 10. The callout is about the Stonehenge builders' own families.",
    'In Britain the father-lines changed about as much as the rest of the DNA. In Spain and Portugal, nearly all father-lines changed but under half of the rest of the DNA (Olalde et al. 2019).',
  ],
  ironAge: [
    'The cloud looks bigger because we zoomed in. Card 3 explains.',
    "One real difference: people buried in southern England sit a little closer to the French newcomers than people buried in Scotland (this workshop's data).",
  ],
  revealPca: ['Before you press Enter: where will Britain today land?'],
  roman: ['Some archaeologists think men buried in that York cemetery may have been gladiators or soldiers; nobody knows for sure.'],
  angloSaxon: [
    'Men and women both came: no sign that more men than women moved (Gretzinger et al. 2022).',
    "Three colours can't tell Anglo-Saxon newcomers from Iron Age Britons; the PCA can.",
    'In Orkney, Viking newcomers from Norway added some ancestry too (Leslie et al. 2015).',
  ],
  traitPuzzle: ['Hands up: flat? rising? falling? up then down?'],
  lct: ['People in Europe used milk long before most adults could digest it. The switch seems to have mattered most in famines and epidemics, when a stomach upset could be deadly (Evershed et al. 2022).'],
  slc45a2: [
    "Scientists' leading idea: lighter skin was a real advantage in cloudy northern Europe over the last 4,000 years (Mathieson & Terhorst 2022; Akbari et al. 2026). Of the skin-colour genes, this one shows the strongest sign of natural selection in Europe (Ju & Mathieson 2021).",
    'Skin colour is set by many genes. This one letter tells us about sunlight and vitamin D, nothing else.',
  ],
  tyk2: ['The same version seems to protect against some illnesses where the body attacks itself. It became common mainly because newcomers who carried it moved in and mixed, not because it helped. Since Roman times, TB seems to have made it rarer (Kerner et al. 2021).'],
  when: ['In this workshop we follow the order of events and generations, not dates. Happy to talk about how scientists estimate dates afterwards.'],
  richard3FatherLine: ["It didn't match the relatives they tested. Over many generations, family trees on paper and in DNA don't always agree, which is why scientists used several clues together."],
};

/** Spec §3.6 freeze text: the lead of "Freeze and verify". */
export const FREEZE_TEXT =
  "Code freeze Wed 21 Oct 20:00 PT. The offline file's size and SHA-256 are recorded here. No code changes or hotfixes 22–24 Oct: note problems below and handle them by voice.";
/** Spec §3.6 dry-run line. */
export const DRY_RUN_CHECK = 'Timed dry run through the wrap (Wed 21): must land 45–50 minutes.';

/** Spec §2.1 timing rule. */
export const TIMING_RULE: readonly string[] = [
  'Target 48.5 minutes, inside a 45–50 minute window. The clock runs from the first typed command to the end of the wrap.',
  'Open the file and reload with ?reset on every station before each group sits down; seating is outside the clock. Hold questions to the wrap and take them after it.',
  "Mon 19 timings are taken with text-only cards. Add 15% to each card step's measured time before comparing with the window.",
  'If the adjusted Mon 19 time or the Wed 21 dry run exceeds 50 minutes, cut in this order until it fits, and record each cut here. Cards are never reordered.',
];

/** Spec §2.1 cuts 1-8, in order, with their minutes. Cuts 1-3 and 5-8 are instructor actions; cut 4 is a code change. */
export const TIMING_CUTS: readonly string[] = [
  'A1 shown only as a 30-second look, no discussion (−0.5).',
  'E3 skipped by the instructor (Enter straight through) (−0.5).',
  'K2 and L3 shown without the puzzle discussion (−1.0).',
  'BronzeAge step removed from `SCRIPT` (it stays runnable as an extra). This is a code change: it lands by Wed 17:00 with tests green (−1.0).',
  'J2 and L2 shown for 10 s each, no discussion (−1.5).',
  'E2 skipped (−1.0).',
  'K1 and K2 skipped; only the TYK2 plot is discussed (−1.5).',
  'A1 skipped (−1.0 more).',
];

export interface OpenCheck { n: number; check: string; status: string; gates: string; ifFails: string }

/**
 * Spec §11 open checks, with the status of 2026-10-16. `npm run run-sheet` rewrites the whole sheet, so a status that changes
 * is changed here, not by hand in the generated file.
 * Check 5 carries O1 (settled): the build writes 1000 Genomes Britain as 5 copies = 0.02747, which card K2 shows as 2.7.
 * Check 17 states Kerner's date with the one allowed phrase (about 2,000 years ago), so the sheet passes the on-screen rules.
 */
export const OPEN_CHECKS: readonly OpenCheck[] = [
  { n: 1, check: 'Silva et al. 2026 preprint: 259 Roman-period people; 71% (80% with a second local source) modelled fully as Iron Age Britain; outsiders mostly at urban, military and elite sites; rural influence "sporadic, albeit seemingly minor".', status: 'Passes (science review); the instructor may confirm against the bioRxiv PDF', gates: 'F1 bullets 1–2; G1 bullet 2; Roman log line', ifFails: 'Spec §3.3 fallback text; Silva dropped from the log line and G1' },
  { n: 2, check: 'Patterson et al. 2022 says nothing about sex bias in the Beaker arrival.', status: 'Passes for the main text; supplement not read, nothing on screen depends on it', gates: 'Confirms D2 cites only Olalde 2018/2019', ifFails: 'Nothing changes' },
  { n: 3, check: 'Beethoven claims against Begg et al. 2023 and Wesseldijk et al. 2024 (9th percentile); whether the evec Beethoven rows are the Begg 2023 genome (post-event dot only).', status: 'Passes; the evec identity question stays open, post-event only', gates: 'L2', ifFails: 'Drop the failing bullet; if two or more fail, drop L2 (the step keeps L1 and L3)' },
  { n: 4, check: 'SLC45A2 change written L374F (rs16891982).', status: 'Passes', gates: 'I1 bullet 2', ifFails: 'Remove "(scientists write it L374F)"' },
  { n: 5, check: 'TYK2 values: gnomAD nfe 0.044 (2,990 copies), gnomAD fin 0.0287 (305), 1000G GBR 0.02747 (5 copies; card K2 shows 2.7); the TYK2 caption stays consistent with the AGES present day 0.0343.', status: 'Passes; Pakistan dropped (1 copy)', gates: 'K2', ifFails: 'Show only the values that check out' },
  { n: 6, check: 'Zero rows are true 1000 Genomes zeros (rs16891982 JPT, YRI; rs12913832 and rs34536443 CHB, JPT, YRI, LWK).', status: 'Passes (Ensembl REST); the build snapshots the Ensembl records', gates: 'I2, J3, K2 zero values', ifFails: 'Omit that population' },
  { n: 7, check: 'Akbari "19-fold" conflicts with its figure legend.', status: 'Resolved: "much more likely", no number', gates: 'HLA text card', ifFails: '—' },
  { n: 8, check: 'HLA-DQ2 distribution drawn for Europe only.', status: 'Resolved by design', gates: 'L3', ifFails: '—' },
  { n: 9, check: 'Monument one-liners and the B1 say-line against the English Heritage and Historic Environment Scotland pages.', status: 'Open', gates: 'B1, step 3 say-line', ifFails: 'Shorten the failing line to the monument name and county' },
  { n: 10, check: '1000 Genomes GBR sampling description vs the AADR localities.', status: 'Unresolved but no longer gating (the reveal caption says only "England and Scotland, including Orkney; none from Wales")', gates: '—', ifFails: '—' },
  { n: 11, check: 'Every image and map viewed by the instructor at projector size against the §7.2 list; visual_check filled by him.', status: 'Open (Mon 19–Wed 21)', gates: 'All image tiles and maps', ifFails: 'Fallback image, else the tile or map falls back to text' },
  { n: 12, check: 'Itan 2010 "about 65%"; Liebert 2017 values match the CSV.', status: 'Passes (H2 uses f_13910T)', gates: 'H1 bullet 2, H2', ifFails: '—' },
  { n: 13, check: 'Time wording in the Beaker callout.', status: 'Resolved: "within about ten generations"; a vitest pins the callout', gates: 'Callout', ifFails: '—' },
  { n: 14, check: 'A1 map labels: the 8 map_label groups from the data build.', status: 'Open until the europe_pops run (Sun 18 or Mon 19)', gates: 'A1 labels', ifFails: 'The map ships unlabelled' },
  { n: 15, check: "The LCT trajectory's present-day value is below 0.75 (H2 line 3).", status: 'Open, as a vitest at P1', gates: 'H2 line 3', ifFails: 'Line 3 becomes "The next plot follows this letter across all of West Eurasia."' },
  { n: 16, check: 'Gretzinger 2022: present-day English ancestry 25–47% early-medieval-continental-like ("about a quarter to a half").', status: 'Passes', gates: 'G1 bullet 3', ifFails: 'Drop the numbers: "people in England today carry only part of this ancestry"' },
  { n: 17, check: 'Kerner 2021 negative selection on TYK2 P1104A starting about 2,000 years ago ("since Roman times").', status: 'Passes', gates: 'Step 17 say-line only', ifFails: '—' },
];

/**
 * A consumer result as the terminal prints it: highest share first, whole percents by largest remainder (commands.ts
 * roundPercents, the same call as the terminal's bar lines). One rounding rule, so what the instructor reads out from the
 * sheet is what is on the projector.
 */
function shownShares(rows: ConsumerShare[] | undefined): { label: ConsumerShare['label']; pct: number }[] {
  const sorted = [...(rows ?? [])].sort((a, b) => b.share - a.share);
  const pcts = roundPercents(sorted.map((r) => r.share));
  return sorted.map((r, i) => ({ label: r.label, pct: pcts[i] ?? 0 }));
}
function share(rows: ConsumerShare[] | undefined, label: ConsumerShare['label']): number {
  return shownShares(rows).find((r) => r.label === label)?.pct ?? 0;
}
function top(rows: ConsumerShare[] | undefined): string {
  const r = shownShares(rows)[0];
  return r ? `${r.label} (${r.pct}%)` : 'none';
}
function n(data: WorkshopData, id: PeriodId): number {
  return data.periods.find((p) => p.id === id)?.n_pca ?? 0;
}
/** Whole-percent steppe share of a period's bar, by the app's own steppePct (bar labels, reveal note and this sheet agree). */
function steppeOf(data: WorkshopData, id: PeriodId): number {
  const bar = data.admixture.bars.find((b) => b.period === id);
  return bar ? steppePct(bar) : 0;
}
function listOf(labels: string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** The bars the revealAdmix step outlines as new, replayed through the app's own execute + reducePlot. */
export function outlinedAtReveal(data: WorkshopData): PeriodId[] {
  const k = SCRIPT_STEPS.findIndex((s) => s.id === 'revealAdmix');
  if (k < 0) return [];
  let plot = INITIAL_PLOT;
  for (const c of SCRIPT.slice(0, k + 1)) plot = reducePlot(plot, execute(c, data).plot, data);
  return plot.admixNew;
}

/** The last card of a step (the puzzle card of a trait step). */
function lastCard(id: StepId): CardId | undefined {
  return SCRIPT_STEPS.find((s) => s.id === id)?.cards?.ids.at(-1);
}

function traitLines(data: WorkshopData, gene: string, id: StepId, after: readonly string[] = []): string[] {
  const t = data.traits.find((x) => x.gene === gene);
  const out = [`*At the puzzle card (${lastCard(id) ?? '?'}), before anyone presses Enter:*`, ...(SAY_LINES.traitPuzzle ?? [])];
  if (after.length > 0) out.push('*After the plot:*', ...after);
  if (t) out.push(t.source === 'text' ? `Plot caption: ${traitCaption(t)} (text card)` : `Plot caption: ${traitCaption(t)} [${traitSourceLabel(t)}]`);
  return out;
}

function sayFor(id: StepId | 'wrap', data: WorkshopData): string[] {
  const v = cardVars(data);
  const me = shownShares(ME_RESULT).map((r) => `${r.pct}% ${r.label}`).join(', ');
  switch (id) {
    case 'hook':
      return [`On screen: an example customer's result (${me}).`, `Ask: "${HOOK_QUESTION}" Hold on to that question.`];
    case 'load':
      return [`load_genomes() loads real ancient and modern genomes: ${data.logs.snps_used.toLocaleString('en-US')} DNA positions. The map's axes come from about ${round10(data.logs.pca_people_unique)} present-day Europeans; Britons are placed on it afterwards.`];
    case 'europe':
      return ['Only present-day Europeans so far: Britain today is held back. The A1 card opens when the log ends.'];
    case 'firstFarmers':
      return [...(SAY_LINES.firstFarmers ?? []), `The hint line now reads "${PREDICT_HINT}". Ask the room to predict before anyone presses Enter.`];
    case 'bellBeaker':
      return [...(SAY_LINES.bellBeaker ?? [])];
    case 'admix1':
      return [`The bars show ${PERIOD_LABELS.FirstFarmers} and ${PERIOD_LABELS.BellBeaker} only.`, ...(SAY_LINES.admix1 ?? [])];
    case 'bronzeAge':
      return [`The view zooms in on Britain: the caption strip says about ${v.zoom}× (this workshop's data).`];
    case 'ironAge':
      return [...(SAY_LINES.ironAge ?? [])];
    case 'consumerIA':
      return [
        `If ${PERIOD_LABELS.IronAge} Britons took a consumer test, ${share(data.consumer.IronAge, 'British')}% would be called "British" (this workshop's data).`,
        `The hint line now reads "${REVEAL_HINT}".`,
      ];
    case 'revealPca':
      return [...(SAY_LINES.revealPca ?? [])];
    case 'revealAdmix': {
      const labels = outlinedAtReveal(data).map((p) => PERIOD_LABELS[p]);
      return [
        `The bars added since the first ADMIXTURE run are outlined: ${listOf(labels)}.`,
        `${PERIOD_LABELS.Today}: ${steppeOf(data, 'Today')}% steppe; ${PERIOD_LABELS.IronAge}: ${steppeOf(data, 'IronAge')}% steppe (this workshop's data).`,
      ];
    }
    case 'roman':
      return [
        `The ${PERIOD_LABELS.Roman} layer is small (n = ${n(data, 'Roman')}) and lands inside the ${PERIOD_LABELS.IronAge} cloud.`,
        '*Only if a student asks about the York man:*',
        ...(SAY_LINES.roman ?? []),
        '*Do not mention how they were buried.*',
      ];
    case 'angloSaxon':
      return [...(SAY_LINES.angloSaxon ?? [])];
    case 'finale':
      return ['Every period appears, oldest first; Britain today comes last.'];
    case 'lct':
      return traitLines(data, 'LCT', id, SAY_LINES.lct);
    case 'slc45a2':
      return traitLines(data, 'SLC45A2', id, SAY_LINES.slc45a2);
    case 'herc2':
      return traitLines(data, 'HERC2', id);
    case 'tyk2':
      return traitLines(data, 'TYK2', id, SAY_LINES.tyk2);
    case 'hla':
      return traitLines(data, 'HLA-DQ2', id);
    case 'wrap':
      return [`Everyone clicks "${WRAP_BUTTON}" (top right) to show the QR code.`, WRAP_LINE, 'WWU Biology: point to the QR code to take the app home.'];
  }
}

/** The 19 guided steps of spec §2.1 (from hints.SCRIPT / SCRIPT_STEPS) plus the wrap. */
export function beats(data: WorkshopData): Beat[] {
  const out: Beat[] = SCRIPT.map((cmd, i) => {
    const step = SCRIPT_STEPS[i];
    if (!step) throw new Error(`SCRIPT_STEPS has no step ${i}`);
    return {
      index: i, id: step.id, min: STEP_MINUTES[step.id], title: BEAT_TITLES[step.id], commands: [cmd],
      cards: [...(step.cards?.ids ?? [])], say: sayFor(step.id, data),
    };
  });
  out.push({ index: null, id: 'wrap', min: STEP_MINUTES.wrap, title: BEAT_TITLES.wrap, commands: [], cards: [], say: sayFor('wrap', data) });
  return out;
}

/** Every line the instructor may read aloud, cues included (checked against spec §6 rule 1 in tests). */
export function sayLines(data: WorkshopData): string[] {
  return [...beats(data).flatMap((b) => b.say), ...(SAY_LINES.when ?? []), ...(SAY_LINES.richard3FatherLine ?? [])];
}

const cell = (s: string): string => s.replace(/\|/g, '\\|');

/** The AncestryDNA definition the app quotes in CONSUMER_TAKEAWAY, without its quote marks. Fails loudly if content.ts changes shape. */
function ancestryPanelQuote(): string {
  const quoted = /"([^"]+)"/.exec(CONSUMER_TAKEAWAY);
  if (!quoted) throw new Error('CONSUMER_TAKEAWAY no longer quotes the AncestryDNA definition; update src/runsheet.ts');
  return quoted[1]!;
}

const fmtMin = (m: number): string => String(m);

/**
 * The whole sheet as Markdown. `offlineFile` is the exported offline file's size and sha256, read by the CLI when the sheet is
 * generated (scripts/runsheet-cli.ts). Without it (null, undefined or a damaged record) "Freeze and verify" prints a warning
 * line in place of the numbers; the sheet itself is still built.
 */
export function buildRunSheet(data: WorkshopData, generatedAt: string, offlinePath: string, offlineFile?: OfflineFileInfo | null): string {
  const sourceOf = (g: string) => data.traits.find((t) => t.gene === g)?.source ?? 'missing';
  const v = cardVars(data);
  const all = beats(data);
  const total = Math.round(all.reduce((s, b) => s + b.min, 0) * 10) / 10;
  const L: string[] = [];
  L.push('---');
  L.push('title: Ancient DNA of Britain — Instructor Run Sheet');
  L.push('status: draft');
  L.push(`generated: { by: agent/ClaudeCode, at: ${generatedAt} }`);
  L.push('stale_after: 2026-10-25');
  L.push('sources:');
  L.push('  - docs/superpowers/specs/2026-10-16-ancient-dna-workshop-v3-design.md');
  L.push('  - docs/superpowers/specs/2026-10-15-ancient-dna-terminal-workshop-design.md');
  L.push('  - genetic-data/workshop-build/out/workshop_data.json');
  L.push('  - https://github.com/mpwilliams-lab/ancient-dna-workshop (src/hints.ts, src/cards.ts, src/content.ts, src/runsheet.ts)');
  L.push('---');
  L.push('');
  L.push('# Ancient DNA of Britain — Instructor Run Sheet');
  L.push('');
  L.push("Generated from the app's own script, cards, on-screen strings and `workshop_data.json` by `npm run run-sheet`. Re-run it after any data rebuild; do not edit numbers by hand. Lines under \"Say\" are for the instructor only: they never appear on screen.");
  L.push('');
  L.push('## At a glance');
  L.push('');
  L.push(`- **Open first:** ${PAGES_URL} in Microsoft Edge, then press F11 (full screen).`);
  L.push(`- **If the network fails:** double-click \`${OFFLINE_NAME}\` on the desktop (Drive master copy: \`${offlinePath}\`).`);
  L.push('- **New group:** add `?reset` to the end of the address and press Enter (for the desktop copy: click the address bar, press End, type `?reset`, Enter).');
  L.push('- **Keys students need:** Enter runs; Tab completes; **Esc fills in the hinted command**; ↑/↓ recall earlier commands. After 3 wrong tries in a row the hint is filled in automatically; they just press Enter.');
  L.push(`- **Keep stations on the guided order:** every command runs at any time, but a station's hint line moves on only when its hinted command is run. It reads \`${NEXT_PREFIX}…\` until the last guided step, then \`${EXTRA_PREFIX}…\`, one optional extra at a time. You set the pace by voice and the projector.`);
  L.push(`- **Cards:** after some steps a card opens over the plot by itself (for the five trait steps it opens before the plot, which shows when the last card closes). Enter on an empty prompt, Esc or the Continue button moves on; a held or double-pressed key moves at most one card. While a card is open the hint line reads "${CARD_HINT}"`);
  L.push('');
  L.push(`## Timing (target ${total} minutes)`);
  L.push('');
  for (const line of TIMING_RULE) L.push(`- ${line}`);
  L.push('');
  L.push('Cuts, in this order:');
  L.push('');
  TIMING_CUTS.forEach((cut, i) => L.push(`${i + 1}. ${cut}`));
  L.push('');
  L.push('Cuts used (date, cut number, minutes saved):');
  L.push('');
  L.push('| Date | Cut | Minutes saved |');
  L.push('|---|---|---|');
  L.push('|  |  |  |');
  L.push('');
  L.push('## Step by step');
  L.push('');
  for (const b of all) {
    L.push(b.index === null ? `### ${b.title} (${fmtMin(b.min)} min)` : `### Step ${b.index} — ${b.title} (${fmtMin(b.min)} min)`);
    L.push('');
    if (b.commands.length) {
      L.push('Students type:');
      L.push('');
      L.push('```');
      for (const c of b.commands) L.push(formatCommand(c));
      L.push('```');
      L.push('');
    }
    if (b.cards.length) {
      const placement = b.index === null ? undefined : SCRIPT_STEPS[b.index]?.cards?.placement;
      L.push(placement === 'before'
        ? 'Cards (open as soon as the command is accepted; the plot shows when the last card closes):'
        : 'Cards (open when the log has finished printing):');
      L.push('');
      for (const id of b.cards) L.push(`- ${id} — ${CARDS[id].title}`);
      L.push('');
    }
    L.push('Say:');
    L.push('');
    for (const s of b.say) L.push(`- ${s}`);
    L.push('');
  }
  L.push('## After the wrap: questions');
  L.push('');
  L.push(`- Questions are held to the wrap and taken after it (outside the ${total}-minute clock).`);
  L.push(`- Anyone who wants more can type help() to list the commands. After the last guided step the hint line suggests one extra at a time: ${EXTRAS.map(formatCommand).join(', ')}.`);
  L.push('');
  L.push('## Say only if asked');
  L.push('');
  L.push('*Any "when?" question:*');
  L.push('');
  for (const s of SAY_LINES.when ?? []) L.push(`- ${s}`);
  L.push('');
  L.push("*Richard III's father-line, only if asked:*");
  L.push('');
  for (const s of SAY_LINES.richard3FatherLine ?? []) L.push(`- ${s}`);
  L.push('- *Do not raise this for Beethoven; if asked, give the same answer.*');
  L.push('');
  L.push('## Numbers on screen (from workshop_data.json)');
  L.push('');
  L.push('| What | Value |');
  L.push('|---|---|');
  L.push(`| Steppe share, Bell Beaker-period Britons (this run) | ${data.admixture.beaker_steppe_pct}% |`);
  L.push(`| Reveal note: ${cell(PERIOD_LABELS.Today)} / ${cell(PERIOD_LABELS.IronAge)} steppe share | ${steppeOf(data, 'Today')}% / ${steppeOf(data, 'IronAge')}% |`);
  L.push(`| Zoom on Britain (zoom note, card E3) | about ${v.zoom}× |`);
  L.push(`| Card E3: ${cell(PERIOD_LABELS.IronAge)} against ${cell(PERIOD_LABELS.BellBeaker)} people | ${v.n_IronAge} against ${v.n_BellBeaker} (about ${v.ratio}×) |`);
  L.push(`| People behind the map axes (as the log lines say it) | about ${round10(data.logs.pca_people_unique)} |`);
  L.push(`| DNA positions kept by the quality filter | ${data.logs.snps_used.toLocaleString('en-US')} |`);
  L.push(`| ADMIXTURE run: positions / people | ${data.logs.admix_snps.toLocaleString('en-US')} / ${data.logs.admix_individuals.toLocaleString('en-US')} |`);
  for (const p of data.periods) {
    L.push(`| ${cell(PERIOD_LABELS[p.id])}: people on the map / in the bars | ${p.n_pca} / ${p.n_admix} |`);
  }
  L.push(`| ${cell(NORTH_SEA_LABEL)} marker: people | ${data.north_sea.n} |`);
  L.push(`| Consumer test, ${PERIOD_LABELS.IronAge}: "British" | ${share(data.consumer.IronAge, 'British')}% |`);
  L.push(`| Consumer test, ${PERIOD_LABELS.BellBeaker}: top label | ${top(data.consumer.BellBeaker)} |`);
  L.push(`| Consumer test, ${PERIOD_LABELS.AngloSaxon}: "Scandinavian" | ${share(data.consumer.AngloSaxon, 'Scandinavian')}% |`);
  L.push(`| Trait plot sources | LCT ${sourceOf('LCT')}, SLC45A2 ${sourceOf('SLC45A2')}, HERC2 ${sourceOf('HERC2')}, TYK2 ${sourceOf('TYK2')}, HLA-DQ2 ${sourceOf('HLA-DQ2')} |`);
  L.push(`| Trait cards: rows shown (H2, I2, J3, K2, L3) | ${(['LCT', 'SLC45A2', 'HERC2', 'TYK2', 'HLA-DQ2'] as const).map((g) => data.trait_maps?.[g]?.length ?? 0).join(', ')} |`);
  L.push('');
  L.push('## Framing (keep the timeline debate off the table)');
  L.push('');
  L.push('- Name periods only: "First farmers / Stonehenge builders", "Bell Beaker", "Bronze Age", "Iron Age", "Roman", "Anglo-Saxon", "Viking", "Britain today". Describe the earliest group only by order: "the people living in Britain before the Beaker newcomers".');
  L.push('- Do not give prehistoric dates or ages. The only time phrases on screen are "about 2,000 years ago" (Kerner), "about 100 generations ago" (Colbran) and "over the last 4,000 years" (Akbari); Roman and later periods may use CE dates.');
  L.push(`- If someone asks how old the bones are, answer with the wrap line: "${WRAP_LINE}"`);
  L.push(`- Consumer tests: quote only AncestryDNA's own white papers (it compares customers with "${ancestryPanelQuote()}"). No 23andMe-specific numbers.`);
  L.push('- The consumer-test labels are illustrative, not a measurement; "Scandinavian" stands in for the North Sea region, not Vikings.');
  L.push('- Richard III and Beethoven are story cards only: they are not on the maps or in the bars.');
  L.push('');
  L.push('## Before each group (every station)');
  L.push('');
  L.push('- [ ] Reload with `?reset`.');
  L.push('- [ ] The prompt is empty and the hint shows `ancestry_test(person = "me")`.');
  L.push('- [ ] No "Restored previous session" line in the terminal.');
  L.push('- [ ] No card is open, and Edge is full screen (F11): prompt, hint and plot visible without scrolling.');
  L.push('');
  L.push('## Monday 19 Oct rehearsal checklist');
  L.push('');
  L.push('- [ ] Edge: open `edge://version` on one lab machine and note the version.');
  L.push('- [ ] Screen: Settings → System → Display; note the resolution and the Scale (100% / 125% / 150%).');
  L.push('- [ ] Projector: note its mirrored resolution.');
  L.push('- [ ] If either is not one of 1024×768, 1280×720, 1280×1024, 1366×768, 1920×1080 at 100/125/150%, run `LAB_VIEWPORTS="<w>x<h>@<scale>" npm run e2e` in the repo (e.g. `LAB_VIEWPORTS="1600x900@1.25"`) and fix by Wed 21 Oct.');
  L.push(`- [ ] Pages: open ${PAGES_URL} on the lab network; run the first three commands.`);
  L.push(`- [ ] Offline: copy \`${OFFLINE_NAME}\` from the USB stick or the lab shared drive onto every lab machine's desktop; double-click it on two machines and run \`load_genomes()\`.`);
  L.push('- [ ] Practise `?reset` on both the Pages URL and the desktop copy.');
  L.push(`- [ ] Refresh mid-session once, with a card open: the same card comes back and the session comes back with "${RESTORED_NOTICE}".`);
  L.push('- [ ] Time every step with text-only cards and fill in the timing table below (add 15% to card steps).');
  L.push('');
  L.push('## Wednesday 21 Oct: cutoff, dry run, freeze');
  L.push('');
  L.push('- [ ] 12:00 PT merge cutoff: unfinished features are switched off.');
  L.push(`- [ ] ${DRY_RUN_CHECK}`);
  L.push('- [ ] By 17:00: any code cut (cut 4) is in, with tests green.');
  L.push('- [ ] 20:00 PT code freeze: final build, release check, export, size and SHA-256 recorded below.');
  L.push('');
  L.push('## Rehearsal timing (fill in by hand)');
  L.push('');
  L.push('| # | Step | Planned min | Mon 19 measured | Mon 19 +15% (card steps) | Wed 21 dry run |');
  L.push('|---|---|---|---|---|---|');
  for (const b of all) L.push(`| ${b.index ?? '–'} | ${cell(b.title)} | ${fmtMin(b.min)} |  |  |  |`);
  L.push(`| | **Total** | **${total}** |  |  |  |`);
  L.push('');
  L.push('## Open checks (spec §11)');
  L.push('');
  L.push('| # | Check | Status | Gates | If it fails |');
  L.push('|---|---|---|---|---|');
  for (const c of OPEN_CHECKS) L.push(`| ${c.n} | ${cell(c.check)} | ${cell(c.status)} | ${cell(c.gates)} | ${cell(c.ifFails)} |`);
  L.push('');
  L.push('## Fallbacks');
  L.push('');
  L.push('| Problem | Do this |');
  L.push('|---|---|');
  L.push(`| Pages URL will not load | Use the desktop copy \`${OFFLINE_NAME}\`. |`);
  L.push('| A station is frozen or shows an error | Press F5. The session restores (an open card comes back too); if it does not, reload with `?reset` and have the student press Esc + Enter to catch up (every command works from the start). |');
  L.push(`| Keyboard seems dead | A student has opened "${WRAP_BUTTON}" (the screen with the QR code). Press Esc or click "${WRAP_CLOSE}". |`);
  L.push('| A card will not close | Press Enter on an empty prompt, or click Continue. Each press moves one card; wait a moment between presses. |');
  L.push('| A student is lost | Esc fills in the hinted command; Enter runs it. |');
  L.push('| A student is far behind | Have them press Esc to fill in their next guided step, then Enter, and repeat until they catch up (the hint line shows that step). Skipping a step leaves their hint behind: it only moves on when the hinted command is run. |');
  L.push('| Projector shows a cut-off page | Press F11 on the instructor machine; Ctrl+0 resets the zoom. |');
  L.push('| A trait plot looks wrong | Read its caption aloud and move on; captions are exact. |');
  L.push('| Running long | Use the timing cuts above, in order. Every command still runs: a station that falls behind presses Esc and Enter to run its hinted command (about 10 s), because a command left unrun leaves every later hint stuck on it. |');
  L.push('');
  L.push(...freezeSection(offlinePath, offlineFile));
  return L.join('\n');
}

/** "Freeze and verify": the freeze text, the offline file's recorded size and hash, the Thu 22 desktop check, and room for notes. */
function freezeSection(offlinePath: string, offlineFile: unknown): string[] {
  const L: string[] = [];
  L.push('## Freeze and verify');
  L.push('');
  L.push(FREEZE_TEXT);
  L.push('');
  L.push('Sessions run Thu 22 and Fri 23 Oct only; there is none on Sat 24.');
  L.push('');
  if (isOfflineFileInfo(offlineFile)) {
    L.push(`The offline file is the one \`npm run export-offline\` wrote to the Drive master folder (\`${offlinePath}\`). Its size and SHA-256 below were read from that file when this sheet was generated (see \`generated\` at the top), not typed in.`);
    L.push('');
    L.push('| File | Size | SHA-256 |');
    L.push('|---|---|---|');
    L.push(`| \`${OFFLINE_NAME}\` | ${offlineFile.bytes.toLocaleString('en-US')} bytes | \`${offlineFile.sha256}\` |`);
    L.push('');
    L.push('At the freeze, run `npm run export-offline` and then `npm run run-sheet`, so this table always describes the file that was copied.');
  } else {
    L.push(`> **WARNING: the offline file was not found (or could not be read) at \`${offlinePath}\` when this sheet was generated, so its size and hash are not shown. Run \`npm run export-offline\`, then \`npm run run-sheet\` again, before relying on this section.**`);
  }
  L.push('');
  L.push('### Thu 22 Oct, before the first session: check every desktop copy');
  L.push('');
  L.push('Copy the frozen file to every lab desktop and remove the Mon 19 copy. Then, on each lab desktop, open PowerShell and run:');
  L.push('');
  L.push('```');
  L.push('cd "$([Environment]::GetFolderPath(\'Desktop\'))"');
  L.push(`Get-FileHash -Algorithm SHA256 .\\${OFFLINE_NAME}`);
  L.push('```');
  L.push('');
  L.push('The `Hash` line must equal the SHA-256 recorded in this section. PowerShell prints it in capitals; the case does not matter. A different hash means a stale or damaged copy: copy the Drive master over it again, then check it again.');
  L.push('');
  L.push('### Problems noted during sessions');
  L.push('');
  L.push('| When | Station | Problem | Handled by voice |');
  L.push('|---|---|---|---|');
  L.push('|  |  |  |  |');
  L.push('');
  return L;
}
