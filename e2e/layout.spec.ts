import { expect, test } from '@playwright/test';
import { SCRIPT } from '../src/hints';
import { formatCommand } from '../src/parser';
import { APP_URL, centreOf, idle, plotSettled, prompt, run } from './helpers';

interface Case { name: string; width: number; height: number; dsf: number }

const SCREENS: [number, number][] = [[1024, 768], [1280, 720], [1280, 1024], [1366, 768], [1920, 1080]];
const SCALES = [1, 1.25, 1.5];
const cases: Case[] = [];
for (const [w, h] of SCREENS) {
  for (const s of SCALES) {
    // Spec §8: the same viewport at device scale factor 1, 1.25, 1.5.
    cases.push({ name: `${w}x${h} dsf ${s}`, width: w, height: h, dsf: s });
    // What Windows display scaling really does to a full-screen (F11) Edge window: fewer CSS px.
    if (s !== 1) cases.push({ name: `${w}x${h} @${s * 100}% (CSS ${Math.floor(w / s)}x${Math.floor(h / s)})`, width: Math.floor(w / s), height: Math.floor(h / s), dsf: s });
  }
}
// Floor: the smallest screen at 150% in a normal (not full-screen) Edge window with the taskbar.
cases.push({ name: 'floor 640x360', width: 640, height: 360, dsf: 1.5 });
// Lab resolutions read on Mon 19 Oct, e.g. LAB_VIEWPORTS="1600x900@1.25,1440x900@1"
for (const spec of (process.env.LAB_VIEWPORTS ?? '').split(',').filter(Boolean)) {
  const m = /^(\d+)x(\d+)@([\d.]+)$/.exec(spec.trim());
  if (!m) throw new Error(`bad LAB_VIEWPORTS entry: ${spec}`);
  const [w, h, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
  cases.push({ name: `lab ${w}x${h} @${s * 100}%`, width: Math.floor(w / s), height: Math.floor(h / s), dsf: s });
}

for (const c of cases) {
  test(`no page scroll, prompt + hint + plot visible: ${c.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: c.dsf });
    const page = await ctx.newPage();
    await page.goto(`${APP_URL}?reset`);
    await expect(prompt(page)).toBeVisible();
    // Fill the terminal well past one screen of output (Enter mid-print flushes, so this is quick).
    const filler = ['load_genomes()', 'run_pca(period = "all")', 'run_admixture(K = 3)', 'run_pca(period = "Viking")', 'run_pca(period = "AngloSaxon")', 'allele_freq(gene = "LCT")'];
    for (let round = 0; round < 3; round++) {
      for (const cmd of filler) await run(page, cmd, { wait: false });
    }
    await idle(page);
    // The test only means something if the terminal output really overflowed into its own scroller.
    const scrolled = await page.evaluate(() =>
      [...document.querySelectorAll('#terminal *')].some((e) => {
        const oy = getComputedStyle(e).overflowY;
        return (oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1;
      }),
    );
    expect(scrolled, 'terminal output overflows into an internal scroller').toBe(true);

    const m = await page.evaluate(() => ({
      sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth,
      bh: document.body.scrollHeight, bw: document.body.scrollWidth,
      ih: window.innerHeight, iw: window.innerWidth,
    }));
    expect(m.sh, 'page height').toBeLessThanOrEqual(m.ih);
    expect(m.bh, 'body height').toBeLessThanOrEqual(m.ih);
    expect(m.sw, 'page width').toBeLessThanOrEqual(m.iw);
    expect(m.bw, 'body width').toBeLessThanOrEqual(m.iw);

    const inView = async (label: string, box: { x: number; y: number; width: number; height: number } | null) => {
      expect(box, `${label} box`).not.toBeNull();
      expect(box!.height, `${label} height`).toBeGreaterThan(0);
      expect(box!.y, `${label} top`).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, `${label} bottom`).toBeLessThanOrEqual(c.height + 0.5);
      expect(box!.x + box!.width, `${label} right`).toBeLessThanOrEqual(c.width + 0.5);
    };
    await inView('prompt', await prompt(page).boundingBox());
    const hint = page.locator('#terminal').getByText(formatCommand(SCRIPT[0])).last();
    await inView('hint', await hint.boundingBox());
    const plot = await page.locator('#plot').boundingBox();
    await inView('plot', plot);
    expect(plot!.width, 'plot width').toBeGreaterThanOrEqual(240);
    expect(plot!.height, 'plot height').toBeGreaterThanOrEqual(150);

    // Spec §7: terminal on the left, plot on the right (no case here is narrow or portrait enough to stack).
    const term = await page.locator('#terminal').boundingBox();
    expect(term, 'terminal box').not.toBeNull();
    expect(term!.x + term!.width, 'terminal left of plot').toBeLessThanOrEqual(plot!.x + 1);

    // RF5: the Iron Age -> Anglo-Saxon centre shift is at least 25 px on every lab screen and scale.
    await run(page, 'run_pca(period = "IronAge")');
    await run(page, 'run_pca(period = "AngloSaxon")');
    await plotSettled(page); // the frame animation is about 0.5 s; measure only once it has finished
    const a = await centreOf(page, '#plot .centre[data-centre="IronAge"]');
    const b = await centreOf(page, '#plot .centre[data-centre="AngloSaxon"]');
    expect(Math.hypot(b.x - a.x, b.y - a.y), 'Anglo-Saxon shift').toBeGreaterThanOrEqual(25);

    // Wrap screen: the whole QR is on screen.
    await page.locator('#wrap-open').click();
    await inView('QR', await page.locator('#wrap-qr svg').boundingBox());
    await page.locator('#wrap-close').click();
    await expect(page.locator('#wrap')).toBeHidden();
    await ctx.close();
  });
}
