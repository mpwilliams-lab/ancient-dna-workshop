// @vitest-environment jsdom
// Spec §4.4 (Enter/Esc/auto-fill table), §5.2 focus, §5.3 repeat guard, §5.4 keys test, CONTRACT §4.8-§4.9, §4.15.
// Drives the REAL shell (boot) through keydown events: terminal -> controller -> CardView, as on a lab machine.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot, hasTestFlag, makeTestHook, type BootEnv, type Booted } from '../src/shell';
import { AUTOFILL_NOTE, CARD_REPEAT_GUARD_MS } from '../src/controller';
import { CARDS } from '../src/cards';
import { CARD_HINT, cardCounter } from '../src/content';
import { ALL_OFF, FEATURES, withFeatures, type Features } from '../src/features';
import { SCRIPT, SCRIPT_STEPS, hintText } from '../src/hints';
import { formatCommand } from '../src/parser';
import { INITIAL_DERIVED } from '../src/replay';
import { CARD_IDS } from '../src/types';
import { checkedManifest, fakeUrls } from './helpers/assetEnv';
import { FIXTURE, MemStore, loadIndexHtml } from './helpers/shellEnv';

const FILE_URL = 'file:///C:/Users/lab/Desktop/ancient-dna-workshop.html';
const IRON_AGE = SCRIPT_STEPS.findIndex((s) => s.id === 'ironAge');   // after: E1, E2, E3
const ANGLO_SAXON = SCRIPT_STEPS.findIndex((s) => s.id === 'angloSaxon'); // after: G1, G2 (G2 has photos)

let clock = 10_000;
let store: MemStore;

