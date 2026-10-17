// @vitest-environment jsdom
// Spec §4.5 tests 1 and 7 on the real page: boot() with the real terminal, card view and plot renderer in jsdom, driven by key and
// click events, and "refreshed" by booting again over the same sessionStorage. The headless tests (controller-back.test.ts,
// replay.test.ts) use fakes for all three; this file says that what a student SEES agrees: Back shows, at every screen, the page the
// live run had there; running forward again reproduces it; a refresh, at any point and mid-print too, shows the page it came from.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_HINT, RESTORED_NOTICE } from '../src/content';
import { ALL_OFF, withFeatures } from '../src/features';
import { EXTRAS, SCRIPT, hintCommand } from '../src/hints';
import { formatCommand } from '../src/parser';
import { boot, type BootEnv, type Booted } from '../src/shell';
import { checkedManifest, fakeUrls } from './helpers/assetEnv';
import { FIXTURE, MemStore, loadIndexHtml } from './helpers/shellEnv';
import { mulberry32 } from './helpers/rng';
import { cardCount, forwardRun, screenKeys, screensOf, standingOn, type ScriptDriver } from './helpers/script';

const FILE_URL = 'file:///C:/Users/lab/Desktop/ancient-dna-workshop.html';
const FEATS = withFeatures({ back: true }, ALL_OFF);

let store: MemStore;
const clock = { t: 0 };

/** Loads a fresh copy of index.html and boots on it over the same sessionStorage: what F5 does. */
function start(over: Partial<BootEnv> = {}): Booted {
  loadIndexHtml();
  return boot({
    doc: document, href: FILE_URL, getStorage: () => store as unknown as Storage, replaceUrl: () => {}, data: FIXTURE,
    features: FEATS, now: () => clock.t, ...over,
  });
}

const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('#terminal input')!;
const card = (): HTMLElement => document.getElementById('card')!;
const backButton = (): HTMLButtonElement => document.getElementById('back') as HTMLButtonElement;
const cardButton = (cls: 'card-back' | 'card-continue' | 'card-credits'): HTMLButtonElement => card().querySelector<HTMLButtonElement>(`.${cls}`)!;

