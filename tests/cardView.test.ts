// @vitest-environment jsdom
// Spec §5.2 (DOM, structure, text forms, no-scroll fit, focus), §3.4 P1 value bars, CONTRACT §4.11.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  barFraction, cardSourceLine, continueLabel, fitCard, LONG_VALUE_LIST, mountCardView, renderCardBody, upgradedFormShown,
  type CardRenderContext,
} from '../src/cardView';
import { CARDS, cardSource, cardStrings, cardVars, distributionRows, DISTRIBUTION_SCALE_MAX, fillCard } from '../src/cards';
import {
  BACK_BUTTON, BACK_BUTTON_LABEL, CARD_CONTINUE, CARD_CONTINUE_DONE, CARD_CONTINUE_TO_PLOT, CHIP_TEXT, cardCounter, IRELAND_FOOTNOTE,
  MAP_SOURCE_SUFFIX,
} from '../src/content';
import { validateData } from '../src/data';
import { ALL_OFF, ALL_ON, withFeatures, type Features } from '../src/features';
import { CARD_IDS, GENE_IDS, type CardId, type WorkshopData } from '../src/types';
import { ruleViolations } from './contentRules';
import { FIXTURE } from './fixtures/fixture';
import { loadIndexHtml } from './helpers/shellEnv';

const ctx = (over: Partial<CardRenderContext> = {}): CardRenderContext => ({
  data: FIXTURE, features: ALL_OFF, index: 0, count: 1, placement: 'after', showBack: false, ...over,
});
const body = (id: CardId, over: Partial<CardRenderContext> = {}): HTMLElement => renderCardBody(document, CARDS[id], ctx(over));
const texts = (root: ParentNode, sel: string): (string | null)[] => [...root.querySelectorAll(sel)].map((e) => e.textContent);
const VARS = cardVars(FIXTURE);
const fill = (s: string): string => fillCard(s, VARS);

