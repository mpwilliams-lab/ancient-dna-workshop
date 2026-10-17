import { expect, test, type Page } from '@playwright/test';
import { NEXT_PREFIX, SCRIPT, SCRIPT_STEPS } from '../src/hints';
import { formatCommand, PARSE_TEXT } from '../src/parser';
import { CARDS } from '../src/cards';
import { FEATURES } from '../src/features';
import {
  BEAKER_CALLOUT, CARD_HINT, cardCounter, CONSUMER_BARS_LOG, EAST_ENGLAND_LEGEND, EUROPE_HELD_BACK, FINALE_CAPTION, HLA_REVEAL_LINE,
  HLA_TEXT_CARD, ME_RESULT, PERIOD_LABELS, PREDICT_HINT, REVEAL_CALLOUT, REVEAL_HINT, ROMAN_LOG_LINE, TODAY_PLACED,
} from '../src/content';
import { consumerRows } from '../src/plots/consumer';
import { PERIOD_IDS, type PeriodId } from '../src/types';
import {
  cardOpen, centreOf, closeCardWithEnter, consumerBarsShown, DATA, focusLayer, freshStart, hintIndex, idle, layersShown, plotSettled,
  prompt, run, screenViolations, terminalBars, watch,
} from './helpers';

const REVEAL_PCA = SCRIPT_STEPS.findIndex((s) => s.id === 'revealPca');

/** The plot after SCRIPT[0..i] under the shipped flags (spec §2.3): the view, and the layers in time order (Today only once run). */
function expectedAfter(i: number): { view: string; layers: PeriodId[] } {
  let view = 'none';
  const layers = new Set<PeriodId>();
  for (const c of SCRIPT.slice(0, i + 1)) {
    if (c.name === 'run_pca') {
      view = 'pca';
      if (c.period === 'all') for (const p of PERIOD_IDS) layers.add(p);
      else if (c.period !== 'Europe') layers.add(c.period);
    } else if (c.name === 'run_admixture') view = 'admixture';
    else if (c.name === 'allele_freq') view = 'trait';
    else if (c.name === 'ancestry_test' && FEATURES.consumerBars) view = 'consumer';
  }
  return { view, layers: PERIOD_IDS.filter((p) => layers.has(p)) };
}

/** The hint line before step i on the guided path: the Predict line before BellBeaker, the Reveal line before Today. */
function hintBefore(i: number): string {
  const step = SCRIPT[i]!;
  if (step.name === 'run_pca' && step.period === 'BellBeaker') return PREDICT_HINT;
  if (step.name === 'run_pca' && step.period === 'Today') return REVEAL_HINT;
  return NEXT_PREFIX + formatCommand(step);
}

