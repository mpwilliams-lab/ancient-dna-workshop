import { expect, test } from '@playwright/test';
import { SCRIPT } from '../src/hints';
import { formatCommand, PARSE_TEXT } from '../src/parser';
import { BEAKER_CALLOUT, EAST_ENGLAND_LEGEND, HLA_TEXT_CARD, PERIOD_LABELS, ROMAN_LOG_LINE } from '../src/content';
import { centreOf, DATA, freshStart, hintIndex, idle, plotSettled, run, screenViolations, watch } from './helpers';

test('the full guided script runs over file:// with zero network requests and no page errors', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  expect(await hintIndex(page)).toBe(0);
  expect(await screenViolations(page), 'on load').toEqual([]);

  for (let i = 0; i < SCRIPT.length; i++) {
    const step = SCRIPT[i];
    const cmd = formatCommand(step);
    const afterPlotClick = i === 0 || i === 3;
    if (afterPlotClick) {
      // Students click the plot, then type. Nothing here clicks or focuses the prompt, so the shell itself must have
      // handed the keyboard back to it (Task 13's document-level mouseup refocus). Step 0 clicks the empty plot
      // panel; step 3 clicks the PCA that step 2 drew.
      await page.locator(i === 0 ? '#plot' : '#plot svg').first().click();
      await page.keyboard.type(cmd, { delay: 5 });
      await page.keyboard.press('Enter');
      await idle(page);
    } else {
      await run(page, cmd, { typeDelay: 5 });
    }
    const how = afterPlotClick ? ', typed straight after a click on the plot (the prompt must keep the keyboard)' : '';
    expect(await hintIndex(page), `after ${cmd}${how}`).toBe(i + 1);
    // Spec §6: every rule holds on the text the built page actually shows after each step.
    expect(await screenViolations(page), `after ${cmd}`).toEqual([]);

    if (step.name === 'run_admixture') {
      // Spec v3 §3.2 rule 3: the plain Beaker callout is on screen and the v2.1 bridge line is gone.
      await expect(page.locator('#plot .admix-callout')).toHaveText(BEAKER_CALLOUT);
      await expect(page.locator('#plot .admix-bridge')).toHaveCount(0);
      expect((await page.locator('body').textContent()) ?? '').not.toMatch(/rises to \d+%, not 90%/);
    }

    if (step.name === 'run_pca' && step.period === 'Roman') {
      // Spec v3 §3.5: run_pca(period = "Roman") prints the Roman log line in the terminal.
      await expect(page.locator('#terminal')).toContainText(ROMAN_LOG_LINE);
    }

    if (step.name === 'run_pca') {
      // Beat 3: the black-outlined eastern-England points are explained in the legend, from the real data's `east` flags.
      // Before the Anglo-Saxon step there is no item. The v3 finale (run_pca(all), step 13) is not checked here: Task 8
      // shows the item only while Anglo-Saxon is in focus, and Task 14 rewrites this spec for the v3 script.
      const item = page.locator('#plot .legend-item[data-legend="east"]');
      if (step.period === 'AngloSaxon') {
        await expect(item).toHaveCount(1);
        await expect(item).toHaveText(EAST_ENGLAND_LEGEND);
        expect(await page.locator('#plot .pt.east').count(), 'outlined points on the plot').toBeGreaterThan(0);
      } else if (step.period !== 'all') {
        await expect(item, `after ${cmd}`).toHaveCount(0);
      }
    }

    if (step.name === 'allele_freq') {
      const trait = DATA.traits.find((t) => t.gene === step.gene)!;
      const plot = page.locator('#plot');
      if (trait.source === 'text') {
        await expect(plot).toContainText(HLA_TEXT_CARD);
      } else {
        const drawn = await plot.evaluate((host, nPoints) => {
          const svg = host.querySelector('svg');
          const svgW = svg ? svg.getBoundingClientRect().width : 0;
          const lines = [...host.querySelectorAll('path, polyline')].filter((p) => {
            const r = p.getBoundingClientRect();
            const nums = (p.getAttribute('d') ?? p.getAttribute('points') ?? '').match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
            return r.width >= 0.3 * svgW && nums.length / 2 >= Math.min(5, nPoints);
          }).length;
          const dots = [...host.querySelectorAll('circle')].filter((c) => c.getBoundingClientRect().width > 0).length;
          return { lines, dots };
        }, trait.points.length);
        expect(drawn.lines > 0 || drawn.dots >= trait.points.length, `${trait.gene} drew ${JSON.stringify(drawn)}`).toBe(true);
      }
    }
  }

  // Spec §6 on the extras students can reach (whole-Europe view, a period off the script, per-person bars).
  for (const extra of ['run_pca(period = "all")', 'run_pca(period = "Viking")', 'run_admixture(K = 3, period = "BellBeaker")']) {
    await run(page, extra);
    expect(await screenViolations(page), `after ${extra}`).toEqual([]);
  }

  // Spec v2.1 §5.3: consumer includes Today, so ancestry_test(person = "Today") shows bars like any period.
  await run(page, 'ancestry_test(person = "Today")');
  await expect(page.locator('#terminal')).toContainText(`Consumer-style ancestry test: ${PERIOD_LABELS.Today} (`);
  await expect(page.locator('#terminal')).not.toContainText('No consumer-test result for');
  expect(await screenViolations(page), 'after ancestry_test(person = "Today")').toEqual([]);

  // Spec §6 rule 7 + §3 wrap: the wrap screen text obeys the rules too.
  await page.locator('#wrap-open').click();
  await expect(page.locator('#wrap')).toBeVisible();
  expect(await screenViolations(page), 'wrap screen').toEqual([]);

  expect(w.requests).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('Iron Age -> Anglo-Saxon centre shift is at least 25 px at 1366x768 in the British frame', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await freshStart(page);
  await run(page, 'run_pca(period = "IronAge")');
  await run(page, 'run_pca(period = "AngloSaxon")');
  await plotSettled(page); // the frame animation is about 0.5 s; measure only once it has finished
  const a = await centreOf(page, '#plot .centre[data-centre="IronAge"]');
  const b = await centreOf(page, '#plot .centre[data-centre="AngloSaxon"]');
  const shift = Math.hypot(b.x - a.x, b.y - a.y);
  console.log(`AngloSaxon shift at 1366x768: ${shift.toFixed(1)} px`);
  expect(shift).toBeGreaterThanOrEqual(25);
});

