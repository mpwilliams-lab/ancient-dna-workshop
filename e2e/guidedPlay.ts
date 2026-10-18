// The guided script played the way a class plays it (spec §2.1, §5.3), for every proof that depends on what the plot and its legend hold at
// a guided step: from a fresh session each hinted command is typed at the prompt, and every card it opens is closed with a blank Enter after
// the repeat guard, up to and including one step (e2e/guided.spec.ts walks the same path with its own assertions). A shortcut such as the Iron
// Age and then the Roman period leaves the plot short of layers and the legend short of entries: at the Roman step a class's legend runs
// Bell Beaker, Bronze Age, Iron Age, Roman along its first row, which reaches under the plot's south-east corner, where the York traveller's
// arrow once landed on the Roman entry (Task 29, fix round 1) and no test saw it. The Roman proofs (e2e/p3-roman.spec.ts) and the instructor's
// preview (scripts/preview-maps.ts) both use this; guidedPlot is the same replay without a browser, for a vitest or a drawing.
import type { Page } from '@playwright/test';
import { FEATURES, type Features } from '../src/features';
import { SCRIPT, SCRIPT_STEPS } from '../src/hints';
import { formatCommand } from '../src/parser';
import type { PlotState } from '../src/plotState';
import { derive } from '../src/replay';
import type { StepId, WorkshopData } from '../src/types';

/** Spec §5.3: Enter within 400 ms of a card opening, or of the previous advance, is ignored; a little longer is waited (helpers.ts CARD_KEY_GAP_MS). */
const CARD_GAP_MS = 450;

/** The index in the guided script of the step with this id; throws for an id that is not a step. */
function stepIndex(upTo: StepId): number {
  const last = SCRIPT_STEPS.findIndex((s) => s.id === upTo);
  if (last < 0) throw new Error(`there is no guided step "${upTo}"`);
  return last;
}

/**
 * Plays the guided script from the start of a fresh session (the page is already open at `?reset`, its terminal ready) up to and including
 * the step with this id: each hinted command typed at the prompt, each card it opens shown and then closed with a blank Enter, and the plot
 * left as the class sees it once the last card has closed. Returns the commands typed, in order.
 */
export async function playGuided(page: Page, upTo: StepId): Promise<string[]> {
  const last = stepIndex(upTo);
  const prompt = page.locator('#terminal').locator('input, textarea').first();
  const idle = (): Promise<unknown> => page.waitForFunction(() => window.__adw !== undefined && !window.__adw.isPrinting());
  await idle();
  const typed: string[] = [];
  for (let i = 0; i <= last; i++) {
    const cmd = formatCommand(SCRIPT[i]!);
    typed.push(cmd);
    await prompt.click();
    await prompt.pressSequentially(cmd);
    await prompt.press('Enter');
    await idle();
    for (const id of SCRIPT_STEPS[i]!.cards?.ids ?? []) {
      await page.locator(`#card[data-card-id="${id}"]`).waitFor({ state: 'visible' });
      await page.waitForTimeout(CARD_GAP_MS);
      await prompt.press('Enter');
    }
    await page.locator('#card').waitFor({ state: 'hidden' });
  }
  return typed;
}

/**
 * The plot a class has at the end of one guided step, by replay and no browser: the same commands in the same order, run through the same
 * forward step as a live session (src/replay.ts), under the shipped flags unless `features` says otherwise.
 */
export function guidedPlot(data: WorkshopData, upTo: StepId, features: Features = FEATURES): PlotState {
  const steps = SCRIPT.slice(0, stepIndex(upTo) + 1).map((c) => ({ cmd: formatCommand(c) }));
  return derive(data, steps, steps.length, features).plot;
}