test('the 19-step guided script runs over file://: cards in order, Britain today held back, callouts switch; no network, no errors', async ({ page }) => {
  test.setTimeout(300_000);
  const w = watch(page);
  await freshStart(page);
  expect(await hintIndex(page)).toBe(0);
  expect(await screenViolations(page), 'on load').toEqual([]);

  for (let i = 0; i < SCRIPT.length; i++) {
    const step = SCRIPT[i]!;
    const cmd = formatCommand(step);
    await expect(page.locator('#terminal .term-hint'), `hint before step ${i}`).toHaveText(hintBefore(i));

    const afterPlotClick = i === 0 || i === 3;
    if (afterPlotClick) {
      // Students click the plot, then type: the shell must hand the keyboard back to the prompt by itself.
      // Step 3 follows step 2 (run_pca Europe), whose card A1 covers the plot column while it is open. The card loop below
      // closed it at the end of the previous iteration; this pins that the click lands on the plot and not on a card.
      await expect(page.locator('#card'), `no card covers the plot before step ${i}`).toBeHidden();
      await page.locator(i === 0 ? '#plot' : '#plot svg').first().click();
      await page.keyboard.type(cmd, { delay: 5 });
      await page.keyboard.press('Enter');
      await idle(page);
    } else {
      await run(page, cmd, { typeDelay: 5 });
    }
    expect(await hintIndex(page), `after ${cmd}`).toBe(i + 1);

    // Cards (spec §2.1, §5.3): after-cards open when the log ends, before-cards on acceptance; each one in order.
    const cards = SCRIPT_STEPS[i]!.cards;
    const ids = cards?.ids ?? [];
    for (let j = 0; j < ids.length; j++) {
      const id = ids[j]!;
      const card = page.locator(`#card[data-card-id="${id}"]`);
      await expect(card, `${cmd}: card ${id}`).toBeVisible();
      await expect(card.locator('#card-title')).toHaveText(CARDS[id].title);
      await expect(card.locator('.card-counter')).toHaveText(cardCounter(j + 1, ids.length));
      await expect(page.locator('#terminal .term-hint')).toHaveText(CARD_HINT);
      expect(await cardOpen(page)).toBe(id);
      expect(await screenViolations(page), `with card ${id} open`).toEqual([]);
      await closeCardWithEnter(page);
    }
    await expect(page.locator('#card')).toBeHidden();
    expect(await screenViolations(page), `after ${cmd}`).toEqual([]);

    // Task 18: consumer bars, shipped set only (spec §10.3). Steps 0 and 8.
    if (step.name === 'ancestry_test') {
      const bars = page.locator('#plot svg[data-view="consumer"] g.consumer-bar');
      if (FEATURES.consumerBars) {
        await expect(page.locator('#plot')).toHaveAttribute('data-view', 'consumer');
        const want = step.person === 'me' ? ME_RESULT.length : (DATA.consumer[step.person] ?? []).length;
        await expect(bars).toHaveCount(want);
        await expect(page.locator('#terminal')).toContainText(CONSUMER_BARS_LOG);
        // The bars are the terminal's numbers: the same labels and whole percents, in the same order (the last `want` bar lines are this command's).
        const rows = consumerRows(DATA, step.person).map((r) => `${r.label} ${r.pct}%`);
        expect(await consumerBarsShown(page), `the bars after ${cmd}`).toEqual(rows);
        expect((await terminalBars(page)).slice(-want), `the terminal's bar lines after ${cmd}`).toEqual(rows);
        // Britain today is not shown yet (instructor feedback): neither bars nor words for it before the reveal step.
        await expect(page.locator('#plot')).not.toContainText(PERIOD_LABELS.Today);
      } else {
        await expect(bars).toHaveCount(0);
        await expect(page.locator('#terminal')).not.toContainText(CONSUMER_BARS_LOG);
      }
    }

    // The plot under the cards (spec §2.3).
    const exp = expectedAfter(i);
    await expect(page.locator('#plot')).toHaveAttribute('data-view', exp.view);
    if (exp.view === 'pca') {
      await plotSettled(page);
      expect([...(await layersShown(page))].sort(), `layers after ${cmd}`).toEqual([...exp.layers].sort());
      if (step.name === 'run_pca' && step.period !== 'Europe' && step.period !== 'all') {
        expect(await focusLayer(page), `focus after ${cmd}`).toBe(step.period);
      }
    }
    if (i < REVEAL_PCA) {
      // Britain today is held back until the reveal (spec §1.1 decision 4).
      await expect(page.locator('#plot g.layer.period[data-layer="Today"]'), `no Britain today after ${cmd}`).toHaveCount(0);
      await expect(page.locator('#plot .today-ring'), `no Britain today rings after ${cmd}`).toHaveCount(0);
    }

    if (step.name === 'run_pca') {
      // The eastern-England outline is explained in the legend only while Anglo-Saxon is in focus.
      const east = page.locator('#plot .legend-item[data-legend="east"]');
      if (step.period === 'AngloSaxon') {
        await expect(east).toHaveCount(1);
        await expect(east).toHaveText(EAST_ENGLAND_LEGEND);
      } else {
        await expect(east, `after ${cmd}`).toHaveCount(0);
      }
      if (step.period === 'Europe') await expect(page.locator('#terminal')).toContainText(EUROPE_HELD_BACK);
      if (step.period === 'Today') await expect(page.locator('#terminal')).toContainText(TODAY_PLACED);
      if (step.period === 'Roman') await expect(page.locator('#terminal')).toContainText(ROMAN_LOG_LINE);
    }

    if (step.name === 'run_admixture') {
      // Step 5: Beaker callout; step 10: the reveal callout and its note. No bridge line anywhere (spec §3.2-§3.3).
      const reveal = SCRIPT_STEPS[i]!.id === 'revealAdmix';
      const svg = page.locator('#plot svg[data-callout]');
      await expect(svg).toHaveAttribute('data-callout', reveal ? 'reveal' : 'beaker');
      await expect(svg).toHaveAttribute('aria-label', reveal ? REVEAL_CALLOUT : BEAKER_CALLOUT);
      await expect(page.locator('#plot .admix-reveal-note')).toHaveCount(reveal ? 1 : 0);
      await expect(page.locator('#plot .admix-bridge')).toHaveCount(0);
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
        if (step.gene === 'HLA-DQ2') await expect(page.locator('#plot .traj-reveal')).toHaveText(HLA_REVEAL_LINE);
      }
    }
  }

  // The extras (spec §2.1), in rotation order; none opens a card.
  for (const extra of ['run_pca(period = "Viking")', 'run_admixture(K = 3, period = "BellBeaker")', 'ancestry_test(person = "Today")', 'run_admixture(K = 3)']) {
    await run(page, extra);
    await expect(page.locator('#card')).toBeHidden();
    expect(await screenViolations(page), `after ${extra}`).toEqual([]);
  }
  await expect(page.locator('#terminal')).toContainText(`Consumer-style ancestry test: ${PERIOD_LABELS.Today} (`);
  await expect(page.locator('#plot svg[data-callout]')).toHaveAttribute('data-callout', 'reveal');

  // Wrap screen.
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
  await plotSettled(page);
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
  await expect(page.locator('#card')).toBeHidden();   // off-script runs open no card
  expect(w.errors).toEqual([]);
});

