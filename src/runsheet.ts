// Builds the instructor run sheet (D/docs/run-sheet.md) from the same script, strings and data the app uses.
import type { ConsumerShare, PeriodId, WorkshopData } from './types';
import type { Command } from './parser';
import { formatCommand } from './parser';
import { SCRIPT } from './hints';
import {
  ANGLO_SAXON_TAKEAWAY, BEAKER_CALLOUT, beakerBridge, CONSUMER_NOTE, ME_RESULT, NORTH_SEA_LABEL,
  PAGES_URL, PERIOD_LABELS, PREDICT_HINT, ROMAN_CARD, traitCaption, traitSourceLabel, WRAP_BUTTON, WRAP_LINE,
} from './content';

/** The live site. Re-exported from content.ts so the sheet always names the address the wrap screen and QR code use. */
export { PAGES_URL };
export const OFFLINE_NAME = 'ancient-dna-workshop.html';

export interface Beat { min: string; beat: string; commands: Command[]; say: string[] }

const pct = (x: number): number => Math.round(x * 100);
function share(rows: ConsumerShare[] | undefined, label: ConsumerShare['label']): number {
  return pct(rows?.find((r) => r.label === label)?.share ?? 0);
}
function top(rows: ConsumerShare[] | undefined): string {
  const r = [...(rows ?? [])].sort((a, b) => b.share - a.share)[0];
  return r ? `${r.label} (${pct(r.share)}%)` : 'none';
}
function n(data: WorkshopData, id: PeriodId): number {
  return data.periods.find((p) => p.id === id)?.n_pca ?? 0;
}
const at = (i: number): Command => {
  const c = SCRIPT[i];
  if (!c) throw new Error(`SCRIPT has no step ${i}`);
  return c;
};

/** The minute-by-minute beats of spec §3 with the exact commands from hints.SCRIPT. */
export function beats(data: WorkshopData): Beat[] {
  const steppe = data.admixture.beaker_steppe_pct;
  const trait = (g: string) => data.traits.find((t) => t.gene === g)!;
  const me = ME_RESULT.map((r) => `${pct(r.share)}% ${r.label}`).join(', ');
  return [
    { min: '0–3', beat: 'Hook', commands: [at(0)], say: [
      `This is what a consumer DNA test tells an example customer: ${me}.`,
      'Can a test like this tell us who lived in Britain long ago? Hold on to that question.',
    ] },
    { min: '3–7', beat: "Load + today's Europe", commands: [at(1), at(2)], say: [
      `load_genomes() loads real ancient and modern genomes. The map uses ${data.logs.snps_used.toLocaleString('en-US')} DNA positions.`,
      'Each dot is one person. Dots close together share more ancestry. North is up: the gene map looks like the map of Europe.',
    ] },
    { min: '7–13', beat: 'Beat 1: Beaker arrival (migration)', commands: [at(3), at(4), at(5)], say: [
      `${PERIOD_LABELS.FirstFarmers}: the people living in Britain before the Beaker newcomers. They sit toward southern Europeans.`,
      `The hint line now reads "${PREDICT_HINT}". Ask the room to predict before anyone presses Enter.`,
      `${PERIOD_LABELS.BellBeaker}-period Britons land near modern Britons and Scandinavians.`,
      BEAKER_CALLOUT,
      beakerBridge(steppe),
    ] },
    { min: '13–16', beat: 'Beat 2: Romans (culture changed, people did not)', commands: [at(6), at(7)], say: [
      'The view zooms in on Britain.',
      `The ${PERIOD_LABELS.Roman} layer is small (n = ${n(data, 'Roman')}) and lands inside the ${PERIOD_LABELS.IronAge} cloud.`,
      ROMAN_CARD,
    ] },
    { min: '16–20', beat: 'Beat 3: Anglo-Saxons (migration)', commands: [at(8), at(9)], say: [
      `${PERIOD_LABELS.AngloSaxon}-period Britons move toward the "${NORTH_SEA_LABEL}" marker. Eastern-England burials are furthest along (Gretzinger et al. 2022: up to 76% continental ancestry).`,
      `Now the bars: the new outlined ${PERIOD_LABELS.AngloSaxon} bar looks almost the same as the ${PERIOD_LABELS.IronAge} and ${PERIOD_LABELS.Roman} bars.`,
      ANGLO_SAXON_TAKEAWAY,
    ] },
    { min: '20–22', beat: 'Beat 4: Today + consumer DNA', commands: [at(10)], say: [
      `If ${PERIOD_LABELS.IronAge} Britons took a consumer test, ${share(data.consumer.IronAge, 'British')}% would be called "British".`,
      'Consumer tests compare you only with living people, so only ancient DNA reveals the turnovers.',
      CONSUMER_NOTE,
    ] },
    { min: '22–28', beat: 'Traits through time', commands: [at(11), at(12), at(13), at(14), at(15)],
      say: ['LCT', 'SLC45A2', 'HERC2', 'TYK2', 'HLA-DQ2'].map((g) => {
        const t = trait(g);
        return t.source === 'text' ? `${g}: ${traitCaption(t)} (text card)` : `${g}: ${traitCaption(t)} [${traitSourceLabel(t)}]`;
      }) },
    { min: '28–30', beat: 'Wrap', commands: [], say: [
      `Everyone clicks "${WRAP_BUTTON}" (top right) to show the QR code.`,
      WRAP_LINE,
      'WWU Biology: point to the QR code to take the app home.',
    ] },
    { min: '30–35', beat: 'Q&A', commands: [], say: ['Questions.'] },
  ];
}