function start(href = FILE_URL, s: MemStore = store, features: Features = ALL_OFF, assets?: BootEnv['assets']): Booted {
  return boot({
    doc: document, href, getStorage: () => s as unknown as Storage, replaceUrl: () => {}, data: FIXTURE,
    features, now: () => clock, ...(assets ? { assets } : {}),
  });
}
const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('#terminal input')!;
const card = (): HTMLElement => document.getElementById('card')!;
const cardId = (): string | null => (card().hidden ? null : card().getAttribute('data-card-id'));
const hint = (): string => document.querySelector('#terminal .term-hint')!.textContent ?? '';
const continueButton = (): HTMLButtonElement => card().querySelector<HTMLButtonElement>('.card-continue')!;
function keydown(key: 'Enter' | 'Escape', repeat = false): void {
  input().dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true }));
}
function typeLine(line: string): void {
  input().value = line;
  keydown('Enter');
}
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(4000);   // staggered logs take at most 2.8 s; after-cards open when they end
}
/** Continue clicks are never throttled (spec §5.3), so they close a step's cards without touching the clock. */
function clickThroughCards(): void {
  for (let i = 0; i < 10 && !card().hidden; i++) continueButton().click();
  expect(card().hidden).toBe(true);
}
/** Runs SCRIPT[0..n) the way a student does, closing every card on the way. */
async function runSteps(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    typeLine(formatCommand(SCRIPT[i]!));
    await settle();
    clickThroughCards();
  }
}
/** Runs up to and including the Iron Age step: E1 (1 of 3) is then open. */
async function toIronAgeCards(): Promise<Booted> {
  const b = start();
  await runSteps(IRON_AGE);
  typeLine(formatCommand(SCRIPT[IRON_AGE]!));
  await settle();
  expect(cardId()).toBe('E1');
  return b;
}
/** The Iron Age cards with E3 (the last one) open, reached by Continue clicks. */
async function toLastIronAgeCard(): Promise<Booted> {
  const b = await toIronAgeCards();
  continueButton().click();
  continueButton().click();
  expect(cardId()).toBe('E3');
  return b;
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 10_000;
  store = new MemStore();
  loadIndexHtml();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('cards open over the plot on the guided path', () => {
  it('after-cards open when the Iron Age log ends, in order, with their counters, and the hint line shows CARD_HINT', async () => {
    await toIronAgeCards();
    expect(card().querySelector('#card-title')!.textContent).toBe(CARDS.E1.title);
    expect(card().querySelector('.card-counter')!.textContent).toBe(cardCounter(1, 3));
    expect(hint()).toBe(CARD_HINT);
  });
  it('the prompt keeps focus while a card is open, and gets it back after a Continue click', async () => {
    await toIronAgeCards();
    expect(document.activeElement).toBe(input());
    const cont = continueButton();
    cont.focus();
    cont.click();
    expect(cardId()).toBe('E2');
    expect(document.activeElement).toBe(input());
  });
  it('the prompt has the keyboard after every Continue click, including the one that closes the last card', async () => {
    await toIronAgeCards();
    for (const next of ['E2', 'E3', null]) {
      const cont = continueButton();
      cont.focus();
      expect(document.activeElement).toBe(cont);
      cont.click();
      expect(cardId()).toBe(next);
      expect(document.activeElement).toBe(input());
    }
  });
  it('the prompt also gets the keyboard back after a click on the card\'s Back button (over the start it only closes a ?test card)', () => {
    const b = start(`${FILE_URL}?test`, store, withFeatures({ back: true }, ALL_OFF));
    makeTestHook(b).openCard!('A1');
    const back = card().querySelector<HTMLButtonElement>('.card-back')!;
    back.focus();
    expect(document.activeElement).toBe(back);
    back.click();
    expect(document.activeElement).toBe(input());
    expect(cardId()).toBeNull();                       // Task 17: Back closes the ?test card first (nothing to go back to here)
    expect(b.controller.screen).toEqual({ step: 0, card: 0 });
  });
});

describe('repeat guard (spec §5.3, §5.4 keys test)', () => {
  it('a held Enter (one press, then ten repeat keydowns) on card 1 of 3 leaves card 2 open', async () => {
    await toIronAgeCards();
    clock += 500;
    keydown('Enter');
    expect(cardId()).toBe('E2');
    for (let i = 0; i < 10; i++) {
      clock += 30;
      keydown('Enter', true);
    }
    expect(cardId()).toBe('E2');
  });
  it('two Enters 100 ms apart advance only one card', async () => {
    await toIronAgeCards();
    clock += 500;
    keydown('Enter');
    expect(cardId()).toBe('E2');
    clock += 500;
    keydown('Enter');
    expect(cardId()).toBe('E3');
    clock += 100;
    keydown('Enter');
    expect(cardId()).toBe('E3');
  });
  it('an Enter within 400 ms of a card opening is ignored; Continue clicks are never throttled', async () => {
    await toIronAgeCards();
    clock += 100;
    keydown('Enter');
    expect(cardId()).toBe('E1');
    continueButton().click();
    continueButton().click();
    expect(cardId()).toBe('E3');
  });
  it('the window is exactly 400 ms: an Enter 399 ms after the opening is ignored, one at 400 ms advances', async () => {
    await toIronAgeCards();
    expect(CARD_REPEAT_GUARD_MS).toBe(400);
    clock += CARD_REPEAT_GUARD_MS - 1;
    keydown('Enter');
    expect(cardId()).toBe('E1');
    clock += 1;
    keydown('Enter');
    expect(cardId()).toBe('E2');
    clock += CARD_REPEAT_GUARD_MS - 1;
    keydown('Enter');
    expect(cardId()).toBe('E2');
    clock += 1;
    keydown('Enter');
    expect(cardId()).toBe('E3');
  });
  it('a repeat Esc is ignored too', async () => {
    await toIronAgeCards();
    clock += 500;
    keydown('Escape', true);
    expect(cardId()).toBe('E1');
  });
  it('a repeat keydown is ignored even after the 400 ms window: the first auto-repeat of a held key comes about 500 ms after the press', async () => {
    await toIronAgeCards();
    clock += 500;
    keydown('Enter');                         // the press: E1 -> E2
    expect(cardId()).toBe('E2');
    clock += 600;
    keydown('Enter', true);                   // the first auto-repeat
    expect(cardId()).toBe('E2');
    clock += 33;
    keydown('Escape', true);
    expect(cardId()).toBe('E2');
  });
});

describe('Esc after the last card (spec §5.3: a double-pressed or held key moves at most one card)', () => {
  it('a second Esc 100 ms after the last card closed does not fill the hinted command; one 400 ms after does', async () => {
    const b = await toLastIronAgeCard();
    clock += 500;
    keydown('Escape');                        // closes E3
    expect(cardId()).toBeNull();
    clock += 100;
    keydown('Escape');                        // the second press of a double Esc
    expect(input().value).toBe('');
    clock += CARD_REPEAT_GUARD_MS - 101;
    keydown('Escape');                        // 399 ms after the card closed
    expect(input().value).toBe('');
    clock += 1;
    keydown('Escape');                        // 400 ms
    expect(input().value).toBe(formatCommand(SCRIPT[IRON_AGE + 1]!));
    expect(b.controller.hintIndex).toBe(IRON_AGE + 1);
  });
  it('a held Esc (the repeat keydowns that follow the one that closed the last card) fills nothing', async () => {
    await toLastIronAgeCard();
    clock += 500;
    keydown('Escape');
    expect(cardId()).toBeNull();
    for (let i = 0; i < 10; i++) {
      clock += 30;
      keydown('Escape', true);
    }
    expect(input().value).toBe('');
    clock += 600;                             // a slow first auto-repeat, outside the 400 ms window, is still a repeat
    keydown('Escape', true);
    expect(input().value).toBe('');
    expect(cardId()).toBeNull();
  });
  it('Esc with no card in play still fills the hinted command at once', async () => {
    start();
    keydown('Escape');
    expect(input().value).toBe(formatCommand(SCRIPT[0]!));
  });
});

describe('Enter, Esc and three tries with a card open (spec §4.4 table)', () => {
  it('blank Enter advances; after the last card the hint line shows the step hint again', async () => {
    const b = await toIronAgeCards();
    for (const id of ['E2', 'E3']) {
      clock += 500;
      keydown('Enter');
      expect(cardId()).toBe(id);
      expect(hint()).toBe(CARD_HINT);
    }
    clock += 500;
    keydown('Enter');
    expect(cardId()).toBeNull();
    expect(hint()).toBe(hintText(b.controller.hintIndex, SCRIPT[IRON_AGE]!, 0));
  });
  it('Esc with text in the prompt advances one card and leaves the text alone', async () => {
    await toIronAgeCards();
    input().value = 'run_pca(';
    clock += 500;
    keydown('Escape');
    expect(cardId()).toBe('E2');
    expect(input().value).toBe('run_pca(');
  });
  it('Enter with text closes the remaining cards of the step, then runs the line (a bad line counts as a try)', async () => {
    const b = await toIronAgeCards();
    clock += 500;
    typeLine('nonsense()');
    await settle();
    expect(cardId()).toBeNull();
    expect(b.controller.badTries).toBe(1);
    expect(b.controller.screen).toEqual({ step: IRON_AGE + 1, card: 3 });   // the skipped cards stay screens for Back
    expect(document.querySelector('#terminal .term-out')!.textContent).toContain('nonsense()');
  });
  it('card advances never count toward the three tries: three blank Enters close three cards, no auto-fill', async () => {
    const b = await toIronAgeCards();
    for (let i = 0; i < 3; i++) {
      clock += 500;
      keydown('Enter');
    }
    expect(cardId()).toBeNull();
    expect(b.controller.badTries).toBe(0);
    expect(input().value).toBe('');
    expect(document.querySelector('#terminal .term-out')!.textContent).not.toContain(AUTOFILL_NOTE);
  });
  it('the wrap screen takes Esc before the card: Esc closes the wrap and the card stays on the same index', async () => {
    await toIronAgeCards();
    document.getElementById('wrap-open')!.click();
    const close = document.getElementById('wrap-close')!;
    expect(document.getElementById('wrap')!.hidden).toBe(false);
    clock += 500;
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.getElementById('wrap')!.hidden).toBe(true);
    expect(cardId()).toBe('E1');
  });
  it('the next Esc, now typed in the prompt, advances that card as usual (focus came back with the wrap closing)', async () => {
    await toIronAgeCards();
    document.getElementById('wrap-open')!.click();
    clock += 500;
    document.getElementById('wrap-close')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(cardId()).toBe('E1');
    expect(document.activeElement).toBe(input());
    keydown('Escape');
    expect(cardId()).toBe('E2');
  });
});