test('typing the hint line exactly as shown, label and all, runs that step (step 2 is Europe)', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  for (let i = 0; i < 3; i++) {
    const shown = ((await page.locator('#terminal .term-hint').textContent()) ?? '').trim();
    expect(shown, `the hint before step ${i}`).toBe(`Next: ${formatCommand(SCRIPT[i]!)}`);
    await run(page, shown, { typeDelay: 5 });
    expect(await hintIndex(page), `after typing "${shown}"`).toBe(i + 1);
  }
  expect(formatCommand(SCRIPT[2]!)).toBe('run_pca(period = "Europe")');
  await expect(page.locator('#card[data-card-id="A1"]')).toBeVisible();
  await expect(page.locator('#terminal')).not.toContainText(PARSE_TEXT.unknownCommand);
  expect(w.requests).toEqual([]);
  expect(w.errors).toEqual([]);
});

/**
 * A finale that is over, jumped to or run out, leaves nothing behind (computed styles, so a fade that was never undone shows):
 * every period layer and every legend item at full opacity, the pulse ring and its halo invisible, nothing still running.
 */
async function expectFinaleOver(page: Page, when: string): Promise<void> {
  const state = await page.evaluate(() => {
    const opacities = (sel: string): string[] => [...document.querySelectorAll(sel)].map((e) => getComputedStyle(e).opacity);
    return {
      layers: opacities('#plot g.layer.period'),
      legend: opacities('#plot g.legend-item'),
      pulse: opacities('#plot circle.finale-pulse-halo, #plot circle.finale-pulse'),
      running: document.getElementById('plot')!.getAnimations({ subtree: true }).length,
    };
  });
  expect(state.layers, `${when}: every period layer is fully in`).toEqual(Array(8).fill('1'));
  expect(state.legend.length, `${when}: the legend is there`).toBeGreaterThanOrEqual(8);
  expect(new Set(state.legend), `${when}: every legend item is fully in`).toEqual(new Set(['1']));
  expect(state.pulse, `${when}: the pulse (halo, ring) is invisible`).toEqual(['0', '0']);
  expect(state.running, `${when}: nothing is still running`).toBe(0);
}

