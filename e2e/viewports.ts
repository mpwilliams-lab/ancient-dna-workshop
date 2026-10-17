// The viewport matrix of spec §5.4 (Task 26), written once for every spec that runs over it (layout.spec.ts, maps.spec.ts).
// Each case is what the page sees: a window size in CSS px and a device scale factor. A lab machine's screen at a Windows display
// scale of 125% or 150% shows the page in fewer CSS px (the F11 case), so each of those is a case of its own next to the plain
// "same size, scale factor 1.25 or 1.5" one.
import type { Browser, Page } from '@playwright/test';

/**
 * Spec §5.4 fit rule of a case. 'normal': no card may need dense. 'no-scroll': no card body may overflow (dense and compact are
 * allowed). 'any': spec §5.2's whole order (normal, dense, compact, scroll) is allowed. Every case, whatever its rule, must still
 * show the title, the first body line and every footer button, leave the prompt and the hint line uncovered, and never scroll the page.
 */
export type Fit = 'normal' | 'no-scroll' | 'any';
export interface Case { name: string; width: number; height: number; dsf: number; fit: Fit }

export const ALLOWED_FITS: Readonly<Record<Fit, readonly string[]>> = {
  normal: ['normal'],
  'no-scroll': ['normal', 'dense', 'compact'],
  any: ['normal', 'dense', 'compact', 'scroll'],
};

const SCREENS: readonly (readonly [number, number])[] = [[1024, 768], [1280, 720], [1280, 1024], [1366, 768], [1920, 1080]];
const SCALES = [1, 1.25, 1.5] as const;
/** The two lab-standard screens of spec §5.4. At 100% no card may need dense; at 125% none may scroll. */
const LAB_STANDARD = new Set(['1366x768', '1920x1080']);

function build(): Case[] {
  const cases: Case[] = [];
  for (const [w, h] of SCREENS) {
    const standard = LAB_STANDARD.has(`${w}x${h}`);
    for (const s of SCALES) {
      const fit: Fit = !standard ? 'any' : s === 1 ? 'normal' : s === 1.25 ? 'no-scroll' : 'any';
      // Spec §8: the same viewport at device scale factor 1, 1.25, 1.5.
      cases.push({ name: `${w}x${h} dsf ${s}`, width: w, height: h, dsf: s, fit });
      // What Windows display scaling really does to a full-screen (F11) Edge window: fewer CSS px.
      if (s !== 1) {
        cases.push({ name: `${w}x${h} @${s * 100}% (CSS ${Math.floor(w / s)}x${Math.floor(h / s)})`, width: Math.floor(w / s), height: Math.floor(h / s), dsf: s, fit });
      }
    }
  }
  // Floor: the smallest screen at 150% in a normal (not full-screen) Edge window with the taskbar.
  cases.push({ name: 'floor 640x360', width: 640, height: 360, dsf: 1.5, fit: 'any' });
  if (cases.length !== 26) throw new Error(`layout matrix: expected the 26 viewport cases, built ${cases.length}`);
  return cases;
}

/** The lab resolutions read on Mon 19 Oct, e.g. LAB_VIEWPORTS="1600x900@1.25,1440x900@1": each is the screen divided by its scale. */
function labCases(env: string | undefined): Case[] {
  return (env ?? '').split(',').filter(Boolean).map((spec) => {
    const m = /^(\d+)x(\d+)@([\d.]+)$/.exec(spec.trim());
    if (!m) throw new Error(`bad LAB_VIEWPORTS entry: ${spec}`);
    const [w, h, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return { name: `lab ${w}x${h} @${s * 100}%`, width: Math.floor(w / s), height: Math.floor(h / s), dsf: s, fit: 'no-scroll' as const };
  });
}

/** The 26 viewport cases of v2.1 (5 screens x [1, 1.25, 1.5 + 1.25 and 1.5 as CSS px] + the 640 x 360 floor), then every LAB_VIEWPORTS entry. */
export const CASES: readonly Case[] = [...build(), ...labCases(process.env.LAB_VIEWPORTS)];

/** The cases a test names, in the order named. A name that no case has stops the run at load, so a renamed case can never leave a test with nothing to run. */
export function casesNamed(...names: string[]): Case[] {
  return names.map((n) => {
    const c = CASES.find((k) => k.name === n);
    if (c === undefined) throw new Error(`layout matrix: no viewport case named "${n}"`);
    return c;
  });
}

/** The two cases where a card covers both panes right down to the hint line and is the narrowest and shortest there is: a lab screen at 150% and the floor. */
export const NARROW_CASES: readonly Case[] = casesNamed('1024x768 @150% (CSS 682x512)', 'floor 640x360');

/** Runs `body` in a fresh page at the case's size, and always closes its context. */
export async function withPage(browser: Browser, c: Case, body: (page: Page) => Promise<void>): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: c.dsf });
  try {
    await body(await ctx.newPage());
  } finally {
    await ctx.close();
  }
}

/** The lab-standard cases (their fit rule is 'normal' or 'no-scroll'): 1366 x 768 and 1920 x 1080 at 100% and 125%, each both ways. */
export const LAB_STANDARD_CASES: readonly Case[] = CASES.filter((c) => c.fit !== 'any' && !c.name.startsWith('lab '));
if (LAB_STANDARD_CASES.length !== 6) throw new Error(`layout matrix: expected 6 lab-standard cases, found ${LAB_STANDARD_CASES.length}`);
