// @vitest-environment node
// Pins what the sheet tells the instructor against the app itself and against spec §3.6 / §2.1 / §11.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { distributionRows } from '../src/cards';
import { execute } from '../src/commands';
import * as content from '../src/content';
import { allRenderableStrings, PERIOD_LABELS } from '../src/content';
import { validateData } from '../src/data';
import { advance, EXTRAS, hintCommand, SCRIPT } from '../src/hints';
import { formatCommand } from '../src/parser';
import {
  beats, buildRunSheet, DRY_RUN_CHECK, OPEN_CHECKS, outlinedAtReveal, SAY_LINES, TIMING_CUTS, TIMING_RULE,
} from '../src/runsheet';
import type { ConsumerShare, WorkshopData } from '../src/types';
import { FIXTURE } from './helpers/shellEnv';

const ROOT = resolve(__dirname, '..');
const md = buildRunSheet(FIXTURE, '2026-10-19T09:00:00Z', '/Drive/web-app-dist/ancient-dna-workshop.html');
const allSay = (): string[] => Object.values(SAY_LINES).flatMap((v) => v ?? []);
/** Another module importing src/runsheet, in any form (static, side-effect, dynamic, re-export): a quoted relative path ending in "runsheet". */
const RUNSHEET_IMPORT = /['"]\.{1,2}\/(?:[\w/]*\/)?runsheet['"]/;

function row(title: string): string {
  const line = md.split('\n').find((l) => l.startsWith(`| ${title} |`));
  if (line === undefined) throw new Error(`the run sheet has no "${title}" row`);
  return line;
}
function section(title: string): string {
  const start = md.indexOf(`\n## ${title}\n`);
  if (start < 0) throw new Error(`the run sheet has no "## ${title}" section`);
  const rest = md.slice(start + 1);
  const next = rest.indexOf('\n## ', 4);
  return next < 0 ? rest : rest.slice(0, next);
}

describe('say-lines: spec §3.6, verbatim, instructor only', () => {
  it('holds exactly the §3.6 lines', () => {
    expect(SAY_LINES).toEqual({
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
    });
  });
  it('every say-line is in the sheet, under its step or under "Say only if asked"', () => {
    for (const s of allSay()) expect(md, s).toContain(`- ${s}`);
    const asked = section('Say only if asked');
    for (const s of [...SAY_LINES.when!, ...SAY_LINES.richard3FatherLine!]) expect(asked).toContain(s);
    expect(asked).toContain('*Do not raise this for Beethoven; if asked, give the same answer.*');
    expect(md).toContain('*Only if a student asks about the York man:*');
    expect(md).toContain('*Do not mention how they were buried.*');
  });
  it('the trait-puzzle line is cued at each puzzle card, before anyone presses Enter', () => {
    for (const [id, card] of [['lct', 'H2'], ['slc45a2', 'I2'], ['herc2', 'J3'], ['tyk2', 'K2'], ['hla', 'L3']] as const) {
      const beat = beats(FIXTURE).find((b) => b.id === id)!;
      const cue = beat.say.indexOf(`*At the puzzle card (${card}), before anyone presses Enter:*`);
      expect(cue, id).toBeGreaterThan(-1);
      expect(beat.say[cue + 1]).toBe(SAY_LINES.traitPuzzle![0]);
    }
  });
  it('never reaches the screen: not in allRenderableStrings(), no app module imports runsheet.ts, not in the built page', () => {
    const screen = allRenderableStrings();
    for (const s of allSay()) expect(screen.some((x) => x.includes(s)), s).toBe(false);
    const srcFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? srcFiles(join(dir, e.name)) : /\.ts$/.test(e.name) ? [join(dir, e.name)] : []);
    for (const f of srcFiles(resolve(ROOT, 'src'))) {
      if (/[\\/]runsheet\.ts$/.test(f)) continue;
      expect(readFileSync(f, 'utf8'), f).not.toMatch(RUNSHEET_IMPORT);
    }
    const built = resolve(ROOT, 'dist/index.html');
    if (existsSync(built)) {
      const page = readFileSync(built, 'utf8');
      for (const s of allSay()) expect(page.includes(s), s).toBe(false);
    }
  });
  it('the import guard sees side-effect, dynamic and re-export imports, not only "from" imports', () => {
    for (const form of ["import { buildRunSheet } from './runsheet';", 'import "./runsheet";', "const m = await import('../runsheet');", "export * from './sub/runsheet';"]) {
      expect(RUNSHEET_IMPORT.test(form), form).toBe(true);
    }
    for (const other of ["import { x } from './runsheetFoo';", "import { x } from './plots/pca';"]) expect(RUNSHEET_IMPORT.test(other), other).toBe(false);
  });
});