test('finale: run_pca(period = "all") under the shipped flag set (animated, or static when the flag is off)', async ({ page }) => {
  const w = watch(page);
  await freshStart(page);
  await run(page, 'run_pca(period = "IronAge")');
  await run(page, 'run_pca(period = "all")');
  const svg = page.locator('#plot svg.plot-svg[data-view="pca"]');
  const caption = page.locator('#plot p.pca-caption[data-caption="FINALE_CAPTION"]');
  await expect(page.locator('#plot g.layer.period')).toHaveCount(8);
  if (FEATURES.finaleAnimation) {
    await expect(svg).toHaveAttribute('data-animating', 'true');
    await expect(caption).toBeHidden();
    // Spec §4.4: a blank Enter jumps to the final frame.
    await prompt(page).press('Enter');
    await expect(svg).not.toHaveAttribute('data-animating', 'true');
    await expect(caption).toBeVisible();
    await expect(caption).toHaveText(FINALE_CAPTION);
    await expectFinaleOver(page, 'after the jump');
    // Left alone, it ends by itself in about 5.5 s.
    await run(page, 'run_pca(period = "all")');
    await expect(svg).toHaveAttribute('data-animating', 'true');
    await expect(caption).toBeVisible({ timeout: 10_000 });
    await expect(svg).not.toHaveAttribute('data-animating', 'true');
    await expectFinaleOver(page, 'after it ran out');
  } else {
    await expect(caption).toBeVisible();
    expect(await svg.getAttribute('data-animating')).toBeNull();
  }
  // Restore draws the final frame directly.
  await page.reload();
  await idle(page);
  await expect(caption).toBeVisible();
  expect(await svg.getAttribute('data-animating')).toBeNull();
  expect(await page.evaluate(() => document.getElementById('plot')!.getAnimations({ subtree: true }).length)).toBe(0);
  expect(w.requests).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('finale: Back and a typed command during the animation end it (spec §4.4, §4.5 test 6)', async ({ page }) => {
  test.skip(!FEATURES.finaleAnimation || !FEATURES.back, 'the finale or Back is off in the shipped set');
  const w = watch(page);
  await freshStart(page);
  await run(page, 'run_pca(period = "IronAge")');
  const svg = page.locator('#plot svg.plot-svg[data-view="pca"]');
  const running = (): Promise<number> => page.evaluate(() => document.getElementById('plot')!.getAnimations({ subtree: true }).length);

  // Back: the finale jumps to its end at once, and the earlier screen is drawn directly, with nothing left running.
  await run(page, 'run_pca(period = "all")');
  await expect(svg).toHaveAttribute('data-animating', 'true');
  await page.locator('#back').click();
  await expect(svg).toHaveAttribute('data-focus', 'IronAge');
  expect(await svg.getAttribute('data-animating')).toBeNull();
  await expect(page.locator('#plot g.layer.period')).toHaveCount(1);
  await expect(page.locator('#plot p.pca-caption[data-caption="FINALE_CAPTION"]')).toHaveCount(0);
  expect(await running()).toBe(0);
  await expect(prompt(page)).toBeFocused();

  // A command typed during the finale ends it first: the new plot is drawn whole, with no half-played finale in it.
  await run(page, 'run_pca(period = "all")');
  await expect(svg).toHaveAttribute('data-animating', 'true');
  await run(page, 'run_pca(period = "Viking")');
  await expect(svg).toHaveAttribute('data-focus', 'Viking');
  expect(await svg.getAttribute('data-animating')).toBeNull();
  await plotSettled(page);
  expect(await running()).toBe(0);
  expect(w.requests).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('finale: with prefers-reduced-motion it is the static plot with its caption at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const w = watch(page);
  await freshStart(page);
  await run(page, 'run_pca(period = "IronAge")');
  await run(page, 'run_pca(period = "all")');
  const caption = page.locator('#plot p.pca-caption[data-caption="FINALE_CAPTION"]');
  await expect(page.locator('#plot g.layer.period')).toHaveCount(8);
  await expect(caption).toBeVisible();
  await expect(caption).toHaveText(FINALE_CAPTION);
  expect(await page.locator('#plot svg.plot-svg').getAttribute('data-animating')).toBeNull();
  await expect(page.locator('#plot circle.finale-pulse')).toHaveCount(0);
  expect(await page.evaluate(() => document.getElementById('plot')!.getAnimations({ subtree: true }).length)).toBe(0);
  expect(w.requests).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('finale: the plot keeps its size while the caption waits and when it appears (640 x 360, the smallest screen)', async ({ page }) => {
  test.skip(!FEATURES.finaleAnimation, 'the finale is off in the shipped set');
  await page.setViewportSize({ width: 640, height: 360 });
  await freshStart(page);
  await run(page, 'run_pca(period = "all")');
  const svg = page.locator('#plot svg.plot-svg[data-view="pca"]');
  const caption = page.locator('#plot p.pca-caption[data-caption="FINALE_CAPTION"]');
  await expect(svg).toHaveAttribute('data-animating', 'true');
  await expect(caption).toBeHidden();
  const waiting = await svg.boundingBox();
  await prompt(page).press('Enter');
  await expect(caption).toBeVisible();
  const shown = await svg.boundingBox();
  // A caption that took its room only when it appeared would shrink the svg, and the whole plot with it, in a short window.
  expect(shown!.height).toBeCloseTo(waiting!.height, 0);
  expect(shown!.width).toBeCloseTo(waiting!.width, 0);
});

test('finale: no period is listed in the legend or named by a tooltip before it appears', async ({ page }) => {
  test.skip(!FEATURES.finaleAnimation, 'the finale is off in the shipped set');
  const w = watch(page);
  await freshStart(page);
  const svg = page.locator('#plot svg.plot-svg[data-view="pca"]');
  const tip = page.locator('#plot .plot-tip');

  // Jump to the end once, to find a Britain today ring that is on top at its own centre: that spot names Britain today when hovered.
  await run(page, 'run_pca(period = "all")');
  await expect(svg).toHaveAttribute('data-animating', 'true');
  await prompt(page).press('Enter');
  await expect(svg).not.toHaveAttribute('data-animating', 'true');
  const probe = await page.evaluate(() => {
    for (const ring of document.querySelectorAll('#plot g.layer.period[data-layer="Today"] .pt')) {
      const b = ring.getBoundingClientRect();
      const x = b.x + b.width / 2;
      const y = b.y + b.height / 2;
      if (document.elementFromPoint(x, y) === ring) return { x, y };
    }
    return null;
  });
  expect(probe, 'a Britain today ring on top at its own centre').not.toBeNull();
  await page.mouse.move(probe!.x, probe!.y);
  await expect(tip).toHaveText(PERIOD_LABELS.Today);
  await page.mouse.move(2, 2); // out of the plot: the tip clears
  await expect(tip).toHaveText('');

  // Run it again. While it plays that same spot answers nothing, the period points and legend items take no pointer at all, and
  // Britain today is not in the legend yet (it fades in with its rings, 4.75 s in).
  await run(page, 'run_pca(period = "all")');
  await expect(svg).toHaveAttribute('data-animating', 'true');
  const playing = await page.evaluate(({ x, y }) => {
    const pointer = (sel: string): string[] => [...document.querySelectorAll(sel)].map((e) => getComputedStyle(e).pointerEvents);
    return {
      points: pointer('#plot g.layer.period .pt'),
      legend: pointer('#plot g.legend-item'),
      hit: document.elementFromPoint(x, y)?.closest('g.layer.period')?.getAttribute('data-layer') ?? null,
      todayLegend: getComputedStyle(document.querySelector('#plot g.legend-item[data-legend="Today"]')!).opacity,
    };
  }, probe!);
  expect(new Set(playing.points)).toEqual(new Set(['none']));
  expect(new Set(playing.legend)).toEqual(new Set(['none']));
  expect(playing.hit, 'what lies under the spot while it plays').toBeNull();
  expect(Number(playing.todayLegend), 'Britain today in the legend before its turn').toBeLessThan(1);
  await page.mouse.move(probe!.x, probe!.y);
  await expect(tip).not.toHaveText(PERIOD_LABELS.Today);

  // The jump gives the pointer back, and the legend is whole.
  await page.mouse.move(2, 2);
  await prompt(page).press('Enter');
  await expect(svg).not.toHaveAttribute('data-animating', 'true');
  const over = await page.evaluate(() => {
    const pointer = (sel: string): string[] => [...document.querySelectorAll(sel)].map((e) => getComputedStyle(e).pointerEvents);
    return { points: pointer('#plot g.layer.period .pt'), legend: pointer('#plot g.legend-item') };
  });
  expect(over.points).not.toContain('none');
  expect(over.legend).not.toContain('none');
  await expectFinaleOver(page, 'after the second jump');
  await page.mouse.move(probe!.x, probe!.y);
  await expect(tip).toHaveText(PERIOD_LABELS.Today);
  expect(w.requests).toEqual([]);
  expect(w.errors).toEqual([]);
});
