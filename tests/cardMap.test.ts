// @vitest-environment jsdom
// Map slot on cards (Task 20; spec §5.2, §3.2–§3.3, CONTRACT §4.11 DOM; Task 23: A1). Task 24 appends its cases.
// Every manifest here is an in-memory copy (tests/helpers/assetEnv.ts): nothing reads the committed manifest's checks.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardShowsUpgrade } from '../src/assets';
import { renderCardMap } from '../src/cardMap';
import { CARDS, cardSource, cardVars, distributionRows, fillCard } from '../src/cards';
import { renderCardBody, upgradedFormShown } from '../src/cardView';
import { IRELAND_FOOTNOTE, MAP_SOURCE_SUFFIX, MAP_TEXT } from '../src/content';
import { ALL_OFF, ALL_ON } from '../src/features';
import { A1_CONFIRMED_LABELS, mapSpec } from '../src/maps';
import { cloneFixture, FIXTURE } from './fixtures/fixture';
import { checkedManifest, fakeUrls } from './helpers/assetEnv';
import { cardCtx, flagSet, openOnCard } from './helpers/cardCtx';

const MAP_CARDS = [['D1', 'map.D1'], ['E1', 'map.E1'], ['G1', 'map.G1']] as const;
const KENT_LINE = 'The earliest found so far were buried in Kent.';

describe('the upgrade rule for D1, E1, G1', () => {
  for (const [id, flag] of MAP_CARDS) {
    it(`${id}: needs ${flag} AND the instructor's map check`, () => {
      const on = flagSet(flag, true, ALL_OFF);
      expect(cardShowsUpgrade(CARDS[id], on, checkedManifest(), fakeUrls())).toBe(true);
      expect(cardShowsUpgrade(CARDS[id], ALL_OFF, checkedManifest(), fakeUrls())).toBe(false);
      expect(cardShowsUpgrade(CARDS[id], on, checkedManifest([id]), fakeUrls())).toBe(false);
      expect(upgradedFormShown(CARDS[id], on, checkedManifest(), fakeUrls())).toBe(true);
    });
  }
  it('a map card whose spec is not built is never upgraded, whatever the flags and checks', () => {
    for (const id of ['K2', 'L3'] as const) {
      // (Task 27 builds these and moves its ids out of this list. A1 is built: Task 23; H2, I2 and J3: Task 24.)
      expect(cardShowsUpgrade(CARDS[id], ALL_ON, checkedManifest(), fakeUrls()), id).toBe(false);
    }
  });
});