describe('renderCardBody: every card in its P1 text form', () => {
  it.each(CARD_IDS)('%s renders with all flags off: filled title, no image, no map, templates filled', (id) => {
    const b = body(id);
    expect(b.classList.contains('card-body')).toBe(true);
    const title = b.querySelector('h2.card-title')!;
    expect(title.id).toBe('card-title');
    expect(title.textContent).toBe(fill(CARDS[id].title));
    expect(b.querySelector('img')).toBeNull();
    expect(b.querySelector('.card-map')).toBeNull();
    expect(b.textContent).not.toMatch(/[{}]/);
  });
  it.each(CARD_IDS)('%s still renders its text form with every flag on (no asset is ready before Tasks 15 and 20)', (id) => {
    expect(upgradedFormShown(CARDS[id], ALL_ON)).toBe(false);
    const b = body(id, { features: ALL_ON });
    expect(b.querySelector('img')).toBeNull();
    expect(b.querySelector('.card-map')).toBeNull();
  });
  it('keeps the §5.2 order: title, lead, chips, tiles, diagram, bullets/columns, panel, values, side note, lines, puzzle, source', () => {
    const order = ['card-title', 'card-lead', 'card-chips', 'card-tiles', 'card-diagram', 'card-bullets', 'card-columns', 'card-panel',
      'card-values', 'card-side-note', 'card-lines', 'card-puzzle', 'card-source'];
    for (const id of CARD_IDS) {
      const seen = [...body(id).children].map((c) => order.find((cls) => c.classList.contains(cls)));
      expect(seen.every((s) => s !== undefined), id).toBe(true);
      const idx = seen.map((s) => order.indexOf(s!));
      expect([...idx].sort((a, b) => a - b), id).toEqual(idx);
    }
  });
  it('B1: five named tiles (3 + 2 grid), names and lines as text, tiles 4-5 optional, no image caption in the text form', () => {
    const b = body('B1');
    const grid = b.querySelector('.card-tiles')!;
    expect(grid.getAttribute('data-count')).toBe('5');
    const figs = [...grid.querySelectorAll('figure.card-tile')];
    expect(figs.map((f) => f.getAttribute('data-image'))).toEqual(['stonehenge', 'avebury', 'ring-of-brodgar', 'thornborough-plan', 'castlerigg']);
    expect(figs.map((f) => f.classList.contains('is-optional'))).toEqual([false, false, false, true, true]);
    expect(texts(b, '.tile-name')).toEqual(CARDS.B1.tiles!.map((t) => t.name!));
    expect(texts(b, '.tile-caption')).toEqual(CARDS.B1.tiles!.map((t) => t.caption));
    expect(b.textContent).not.toContain('Plan of the three rings');
    expect(b.querySelector('.card-lead')!.textContent).toBe('Some took many generations to finish.');
  });
  it('C1: two chips with their icons and the Amesbury Archer panel', () => {
    const b = body('C1');
    const chips = [...b.querySelectorAll('.card-chips .chip')];
    expect(chips.map((c) => c.getAttribute('data-chip'))).toEqual(['CHIP_DNA_CHANGED', 'CHIP_CULTURE_CHANGED']);
    expect(chips.map((c) => c.textContent)).toEqual([CHIP_TEXT.CHIP_DNA_CHANGED, CHIP_TEXT.CHIP_CULTURE_CHANGED]);
    expect(chips.map((c) => c.classList.contains('chip--dna'))).toEqual([true, false]);
    expect(b.querySelectorAll('.chip-icon')).toHaveLength(2);
    expect(b.querySelector('.card-panel h3')!.textContent).toBe('The Amesbury Archer');
    expect(b.querySelector('.card-panel p')!.textContent).toBe(CARDS.C1.panel!.text);
  });
  it('E2 bullet 2 and G2 bullet 3 end with the "Culture changed, DNA did not" chip', () => {
    for (const [id, i] of [['E2', 1], ['G2', 2]] as const) {
      const items = [...body(id).querySelectorAll('.card-bullets > li')];
      expect(items[i]!.querySelector('.chip')!.getAttribute('data-chip')).toBe('CHIP_CULTURE_ONLY');
      expect(items.filter((li) => li.querySelector('.chip')).length).toBe(1);
    }
  });
  it('F1: two columns, "What changed" text and three "What the DNA shows" bullets with {n_Roman} filled', () => {
    const b = body('F1');
    expect(texts(b, '.card-column > h3')).toEqual(['What changed', 'What the DNA shows']);
    expect(b.querySelector('.card-column p')!.textContent).toBe("Roads, towns, villas, coins, Latin and Hadrian's Wall.");
    const items = texts(b, '.card-column ul > li');
    expect(items).toHaveLength(3);
    expect(items[2]).toContain(`Our ${VARS.n_Roman} Roman-group people`);
  });
  it('E1 text form: the Kent line in place of the map labels, source without the Natural Earth line', () => {
    const b = body('E1');
    expect(texts(b, '.card-lines > li')).toEqual(['The earliest found so far were buried in Kent.']);
    expect(b.querySelector('.card-source')!.textContent).toBe('Patterson et al. 2022.');
    expect(b.textContent).not.toContain(MAP_SOURCE_SUFFIX);
  });
  it('A1 text form shows no source line; no text-form card shows the Natural Earth line', () => {
    expect(body('A1').querySelector('.card-source')).toBeNull();
    for (const id of CARD_IDS) expect(body(id).textContent, id).not.toContain(MAP_SOURCE_SUFFIX);
    expect(body('E3').querySelector('.card-source')!.textContent).toBe(cardSource(CARDS.E3, false));
  });
  it('D2: the own diagram with its two labels', () => {
    const slot = body('D2').querySelector('.card-diagram')!;
    expect(slot.getAttribute('data-diagram')).toBe('fatherMotherLines');
    expect(texts(slot, 'svg text')).toEqual(CARDS.D2.diagram!.labels);
  });
  it('the puzzle line is its own highlighted paragraph on every distribution card', () => {
    for (const id of ['H2', 'I2', 'J3', 'K2', 'L3'] as const) expect(body(id).querySelector('.card-puzzle')!.textContent).toBe(CARDS[id].puzzle);
  });
});

