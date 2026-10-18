// The picture path of the instructor's map preview (npm run preview-maps, Tasks 20 and 29). tests/preview-maps.test.ts runs the script with
// --no-cards (no browser), so what only a browser can do is checked here: the script builds a scratch copy of the app with the flags forced
// on (e2e/mapBuild.ts), opens the Roman slide F1 and the Roman plot at the two lab screens and saves a picture of each. The whole page is
// made once, into a temporary folder (assets/preview, the instructor's own copy, is never touched), and checked for the F1 inset (Task 29:
// its card pictures, with the verdict of the fit, a 1366 x 768 card that has dropped the inset being a real outcome there) and for the York
// traveller (a picture of the plot pane with his mark at each screen).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { SCRIPT_STEPS } from '../src/hints';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('the whole preview page takes the card pictures of the F1 inset and the plot pictures of the York traveller at both lab screens', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'the script drives its own Chromium: one project is enough');
  test.setTimeout(300_000);
  const out = mkdtempSync(join(tmpdir(), 'adw-preview-e2e-'));
  try {
    const r = spawnSync('npm', ['run', 'preview-maps', '--', '--out', out], { cwd: ROOT, encoding: 'utf8', timeout: 280_000 });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stderr, 'the script did not fall back to estimated sizes').not.toContain('could not take the card pictures');
    for (const f of ['cards/F1inset-1366x768.png', 'cards/F1inset-1920x1080.png', 'plots/york-1366x768.png', 'plots/york-1920x1080.png']) {
      expect(existsSync(resolve(out, f)), `${f} was written`).toBe(true);
      expect(statSync(resolve(out, f)).size, `${f} is a real picture`).toBeGreaterThan(5_000);
    }
    const html = readFileSync(resolve(out, 'maps.html'), 'utf8').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    const inset = html.slice(html.indexOf('<section id="F1inset">'), html.indexOf('</section>', html.indexOf('<section id="F1inset">')));
    // The pictures are in the page. (The inset alone is "estimated" at a screen whose slide has hidden it: there is nothing to measure.)
    for (const f of ['cards/F1inset-1366x768.png', 'cards/F1inset-1920x1080.png']) expect(inset, f).toContain(`src="${f}"`);
    // Each screen's caption says what was measured there: the slide keeps its form with the inset on, or it has no room and drops to compact
    // (which hides the inset). Which of the two a screen gets is pinned by e2e/p3-roman.spec.ts, not here.
    const verdicts = inset.match(/The slide keeps its "(?:normal|dense)" form with the inset on\.|it drops to its "(?:compact|scroll)" form, which hides the pictures and the inset\./g) ?? [];
    expect(verdicts, 'one measured verdict for each lab screen').toHaveLength(2);
    const york = html.slice(html.indexOf('<section id="york-traveller">'), html.indexOf('</section>', html.indexOf('<section id="york-traveller">')));
    for (const f of ['plots/york-1366x768.png', 'plots/york-1920x1080.png']) expect(york, f).toContain(`src="${f}"`);
    expect(york).not.toContain('estimated');
    // Each plot picture is taken at the Roman step of the guided run: every guided command from the start typed, as a class gets there, not a
    // shortcut (the Iron Age, then the Roman period) that leaves the plot and its legend short (Task 29, fix round 1). The caption says how many.
    const typed = SCRIPT_STEPS.findIndex((s) => s.id === 'roman') + 1;
    expect(typed, 'more commands than the shortcut\'s two').toBeGreaterThan(2);
    expect(york.match(new RegExp(`after the ${typed} guided commands a class types from the start`, 'g')), 'one picture at each screen, after every guided command up to the Roman step').toHaveLength(2);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