describe('timing (spec §2.1)', () => {
  it('states the target, the window, the clock, the +15% Monday rule', () => {
    expect(TIMING_RULE).toEqual([
      'Target 48.5 minutes, inside a 45–50 minute window. The clock runs from the first typed command to the end of the wrap.',
      'Open the file and reload with ?reset on every station before each group sits down; seating is outside the clock. Hold questions to the wrap and take them after it.',
      "Mon 19 timings are taken with text-only cards. Add 15% to each card step's measured time before comparing with the window.",
      'If the adjusted Mon 19 time or the Wed 21 dry run exceeds 50 minutes, cut in this order until it fits, and record each cut here. Cards are never reordered.',
    ]);
    for (const line of TIMING_RULE) expect(md).toContain(line);
  });
  it('lists cuts 1-8 verbatim with their minutes, in order', () => {
    expect(TIMING_CUTS).toEqual([
      'A1 shown only as a 30-second look, no discussion (−0.5).',
      'E3 skipped by the instructor (Enter straight through) (−0.5).',
      'K2 and L3 shown without the puzzle discussion (−1.0).',
      'BronzeAge step removed from `SCRIPT` (it stays runnable as an extra). This is a code change: it lands by Wed 17:00 with tests green (−1.0).',
      'J2 and L2 shown for 10 s each, no discussion (−1.5).',
      'E2 skipped (−1.0).',
      'K1 and K2 skipped; only the TYK2 plot is discussed (−1.5).',
      'A1 skipped (−1.0 more).',
    ]);
    let from = 0;
    TIMING_CUTS.forEach((cut, i) => {
      const at = md.indexOf(`${i + 1}. ${cut}`, from);
      expect(at, cut).toBeGreaterThan(-1);
      from = at;
    });
  });
  it('has a timing table to fill in by hand, one row per beat', () => {
    const t = section('Rehearsal timing (fill in by hand)');
    expect(t).toContain('| # | Step | Planned min | Mon 19 measured | Mon 19 +15% (card steps) | Wed 21 dry run |');
    for (const b of beats(FIXTURE)) expect(t).toContain(`| ${b.index ?? '–'} | ${b.title} | ${b.min} |`);
  });
  it('the Wed 21 dry-run line is the spec line', () => {
    expect(DRY_RUN_CHECK).toBe('Timed dry run through the wrap (Wed 21): must land 45–50 minutes.');
    expect(md).toContain(`- [ ] ${DRY_RUN_CHECK}`);
  });
});