describe('distribution cards: P1 value bars (spec §3.4)', () => {
  it.each(GENE_IDS)('%s: one value row per distributionRows entry, labels, numbers and bar widths on the right scale', (gene) => {
    const id = CARD_IDS.find((c) => CARDS[c].values === gene)!;
    const list = body(id).querySelector(`.card-values[data-gene="${gene}"]`)!;
    const rows = distributionRows(FIXTURE, gene);
    const items = [...list.querySelectorAll('li.value-row')];
    expect(items.map((li) => li.getAttribute('data-key'))).toEqual(rows.map((r) => r.key));
    expect(items.map((li) => li.querySelector('.value-label')!.textContent)).toEqual(rows.map((r) => r.label));
    expect(items.map((li) => li.querySelector('.value-num')!.textContent)).toEqual(rows.map((r) => r.display));
    expect(items.map((li) => li.querySelector('.value-bar')!.getAttribute('style'))).toEqual(
      rows.map((r) => `--v:${barFraction(r.value, DISTRIBUTION_SCALE_MAX[gene])}`),
    );
    expect(list.hasAttribute('data-long')).toBe(rows.length > LONG_VALUE_LIST);
  });
  it.each(GENE_IDS)('%s: a screen reader gets one "label: number" per row, and the bar (a picture of the same number) is hidden from it', (gene) => {
    const id = CARD_IDS.find((c) => CARDS[c].values === gene)!;
    const rows = distributionRows(FIXTURE, gene);
    const items = [...body(id).querySelectorAll(`.card-values[data-gene="${gene}"] li.value-row`)];
    expect(items).toHaveLength(rows.length);
    expect(items.map((li) => li.getAttribute('aria-label'))).toEqual(rows.map((r) => `${r.label}: ${r.display}`));
    for (const li of items) expect(li.querySelector('.value-bar')!.getAttribute('aria-hidden'), li.getAttribute('data-key') ?? '').toBe('true');
  });
  it('bar fractions: copies per 100 over the scale, TYK2 on 0-15, clamped to 0..1', () => {
    expect(barFraction(0.75, 100)).toBe(0.75);
    expect(barFraction(0.044, 15)).toBe(0.293);
    expect(barFraction(0, 15)).toBe(0);
    expect(barFraction(0.2, 15)).toBe(1);
  });
  it('H2 carries the Ireland footnote under its list', () => {
    expect(body('H2').querySelector('.card-side-note')!.textContent).toBe(IRELAND_FOOTNOTE);
  });
  it('a gene with no rows in the JSON shows no list (rows are data-driven)', () => {
    const d = structuredClone(FIXTURE);
    d.trait_maps.TYK2 = [];
    const list = renderCardBody(document, CARDS.K2, ctx({ data: d })).querySelector('.card-values')!;
    expect(list.querySelectorAll('li')).toHaveLength(0);
  });
});

describe('continueLabel (spec §3.5)', () => {
  it('Continue on every card but the last; the last says "Show the plot" (before) or "See the plot" (after)', () => {
    expect(continueLabel(0, 3, 'after')).toBe(CARD_CONTINUE);
    expect(continueLabel(1, 3, 'after')).toBe(CARD_CONTINUE);
    expect(continueLabel(2, 3, 'after')).toBe(CARD_CONTINUE_DONE);
    expect(continueLabel(0, 1, 'after')).toBe(CARD_CONTINUE_DONE);
    expect(continueLabel(0, 2, 'before')).toBe(CARD_CONTINUE);
    expect(continueLabel(1, 2, 'before')).toBe(CARD_CONTINUE_TO_PLOT);
  });
});