describe('the credits panel and the wrap screen take Esc before the card (spec §5.2; RF4; Task 15)', () => {
  const byId = (id: string): HTMLElement => document.getElementById(id)!;
  const counter = (): string => card().querySelector('.card-counter')!.textContent ?? '';
  const escOn = (el: Element): void => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  };

  it('Esc on the credits panel (opened from the wrap screen over a card) closes only the panel; the card stays on the same index; the wrap closes on the next Esc and the card still stays', async () => {
    await toIronAgeCards();
    continueButton().click();                                  // E2, 2 of 3: a card that is not the first
    expect(counter()).toBe(cardCounter(2, 3));
    clock += 500;
    byId('wrap-open').click();
    byId('wrap-credits').click();
    expect(byId('credits').hidden).toBe(false);
    expect(document.activeElement).toBe(byId('credits-close'));
    escOn(document.activeElement!);
    expect(byId('credits').hidden).toBe(true);
    expect(byId('wrap').hidden).toBe(false);
    expect([cardId(), counter()]).toEqual(['E2', cardCounter(2, 3)]);
    expect(document.activeElement).toBe(byId('wrap-close'));
    escOn(document.activeElement!);
    expect(byId('wrap').hidden).toBe(true);
    expect([cardId(), counter()]).toEqual(['E2', cardCounter(2, 3)]);
    expect(document.activeElement).toBe(input());
    clock += 500;
    keydown('Escape');                                         // now the card takes it
    expect(cardId()).toBe('E3');
  });
  it('Esc on the credits panel opened from the card\'s own Image credits button closes only the panel and leaves the card on its index (G2, 2 of 2)', async () => {
    start(FILE_URL, store, withFeatures({ 'images.G2': true }, ALL_OFF), { manifest: checkedManifest(), urls: fakeUrls() });
    await runSteps(ANGLO_SAXON);
    typeLine(formatCommand(SCRIPT[ANGLO_SAXON]!));
    await settle();
    expect(cardId()).toBe('G1');
    expect(card().querySelector('.card-credits'), 'G1 is a map card in its text form').toBeNull();
    continueButton().click();
    expect([cardId(), counter()]).toEqual(['G2', cardCounter(2, 2)]);
    card().querySelector<HTMLButtonElement>('.card-credits')!.click();
    expect(byId('credits').hidden).toBe(false);
    expect(document.activeElement).toBe(byId('credits-close'));
    clock += 500;
    escOn(document.activeElement!);
    expect(byId('credits').hidden).toBe(true);
    expect([cardId(), counter()]).toEqual(['G2', cardCounter(2, 2)]);
    expect(document.activeElement).toBe(input());
    keydown('Escape');                                         // the card, not the panel, takes this one: G2 is the last card
    expect(cardId()).toBeNull();
  });
  it('Shift+Tab can take focus out of the wrap screen. An Esc typed in the prompt then closes the wrap and does not move the card or fill the prompt', async () => {
    await toIronAgeCards();
    clock += 500;
    byId('wrap-open').click();
    expect(document.activeElement).toBe(byId('wrap-close'));
    input().focus();                                           // what Shift+Tab does: focus leaves the dialog for the prompt
    keydown('Escape');
    expect(byId('wrap').hidden).toBe(true);
    expect([cardId(), counter()]).toEqual(['E1', cardCounter(1, 3)]);
    clock += 500;
    keydown('Escape');
    expect(cardId()).toBe('E2');
  });
  it('the same with no card open: Esc in the prompt closes the wrap and does not fill the prompt with the hinted command', () => {
    start();
    expect(cardId()).toBeNull();
    byId('wrap-open').click();
    input().focus();
    keydown('Escape');
    expect(byId('wrap').hidden).toBe(true);
    expect(input().value).toBe('');
    keydown('Escape');                                         // with the wrap closed, Esc fills the hinted command as before
    expect(input().value).not.toBe('');
  });
  it('Shift+Tab out of the credits panel: an Esc typed in the prompt closes the panel only, whether the wrap screen is open under it or not', async () => {
    await toIronAgeCards();
    clock += 500;
    byId('wrap-open').click();
    byId('wrap-credits').click();
    input().focus();
    keydown('Escape');
    expect(byId('credits').hidden).toBe(true);
    expect(byId('wrap').hidden).toBe(false);
    expect([cardId(), counter()]).toEqual(['E1', cardCounter(1, 3)]);
    byId('wrap-close').click();
    byId('wrap-credits').click();                              // the panel opened with no wrap screen under it
    expect(byId('wrap').hidden).toBe(true);
    input().focus();
    keydown('Escape');
    expect(byId('credits').hidden).toBe(true);
    expect([cardId(), counter()]).toEqual(['E1', cardCounter(1, 3)]);
    expect(input().value).toBe('');
  });
  it('a held Esc (auto-repeat) that closes the panel does not advance the card either', async () => {
    await toIronAgeCards();
    clock += 500;
    byId('wrap-credits').click();
    escOn(document.activeElement!);                            // closes the panel
    keydown('Escape', true);                                   // the repeats that follow reach the prompt
    keydown('Escape', true);
    expect([cardId(), counter()]).toEqual(['E1', cardCounter(1, 3)]);
  });
});

