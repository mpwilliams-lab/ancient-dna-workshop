// @vitest-environment jsdom
// Map slot on cards (Task 20; spec §5.2, §3.2–§3.3, CONTRACT §4.11 DOM; Task 23: A1; Task 24: H2, I2, J3; Task 27: K2, L3 and the source line).
// Every manifest here is an in-memory copy (tests/helpers/assetEnv.ts): nothing reads the committed manifest's checks.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardShowsUpgrade } from '../src/assets';
import { renderCardMap } from '../src/cardMap';
import { CARDS, cardSource, cardVars, distributionRows, fillCard } from '../src/cards';
import { renderCardBody, sourceWithMapSuffix, upgradedFormShown } from '../src/cardView';
import { IRELAND_FOOTNOTE, MAP_SOURCE_SUFFIX, MAP_TEXT } from '../src/content';
import { ALL_OFF, ALL_ON } from '../src/features';
import { A1_CONFIRMED_LABELS, mapSpec } from '../src/maps';
import { cloneFixture, FIXTURE } from './fixtures/fixture';
import { ruleViolations } from './contentRules';
import { checkedManifest, fakeUrls, onlyChecked } from './helpers/assetEnv';
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
  // Task 27 built K2 and L3, so no card has an unbuilt map any more and Task 20's version of this test (it named K2 and L3) is gone. The rule
  // is still the code's (assets.ts cardShowsUpgrade asks MAP_SPECS_BUILT), so it is pinned with a card whose map has no spec: F1's inset id,
  // which Task 29 builds and takes out of this test.
  it('a card whose map spec is not built is never upgraded, whatever the flags and checks', () => {
    const unbuilt = { ...CARDS.D1, map: 'F1inset' as const };
    expect(cardShowsUpgrade(unbuilt, ALL_ON, checkedManifest(), fakeUrls())).toBe(false);
    expect(cardShowsUpgrade(CARDS.D1, ALL_ON, checkedManifest(), fakeUrls())).toBe(true);
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

describe('distribution cards with their maps (Tasks 24 and 27, spec §3.4)', () => {
  const CASES = [
    ['H2', 'map.H2', 'LCT'], ['I2', 'map.I2', 'SLC45A2'], ['J3', 'map.J3', 'HERC2'], ['K2', 'map.K2', 'TYK2'], ['L3', 'map.L3', 'HLA-DQ2'],
  ] as const;
  /** How many of the fixture's rows have coordinates, so a dot: spec §3.4's value lists less the gnomAD rows. */
  const DOTS = { LCT: 20, SLC45A2: 10, HERC2: 10, TYK2: 7, 'HLA-DQ2': 4 } as const;
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
      // The card's own source line (spec §3.4), with the Natural Earth line after it where the spec's K2 source does not already have it (§6).
      expect(el.querySelector('.card-source')!.textContent).toBe(sourceWithMapSuffix(CARDS[id].source, true));
      expect(el.querySelector('.card-source')!.textContent).toContain(MAP_SOURCE_SUFFIX);
      // The map sits where the value bars were: after the title and before the lines.
      expect(el.querySelector('.card-title')!.compareDocumentPosition(slot!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(slot!.compareDocumentPosition(el.querySelector('.card-lines')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(placed(gene)).toHaveLength(DOTS[gene]);
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
      for (const t of el.querySelectorAll('svg text')) expect(t.textContent, 'a map label is a place and a number (TYK2 has one decimal)').toMatch(/^[A-Za-z ()]+ \d+(\.\d)?$/);
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

    // Task 26 (carry-forward from the Task 24 review): the card used to draw a map with overlapping numbers, laid out by the greedy
    // fallback, when placeDotLabels found no clear place for every label. Now such data leaves the card in its value bars.
    it(`${id}: a card whose rows cannot all be labelled clear of each other (two rows on one spot) keeps its value bars, footer included`, () => {
      const d = cloneFixture();
      const [a, b] = d.trait_maps[gene].filter((r) => r.lat !== undefined && r.lon !== undefined);
      d.trait_maps[gene] = d.trait_maps[gene].map((r) => (r.label_key === b!.label_key ? { ...r, lat: a!.lat, lon: a!.lon } : r));
      const el = renderCardBody(document, CARDS[id], cardCtx(d, flagSet(flag, true, ALL_OFF), checkedManifest(), { placement: 'before' }));
      expect(el.querySelector('.card-map')).toBeNull();
      expect(el.querySelectorAll('.card-values .value-row').length).toBe(distributionRows(d, gene).length);
      expect(openOnCard(id, d, flagSet(flag, true, ALL_OFF), checkedManifest()).querySelector('.card-credits')).toBeNull();
    });

    it(`${id}: the map is named by the card's title and every number on it, "<place> <copies>" in the value list's order, as a screen reader gets it`, () => {
      const el = renderCardBody(document, CARDS[id], cardCtx(FIXTURE, flagSet(flag, true, ALL_OFF), checkedManifest(), { placement: 'before' }));
      const svg = el.querySelector('svg.map-svg')!;
      expect(svg.getAttribute('role')).toBe('img');
      expect(svg.getAttribute('aria-label')).toBe(`${CARDS[id].title}: ${placed(gene).map((r) => `${r.label} ${r.display}`).join(', ')}`);
      expect(svg.hasAttribute('aria-hidden')).toBe(false);
      expect(ruleViolations(svg.getAttribute('aria-label')!), 'what a screen reader gets passes the content rules like the labels it lists').toEqual([]);
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

describe('sourceWithMapSuffix (Task 27, spec §6: maps carry the Natural Earth line)', () => {
  it('leaves the text form alone', () => {
    expect(sourceWithMapSuffix('Data: gnomAD.', false)).toBe('Data: gnomAD.');
    expect(sourceWithMapSuffix(undefined, false)).toBeUndefined();
  });
  it('adds the suffix once when a map is shown', () => {
    expect(sourceWithMapSuffix('Data: gnomAD.', true)).toBe(`Data: gnomAD. ${MAP_SOURCE_SUFFIX}`);
    expect(sourceWithMapSuffix(`Data: x. ${MAP_SOURCE_SUFFIX}`, true)).toBe(`Data: x. ${MAP_SOURCE_SUFFIX}`);
    expect(sourceWithMapSuffix(undefined, true)).toBe(MAP_SOURCE_SUFFIX);
    expect(sourceWithMapSuffix('', true)).toBe(MAP_SOURCE_SUFFIX);
    // Idempotent: applying it to its own result changes nothing.
    const once = sourceWithMapSuffix('Data: gnomAD.', true);
    expect(sourceWithMapSuffix(once, true)).toBe(once);
  });
  it('changes no card but K2: every other map card\'s spec source already ends with the line, and K2\'s (spec §3.4) does not', () => {
    const MAP_CARD_IDS = ['A1', 'D1', 'E1', 'G1', 'H2', 'I2', 'J3', 'K2', 'L3'] as const;
    for (const id of MAP_CARD_IDS) {
      const source = CARDS[id].source!;
      if (id === 'K2') {
        expect(source.endsWith(MAP_SOURCE_SUFFIX), 'K2\'s §3.4 source has no Natural Earth line').toBe(false);
        expect(sourceWithMapSuffix(source, true)).toBe(`${source} ${MAP_SOURCE_SUFFIX}`);
      } else {
        expect(source.endsWith(MAP_SOURCE_SUFFIX), `${id}'s source already ends with it`).toBe(true);
        expect(sourceWithMapSuffix(source, true), id).toBe(source);
      }
    }
  });
});

describe('distribution cards K2 and L3 with their maps (Task 27)', () => {
  const CASES = [['K2', 'map.K2', 'TYK2', 1, 2], ['L3', 'map.L3', 'HLA-DQ2', 2, 3]] as const;
  for (const [id, flag, gene, index, count] of CASES) {
    const upgraded = () => renderCardBody(document, CARDS[id],
      cardCtx(FIXTURE, flagSet(flag, true, ALL_OFF), onlyChecked([id]), { placement: 'before', index, count }));

    it(`${id} upgraded: map instead of the value bars; title, lines and puzzle stay; gnomAD rows in the side list`, () => {
      const el = upgraded();
      expect(el.querySelector(`.card-map[data-map="${id}"] svg.map-svg`)).not.toBeNull();
      expect(el.querySelector('.card-values')).toBeNull();
      expect(el.querySelector('.card-title')!.textContent).toBe(CARDS[id].title);
      expect(el.querySelector('.card-puzzle')!.textContent).toBe(CARDS[id].puzzle);
      expect(el.querySelectorAll('.card-lines li')).toHaveLength(CARDS[id].lines!.length);
      const side = distributionRows(FIXTURE, gene).filter((r) => r.lat === undefined || r.lon === undefined);
      expect([...el.querySelectorAll('.card-map-side li')].map((li) => li.textContent)).toEqual(side.map((r) => `${r.label} ${r.display}`));
    });

    it(`${id} upgraded: the source line ends with the Natural Earth line exactly once`, () => {
      const src = upgraded().querySelector('.card-source')!.textContent!;
      expect(src.endsWith(MAP_SOURCE_SUFFIX)).toBe(true);
      expect(src.split(MAP_SOURCE_SUFFIX).length - 1).toBe(1);
      expect(src.startsWith(CARDS[id].source!.replace(` ${MAP_SOURCE_SUFFIX}`, ''))).toBe(true);   // the spec's own words come first, unchanged
    });

    it(`${id} with its flag on but the map unchecked: the P1 value bars and the text-form source line`, () => {
      const el = renderCardBody(document, CARDS[id],
        cardCtx(FIXTURE, flagSet(flag, true, ALL_OFF), onlyChecked([]), { placement: 'before', index, count }));
      expect(el.querySelector('.card-map')).toBeNull();
      expect(el.querySelectorAll(`.card-values[data-gene="${gene}"] .value-row`)).toHaveLength(distributionRows(FIXTURE, gene).length);
      expect(el.querySelector('.card-source')?.textContent ?? '').toBe(cardSource(CARDS[id], false) ?? '');
      expect(el.querySelector('.card-source')?.textContent ?? '').not.toContain('Natural Earth');
    });

    it(`${id}: the footer has Image credits exactly when the map shows, with only this map checked`, () => {
      expect(openOnCard(id, FIXTURE, flagSet(flag, true, ALL_OFF), onlyChecked([id])).querySelector('.card-credits')).not.toBeNull();
      expect(openOnCard(id, FIXTURE, flagSet(flag, true, ALL_OFF), onlyChecked([])).querySelector('.card-credits')).toBeNull();
      expect(openOnCard(id, FIXTURE, flagSet(flag, false, ALL_ON), onlyChecked([id])).querySelector('.card-credits')).toBeNull();
    });
  }

  // (place, number) of every row a card shows, whichever form it is in: the value bars of the text form, or the map's labels plus its side list.
  const numbersOf = (el: HTMLElement): [string, string][] => {
    const bars = [...el.querySelectorAll('.value-row')].map((li): [string, string] => [li.querySelector('.value-label')!.textContent!, li.querySelector('.value-num')!.textContent!]);
    const labels = [...el.querySelectorAll('svg text.map-label')].map((t): [string, string] => {
      const s = t.textContent!;
      return [s.slice(0, s.lastIndexOf(' ')), s.slice(s.lastIndexOf(' ') + 1)];
    });
    const side = [...el.querySelectorAll('.card-map-side li')].map((li): [string, string] => [li.querySelector('.value-label')!.textContent!, li.querySelector('.value-num')!.textContent!]);
    return [...bars, ...labels, ...side].sort((a, b) => a[0].localeCompare(b[0]));
  };

  for (const [id, flag] of CASES) {
    it(`${id}: the value bars of the text form and the labels plus side list of the map say the same numbers`, () => {
      const bars = numbersOf(renderCardBody(document, CARDS[id], cardCtx(FIXTURE, ALL_OFF, onlyChecked([]), { placement: 'before' })));
      const map = numbersOf(renderCardBody(document, CARDS[id], cardCtx(FIXTURE, flagSet(flag, true, ALL_OFF), onlyChecked([id]), { placement: 'before' })));
      expect(bars.length).toBeGreaterThanOrEqual(5);
      expect(map).toEqual(bars);
    });
  }

  it('K2 prints one decimal everywhere, in both forms (Britain 2.7, O1), and L3 whole numbers', () => {
    const k2 = numbersOf(renderCardBody(document, CARDS.K2, cardCtx(FIXTURE, flagSet('map.K2', true, ALL_OFF), onlyChecked(['K2']), { placement: 'before' })));
    for (const [place, n] of k2) expect(n, place).toMatch(/^\d+\.\d$/);
    expect(k2.find(([place]) => place === 'Britain')![1]).toBe('2.7');
    const l3 = numbersOf(renderCardBody(document, CARDS.L3, cardCtx(FIXTURE, flagSet('map.L3', true, ALL_OFF), onlyChecked(['L3']), { placement: 'before' })));
    for (const [place, n] of l3) expect(n, place).toMatch(/^\d+$/);
  });

  it('each flag is its own: with only map.K2 on, L3 keeps its value bars, and the other way round', () => {
    for (const [on, off] of [['K2', 'L3'], ['L3', 'K2']] as const) {
      const only = flagSet(`map.${on}`, true, ALL_OFF);
      expect(renderCardBody(document, CARDS[on], cardCtx(FIXTURE, only, onlyChecked(['K2', 'L3']), { placement: 'before' })).querySelector('.card-map'), on).not.toBeNull();
      const other = renderCardBody(document, CARDS[off], cardCtx(FIXTURE, only, onlyChecked(['K2', 'L3']), { placement: 'before' }));
      expect(other.querySelector('.card-map'), off).toBeNull();
      expect(other.querySelector('.card-values'), off).not.toBeNull();
    }
  });
});