describe('fitCard (spec §5.2 no-scroll fit)', () => {
  /** Makes the card body overflow until the card reaches `fitsAt` ('never' = overflows at every level). */
  function mockOverflow(card: HTMLElement, fitsAt: 'normal' | 'dense' | 'compact' | 'never'): void {
    const b = card.querySelector('.card-body') as HTMLElement;
    const order = ['normal', 'dense', 'compact'];
    const level = (): string => (card.classList.contains('compact') ? 'compact' : card.classList.contains('dense') ? 'dense' : 'normal');
    Object.defineProperty(b, 'clientHeight', { configurable: true, get: () => 100 });
    Object.defineProperty(b, 'scrollHeight', {
      configurable: true,
      get: () => (fitsAt !== 'never' && order.indexOf(level()) >= order.indexOf(fitsAt) ? 100 : 180),
    });
  }
  function cardWith(fitsAt: 'normal' | 'dense' | 'compact' | 'never'): HTMLElement {
    const card = document.createElement('div');
    card.append(body('E1'));
    mockOverflow(card, fitsAt);
    return card;
  }
  it.each([
    ['normal', 'normal', []],
    ['dense', 'dense', ['dense']],
    ['compact', 'compact', ['dense', 'compact']],
    ['never', 'scroll', ['dense', 'compact', 'scroll']],
  ] as const)('fits at %s -> data-fit %s', (fitsAt, level, classes) => {
    const card = cardWith(fitsAt);
    expect(fitCard(card)).toBe(level);
    expect(card.getAttribute('data-fit')).toBe(level);
    expect(['dense', 'compact', 'scroll'].filter((c) => card.classList.contains(c))).toEqual(classes);
  });
  it('starts again from normal on every call (a resize can make a card fit again)', () => {
    const card = cardWith('never');
    fitCard(card);
    mockOverflow(card, 'normal');
    expect(fitCard(card)).toBe('normal');
    expect(card.className).toBe('');
  });
});

describe('mountCardView (the CardHost the controller drives)', () => {
  let onContinue: Mock<() => void>;
  let onBack: Mock<() => void>;
  let onCredits: Mock<() => void>;
  const root = (): HTMLElement => document.getElementById('card')!;
  beforeEach(() => {
    loadIndexHtml();
    onContinue = vi.fn<() => void>();
    onBack = vi.fn<() => void>();
    onCredits = vi.fn<() => void>();
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });
  const mount = (features = ALL_OFF) => mountCardView(root(), FIXTURE, { onContinue, onBack, onCredits }, features);

  it('index.html has the static #card region inside #panes, hidden, labelled by the card title', () => {
    const el = root();
    expect(el.parentElement!.id).toBe('panes');
    expect(el.hidden).toBe(true);
    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.getAttribute('aria-labelledby')).toBe('card-title');
  });
  it('open shows the card with its id, counter and Continue label; close hides and empties it', () => {
    const v = mount();
    expect(v.isOpen()).toBe(false);
    v.open('E1', 0, 3, 'after');
    const el = root();
    expect(el.hidden).toBe(false);
    expect(v.isOpen()).toBe(true);
    expect(v.currentId()).toBe('E1');
    expect(el.getAttribute('data-card-id')).toBe('E1');
    expect(el.classList.contains('card')).toBe(true);
    expect(el.getAttribute('data-fit')).toBe('normal');
    expect(el.querySelector('#card-title')!.textContent).toBe(CARDS.E1.title);
    expect(el.querySelector('.card-counter')!.textContent).toBe(cardCounter(1, 3));
    expect(el.querySelector('.card-continue')!.textContent).toBe(CARD_CONTINUE);
    v.open('E3', 2, 3, 'after');
    expect(el.querySelector('.card-counter')!.textContent).toBe('3 of 3');
    expect(el.querySelector('.card-continue')!.textContent).toBe(CARD_CONTINUE_DONE);
    v.open('H2', 1, 2, 'before');
    expect(el.querySelector('.card-continue')!.textContent).toBe(CARD_CONTINUE_TO_PLOT);
    v.close();
    expect(el.hidden).toBe(true);
    expect(el.childElementCount).toBe(0);
    expect(el.hasAttribute('data-card-id')).toBe(false);
    expect(v.currentId()).toBeNull();
    expect(v.refit()).toBe('normal');
  });
  it('the footer has exactly counter + Continue with every flag off: no Back, no Image credits', () => {
    const v = mount();
    v.open('B1', 0, 1, 'after');
    const footer = root().querySelector('footer.card-footer')!;
    expect([...footer.children].map((c) => c.className)).toEqual(['card-counter', 'card-continue']);
    expect(root().querySelector('.card-back')).toBeNull();
    expect(root().querySelector('.card-credits')).toBeNull();
    for (const b of footer.querySelectorAll('button')) expect(b.getAttribute('type')).toBe('button');
  });
  it('with the back flag on, the card shows its own Back button (labelled), which calls onBack', () => {
    const v = mount(withFeatures({ back: true }, ALL_OFF));
    v.open('E1', 0, 3, 'after');
    const back = root().querySelector<HTMLButtonElement>('.card-back')!;
    expect(back.textContent).toBe(BACK_BUTTON);
    expect(back.getAttribute('aria-label')).toBe(BACK_BUTTON_LABEL);
    back.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
  it('Continue calls the handler and nothing else (the controller decides what happens next)', () => {
    const v = mount();
    v.open('E1', 0, 3, 'after');
    root().querySelector<HTMLButtonElement>('.card-continue')!.click();
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(v.currentId()).toBe('E1');
    expect(onBack).not.toHaveBeenCalled();
    expect(onCredits).not.toHaveBeenCalled();
  });
  it('opening a card never takes focus from the prompt (spec §5.2 focus)', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const v = mount();
    v.open('A1', 0, 1, 'after');
    expect(document.activeElement).toBe(input);
  });
  it('records the space below the card (hint line and prompt stay visible below 1100 px) as --card-bottom', () => {
    const v = mount();
    v.open('A1', 0, 1, 'after');
    expect(root().style.getPropertyValue('--card-bottom')).toMatch(/^\d+px$/);
  });
  it('an unknown id opens nothing', () => {
    const v = mount();
    v.open('Z9' as CardId, 0, 1, 'after');
    expect(v.isOpen()).toBe(false);
  });
});