describe('open checks (spec §11)', () => {
  it('lists all 17 checks with status, what they gate and the fallback', () => {
    expect(OPEN_CHECKS.map((c) => c.n)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    for (const c of OPEN_CHECKS) for (const v of [c.check, c.status, c.gates, c.ifFails]) expect(v.trim(), `check ${c.n}`).not.toBe('');
    const t = section('Open checks (spec §11)');
    for (const c of OPEN_CHECKS) expect(t).toContain(`| ${c.n} |`);
    expect(OPEN_CHECKS[13]!.check).toMatch(/A1 map labels/);
    expect(OPEN_CHECKS[14]!.ifFails).toBe('Line 3 becomes "The next plot follows this letter across all of West Eurasia."');
  });
  // O1 (settled): the build writes 1000 Genomes Britain as 5 copies = 0.02747, so card K2 shows 2.7. The spec §11 line still
  // has the pre-O1 value (0.0275, which would round to 2.8).
  it('check 5 carries O1: 1000 Genomes Britain is 0.02747 and card K2 shows 2.7, never the stale 0.0275 or 2.8', () => {
    const c = OPEN_CHECKS[4]!;
    expect(c.n).toBe(5);
    expect(c.check).toContain('0.02747');
    expect(c.check).toMatch(/shows 2\.7\b/);
    expect(c.check).not.toMatch(/0\.0275|\b2\.8\b/);
  });
});

// Skipped in a plain `npm test`. `npm run check-data` does not run this file: run it with REAL_DATA=1 npx vitest run tests/runsheet-content.test.ts.
describe.runIf(process.env.REAL_DATA === '1')('open check 5 against the real workshop_data.json (O1)', () => {
  it('quotes the 1000 Genomes Britain value the build wrote and what card K2 shows for it', () => {
    const real = validateData(JSON.parse(readFileSync(resolve(ROOT, 'src/data/workshop_data.json'), 'utf8')));
    const gbr = real.trait_maps.TYK2.find((r) => r.label_key === '1kg:GBR')!;
    const shown = distributionRows(real, 'TYK2').find((r) => r.key === '1kg:GBR')!.display;
    expect(OPEN_CHECKS[4]!.check).toContain(`1000G GBR ${gbr.value} (${gbr.allele_count} copies; card K2 shows ${shown})`);
  });
});

describe('run sheet: nothing tells the instructor to skip a guided command', () => {
  it('rests on how the hint really works: only the hinted command moves it on, and Esc inserts that command', () => {
    expect(advance(0, SCRIPT[1]!)).toBe(0);
    expect(advance(0, SCRIPT[0]!)).toBe(1);
    expect(formatCommand(hintCommand(0, 0))).toBe(formatCommand(SCRIPT[0]!));
  });
  it('never advises skipping a step, skipping ahead, or saying a command aloud instead of typing it', () => {
    const advice: [RegExp, string][] = [
      [/instead of typing|without typing|rather than typing/i, 'saying a command aloud instead of typing it'],
      [/skip ahead/i, 'skipping ahead'],
      [/\b(?:skip|omit|leave out) (?:the |a |any |that )?(?:guided |first |hook )?(?:command|step|hook)\b/i, 'skipping a guided command'],
      [/do not type|don't type|no need to type/i, 'not typing a command'],
    ];
    for (const [pattern, what] of advice) expect(md, what).not.toMatch(pattern);
  });
  it('"Running long" keeps the commands: timing cuts first, Esc and Enter to catch up, and a warning about the hint', () => {
    const r = row('Running long');
    expect(r).toMatch(/\bEsc\b/);
    expect(r).toMatch(/\bEnter\b/);
    expect(r).toMatch(/\bhint\b/i);
    expect(r).toMatch(/timing cuts/i);
  });
  it('"A student is far behind" catches up through the guided steps with Esc, and says skipping leaves the hint behind', () => {
    const r = row('A student is far behind');
    expect(r).toMatch(/\bEsc\b/);
    expect(r).toMatch(/skipping/i);
    expect(r).toMatch(/\bhint\b/i);
  });
});

describe('run sheet: strings come from the app, not from hand copies', () => {
  it('src/runsheet.ts holds no hand-typed copy of a long on-screen string: it imports the constant from content.ts', () => {
    const source = readFileSync(resolve(ROOT, 'src/runsheet.ts'), 'utf8').replace(/\\(['"`])/g, '$1');
    const copied = Object.entries(content)
      .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].length >= 40 && source.includes(e[1]))
      .map(([name]) => name);
    expect(copied).toEqual([]);
  });
  it('quotes AncestryDNA exactly as the app does, down to the last words "region or group"', () => {
    const quote = /"([^"]+)"/.exec(content.CONSUMER_TAKEAWAY)?.[1];
    expect(quote).toMatch(/region or group$/);
    expect(md).toContain(`(it compares customers with "${quote}")`);
  });
  it('keeps the restored-session wording', () => {
    expect(md).toContain('No "Restored previous session" line in the terminal.');
    expect(md).toContain(`the session comes back with "${content.RESTORED_NOTICE}"`);
  });
  it('keeps the wrap line, in full, as the answer about how old the bones are', () => {
    expect(md).toContain(`answer with the wrap line: "${content.WRAP_LINE}"`);
  });
  it('the Predict and Reveal hint lines are quoted from the app at steps 3 and 8', () => {
    expect(beats(FIXTURE).find((b) => b.id === 'firstFarmers')!.say.join('\n')).toContain(content.PREDICT_HINT);
    expect(beats(FIXTURE).find((b) => b.id === 'consumerIA')!.say.join('\n')).toContain(content.REVEAL_HINT);
  });
});

// One rounding rule with the screen (Task 7 review, Task 13 carry-forward): where the sheet quotes a number the students see,
// it rounds the way the app does, so what the instructor reads out is what is on the projector. Each case runs the app's own
// terminal command on the same data as the oracle.
describe('run sheet: numbers are the screen\'s numbers', () => {
  const AT = '2026-10-19T09:00:00Z';
  const OFFLINE = '/Drive/web-app-dist/ancient-dna-workshop.html';
  const sheetFor = (data: WorkshopData): string => buildRunSheet(data, AT, OFFLINE);
  const withConsumer = (period: 'IronAge' | 'BellBeaker' | 'AngloSaxon', shares: ConsumerShare[]): WorkshopData =>
    ({ ...FIXTURE, consumer: { ...FIXTURE.consumer, [period]: shares } });

  it('the people behind the map axes are "about N", N = pca_people_unique rounded to 10 as the log lines round it', () => {
    for (const [people, about] of [[951, 950], [954, 950], [955, 960]] as const) {
      const data: WorkshopData = { ...FIXTURE, logs: { ...FIXTURE.logs, pca_people_unique: people } };
      expect(execute({ name: 'load_genomes' }, data).lines.join('\n'), `terminal, ${people}`).toContain(`about ${about} present-day Europeans`);
      const sheet = sheetFor(data);
      expect(sheet, `say-line, ${people}`).toContain(`come from about ${about} present-day Europeans`);
      const axes = sheet.split('\n').find((l) => l.startsWith('| People behind the map axes'));
      expect(axes, `table row, ${people}`).toContain(`| about ${about} |`);
      expect(axes, `table row, ${people}`).not.toContain(String(people));
    }
  });
  it('never prints the genotype-row count (pca_samples_used): the screen no longer shows it', () => {
    const data: WorkshopData = { ...FIXTURE, logs: { ...FIXTURE.logs, pca_samples_used: 1234 } };
    expect(sheetFor(data)).not.toMatch(/1,?234/);
    expect(md).not.toContain('1,163');
  });
  it('consumer percentages are the terminal\'s (largest remainder), not Math.round: 40.4% shows 41, and 34.5% twice shows 35 then 34', () => {
    // 40.4 + 20.2 + 20.2 + 19.2: the spare point goes to 40.4 (41) although Math.round gives 40.
    const spare: ConsumerShare[] = [
      { label: 'British', share: 0.404 }, { label: 'French', share: 0.202 }, { label: 'Scandinavian', share: 0.202 }, { label: 'Italian', share: 0.192 },
    ];
    // 34.5 + 34.5 + 31: the spare point goes to the first of the tie, so the second shows 34 although Math.round gives 35.
    const tie: ConsumerShare[] = [{ label: 'British', share: 0.345 }, { label: 'Scandinavian', share: 0.345 }, { label: 'French', share: 0.31 }];

    const ironAge = withConsumer('IronAge', spare);
    expect(execute({ name: 'ancestry_test', person: 'IronAge' }, ironAge).lines.join('\n')).toMatch(/British\s+\[[#.]+\]\s+41%/);
    const ironSheet = sheetFor(ironAge);
    expect(ironSheet).toContain('41% would be called "British"');
    expect(ironSheet).toContain(`| Consumer test, ${PERIOD_LABELS.IronAge}: "British" | 41% |`);

    const beaker = withConsumer('BellBeaker', spare);
    expect(sheetFor(beaker)).toContain(`| Consumer test, ${PERIOD_LABELS.BellBeaker}: top label | British (41%) |`);

    const anglo = withConsumer('AngloSaxon', tie);
    expect(execute({ name: 'ancestry_test', person: 'AngloSaxon' }, anglo).lines.join('\n')).toMatch(/Scandinavian\s+\[[#.]+\]\s+34%/);
    expect(sheetFor(anglo)).toContain(`| Consumer test, ${PERIOD_LABELS.AngloSaxon}: "Scandinavian" | 34% |`);
  });
  it('the reveal steppe shares are whole percents of the Britain today and Iron Age bars (fixture: 0.556 and 0.571)', () => {
    expect(beats(FIXTURE).find((b) => b.id === 'revealAdmix')!.say).toContain(
      `${PERIOD_LABELS.Today}: 56% steppe; ${PERIOD_LABELS.IronAge}: 57% steppe (this workshop's data).`);
    expect(md).toContain(`| Reveal note: ${PERIOD_LABELS.Today} / ${PERIOD_LABELS.IronAge} steppe share | 56% / 57% |`);
  });
});

describe('run sheet: the reveal ADMIXTURE step names the bars the app outlines', () => {
  it('replaying the guided script through execute + reducePlot outlines Bronze Age, Iron Age and Britain today, and the sheet says so', () => {
    expect(outlinedAtReveal(FIXTURE)).toEqual(['BronzeAge', 'IronAge', 'Today']);
    const line = beats(FIXTURE).find((b) => b.id === 'revealAdmix')!.say.find((s) => /outlined/.test(s));
    expect(line).toBe(`The bars added since the first ADMIXTURE run are outlined: ${PERIOD_LABELS.BronzeAge}, ${PERIOD_LABELS.IronAge} and ${PERIOD_LABELS.Today}.`);
  });
});

describe('run sheet: questions come after the wrap', () => {
  it('says that help() lists the commands and that, after the last guided step, the hint line suggests the extras', () => {
    const qa = section('After the wrap: questions');
    expect(qa).toContain('help()');
    expect(qa).toMatch(/after the last guided step/i);
    for (const extra of EXTRAS) expect(qa).toContain(formatCommand(extra));
  });
});
