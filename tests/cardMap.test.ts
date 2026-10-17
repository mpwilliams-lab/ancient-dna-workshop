// @vitest-environment jsdom
// Map slot on cards (Task 20; spec §5.2, §3.2–§3.3, CONTRACT §4.11 DOM). Tasks 23 and 24 append their cases.
// Every manifest here is an in-memory copy (tests/helpers/assetEnv.ts): nothing reads the committed manifest's checks.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardShowsUpgrade } from '../src/assets';
import { renderCardMap } from '../src/cardMap';
import { CARDS, cardSource } from '../src/cards';
import { renderCardBody, upgradedFormShown } from '../src/cardView';
import { MAP_SOURCE_SUFFIX, MAP_TEXT } from '../src/content';
import { ALL_OFF, ALL_ON } from '../src/features';
import { mapSpec } from '../src/maps';
import { FIXTURE } from './fixtures/fixture';
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
    for (const id of ['H2', 'I2', 'J3', 'K2', 'L3', 'A1'] as const) {
      // (Tasks 23/24/27 build these; each of them moves its id out of this list.)
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