// ---- Added beyond the brief (Task 10 review carry-forward, RF3 drift, "a card never changes plot state") ----

const NOOP_HANDLERS = { onContinue: () => undefined, onBack: () => undefined, onCredits: () => undefined };
const FEATURE_SETS: [string, Features][] = [['all off', ALL_OFF], ['all on', ALL_ON], ['back only', withFeatures({ back: true }, ALL_OFF)]];

/** Every text node and aria-label of a rendered card (body and footer): what a person or a screen reader gets. */
function renderedStrings(root: Element): string[] {
  const out: string[] = [];
  for (const e of [root, ...root.querySelectorAll('*')]) {
    const label = e.getAttribute('aria-label');
    if (label) out.push(label);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t !== '') out.push(t);
  }
  return out;
}

/** Opens every card (first and last label variants, every flag set) and runs the spec §6 scan over what is really rendered. */
function scanRenderedCards(data: WorkshopData): void {
  for (const [name, features] of FEATURE_SETS) {
    const root = document.createElement('div');
    document.body.append(root);
    const view = mountCardView(root, data, NOOP_HANDLERS, features);
    for (const id of CARD_IDS) {
      for (const [index, count, placement] of [[0, 3, 'after'], [2, 3, 'before'], [0, 1, 'after']] as const) {
        view.open(id, index, count, placement);
        const strings = renderedStrings(root);
        expect(strings.length, `${name} ${id}`).toBeGreaterThan(3);
        expect(strings.filter((s) => ruleViolations(s).length > 0), `${name} ${id} ${placement}`).toEqual([]);
      }
    }
    view.close();
    root.remove();
  }
}

describe('rendered text: the content scanner covers what is really on the card', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  it('every string a card shows passes the spec §6 rules (body, counter, buttons, chips, value rows, aria-labels; every flag set)', () => {
    scanRenderedCards(FIXTURE);
  });
  it.each(CARD_IDS)('%s: its body text is the approved text and nothing else (nothing dropped, nothing added)', (id) => {
    const card = CARDS[id];
    const approved = new Set(cardStrings(card).map(fill));
    // Not shown in the text form: the caption of a picture that is not there, and the map-outline credit of a map that is not there.
    for (const t of card.tiles ?? []) if (t.imageCaption !== undefined) approved.delete(fill(t.imageCaption));
    if (card.source !== undefined) {
      approved.delete(fill(card.source));
      const shown = cardSource(card, false);
      if (shown !== undefined) approved.add(fill(shown));
    }
    const shown = new Set<string>();
    const walker = document.createTreeWalker(body(id), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if (n.parentElement!.closest('.chip, .card-values')) continue;   // chips and value rows are pinned on their own
      const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t !== '') shown.add(t);
    }
    expect([...shown].filter((s) => !approved.has(s)), `${id}: text on the card that is not approved`).toEqual([]);
    expect([...approved].filter((s) => !shown.has(s)), `${id}: approved text that is missing from the card`).toEqual([]);
  });
  it('never mutates CARDS, which the controller shares by identity: opening every card in every flag set leaves the table unchanged', () => {
    const before = JSON.stringify(CARDS);
    scanRenderedCards(FIXTURE);
    expect(JSON.stringify(CARDS)).toBe(before);
  });
});

