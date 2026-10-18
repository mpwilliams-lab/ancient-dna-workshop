// @vitest-environment jsdom
// F1 with its P3 town inset (Task 29). onlyChecked() is an in-memory copy with the inset checked; the real
// manifest is filled only by the instructor (npm run visual-check).
import { describe, expect, it } from 'vitest';
import { insetTile, renderCardBody, renderF1Inset } from '../src/cardView';
import { CARDS } from '../src/cards';
import { MAP_SOURCE_SUFFIX, MAP_TEXT } from '../src/content';
import { ALL_OFF, ALL_ON } from '../src/features';
import { EUROPE_LAND, EUROPE_PROJECTION } from '../src/generated/map-europe';
import { F1_INSET_BOX, F1_INSET_PLACES } from '../src/maps';
import { project } from '../src/plots/map';
import { f1 } from '../src/plots/svg';
import { FIXTURE } from './fixtures/fixture';
import { cardCtx, flagSet, openOnCard } from './helpers/cardCtx';
import { onlyChecked } from './helpers/assetEnv';

const ON = flagSet('romanInset', true, ALL_OFF);
const renderF1 = (manifest = onlyChecked(['F1inset']), features = ON): HTMLElement => {
  const el = renderCardBody(document, CARDS.F1, cardCtx(FIXTURE, features, manifest, { placement: 'after' }));
  document.body.replaceChildren(el);
  return el;
};