function press(key: 'Enter' | 'Escape' | 'Tab', repeat = false): void {
  input().dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true }));
}
function typeLine(line: string): void {
  input().value = line;
  press('Enter');
}
/** Staggered logs take at most 2.8 s, and an after-card opens when its log ends. */
async function settle(ms = 4000): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** An element and everything under it as text, attributes sorted: the order a page set them in is not something a student sees. */
function canon(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return JSON.stringify(node.textContent);
  if (!(node instanceof Element)) return '';
  const attrs = [...node.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort().join(' ');
  return `<${node.tagName.toLowerCase()} ${attrs}>${[...node.childNodes].map(canon).join('')}</>`;
}

/**
 * Everything a student sees, as text and markup. The restore notice is the one line a refresh adds on its own, and the prompt is the
 * one thing a refresh cannot bring back (what is typed in it is not part of the session), so a refresh compares without it.
 */
function shot(app: Booted, withPrompt = true) {
  return {
    lines: [...document.querySelectorAll('#terminal .term-out .term-line')]
      .filter((e) => !(e.classList.contains('term-line--notice') && e.textContent === RESTORED_NOTICE))
      .map((e) => `${e.className}|${e.textContent}`),
    hint: document.querySelector('#terminal .term-hint')!.textContent,
    prompt: withPrompt ? input().value : null,
    card: card().hidden ? null : canon(card()),
    plot: canon(document.getElementById('plot')!),
    backDisabled: backButton().disabled,
    screen: app.controller.screen,
    cardOpen: app.controller.cardOpen,
    hintIndex: app.controller.hintIndex,
  };
}
type Shot = ReturnType<typeof shot>;

/** The real page as the shared walk drives it: a typed command (the clock moved on, its staggered log waited for), Continue is the card's button. */
const dom = (app: Booted): ScriptDriver<Shot> => ({
  run: async (line) => {
    clock.t += 1000;
    typeLine(line);
    await settle();
  },
  continueCard: () => cardButton('card-continue').click(),
  snap: () => shot(app),
});

/** The page after the whole guided script, and the page at every screen on the way (the same live run, once per test). */
async function liveRun(): Promise<{ app: Booted; live: Map<string, Shot>; keys: string[] }> {
  const app = start();
  const live = new Map<string, Shot>();
  await forwardRun(dom(app), (key, s) => live.set(key, s));
  const keys = screenKeys();
  expect([...live.keys()]).toEqual(keys);
  return { app, live, keys };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  store = new MemStore();
  clock.t = 10_000;
});
afterEach(() => {
  expect(console.error).not.toHaveBeenCalled();     // the controller and the views log, never throw: a log here is a failure
  vi.restoreAllMocks();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('Back on the real page: spec §4.5 test 1, at every screen', () => {
  it('walking Back from the end shows, at every screen, the page the live run had there (header button on bare plots, the card\'s own on cards)', async () => {
    const { app, live, keys } = await liveRun();
    expect(backButton().disabled).toBe(false);
    for (let at = keys.length - 2; at >= 0; at--) {
      const here = shot(app).cardOpen !== null ? cardButton('card-back') : backButton();
      here.click();
      expect(shot(app), `Back to ${keys[at]}`).toEqual(live.get(keys[at]!));
    }
    expect(backButton().disabled).toBe(true);
    backButton().click();                                 // disabled: a click does nothing
    expect(shot(app)).toEqual(live.get('0.0'));
  });

  it('then running forward again (typing the same commands, clicking through the same cards) reproduces every screen', async () => {
    const { app, live, keys } = await liveRun();
    for (let at = keys.length - 2; at >= 0; at--) (shot(app).cardOpen !== null ? cardButton('card-back') : backButton()).click();
    const again: string[] = [];
    await forwardRun(dom(app), (key, s) => {
      again.push(key);
      expect(s, `forward again to ${key}`).toEqual(live.get(key));
    });
    expect(again).toEqual(keys);
  });

  it('and from a screen in the middle: Back by k screens, forward again, every later screen equals the live run', async () => {
    const { app, live, keys } = await liveRun();
    const from = 9;                                       // a card screen, deep in the script
    for (let at = keys.length - 1; at > from; at--) backButton().click();
    expect(shot(app)).toEqual(live.get(keys[from]!));
    const [step, cardIndex] = keys[from]!.split('.').map(Number) as [number, number];
    for (let j = cardIndex; j < cardCount(step - 1); j++) cardButton('card-continue').click();   // the cards of this step still ahead
    await forwardRun(dom(app), (key, s) => expect(s, `forward ${key}`).toEqual(live.get(key)), step);
  });
});

describe('a refresh on the real page shows the page it came from (spec §4.5 test 7, and after Back)', () => {
  it('after every Back of a walk from the end to the start: the same lines, hint, card, plot and Back button', async () => {
    const { live, keys } = await liveRun();
    let app = start();                                    // the page after a refresh at the end of the run
    expect(shot(app, false)).toEqual({ ...live.get(keys.at(-1)!)!, prompt: null });
    for (let at = keys.length - 2; at >= 0; at--) {
      (shot(app).cardOpen !== null ? cardButton('card-back') : backButton()).click();
      const before = shot(app, false);
      expect(before, `Back to ${keys[at]}`).toEqual({ ...live.get(keys[at]!)!, prompt: null });
      app = start();                                      // F5 here
      expect(shot(app, false), `refresh at ${keys[at]}`).toEqual(before);
      expect(document.querySelectorAll('#terminal .term-line--notice'), `${keys[at]}: the notice, once (the typing history comes back even to the first screen)`).toHaveLength(1);
    }
  });

  it('a refresh keeps the cut: after Back and a new command, the undone steps do not come back', async () => {
    let app = start();
    for (let i = 0; i < 5; i++) {                         // through bellBeaker, C1 closed
      clock.t += 1000;
      typeLine(formatCommand(SCRIPT[i]!));
      await settle();
      while (shot(app).cardOpen !== null) cardButton('card-continue').click();
    }
    backButton().click();                                 // C1
    backButton().click();                                 // the plot of step 4: bellBeaker is undone
    clock.t += 1000;
    typeLine('run_pca(period = "Roman")');                // off the script, in its place
    await settle();
    const before = shot(app, false);
    app = start();
    expect(shot(app, false)).toEqual(before);
    expect(app.controller.session.steps.map((s) => s.cmd)).toEqual([...SCRIPT.slice(0, 4).map(formatCommand), 'run_pca(period = "Roman")']);
  });
});

describe('the Back buttons and the dialogs', () => {
  it('both buttons do nothing behind the wrap screen or the credits panel: Shift+Tab can put focus on them there', async () => {
    const app = start();
    for (let i = 0; i < 3; i++) {
      clock.t += 1000;
      typeLine(formatCommand(SCRIPT[i]!));
      await settle();
    }
    expect(app.controller.cardOpen).toBe('A1');
    const open = shot(app);
    document.getElementById('wrap-open')!.click();        // the wrap screen
    backButton().click();
    cardButton('card-back').click();
    expect(shot(app)).toEqual(open);
    document.getElementById('wrap-credits')!.click();     // the credits panel, over the wrap screen
    backButton().click();
    cardButton('card-back').click();
    expect(shot(app)).toEqual(open);
    document.getElementById('credits-close')!.click();
    document.getElementById('wrap-close')!.click();
    cardButton('card-back').click();                      // both closed: now it steps back
    expect(app.controller.screen).toEqual({ step: 2, card: 0 });
    expect(document.activeElement).toBe(input());
  });

  it('the credits panel opened from a card\'s own button, with the wrap screen closed, makes both Back buttons inert too', async () => {
    const features = withFeatures({ back: true, 'images.B1': true }, ALL_OFF);
    const app = start({ features, assets: { manifest: checkedManifest(), urls: fakeUrls() } });
    for (let i = 0; i < 4; i++) {
      clock.t += 1000;
      typeLine(formatCommand(SCRIPT[i]!));
      await settle();
    }
    expect(app.controller.cardOpen).toBe('B1');
    cardButton('card-credits').click();   // "Image credits": B1 shows its photographs, so it has the button
    expect(document.getElementById('credits')!.hidden).toBe(false);
    expect(document.getElementById('wrap')!.hidden).toBe(true);
    const open = shot(app);
    backButton().click();
    cardButton('card-back').click();
    expect(shot(app)).toEqual(open);
    document.getElementById('credits-close')!.click();
    cardButton('card-back').click();                      // closed: now it steps back, from B1 to the plot of step 3
    expect(app.controller.screen).toEqual({ step: 3, card: 1 });
  });

  it('the header button is created disabled and is enabled by a restored session that has a step to go back to', async () => {
    let app = start();
    expect(backButton().disabled).toBe(true);
    clock.t += 1000;
    typeLine(formatCommand(SCRIPT[0]!));
    await settle();
    expect(backButton().disabled).toBe(false);
    app = start();
    expect(app.restored).toBe(true);
    expect(backButton().disabled).toBe(false);
    backButton().click();
    expect(backButton().disabled).toBe(true);
    app = start();
    expect(backButton().disabled).toBe(true);
  });
});

// ---- random sessions: live, Back and refresh on the real page ----

const HINT_BAD = ['nope', 'run_pca(period = "Jurassic")', 'run_pcaa(period = "IronAge")', ')))'];
const TABS = ['run_', 'allele_freq(gene = "H', 'run_p'];
const POOL = [...SCRIPT, ...EXTRAS].map(formatCommand);

/** Facts that hold on every screen of every session, whatever was pressed. */
function expectPageInvariants(app: Booted, label: string): void {
  const open = app.controller.cardOpen;
  expect(card().hidden, `${label}: the card is shown exactly when one is open`).toBe(open === null);
  if (open !== null) {
    expect(card().getAttribute('data-card-id'), label).toBe(open);
    expect(document.querySelector('#terminal .term-hint')!.textContent, `${label}: the hint line reads CARD_HINT with a card open`).toBe(CARD_HINT);
    expect(cardButton('card-back'), `${label}: every card has its Back button`).toBeTruthy();
  }
  expect(backButton().disabled, `${label}: Back is disabled exactly on the first screen`).toBe(!app.controller.canGoBack);
  expect(app.controller.canGoBack, label).toBe(app.controller.screen.step > 0);
}

describe('random sessions on the real page: refresh and Back at any point (fixed seeds)', () => {
  it('a refresh at any point, mid-print included, shows the page it came from; every Back lands one screen earlier; the invariants hold', async () => {
    let backs = 0;
    let refreshes = 0;
    let midPrint = 0;
    for (let run = 0; run < 60; run++) {
      store = new MemStore();
      clock.t = 10_000;
      const rng = mulberry32(0xd0e + run);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
      let app = start();
      const trail: string[] = [];
      for (let k = 0; k < 30; k++) {
        clock.t += rng() < 0.2 ? 100 : 500;
        const x = rng();
        let did = '';
        if (x < 0.3) {
          did = formatCommand(hintCommand(app.controller.hintIndex, app.controller.derived.extrasTick));
          typeLine(did);
        } else if (x < 0.38) {
          did = pick(POOL);
          typeLine(did);
        } else if (x < 0.44) {
          did = pick(HINT_BAD);
          typeLine(did);
        } else if (x < 0.46) {
          did = 'help()';
          typeLine(did);
        } else if (x < 0.48) {
          did = 'clear()';
          typeLine(did);
        } else if (x < 0.52) {
          did = `tab ${pick(TABS)}`;
          input().value = pick(TABS);
          press('Tab');
        } else if (x < 0.60) {
          did = 'blank Enter';
          input().value = '';
          press('Enter', rng() < 0.2);
        } else if (x < 0.65) {
          did = 'Esc';
          press('Escape', rng() < 0.2);
        } else if (x < 0.72) {
          did = 'Continue';
          if (!card().hidden) cardButton('card-continue').click();
        } else if (x < 0.92) {
          // Back: the header button, or the card's own when a card is open (the same action)
          const where = standingOn(app.controller);
          const list = screensOf(app.controller.derived.cardsFor);
          const at = list.findIndex((p) => p.step === where.step && p.card === where.card);
          expect(at, `${trail.join(' | ')}: ${JSON.stringify(where)} is one of the session's screens`).toBeGreaterThanOrEqual(0);
          if (!card().hidden && rng() < 0.5) cardButton('card-back').click();
          else backButton().click();
          did = `Back -> ${app.controller.screen.step}.${app.controller.screen.card}`;
          expect(app.controller.screen, `${trail.join(' | ')} | ${did}: Back moves one place down the list of screens`).toEqual(list[Math.max(0, at - 1)]);
          if (at > 0) backs++;
        } else {
          // F5. Mid-print, the refreshed page must show what the live one shows when its log ends: held after-cards open at once.
          did = 'refresh';
          const printing = app.terminal.isPrinting();
          const saved = new Map(store.map);
          await settle(4000);
          const before = shot(app, false);
          if (printing) {
            midPrint++;
            store.map = saved;                            // the page that is refreshed is the one saved mid-print
          }
          app = start();
          refreshes++;
          expect(shot(app, false), `${trail.join(' | ')} | refresh${printing ? ' (mid-print)' : ''}`).toEqual(before);
        }
        trail.push(did);
        await settle(rng() < 0.35 ? 120 : 4000);
        expectPageInvariants(app, `run ${run}: ${trail.join(' | ')}`);
      }
      // the end of every session: let the log finish and refresh once more
      await settle(4000);
      const before = shot(app, false);
      app = start();
      expect(shot(app, false), `run ${run} (end): ${trail.join(' | ')}`).toEqual(before);
    }
    expect(backs, 'the sessions really went Back').toBeGreaterThan(150);
    expect(refreshes, 'and refreshed').toBeGreaterThan(40);
    expect(midPrint, 'some of them in the middle of a log').toBeGreaterThan(3);
  }, 240_000);
});