describe('cardSourceLine (carry-forward from the Task 10 review: a source line is never half-filled)', () => {
  const noFit = cardVars(FIXTURE);                            // the fixture has no europe_fit, so {n_pops} and {n_people} are ''
  const withFit = { ...noFit, n_pops: '26', n_people: '716' };
  it("A1's upgraded source needs the Europe fit: filled when europe_fit is there, left out (not half-filled) when it is not", () => {
    expect(noFit.n_pops).toBe('');
    expect(cardSourceLine(CARDS.A1, true, withFit)).toBe(fillCard(CARDS.A1.source!, withFit));
    expect(cardSourceLine(CARDS.A1, true, withFit)).toContain('(26 groups, 716 people)');
    expect(cardSourceLine(CARDS.A1, true, noFit)).toBeUndefined();
  });
  it("the text form drops A1's source whatever the data holds; other cards' sources do not depend on the Europe fit", () => {
    expect(cardSourceLine(CARDS.A1, false, withFit)).toBeUndefined();
    expect(cardSourceLine(CARDS.E3, false, noFit)).toBe("This workshop's data.");
    expect(cardSourceLine(CARDS.E1, false, noFit)).toBe('Patterson et al. 2022.');
    expect(cardSourceLine(CARDS.D2, false, noFit)).toBeUndefined();   // D2 has no source
  });
});