describe('F1 town inset (Task 29, flag romanInset)', () => {
  it('F1 declares its inset behind romanInset', () => {
    expect(CARDS.F1.inset).toEqual({ map: 'F1inset', feature: 'romanInset' });
  });

  it('with the flag on and the inset checked, F1 shows one optional inset tile in its tile row', () => {
    expect(renderF1().querySelectorAll('.card-tiles > figure.card-tile.card-inset.is-optional[data-map="F1inset"]')).toHaveLength(1);
  });

  it('with the flag on but the inset unchecked, F1 shows no inset (text-only fallback)', () => {
    expect(renderF1(onlyChecked([])).querySelector('.card-inset')).toBeNull();
  });

  it('draws six filled town markers, one hollow countryside marker and no SVG text', () => {
    const svg = renderF1Inset(document, FIXTURE).querySelector('svg.inset-svg')!;
    expect(svg.querySelectorAll('circle.inset-town')).toHaveLength(6);
    expect(svg.querySelectorAll('circle.inset-country')).toHaveLength(1);
    expect(svg.querySelector('circle.inset-country')!.getAttribute('fill')).toBe('#FFFFFF');
    expect(svg.querySelectorAll('text')).toHaveLength(0);
  });

  it('crops the Europe-frame outline to Britain with its viewBox', () => {
    const svg = renderF1Inset(document, FIXTURE).querySelector('svg.inset-svg')!;
    const a = project(EUROPE_PROJECTION, F1_INSET_BOX.latMax, F1_INSET_BOX.lonMin);
    const b = project(EUROPE_PROJECTION, F1_INSET_BOX.latMin, F1_INSET_BOX.lonMax);
    expect(svg.getAttribute('viewBox')).toBe(`${f1(a.x)} ${f1(a.y)} ${f1(b.x - a.x)} ${f1(b.y - a.y)}`);
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('the key under the map holds the two verbatim labels, filled then hollow', () => {
    const items = renderF1Inset(document, FIXTURE).querySelectorAll('figcaption.inset-key .inset-key-item');
    expect(Array.from(items).map((i) => i.textContent)).toEqual([...MAP_TEXT.F1inset]);
  });

  it('F1 gets the Natural Earth source line exactly once when the inset shows', () => {
    const src = renderF1().querySelectorAll('.card-source');
    expect(src).toHaveLength(1);
    expect(src[0]!.textContent).toBe(MAP_SOURCE_SUFFIX);
  });

  it('insetTile is null for every card without an inset', () => {
    for (const card of Object.values(CARDS)) {
      if (card.id === 'F1') continue;
      expect(insetTile(document, card, cardCtx(FIXTURE, ON, onlyChecked(['F1inset'])))).toBeNull();
    }
  });
});

// ---- What the brief's tests leave open: where the markers are, what the tile says, how it sits beside the photos ----
describe('the inset tile in detail (Task 29)', () => {
  const place = (cx: number, cy: number): { x: number; y: number } => ({ x: cx, y: cy });

  it('the seven markers are drawn at the seven places, six towns first and the countryside last, each inside the crop', () => {
    const svg = renderF1Inset(document, FIXTURE).querySelector('svg.inset-svg')!;
    const dots = [...svg.querySelectorAll('circle.inset-town, circle.inset-country')];
    expect(dots.map((d) => d.getAttribute('class'))).toEqual([...Array(6).fill('inset-town'), 'inset-country']);
    const [vx, vy, vw, vh] = svg.getAttribute('viewBox')!.split(' ').map(Number) as [number, number, number, number];
    dots.forEach((d, i) => {
      const p = F1_INSET_PLACES[i]!;
      const want = project(EUROPE_PROJECTION, p.lat, p.lon);
      const got = place(Number(d.getAttribute('cx')), Number(d.getAttribute('cy')));
      expect(got.x, `marker ${i} x`).toBeCloseTo(want.x, 0);
      expect(got.y, `marker ${i} y`).toBeCloseTo(want.y, 0);
      const r = Number(d.getAttribute('r'));
      expect(r, `marker ${i} radius`).toBeGreaterThan(0);
      expect(got.x - r >= vx && got.x + r <= vx + vw && got.y - r >= vy && got.y + r <= vy + vh, `marker ${i} whole inside the crop`).toBe(true);
    });
  });

  it('the outline is the Europe frame\'s, clipped to the crop so the rest of Europe cannot spill over the card', () => {
    const svg = renderF1Inset(document, FIXTURE).querySelector('svg.inset-svg')!;
    expect(svg.getAttribute('data-frame')).toBe('europe');
    expect(svg.querySelectorAll('g.map-land path')).toHaveLength(EUROPE_LAND.length);
    const clip = svg.querySelector('clipPath rect')!;
    expect(clip, 'a window clip').not.toBeNull();
    expect(`${clip.getAttribute('x')} ${clip.getAttribute('y')} ${clip.getAttribute('width')} ${clip.getAttribute('height')}`).toBe(svg.getAttribute('viewBox'));
    expect(svg.querySelector('g.map-window')!.getAttribute('clip-path')).toMatch(/^url\(#.+\)$/);
    expect(svg.classList.contains('map-svg') && svg.classList.contains('inset-svg')).toBe(true);
  });

  it('shows no place name anywhere: the only words in the tile are the two key labels (the six towns and the county are build-internal)', () => {
    const html = renderF1Inset(document, FIXTURE).outerHTML;
    for (const name of ['York', 'Catterick', 'Colchester', 'Canterbury', 'Winchester', 'Gloucester', 'Cambridgeshire']) expect(html, name).not.toContain(name);
    expect(renderF1Inset(document, FIXTURE).textContent).toBe(MAP_TEXT.F1inset.join(''));
  });

  it('the swatches in the key match the markers: filled for the towns, hollow for the countryside', () => {
    const swatches = [...renderF1Inset(document, FIXTURE).querySelectorAll('.inset-key-item svg.inset-swatch circle')];
    expect(swatches).toHaveLength(2);
    const town = renderF1Inset(document, FIXTURE).querySelector('circle.inset-town')!;
    expect(swatches[0]!.getAttribute('fill')).toBe(town.getAttribute('fill'));
    expect(swatches[1]!.getAttribute('fill')).toBe('#FFFFFF');
    expect(swatches[0]!.getAttribute('stroke')).toBe(swatches[1]!.getAttribute('stroke'));
  });

  it('is a figure with the map first and the key after it, and the map is hidden from assistive technology (the key says it in words)', () => {
    const fig = renderF1Inset(document, FIXTURE);
    expect(fig.tagName).toBe('FIGURE');
    expect([...fig.children].map((c) => c.tagName.toLowerCase())).toEqual(['svg', 'figcaption']);
    expect(fig.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
    expect(fig.lastElementChild!.className).toBe('inset-key');
  });

  it('renders the same tile every time (nothing random, nothing stateful)', () => {
    expect(renderF1Inset(document, FIXTURE).outerHTML).toBe(renderF1Inset(document, FIXTURE).outerHTML);
  });

  it('in the photo form the inset is the fourth tile after the three photos, and the pictures are unchanged', () => {
    const el = renderF1(onlyChecked(['F1inset'], ['hadrians-wall', 'bignor-medusa', 'hoxne-coins']), flagSet('romanInset', true, flagSet('images.F1', true, ALL_OFF)));
    const row = el.querySelector('.card-tiles')!;
    expect(row.getAttribute('data-form')).toBe('images');
    expect([...row.children].map((c) => c.getAttribute('data-image') ?? c.getAttribute('data-map'))).toEqual(['hadrians-wall', 'bignor-medusa', 'hoxne-coins', 'F1inset']);
    expect(row.querySelectorAll('img')).toHaveLength(3);
    expect(row.querySelector('.card-inset img')).toBeNull();
  });

  it('in the text form the inset is still there as the last tile of the row, after the three captions', () => {
    const row = renderF1().querySelector('.card-tiles')!;
    expect(row.getAttribute('data-form')).toBe('text');
    expect(row.querySelectorAll('img')).toHaveLength(0);
    expect(row.children).toHaveLength(4);
    expect(row.lastElementChild!.classList.contains('card-inset')).toBe(true);
  });

  it('the row says it carries an inset and counts the photos only, so the picture-count rules of the stylesheet keep their meaning', () => {
    const row = renderF1().querySelector('.card-tiles')!;
    expect(row.getAttribute('data-inset')).toBe('true');
    expect(row.getAttribute('data-count')).toBe('3');
    const without = renderF1(onlyChecked([])).querySelector('.card-tiles')!;
    expect(without.hasAttribute('data-inset')).toBe(false);
    expect(without.getAttribute('data-count')).toBe('3');
  });

  it('the source line sits last in the card, as the Natural Earth credit, and only with the inset', () => {
    const el = renderF1();
    expect(el.lastElementChild!.className).toBe('card-source');
    expect(renderF1(onlyChecked([])).querySelector('.card-source')).toBeNull();
    expect(renderF1(onlyChecked(['F1inset']), ALL_OFF).querySelector('.card-source')).toBeNull();
  });

  it('everything else on F1 is as it was: the title, the chip, the two columns and their words', () => {
    const plain = renderCardBody(document, CARDS.F1, cardCtx(FIXTURE, ALL_OFF, onlyChecked([]), { placement: 'after' }));
    const withInset = renderF1();
    const strip = (e: HTMLElement): string => {
      const c = e.cloneNode(true) as HTMLElement;
      c.querySelectorAll('.card-inset, .card-source').forEach((n) => n.remove());
      c.querySelector('.card-tiles')?.removeAttribute('data-inset');
      return c.outerHTML;
    };
    expect(strip(withInset)).toBe(strip(plain));
  });

  it('the footer is unchanged: no Image credits button for the inset alone (Natural Earth is credited in the source line and the credits footer)', () => {
    const card = openOnCard('F1', FIXTURE, ON, onlyChecked(['F1inset']));
    expect(card.querySelector('.card-inset')).not.toBeNull();
    expect(card.querySelector('.card-credits')).toBeNull();
  });

  it('with every other flag on as well, the inset still needs its own flag and its own check', () => {
    expect(renderF1(onlyChecked(['F1inset']), flagSet('romanInset', false, ALL_ON)).querySelector('.card-inset')).toBeNull();
    expect(renderF1(onlyChecked([]), ALL_ON).querySelector('.card-inset')).toBeNull();
    expect(renderF1(onlyChecked(['F1inset']), ALL_ON).querySelector('.card-inset')).not.toBeNull();
  });
});