test('Enter while a log is printing keeps plot actions in command order', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await run(page, 'run_pca(period = "IronAge")', { wait: false });
  await run(page, 'allele_freq(gene = "LCT")', { wait: false });
  await run(page, 'run_pca(period = "AngloSaxon")');
  await plotSettled(page);
  await expect(page.locator('#plot .centre[data-centre="AngloSaxon"]')).toHaveCount(1);
  expect(w.errors).toEqual([]);
});

test('typing the hint line exactly as shown, label and all, runs that step: no unknown-command error, and the hint moves on', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  // The first three steps (hook, load, Europe) show "Next: <command>"; the fourth onwards is covered at unit level for every
  // step and every extra (tests/hints.test.ts), since the predict line replaces the hint after run_pca(FirstFarmers).
  for (let i = 0; i < 3; i++) {
    const shown = ((await page.locator('#terminal .term-hint').textContent()) ?? '').trim();
    expect(shown, `the hint before step ${i}`).toBe(`Next: ${formatCommand(SCRIPT[i])}`);
    await run(page, shown, { typeDelay: 5 });
    expect(await hintIndex(page), `after typing "${shown}"`).toBe(i + 1);
  }
  await expect(page.locator('#terminal')).not.toContainText(PARSE_TEXT.unknownCommand);
  expect(w.requests).toEqual([]);
  expect(w.errors).toEqual([]);
});
