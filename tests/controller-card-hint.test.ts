// @vitest-environment jsdom
// The hint line is set BEFORE a card is opened, so the card view places the card against the hint line it will have
// (carry-forward from the Task 14 review). The step hint is one line and CARD_HINT two at the smallest lab screens (682 x 512).
// A card placed against the step hint and then followed by CARD_HINT sits 15.6 px over the hint line, and a ResizeObserver
// reports only a size that differs from the last one it reported, so a close and an open inside one frame can leave it there.
// The geometry itself is checked in a real browser (e2e/back.spec.ts); here the order of the controller's two calls.
import { describe, expect, it } from 'vitest';
import { CARD_HINT } from '../src/content';
import { NEXT_PREFIX } from '../src/hints';
import { loadSession } from '../src/session';
import { STEP, closeCards, rig, runSteps, settle, type Rig } from './helpers/controllerRig';

/** The cards opened after the first `n` opens, and what the hint line read as each of them opened. */
function since(r: Rig, n: number): { ids: string[]; hints: string[] } {
  return { ids: r.cards.opens.slice(n).map((o) => o.id), hints: r.cards.hintsAtOpen.slice(n) };
}

describe('every path that opens a card finds CARD_HINT on the hint line already', () => {
  it('an after-card, when its step\'s log ends on its own', async () => {
    const r = rig();
    runSteps(r, 0, 2);
    r.term.holdPrints = true;
    r.c.submit(STEP(2));                                   // europe: A1 after its log
    expect(r.term.hint).toBe(NEXT_PREFIX + STEP(3));       // the step hint while the log prints
    expect(r.cards.opens).toEqual([]);
    await settle(r);
    expect(since(r, 0)).toEqual({ ids: ['A1'], hints: [CARD_HINT] });
  });

  it('an after-card whose log is already on screen when the command is accepted', () => {
    const r = rig();
    runSteps(r, 0, 2);
    r.c.submit(STEP(2));
    expect(since(r, 0)).toEqual({ ids: ['A1'], hints: [CARD_HINT] });
  });

  it('Continue to the next card of a step', () => {
    const r = rig();
    runSteps(r, 0, 7);
    const earlier = r.cards.opens.length;
    r.c.submit(STEP(7));                                   // ironAge: E1, E2, E3
    closeCards(r.c);
    expect(since(r, earlier)).toEqual({ ids: ['E1', 'E2', 'E3'], hints: [CARD_HINT, CARD_HINT, CARD_HINT] });
  });

  it('a "before" card, on acceptance of its command', () => {
    const r = rig();
    runSteps(r, 0, 14);
    const earlier = r.cards.opens.length;
    r.c.submit(STEP(14));                                  // lct: H1 and H2 come before its plot
    expect(since(r, earlier)).toEqual({ ids: ['H1'], hints: [CARD_HINT] });
  });

  it('the card a refresh reopens', () => {
    const live = rig();
    runSteps(live, 0, 7);
    live.c.submit(STEP(7));
    live.c.continueCard();                                 // E2 of E1-E3 is open
    const restored = rig({ restored: loadSession(live.store) });
    expect(since(restored, 0)).toEqual({ ids: ['E2'], hints: [CARD_HINT] });
  });

  it('a ?test card', () => {
    const r = rig();
    r.c.openCardForTest('K2');
    expect(since(r, 0)).toEqual({ ids: ['K2'], hints: [CARD_HINT] });
  });
});