/** Every line the instructor reads aloud (checked against spec §6 rule 1 in tests). */
export function sayLines(data: WorkshopData): string[] {
  return beats(data).flatMap((b) => b.say);
}

const cell = (s: string): string => s.replace(/\|/g, '\\|');

export function buildRunSheet(data: WorkshopData, generatedAt: string, offlinePath: string): string {
  const steppe = data.admixture.beaker_steppe_pct;
  const sourceOf = (g: string) => data.traits.find((t) => t.gene === g)!.source;
  const L: string[] = [];
  L.push('---');
  L.push('title: Ancient DNA of Britain — Instructor Run Sheet');
  L.push('status: draft');
  L.push(`generated: { by: agent/ClaudeCode, at: ${generatedAt} }`);
  L.push('stale_after: 2026-10-25');
  L.push('sources:');
  L.push('  - docs/superpowers/specs/2026-10-15-ancient-dna-terminal-workshop-design.md');
  L.push('  - genetic-data/workshop-build/out/workshop_data.json');
  L.push('  - https://github.com/mpwilliams-lab/ancient-dna-workshop (src/hints.ts, src/content.ts, src/runsheet.ts)');
  L.push('---');
  L.push('');
  L.push('# Ancient DNA of Britain — Instructor Run Sheet');
  L.push('');
  L.push(`Generated from the app's own script, on-screen strings and \`workshop_data.json\` by \`npm run run-sheet\`. Re-run it after any data rebuild; do not edit numbers by hand.`);
  L.push('');
  L.push('## At a glance');
  L.push('');
  L.push(`- **Open first:** ${PAGES_URL} in Microsoft Edge, then press F11 (full screen).`);
  L.push(`- **If the network fails:** double-click \`${OFFLINE_NAME}\` on the desktop (Drive master copy: \`${offlinePath}\`).`);
  L.push('- **New group:** add `?reset` to the end of the address and press Enter (for the desktop copy: click the address bar, press End, type `?reset`, Enter).');
  L.push('- **Keys students need:** Enter runs; Tab completes; **Esc fills in the hinted command**; ↑/↓ recall earlier commands. After 3 wrong tries in a row the hint is filled in automatically; they just press Enter.');
  L.push('- **Pacing is free:** every command works at any time. You lead by voice and the projector; the hint line always shows the next guided command.');
  L.push('');
  L.push('## Minute by minute');
  L.push('');
  for (const b of beats(data)) {
    L.push(`### ${b.min} min — ${b.beat}`);
    L.push('');
    if (b.commands.length) {
      L.push('Students type:');
      L.push('');
      L.push('```');
      for (const c of b.commands) L.push(formatCommand(c));
      L.push('```');
      L.push('');
    }
    L.push('Say:');
    L.push('');
    for (const s of b.say) L.push(`- ${s}`);
    L.push('');
  }
  L.push('## Numbers on screen (from workshop_data.json)');
  L.push('');
  L.push('| What | Value |');
  L.push('|---|---|');
  L.push(`| Steppe share, Bell Beaker-period Britons (this run) | ${steppe}% |`);
  L.push('| Published Beaker turnover | at least 90% ± 2% by the Middle Bronze Age (Olalde et al. 2018) |');
  L.push(`| DNA positions used / people in the PCA run | ${data.logs.snps_used.toLocaleString('en-US')} / ${data.logs.pca_samples_used.toLocaleString('en-US')} |`);
  L.push(`| ADMIXTURE run: positions / people | ${data.logs.admix_snps.toLocaleString('en-US')} / ${data.logs.admix_individuals.toLocaleString('en-US')} |`);
  for (const p of data.periods) {
    L.push(`| ${cell(PERIOD_LABELS[p.id])}: people on the map / in the bars | ${p.n_pca} / ${p.n_admix} |`);
  }
  L.push(`| ${cell(NORTH_SEA_LABEL)} marker: people | ${data.north_sea.n} |`);
  L.push(`| Consumer test, ${PERIOD_LABELS.IronAge}: "British" | ${share(data.consumer.IronAge, 'British')}% |`);
  L.push(`| Consumer test, ${PERIOD_LABELS.BellBeaker}: top label | ${top(data.consumer.BellBeaker)} |`);
  L.push(`| Consumer test, ${PERIOD_LABELS.AngloSaxon}: "Scandinavian" | ${share(data.consumer.AngloSaxon, 'Scandinavian')}% |`);
  L.push(`| Trait plot sources | LCT ${sourceOf('LCT')}, SLC45A2 ${sourceOf('SLC45A2')}, HERC2 ${sourceOf('HERC2')}, TYK2 ${sourceOf('TYK2')}, HLA-DQ2 ${sourceOf('HLA-DQ2')} |`);
  L.push('| Anglo-Saxon migration | up to 76% continental ancestry in eastern England (Gretzinger et al. 2022) |');
  L.push('');
  L.push('## Framing (keep the timeline debate off the table)');
  L.push('');
  L.push('- Name periods only: "First farmers / Stonehenge builders", "Bell Beaker", "Bronze Age", "Iron Age", "Roman", "Anglo-Saxon", "Viking", "Britain today". Describe the earliest group only by order: "the people living in Britain before the Beaker newcomers".');
  L.push('- Do not give prehistoric dates or ages. The only time phrases on screen are "about 2,000 years ago" (Kerner), "about 100 generations ago" (Colbran) and "over the last 4,000 years" (Akbari); Roman and later periods may use CE dates.');
  L.push('- If someone asks how old the bones are, answer with the wrap line: "We are looking at the genetic family tree: the physical pattern of who is related to whom in the DNA. That holds no matter which timeline you use."');
  L.push('- Consumer tests: quote only AncestryDNA\'s own white papers (it compares customers with "people with long family histories in a particular region"). No 23andMe-specific numbers.');
  L.push('- The consumer-test labels are illustrative, not a measurement; "Scandinavian" stands in for the North Sea region, not Vikings.');
  L.push('');
  L.push('## Before each group (every station)');
  L.push('');
  L.push('- [ ] Reload with `?reset`.');
  L.push('- [ ] The prompt is empty and the hint shows `ancestry_test(person = "me")`.');
  L.push('- [ ] No "Restored previous session" line in the terminal.');
  L.push('- [ ] Edge is full screen (F11) and the whole page fits: prompt, hint and plot visible without scrolling.');
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
  L.push('- [ ] Refresh mid-session once: the session comes back with "Restored previous session — reload with ?reset to start fresh".');
  L.push('- [ ] Timed dry run through the wrap: target about 30 minutes.');
  L.push('');
  L.push('## Fallbacks');
  L.push('');
  L.push('| Problem | Do this |');
  L.push('|---|---|');
  L.push(`| Pages URL will not load | Use the desktop copy \`${OFFLINE_NAME}\`. |`);
  L.push('| A station is frozen or shows an error | Press F5. The session restores; if it does not, reload with `?reset` and have the student press Esc + Enter to catch up (every command works from the start). |');
  L.push('| A student is lost | Esc fills in the hinted command; Enter runs it. |');
  L.push('| A student is far behind | They can skip ahead: run the command you are on; the plots follow the last command. |');
  L.push('| Projector shows a cut-off page | Press F11 on the instructor machine; Ctrl+0 resets the zoom. |');
  L.push('| A trait plot looks wrong | Read its caption aloud and move on; captions are exact (spec §6 rule 6). |');
  L.push('| Running long | Skip the per-person bars and the Bronze Age / Viking extras; say the hook aloud instead of typing it. |');
  L.push('');
  return L.join('\n');
}