describe('renderCardBody: map cards', () => {
  for (const [id, flag] of MAP_CARDS) {
    it(`${id} upgraded: the map sits after the chips and before the bullets, with every label and the full source`, () => {
      const el = renderCardBody(document, CARDS[id], cardCtx(FIXTURE, flagSet(flag, true, ALL_OFF), checkedManifest()));
      const slot = el.querySelector<HTMLElement>(`.card-map[data-map="${id}"]`);
      expect(slot).not.toBeNull();
      const svg = slot!.querySelector('svg.map-svg');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('aria-label')).toBe(CARDS[id].title);
      for (const label of MAP_TEXT[id]) expect(svg!.textContent).toContain(label);
      const bullets = el.querySelector('.card-bullets')!;
      expect(slot!.compareDocumentPosition(bullets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(el.querySelector('.card-source')!.textContent).toBe(cardSource(CARDS[id], true));
      expect(el.querySelector('.card-source')!.textContent).toContain(MAP_SOURCE_SUFFIX);
      if (id === 'E1') expect(el.textContent).not.toContain(KENT_LINE);
    });

    it(`${id} with ${flag} on but the map unchecked: the P1 text form`, () => {
      const el = renderCardBody(document, CARDS[id], cardCtx(FIXTURE, flagSet(flag, true, ALL_OFF), checkedManifest([id])));
      expect(el.querySelector('.card-map')).toBeNull();
      expect(el.querySelector('.card-source')?.textContent ?? '').not.toContain('Natural Earth');
      if (id === 'E1') expect(el.textContent).toContain(KENT_LINE);
    });

    it(`${id}: the footer has Image credits exactly when the map shows`, () => {
      expect(openOnCard(id, FIXTURE, flagSet(flag, true, ALL_OFF), checkedManifest()).querySelector('.card-credits')).not.toBeNull();
      expect(openOnCard(id, FIXTURE, flagSet(flag, true, ALL_OFF), checkedManifest([id])).querySelector('.card-credits')).toBeNull();
    });
  }
});

describe('renderCardMap', () => {
  it('builds div.card-map[data-map] around svg.map-svg, with no side list for D1', () => {
    const el = renderCardMap(document, CARDS.D1, FIXTURE);
    expect(el.className).toBe('card-map');
    expect(el.dataset.map).toBe('D1');
    expect(el.querySelector('svg.map-svg')).not.toBeNull();
    expect(el.querySelector('.card-map-side')).toBeNull();
  });
  it('throws for a card without a map', () => {
    expect(() => renderCardMap(document, CARDS.B1, FIXTURE)).toThrow();
  });
  it.each(['D1', 'E1', 'G1'] as const)('%s: the picture shows the window of its spec, and is a picture named by the card title (not hidden from assistive technology)', (id) => {
    const svg = renderCardMap(document, CARDS[id], FIXTURE).querySelector('svg.map-svg')!;
    const v = mapSpec(id, FIXTURE).view!;
    expect(svg.getAttribute('viewBox')).toBe(`${v.x} ${v.y} ${v.width} ${v.height}`);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe(CARDS[id].title);
    expect(svg.hasAttribute('aria-hidden')).toBe(false);
  });
});

describe('the card map layout rules (src/style.css, src/plots/plots.css)', () => {
  const css = readFileSync(resolve(__dirname, '../src/style.css'), 'utf8');
  const plots = readFileSync(resolve(__dirname, '../src/plots/plots.css'), 'utf8');
  /** The declarations of the first rule with exactly this selector (comments dropped). */
  const block = (source: string, selector: string): string => {
    const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const at = text.indexOf(`\n${selector} {`);
    if (at < 0) throw new Error(`no rule for ${selector}`);
    return text.slice(text.indexOf('{', at) + 1, text.indexOf('}', at));
  };
  it('the map slot keeps the spec cap, may shrink to make the card fit, and never below a floor', () => {
    const slot = block(css, '#card .card-map');
    expect(slot).toMatch(/max-height:\s*min\(52vh, 460px\)/);
    expect(slot).toMatch(/flex:\s*0 1 auto/);
    expect(slot).toMatch(/min-height:\s*9em/);
  });
  it('the picture fills the slot it is given, so a slot that shrinks shrinks the whole map (nothing is cut off, nothing leaks in)', () => {
    const pic = block(css, '#card .card-map .map-svg');
    expect(pic).toMatch(/width:\s*100%/);
    expect(pic).toMatch(/height:\s*100%/);
  });
  it('a map svg paints its frame outline whole: the 1 px stroke on the edge the viewBox touches is half outside the box (Task 19 review)', () => {
    expect(block(plots, '.map-svg')).toMatch(/overflow:\s*visible/);
  });
});

describe('A1 card (Task 23, spec §3.1)', () => {
  const ON = flagSet('map.A1', true, ALL_OFF);
  // An independent copy of the approved text (RF3), with {n_pops} and {n_people} as the fixture's europe_fit gives them.
  const LEAD = 'On this map each dot is a whole group of people living in Europe today, placed by their DNA. A thin line joins it to where that group lives.';
  const BULLETS = [
    'North and south line up well; east and west only roughly, partly because we have no German, Dutch, Danish or Swiss groups.',
    "Small, isolated groups such as Basque and Saami people are left off: their DNA has drifted apart from their neighbours'.",
    'Britain is held back. You will place Britons later.',
  ];
  const SOURCE = "Drawn from this workshop's data (26 groups, 716 people). The DNA map was turned and scaled to fit the real map as closely as possible. Inspired by Novembre et al. 2008. Map outline: Made with Natural Earth.";

  const without = (...keys: ('europe_pops' | 'europe_fit')[]) => {
    const d = cloneFixture();
    for (const k of keys) delete d[k];
    return d;
  };

  it('is upgraded only with map.A1 on, the instructor\'s check of the map, and the data (europe_pops and europe_fit)', () => {
    expect(cardShowsUpgrade(CARDS.A1, ON, checkedManifest(), fakeUrls())).toBe(true);
    expect(cardShowsUpgrade(CARDS.A1, ALL_OFF, checkedManifest(), fakeUrls())).toBe(false);
    expect(cardShowsUpgrade(CARDS.A1, ON, checkedManifest(['A1']), fakeUrls())).toBe(false);
    expect(upgradedFormShown(CARDS.A1, ON, checkedManifest(), fakeUrls())).toBe(true);
    // The data is the card view's rule (the body and the footer both ask it): see the text-form test below.
  });

  it('upgraded: the map sits after the lead and before the bullets, the words are the approved ones, and the source line has the fitted groups and people', () => {
    const el = renderCardBody(document, CARDS.A1, cardCtx(FIXTURE, ON, checkedManifest()));
    const slot = el.querySelector<HTMLElement>('.card-map[data-map="A1"]');
    expect(slot).not.toBeNull();
    const svg = slot!.querySelector('svg.map-svg')!;
    expect(svg.getAttribute('aria-label')).toBe('Genes mirror geography');
    expect(el.querySelector('.card-title')!.textContent).toBe('Genes mirror geography');
    expect(el.querySelector('.card-lead')!.textContent).toBe(LEAD);
    expect([...el.querySelectorAll('.card-bullets > li')].map((li) => li.textContent)).toEqual(BULLETS);
    expect(el.querySelector('.card-lead')!.compareDocumentPosition(slot!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot!.compareDocumentPosition(el.querySelector('.card-bullets')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const v = cardVars(FIXTURE);
    expect(v.n_pops).toBe('26');
    expect(el.querySelector('.card-source')!.textContent).toBe(SOURCE);
    expect(el.querySelector('.card-source')!.textContent).toBe(fillCard(cardSource(CARDS.A1, true)!, v));
    expect(el.querySelector('.card-source')!.textContent).toContain(MAP_SOURCE_SUFFIX);
    expect(el.textContent).not.toMatch(/[{}]/);
    // No group ID (the data's own code for a group) is on the card, in its text or in any attribute, whatever it holds.
    for (const p of (FIXTURE.europe_pops ?? []).filter((q) => q.id !== q.label)) expect(el.innerHTML, p.id).not.toContain(p.id);
    expect(openOnCard('A1', FIXTURE, ON, checkedManifest()).querySelector('.card-credits')).not.toBeNull();
  });

  it('the picture is the window of its spec with 26 links, and carries labels only if the instructor has confirmed their names', () => {
    const svg = renderCardMap(document, CARDS.A1, FIXTURE).querySelector('svg.map-svg')!;
    const v = mapSpec('A1', FIXTURE).view!;
    expect(svg.getAttribute('viewBox')).toBe(`${v.x} ${v.y} ${v.width} ${v.height}`);
    expect(svg.querySelectorAll('g.map-link')).toHaveLength(26);
    expect(svg.querySelectorAll('text.map-label')).toHaveLength(A1_CONFIRMED_LABELS.length > 0 ? 8 : 0);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.hasAttribute('aria-hidden')).toBe(false);
    expect(MAP_TEXT.A1).toEqual([]);   // A1's labels are data (europe_pops[].label), not fixed text
  });

  it('text form (flag off, or map unchecked, or europe_pops or europe_fit missing): the P1 title, lead and bullets, no map, no source line, no credits button', () => {
    const contexts: [string, ReturnType<typeof cardCtx>][] = [
      ['flag off', cardCtx(FIXTURE, ALL_OFF, checkedManifest())],
      ['map unchecked', cardCtx(FIXTURE, ON, checkedManifest(['A1']))],
      ['no europe_pops', cardCtx(without('europe_pops'), ON, checkedManifest())],
      ['no europe_fit (the source line is never drawn without it)', cardCtx(without('europe_fit'), ON, checkedManifest())],
      ['neither', cardCtx(without('europe_pops', 'europe_fit'), ON, checkedManifest())],
    ];
    for (const [name, ctx] of contexts) {
      const el = renderCardBody(document, CARDS.A1, ctx);
      expect(el.querySelector('.card-map'), name).toBeNull();
      expect(el.querySelector('svg'), name).toBeNull();
      expect(el.querySelector('.card-source'), name).toBeNull();
      expect(el.querySelector('.card-title')!.textContent, name).toBe('Genes mirror geography');
      expect(el.querySelector('.card-lead')!.textContent, name).toBe(LEAD);
      expect([...el.querySelectorAll('.card-bullets > li')].map((li) => li.textContent), name).toEqual(BULLETS);
      expect(el.textContent, name).not.toContain('Natural Earth');
      expect(openOnCard('A1', ctx.data, ctx.features, ctx.manifest!).querySelector('.card-credits'), name).toBeNull();
    }
  });
});

describe('distribution cards with their maps (Task 24, spec §3.4)', () => {
  const CASES = [['H2', 'map.H2', 'LCT'], ['I2', 'map.I2', 'SLC45A2'], ['J3', 'map.J3', 'HERC2']] as const;
  const BEFORE = /selection|advantage|rose|spread|once more common|over the last 4,000 years/i;   // the "before" rule (tests/cards.test.ts)
  const placed = (gene: (typeof CASES)[number][2]) => distributionRows(FIXTURE, gene).filter((r) => r.lat !== undefined && r.lon !== undefined);
  const side = (gene: (typeof CASES)[number][2]) => distributionRows(FIXTURE, gene).filter((r) => r.lat === undefined || r.lon === undefined);

  for (const [id, flag, gene] of CASES) {
    it(`${id} upgraded: the map instead of the value bars; title, lines, puzzle, side note and source stay, in the order of the P1 form`, () => {
      const el = renderCardBody(document, CARDS[id], cardCtx(FIXTURE, flagSet(flag, true, ALL_OFF), checkedManifest(), { placement: 'before' }));
      const slot = el.querySelector<HTMLElement>(`.card-map[data-map="${id}"]`);
      expect(slot).not.toBeNull();
      expect(slot!.querySelector('svg.map-svg')).not.toBeNull();
      expect(el.querySelector('.card-values')).toBeNull();
      expect(el.querySelector('.card-title')!.textContent).toBe(CARDS[id].title);
      expect(el.querySelector('.card-puzzle')!.textContent).toBe(CARDS[id].puzzle);
      expect([...el.querySelectorAll('.card-lines li')].map((li) => li.textContent)).toEqual(CARDS[id].lines);
      expect(el.querySelector('.card-source')!.textContent).toBe(CARDS[id].source);
      expect(el.querySelector('.card-source')!.textContent).toContain(MAP_SOURCE_SUFFIX);
      // The map sits where the value bars were: after the title and before the lines.
      expect(el.querySelector('.card-title')!.compareDocumentPosition(slot!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(slot!.compareDocumentPosition(el.querySelector('.card-lines')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(placed(gene).length).toBeGreaterThanOrEqual(10);
      expect(slot!.querySelectorAll('svg.map-svg circle.map-dot')).toHaveLength(placed(gene).length);
      expect([...slot!.querySelectorAll('svg.map-svg text.map-label')].map((t) => t.textContent)).toEqual(placed(gene).map((r) => `${r.label} ${r.display}`));
    });

    it(`${id} upgraded: the side list holds the rows without coordinates, with the labels and numbers of the value list`, () => {
      const el = renderCardBody(document, CARDS[id], cardCtx(FIXTURE, flagSet(flag, true, ALL_OFF), checkedManifest(), { placement: 'before' }));
      const items = [...el.querySelectorAll('.card-map-side li')].map((li) => li.textContent);
      expect(items).toEqual(side(gene).map((r) => `${r.label} ${r.display}`));
      expect(items.length === 0, 'only H2 has none').toBe(id === 'H2');
    });

    it(`${id} upgraded: a "before" card still gives nothing away: nothing on it but its puzzle matches the ban, and the map says place names and numbers only`, () => {
      const el = renderCardBody(document, CARDS[id], cardCtx(FIXTURE, flagSet(flag, true, ALL_OFF), checkedManifest(), { placement: 'before' }));
      for (const node of el.querySelectorAll('.card-puzzle')) node.remove();
      expect(el.textContent).not.toMatch(BEFORE);
      expect(el.textContent).not.toMatch(/paternity|illegitim|affair|mismatch/i);
      for (const t of el.querySelectorAll('svg text')) expect(t.textContent, 'a map label is a place and a number').toMatch(/^[A-Za-z ()]+ \d+$/);
    });

    it(`${id} not upgraded (map unchecked): the P1 value bars, no map, no Natural Earth in the source`, () => {
      const el = renderCardBody(document, CARDS[id], cardCtx(FIXTURE, flagSet(flag, true, ALL_OFF), checkedManifest([id]), { placement: 'before' }));
      expect(el.querySelector('.card-map')).toBeNull();
      expect(el.querySelector('svg')).toBeNull();
      expect(el.querySelectorAll(`.card-values[data-gene="${gene}"] .value-row`)).toHaveLength(distributionRows(FIXTURE, gene).length);
      expect(el.querySelector('.card-source')!.textContent).not.toContain('Natural Earth');
    });

    it(`${id}: the footer has Image credits exactly when the map shows`, () => {
      expect(openOnCard(id, FIXTURE, flagSet(flag, true, ALL_OFF), checkedManifest()).querySelector('.card-credits')).not.toBeNull();
      expect(openOnCard(id, FIXTURE, flagSet(flag, true, ALL_OFF), checkedManifest([id])).querySelector('.card-credits')).toBeNull();
      expect(openOnCard(id, FIXTURE, flagSet(flag, false, ALL_OFF), checkedManifest()).querySelector('.card-credits')).toBeNull();
    });

    it(`${id}: a card whose data has no row with coordinates stays in its value-bar form, footer included (the map needs data)`, () => {
      const d = cloneFixture();
      d.trait_maps[gene] = d.trait_maps[gene].map(({ lat: _lat, lon: _lon, ...rest }) => rest);
      const el = renderCardBody(document, CARDS[id], cardCtx(d, flagSet(flag, true, ALL_OFF), checkedManifest(), { placement: 'before' }));
      expect(el.querySelector('.card-map')).toBeNull();
      expect(el.querySelectorAll('.card-values .value-row').length).toBeGreaterThan(0);
      expect(openOnCard(id, d, flagSet(flag, true, ALL_OFF), checkedManifest()).querySelector('.card-credits')).toBeNull();
    });

    it(`${id}: each distribution map has its own flag: with only another map's flag on, ${id} keeps its value bars`, () => {
      const other = id === 'H2' ? 'map.I2' : 'map.H2';
      const el = renderCardBody(document, CARDS[id], cardCtx(FIXTURE, flagSet(other, true, ALL_OFF), checkedManifest(), { placement: 'before' }));
      expect(el.querySelector('.card-map')).toBeNull();
      expect(el.querySelector('.card-values')).not.toBeNull();
    });
  }

  it('H2 keeps the Ireland side note under the map', () => {
    const el = renderCardBody(document, CARDS.H2, cardCtx(FIXTURE, flagSet('map.H2', true, ALL_OFF), checkedManifest(), { placement: 'before' }));
    expect(el.querySelector('.card-side-note')!.textContent).toBe(IRELAND_FOOTNOTE);
    expect(el.querySelector('.card-map')!.compareDocumentPosition(el.querySelector('.card-side-note')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The note is about a dot on the map, so the map shows Ireland (the note would point at nothing without it).
    expect([...el.querySelectorAll('svg text.map-label')].map((t) => t.textContent).some((t) => t!.startsWith('Ireland '))).toBe(true);
  });

  it('the map slot is the picture with the side list beside it, as one block (renderCardMap)', () => {
    const el = renderCardMap(document, CARDS.I2, FIXTURE);
    expect(el.className).toBe('card-map');
    expect(el.dataset.map).toBe('I2');
    expect([...el.children].map((c) => c.tagName.toLowerCase() + (c.className ? `.${c.getAttribute('class')}` : ''))).toEqual(['svg.map-svg', 'ul.card-map-side']);
    expect(el.querySelector('.card-map-side .value-label')!.textContent).toBe('Middle East');
    expect(el.querySelector('.card-map-side .value-num')!.textContent).toBe('47');
  });
});