describe('mountCardView: isolation and geometry', () => {
  beforeEach(() => {
    loadIndexHtml();
  });
  afterEach(() => {
    document.body.innerHTML = '';
    delete (document.defaultView as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  });
  const root = (): HTMLElement => document.getElementById('card')!;

  it('a card never changes plot state: opening, refitting and closing every card leaves the plot, terminal, header and focus alone', () => {
    document.getElementById('plot')!.innerHTML = '<svg class="plot-svg"><circle r="3"></circle></svg>';
    document.getElementById('terminal')!.innerHTML = '<div class="term-hint">hint</div><input aria-label="Command">';
    const input = document.querySelector<HTMLInputElement>('#terminal input')!;
    input.focus();
    const outside = (): string => ['bar', 'terminal', 'plot'].map((id) => document.getElementById(id)!.outerHTML).join('');
    const before = outside();
    const v = mountCardView(root(), FIXTURE, NOOP_HANDLERS, ALL_ON);
    for (const id of CARD_IDS) {
      v.open(id, 0, 2, 'before');
      expect(document.activeElement, id).toBe(input);
      v.refit();
    }
    v.close();
    expect(outside()).toBe(before);
    expect(document.activeElement).toBe(input);
  });
  it('follows the hint line: --card-bottom is the #panes bottom minus the hint top, refreshed when the hint changes height and on a window resize', () => {
    const hint = document.createElement('div');
    hint.className = 'term-hint';
    document.getElementById('terminal')!.append(hint);
    let hintTop = 700;
    document.getElementById('panes')!.getBoundingClientRect = () => ({ bottom: 768 }) as DOMRect;
    hint.getBoundingClientRect = () => ({ top: hintTop }) as DOMRect;
    let hintChanged: () => void = () => undefined;
    (document.defaultView as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      constructor(cb: () => void) {
        hintChanged = cb;
      }
      observe(): void {}
      disconnect(): void {}
    };
    const v = mountCardView(root(), FIXTURE, NOOP_HANDLERS, ALL_OFF);
    v.open('E1', 0, 1, 'after');
    expect(root().style.getPropertyValue('--card-bottom')).toBe('68px');
    hintTop = 650;                                            // the hint wraps onto a second line
    hintChanged();
    expect(root().style.getPropertyValue('--card-bottom')).toBe('118px');
    hintTop = 720;
    document.defaultView!.dispatchEvent(new Event('resize'));
    expect(root().style.getPropertyValue('--card-bottom')).toBe('48px');
  });
  it('finds the hint line when the terminal is mounted after the view (the shell mounts the card view first) and observes it from the first open', () => {
    const observed: Element[] = [];
    let hintChanged: () => void = () => undefined;
    (document.defaultView as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      constructor(cb: () => void) {
        hintChanged = cb;
      }
      observe(e: Element): void {
        observed.push(e);
      }
      disconnect(): void {}
    };
    document.getElementById('panes')!.getBoundingClientRect = () => ({ bottom: 768 }) as DOMRect;
    const v = mountCardView(root(), FIXTURE, NOOP_HANDLERS, ALL_OFF);   // #terminal is still empty: there is no hint line yet
    expect(observed).toHaveLength(0);
    const hint = document.createElement('div');                         // mountTerminal runs after the view is mounted
    hint.className = 'term-hint';
    document.getElementById('terminal')!.append(hint);
    let hintTop = 700;
    hint.getBoundingClientRect = () => ({ top: hintTop }) as DOMRect;
    v.open('E1', 0, 1, 'after');                                        // the controller opens the card first ...
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(hint);
    expect(root().style.getPropertyValue('--card-bottom')).toBe('68px');
    hintTop = 650;                                                      // ... and then setHint(CARD_HINT) makes the hint wrap
    hintChanged();
    expect(root().style.getPropertyValue('--card-bottom')).toBe('118px');
  });
  it('moves its observer to a new hint line element (the terminal is mounted again) and does not re-observe the same one', () => {
    const observed: Element[] = [];
    const watching = new Set<Element>();
    (document.defaultView as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe(e: Element): void {
        observed.push(e);
        watching.add(e);
      }
      disconnect(): void {
        watching.clear();
      }
    };
    document.getElementById('panes')!.getBoundingClientRect = () => ({ bottom: 768 }) as DOMRect;
    const hintAt = (top: number): HTMLElement => {
      const h = document.createElement('div');
      h.className = 'term-hint';
      h.getBoundingClientRect = () => ({ top }) as DOMRect;
      return h;
    };
    const first = hintAt(700);
    document.getElementById('terminal')!.append(first);
    const v = mountCardView(root(), FIXTURE, NOOP_HANDLERS, ALL_OFF);
    expect(watching.size).toBe(1);                                      // the mount-time lookup is kept
    expect(watching.has(first)).toBe(true);
    v.open('E1', 0, 2, 'after');
    v.open('E2', 1, 2, 'after');
    expect(observed).toHaveLength(1);                                   // the same element is observed once, not once per open
    const second = hintAt(650);
    first.replaceWith(second);
    v.open('E3', 0, 1, 'after');
    expect(watching.size).toBe(1);                                      // the observer left the old element for the new one
    expect(watching.has(second)).toBe(true);
    expect(observed).toHaveLength(2);
    expect(root().style.getPropertyValue('--card-bottom')).toBe('118px');
  });
});

describe.runIf(process.env.REAL_DATA === '1')('rendered cards on the real data (REAL_DATA=1 npx vitest run tests/cardView.test.ts)', () => {
  const real = (): WorkshopData => validateData(JSON.parse(readFileSync(resolve(__dirname, '../src/data/workshop_data.json'), 'utf8')));
  afterEach(() => {
    document.body.innerHTML = '';
  });
  it('every string every card shows passes the spec §6 rules', () => {
    scanRenderedCards(real());
  });
  it("A1's upgraded source line carries the real Europe fit: 26 groups, 716 people", () => {
    expect(cardSourceLine(CARDS.A1, true, cardVars(real()))).toContain('(26 groups, 716 people)');
  });
  it('H2 lists all 20 LCT rows in two columns, K2 shows Britain as 2.7 on the 0-15 scale', () => {
    const h2 = renderCardBody(document, CARDS.H2, ctx({ data: real() })).querySelector('.card-values')!;
    expect(h2.querySelectorAll('li')).toHaveLength(20);
    expect(h2.hasAttribute('data-long')).toBe(true);
    const k2 = renderCardBody(document, CARDS.K2, ctx({ data: real() })).querySelector('.card-values')!;
    expect(k2.querySelector('li[data-key="1kg:GBR"] .value-num')!.textContent).toBe('2.7');
  });
});