describe('refresh with a card open (spec §4.2 restore, §4.5 Playwright part in unit form)', () => {
  it('a restored session reopens the open card at the same index', async () => {
    await toIronAgeCards();
    clock += 500;
    keydown('Enter');
    expect(cardId()).toBe('E2');
    loadIndexHtml();
    const again = start(FILE_URL, store);
    expect(again.restored).toBe(true);
    expect(cardId()).toBe('E2');
    expect(card().querySelector('.card-counter')!.textContent).toBe(cardCounter(2, 3));
    expect(again.controller.cardOpen).toBe('E2');
    expect(hint()).toBe(CARD_HINT);
  });
});

describe('test hooks (spec §4.2, §5.4; CONTRACT §4.15)', () => {
  it('hasTestFlag reads ?test and nothing else', () => {
    expect(hasTestFlag(`${FILE_URL}?test`)).toBe(true);
    expect(hasTestFlag(`${FILE_URL}?reset&test`)).toBe(true);
    expect(hasTestFlag(`${FILE_URL}?testing`)).toBe(false);
    expect(hasTestFlag(FILE_URL)).toBe(false);
    expect(hasTestFlag('not a url')).toBe(false);
  });
  it('without ?test the hook is read-only: no openCard', () => {
    const hook = makeTestHook(start());
    expect(hook.openCard).toBeUndefined();
    expect(hook.screen()).toEqual({ step: 0, card: 0 });
    expect(hook.cardOpen()).toBeNull();
    expect(hook.features).toEqual(ALL_OFF);
    expect(Object.isFrozen(hook.features)).toBe(true);
  });
  it('the hook reads the controller live: hintIndex, isPrinting, restored, storage and the screen after a real card opens', async () => {
    const b = await toIronAgeCards();
    const hook = makeTestHook(b);
    expect(hook.hintIndex()).toBe(IRON_AGE + 1);
    expect(hook.isPrinting()).toBe(false);
    expect(hook.restored).toBe(false);
    expect(hook.storage).toBe(true);
    expect(hook.screen()).toEqual({ step: IRON_AGE + 1, card: 0 });
    expect(hook.cardOpen()).toBe('E1');
    const shown = hook.screen();
    shown.card = 99;                                   // a copy: editing it changes nothing
    expect(hook.screen()).toEqual({ step: IRON_AGE + 1, card: 0 });
  });
  it('with ?test, openCard shows any card over the current plot and changes no state; Continue closes it', async () => {
    const b = start(`${FILE_URL}?test`);
    await runSteps(2);
    const before = { screen: b.controller.screen, hint: b.controller.hintIndex, session: JSON.stringify(b.controller.session) };
    const hook = makeTestHook(b);
    expect(typeof hook.openCard).toBe('function');
    hook.openCard!('L3');
    expect(cardId()).toBe('L3');
    expect(hook.cardOpen()).toBe('L3');
    expect(hint()).toBe(CARD_HINT);
    expect(b.controller.screen).toEqual(before.screen);
    expect(b.controller.hintIndex).toBe(before.hint);
    expect(JSON.stringify(b.controller.session)).toBe(before.session);
    continueButton().click();
    expect(cardId()).toBeNull();
    expect(hook.cardOpen()).toBeNull();
    expect(hint()).toBe(hintText(2, SCRIPT[1]!, 0));
    expect(document.activeElement).toBe(input());
  });
  it('a ?test card also closes on a blank Enter or Esc, and ignores an unknown id', () => {
    const b = start(`${FILE_URL}?test`);
    const hook = makeTestHook(b);
    hook.openCard!('Z9' as never);
    expect(cardId()).toBeNull();
    hook.openCard!('A1');
    keydown('Enter');
    expect(cardId()).toBeNull();
    hook.openCard!('B1');
    keydown('Escape');
    expect(cardId()).toBeNull();
    expect(input().value).toBe('');   // that Esc closed the card; it did not fill the hint
  });
  it('Enter with text closes a ?test card and then runs the line', () => {
    const b = start(`${FILE_URL}?test`);
    makeTestHook(b).openCard!('A1');
    typeLine('help()');
    expect(cardId()).toBeNull();
    expect(b.controller.session.history).toEqual(['help()']);
    expect(document.querySelector('#terminal .term-out')!.textContent).toContain('> help()');
  });
  it('the hook hands out a frozen copy of the flags, not the booted set itself', () => {
    const b = start();
    const hook = makeTestHook(b);
    expect(hook.features).not.toBe(b.features);
    expect(hook.features).toEqual(b.features);
    expect(Object.isFrozen(hook.features)).toBe(true);
  });
  it('a ?test card never hides a real one: openCard is ignored while a guided card is open or waits for its log', async () => {
    const b = start(`${FILE_URL}?test`);
    const hook = makeTestHook(b);
    await runSteps(IRON_AGE);
    typeLine(formatCommand(SCRIPT[IRON_AGE]!));   // the Iron Age log is still printing: E1 is held, not open yet
    hook.openCard!('L3');
    expect(cardId()).toBeNull();
    expect(hook.cardOpen()).toBeNull();
    await settle();
    expect(cardId()).toBe('E1');
    hook.openCard!('L3');                         // E1 is open now
    expect(cardId()).toBe('E1');
    expect(hook.cardOpen()).toBe('E1');
  });
  it('opening every card through the hook leaves CARDS, SCRIPT, SCRIPT_STEPS and INITIAL_DERIVED untouched', () => {
    const snapshot = (): string => JSON.stringify([CARDS, SCRIPT, SCRIPT_STEPS, INITIAL_DERIVED]);
    const before = snapshot();
    const hook = makeTestHook(start(`${FILE_URL}?test`));
    for (const id of CARD_IDS) {
      hook.openCard!(id);
      expect(cardId()).toBe(id);
    }
    continueButton().click();
    expect(cardId()).toBeNull();
    expect(snapshot()).toBe(before);
  });
  it('the shipped flag set is what boot uses by default', () => {
    const b = boot({ doc: document, href: FILE_URL, getStorage: () => store as unknown as Storage, replaceUrl: () => {}, data: FIXTURE });
    expect(b.features).toEqual(FEATURES);
    expect(b.test).toBe(false);
  });
});
