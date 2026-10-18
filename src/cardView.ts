// Card overlay (spec §5.2-§5.3, CONTRACT §4.11). A card covers the plot column (>= 1100 px), both panes down to the hint
// line (below 1100 px) or the plot pane (stacked layout). It never changes plot state and never takes focus: the prompt
// keeps the keyboard, and the shell returns focus to it after a button click (Task 12).
// Every card renders its P1 text form until its upgrade is ready (image tiles: renderTiles, Task 15; maps: Task 20).
import type { CardHost } from './controller';
import type { CardId, GeneId, ImageId, WorkshopData } from './types';
import { FEATURES, type Features } from './features';
import {
  CARDS, cardSource, cardVars, distributionRows, DISTRIBUTION_SCALE_MAX, fillCard, type Card, type CardVar,
} from './cards';
import {
  BACK_BUTTON, BACK_BUTTON_LABEL, CARD_CONTINUE, CARD_CONTINUE_DONE, CARD_CONTINUE_TO_PLOT, cardCounter, CREDITS_LINK, MAP_SOURCE_SUFFIX,
  MAP_TEXT,
} from './content';
import { chipElement } from './icons';
import { renderDiagram } from './diagrams';
import { ASSET_MANIFEST, HIDDEN_WHEN_SHOWN, type AssetManifest } from './assetManifest';
import { BUNDLED_IMAGES, cardMapId, cardShowsUpgrade, imageReady, imageUrl, mapReady, type ImageUrls } from './assets';
import { renderCardMap } from './cardMap';
import { F1_INSET_BOX, mapDataReady, mapSpec } from './maps';
import { mapBase, project, renderMap, type MapView } from './plots/map';
import { INK, SVG_NS, f1, svgEl } from './plots/svg';

export interface CardRenderContext {
  data: WorkshopData; features: Features;
  index: number; count: number; placement: 'after' | 'before';
  showBack: boolean;            // = features.back (a card is never open at the start, so Back is always possible from a card)
  manifest?: AssetManifest;     // Task 15: default ASSET_MANIFEST (tests pass a checked copy)
  imageUrls?: ImageUrls;        // Task 15: default BUNDLED_IMAGES (tests pass stand-ins)
}
export type FitLevel = 'normal' | 'dense' | 'compact' | 'scroll';
export interface CardViewHandlers { onContinue(): void; onBack(): void; onCredits(): void }
export interface CardView extends CardHost { isOpen(): boolean; currentId(): CardId | null; refit(): FitLevel }

/** Value lists longer than this are laid out in two columns already at `normal` (the 20-row LCT list at 1366 x 768). */
export const LONG_VALUE_LIST = 11;

/**
 * The upgraded (P2) form is on screen: Task 15's rule (flag on, every non-optional tile image ready, its map checked and its
 * spec built). Otherwise the P1 text form. The map slot, the value bars, the text-form lines, the source line, the image tiles
 * and the Image credits button all read this one rule, so they always agree.
 */
export function upgradedFormShown(
  card: Card, features: Features, manifest: AssetManifest = ASSET_MANIFEST, urls: ImageUrls = BUNDLED_IMAGES,
): boolean {
  return cardShowsUpgrade(card, features, manifest, urls);
}

/** upgradedFormShown for this render, and (map cards) the map's data present: A1 needs europe_pops (Task 23), so without it the
 *  whole card, footer included, stays in the text form. The body and the footer both ask this, so they cannot disagree. */
function upgradeOnScreen(card: Card, ctx: CardRenderContext): boolean {
  const mapId = cardMapId(card);
  return upgradedFormShown(card, ctx.features, ctx.manifest ?? ASSET_MANIFEST, ctx.imageUrls ?? BUNDLED_IMAGES)
    && (mapId === undefined || mapDataReady(mapId, ctx.data));
}

/** Not the last card: Continue. Last "before" card: Show the plot. Last "after" card: See the plot (spec §3.5). */
export function continueLabel(index: number, count: number, placement: 'after' | 'before'): string {
  if (index < count - 1) return CARD_CONTINUE;
  return placement === 'before' ? CARD_CONTINUE_TO_PLOT : CARD_CONTINUE_DONE;
}

/**
 * Spec §6: a card that shows a map carries "Map outline: Made with Natural Earth." in its source line. K2's §3.4 source does not
 * include it, so it is added whenever the map is drawn; a source that already ends with it is left alone, and the text form
 * (mapShown false) is never changed.
 */
export function sourceWithMapSuffix(source: string | undefined, mapShown: boolean): string | undefined {
  if (!mapShown) return source;
  if (source === undefined || source === '') return MAP_SOURCE_SUFFIX;
  return source.endsWith(MAP_SOURCE_SUFFIX) ? source : `${source} ${MAP_SOURCE_SUFFIX}`;
}

/**
 * The source line as shown, templates filled, or undefined when the card shows none. A line whose {…} value is missing from
 * the data is left out, never printed half-filled: A1's "{n_pops} groups, {n_people} people" when the JSON has no europe_fit
 * (cardVars gives '' for both). Carry-forward from the Task 10 review: A1's source is shown only with its map (Task 23), and
 * never without europe_fit. A card whose map is drawn (`upgraded` on a map card) always ends with the Natural Earth line
 * (sourceWithMapSuffix, Task 27: K2's §3.4 source is the one that lacks it), and so does F1 while its town inset is on screen
 * (`insetShown`, Task 29: F1 has no source line of its own, so that line is all it shows).
 */
export function cardSourceLine(
  card: Card, upgraded: boolean, vars: Readonly<Record<CardVar, string>>, insetShown: boolean = false,
): string | undefined {
  const source = sourceWithMapSuffix(cardSource(card, upgraded), (upgraded && cardMapId(card) !== undefined) || insetShown);
  if (source === undefined) return undefined;
  const missing = (Object.keys(vars) as CardVar[]).some((name) => vars[name] === '' && source.includes(`{${name}}`));
  return missing ? undefined : fillCard(source, vars);
}

/** Width of a value bar, 0..1: copies per 100 over the gene's scale (TYK2 0-15), three decimals. */
export function barFraction(freq: number, scaleMax: number): number {
  const v = (freq * 100) / scaleMax;
  return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
}

function make<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The tile row (spec §5.2, §7.2). Photo form only when the card is upgraded on screen (flag on, every non-optional tile
 * checked and bundled). There, an optional tile without a ready image is left out, and C1's Shrewton tile is never shown
 * beside the Archer photo. Otherwise every tile is text: name and line, or the caption alone, with no picture and no image
 * caption (that describes a picture that is not shown). Every picture is shown WHOLE (object-fit: contain, letterboxed on the
 * tile background), never cut by CSS: the instructor approves the staged file in Preview, so approval is what students see.
 * The only crop is a pixel crop already made by scripts/fetch-assets (the Medusa panel), which is part of the file he sees.
 */
export function renderTiles(doc: Document, card: Card, ctx: CardRenderContext): HTMLDivElement | null {
  const tiles = card.tiles ?? [];
  if (tiles.length === 0) return null;
  const vars = cardVars(ctx.data);
  const fill = (text: string): string => fillCard(text, vars);
  const manifest = ctx.manifest ?? ASSET_MANIFEST;
  const urls = ctx.imageUrls ?? BUNDLED_IMAGES;
  const upgraded = cardShowsUpgrade(card, ctx.features, manifest, urls);
  const shows = (id: ImageId): boolean => upgraded && imageReady(id, manifest, urls);
  const row = make(doc, 'div', 'card-tiles');
  for (const t of tiles) {
    const withImage = shows(t.image);
    const hider = HIDDEN_WHEN_SHOWN[t.image];
    if (upgraded && hider !== undefined && shows(hider)) continue;
    if (upgraded && t.optional === true && !withImage) continue;
    const fig = make(doc, 'figure', t.optional === true ? 'card-tile is-optional' : 'card-tile');
    fig.setAttribute('data-image', t.image);
    if (withImage) {
      const img = make(doc, 'img', 'tile-img tile-img--contain');
      img.alt = '';
      img.src = imageUrl(t.image, urls)!;
      fig.append(img);
    }
    const cap = make(doc, 'figcaption');
    if (t.name !== undefined) cap.append(make(doc, 'span', 'tile-name', fill(t.name)));
    cap.append(make(doc, 'span', 'tile-caption', fill(t.caption)));
    if (withImage && t.imageCaption !== undefined) cap.append(make(doc, 'span', 'tile-image-caption', fill(t.imageCaption)));
    fig.append(cap);
    row.append(fig);
  }
  row.setAttribute('data-form', upgraded ? 'images' : 'text');
  row.setAttribute('data-count', String(row.children.length));
  return row;
}

function renderValues(doc: Document, gene: GeneId, data: WorkshopData): HTMLUListElement {
  const rows = distributionRows(data, gene);
  const list = make(doc, 'ul', 'card-values');
  list.setAttribute('data-gene', gene);
  if (rows.length > LONG_VALUE_LIST) list.setAttribute('data-long', 'true');
  const max = DISTRIBUTION_SCALE_MAX[gene];
  for (const r of rows) {
    const li = make(doc, 'li', 'value-row');
    li.setAttribute('data-key', r.key);
    li.setAttribute('aria-label', `${r.label}: ${r.display}`);
    const bar = make(doc, 'span', 'value-bar');
    bar.setAttribute('style', `--v:${barFraction(r.value, max)}`);
    bar.setAttribute('aria-hidden', 'true');
    li.append(make(doc, 'span', 'value-label', r.label), bar, make(doc, 'span', 'value-num', r.display));
    list.append(li);
  }
  return list;
}

/** Marker radius on the F1 inset, in viewBox units of the cropped Europe-frame outline: 3.1 to 3.5 px at the picture's 200 to 230 px of
 *  height (the stroke adds half a unit more), so a dot is 7 to 9 px across. */
const INSET_MARKER_R = 2.6;

/**
 * The F1 town inset (P3, flag romanInset): the Europe-frame Natural Earth outline cropped to Britain (the spec's own window, so the
 * rest of Europe is clipped away, not just off the edge), six filled town markers and one hollow countryside marker drawn at inset
 * size, and the two labels as an HTML key under the map so they stay legible at tile size. The SVG holds no text, and no place
 * name is written anywhere: the six towns and the county are build-internal (src/maps.ts F1_INSET_PLACES).
 */
export function renderF1Inset(doc: Document, data: WorkshopData): HTMLElement {
  const spec = mapSpec('F1inset', data);
  const c = mapBase(spec.frame).projection;
  const a = project(c, F1_INSET_BOX.latMax, F1_INSET_BOX.lonMin);
  const b = project(c, F1_INSET_BOX.latMin, F1_INSET_BOX.lonMax);
  // One decimal, as the viewBox of every other drawing here (f1), so the attribute reads "x y width height" exactly.
  const view: MapView = { x: Number(f1(a.x)), y: Number(f1(a.y)), width: Number(f1(b.x - a.x)), height: Number(f1(b.y - a.y)) };
  const fig = doc.createElement('figure');
  fig.className = 'card-tile card-inset is-optional';
  fig.setAttribute('data-map', 'F1inset');
  const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  renderMap(svg, { ...spec, points: [], view });      // the outline and the window; the markers are drawn here, at inset size
  svg.classList.add('inset-svg');
  for (const pt of spec.points ?? []) {
    const q = project(c, pt.lat, pt.lon);
    const town = pt.label === MAP_TEXT.F1inset[0];
    svg.append(svgEl('circle', {
      class: town ? 'inset-town' : 'inset-country', cx: q.x, cy: q.y, r: INSET_MARKER_R,
      fill: town ? INK : '#FFFFFF', stroke: INK, 'stroke-width': 1.2,
    }));
  }
  const key = doc.createElement('figcaption');
  key.className = 'inset-key';
  MAP_TEXT.F1inset.forEach((text, i) => {
    const item = doc.createElement('span');
    item.className = 'inset-key-item';
    const swatch = doc.createElementNS(SVG_NS, 'svg');
    swatch.setAttribute('class', 'inset-swatch');
    swatch.setAttribute('viewBox', '0 0 12 12');
    swatch.setAttribute('aria-hidden', 'true');
    swatch.append(svgEl('circle', { cx: 6, cy: 6, r: 4.5, fill: i === 0 ? INK : '#FFFFFF', stroke: INK, 'stroke-width': 1.5 }));
    item.append(swatch, doc.createTextNode(text));
    key.append(item);
  });
  fig.append(svg, key);
  return fig;
}

/** F1's town inset is on screen: the card has one, its flag is on, the instructor has checked the inset map and its spec is built. */
function insetOnScreen(card: Card, ctx: CardRenderContext): boolean {
  if (!card.inset || !ctx.features[card.inset.feature]) return false;
  return mapReady(card.inset.map, ctx.manifest ?? ASSET_MANIFEST) && mapDataReady(card.inset.map, ctx.data);
}

/** F1's inset tile when the card has one, its flag is on and the instructor has checked the inset map; otherwise null. */
export function insetTile(doc: Document, card: Card, ctx: CardRenderContext): HTMLElement | null {
  return insetOnScreen(card, ctx) ? renderF1Inset(doc, ctx.data) : null;
}

/** The card body in the §5.2 order (pure DOM build; the footer is added by mountCardView). */
export function renderCardBody(doc: Document, card: Card, ctx: CardRenderContext): HTMLElement {
  const vars = cardVars(ctx.data);
  const fill = (s: string): string => fillCard(s, vars);
  const mapId = cardMapId(card);
  const upgraded = upgradeOnScreen(card, ctx);
  const inset = insetTile(doc, card, ctx);
  const body = make(doc, 'div', 'card-body');

  const title = make(doc, 'h2', 'card-title', fill(card.title));
  title.id = 'card-title';
  body.append(title);
  if (card.lead !== undefined) body.append(make(doc, 'p', 'card-lead', fill(card.lead)));
  if (card.chips && card.chips.length > 0) {
    const chips = make(doc, 'div', 'card-chips');
    for (const key of card.chips) chips.append(chipElement(doc, key));
    body.append(chips);
  }
  // The tile row, with F1's inset as one more tile after the photos (or its text captions). data-count stays the number of photo
  // tiles, which is what the stylesheet's picture-count rules mean; data-inset marks the row that has the extra tile.
  const tiles = renderTiles(doc, card, ctx) ?? (inset !== null ? make(doc, 'div', 'card-tiles') : null);
  if (tiles !== null) {
    if (inset !== null) {
      tiles.append(inset);
      tiles.setAttribute('data-inset', 'true');
    }
    body.append(tiles);
  }
  if (upgraded && mapId !== undefined) body.append(renderCardMap(doc, card, ctx.data));
  if (card.diagram) {
    const slot = make(doc, 'div', 'card-diagram');
    slot.setAttribute('data-diagram', card.diagram.id);
    slot.append(renderDiagram(doc, card.diagram.id, card.diagram.labels.map(fill)));
    body.append(slot);
  }
  if (card.bullets.length > 0) {
    const list = make(doc, 'ul', 'card-bullets');
    for (const b of card.bullets) {
      const li = make(doc, 'li', undefined, fill(b.text));
      if (b.chip) li.append(doc.createTextNode(' '), chipElement(doc, b.chip));
      list.append(li);
    }
    body.append(list);
  }
  if (card.columns && card.columns.length > 0) {
    const cols = make(doc, 'div', 'card-columns');
    for (const c of card.columns) {
      const sec = make(doc, 'section', 'card-column');
      sec.append(make(doc, 'h3', undefined, fill(c.heading)));
      if (c.text !== undefined) sec.append(make(doc, 'p', undefined, fill(c.text)));
      if (c.bullets && c.bullets.length > 0) {
        const list = make(doc, 'ul');
        for (const b of c.bullets) list.append(make(doc, 'li', undefined, fill(b)));
        sec.append(list);
      }
      cols.append(sec);
    }
    body.append(cols);
  }
  if (card.panel) {
    const panel = make(doc, 'aside', 'card-panel');
    panel.append(make(doc, 'h3', undefined, fill(card.panel.title)), make(doc, 'p', undefined, fill(card.panel.text)));
    body.append(panel);
  }
  if (card.values && !upgraded) body.append(renderValues(doc, card.values, ctx.data));
  if (card.sideNote !== undefined) body.append(make(doc, 'p', 'card-side-note', fill(card.sideNote)));
  const lines = [...(upgraded ? [] : card.textForm?.lines ?? []), ...(card.lines ?? [])];
  if (lines.length > 0) {
    const list = make(doc, 'ul', 'card-lines');
    for (const l of lines) list.append(make(doc, 'li', undefined, fill(l)));
    body.append(list);
  }
  if (card.puzzle !== undefined) body.append(make(doc, 'p', 'card-puzzle', fill(card.puzzle)));
  const source = cardSourceLine(card, upgraded, vars, inset !== null);
  if (source !== undefined) body.append(make(doc, 'p', 'card-source', source));
  return body;
}

function renderFooter(doc: Document, card: Card, ctx: CardRenderContext, handlers: CardViewHandlers): HTMLElement {
  const footer = make(doc, 'footer', 'card-footer');
  footer.append(make(doc, 'span', 'card-counter', cardCounter(ctx.index + 1, ctx.count)));
  const button = (cls: string, text: string, onClick: () => void): HTMLButtonElement => {
    const b = make(doc, 'button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  if (ctx.showBack) {
    const back = button('card-back', BACK_BUTTON, () => handlers.onBack());
    back.setAttribute('aria-label', BACK_BUTTON_LABEL);
    footer.append(back);
  }
  if (upgradeOnScreen(card, ctx)) {
    footer.append(button('card-credits', CREDITS_LINK, () => handlers.onCredits()));
  }
  footer.append(button('card-continue', continueLabel(ctx.index, ctx.count, ctx.placement), () => handlers.onContinue()));
  return footer;
}

const FIT_CLASSES = ['dense', 'compact', 'scroll'] as const;

/** Spec §5.2 no-scroll fit: normal, then dense, then compact, then an internal scroll. Starts from normal on every call. */
export function fitCard(cardEl: HTMLElement): FitLevel {
  cardEl.classList.remove(...FIT_CLASSES);
  const body = cardEl.querySelector<HTMLElement>('.card-body');
  const overflows = (): boolean => body !== null && body.scrollHeight > body.clientHeight + 1;
  let level: FitLevel = 'normal';
  for (const next of FIT_CLASSES) {
    if (!overflows()) break;
    cardEl.classList.add(next);
    level = next;
  }
  cardEl.setAttribute('data-fit', level);
  return level;
}

export function mountCardView(
  root: HTMLElement, data: WorkshopData, handlers: CardViewHandlers, features: Features = FEATURES,
  assets: { manifest?: AssetManifest; urls?: ImageUrls } = {},
): CardView {
  const doc = root.ownerDocument;
  root.classList.add('card');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-labelledby', 'card-title');
  root.hidden = true;
  let current: CardId | null = null;

  const hintLine = (): HTMLElement | null => doc.querySelector<HTMLElement>('#terminal .term-hint');

  /** Below 1100 px the card ends where the hint line starts, so the hint, the prompt row and the header stay usable.
   *  Without a hint line (a bare page, no terminal mounted) the card runs to the bottom of #panes. */
  const place = (): void => {
    const panes = root.parentElement;
    const hint = hintLine();
    const gap = panes && hint ? Math.max(0, Math.ceil(panes.getBoundingClientRect().bottom - hint.getBoundingClientRect().top)) : 0;
    root.style.setProperty('--card-bottom', `${gap}px`);
  };

  // The hint line changes height when it switches to CARD_HINT and back. The controller sets the hint just BEFORE it opens a
  // card, so place() below already sees the height the line will keep; the observer follows every later change (a window
  // resize, a font arriving, a restored card whose first layout comes after the open). It cannot replace that order: it
  // reports only a size that differs from the last one it reported. This view may be mounted before the terminal, so the hint
  // line may not exist yet: it is looked up again on every open, and the observer moves to it.
  const RO = doc.defaultView?.ResizeObserver;   // absent in jsdom: then only window resizes refit
  const ro = RO ? new RO(() => view.refit()) : null;
  let observed: HTMLElement | null = null;
  const observeHint = (): void => {
    const hint = hintLine();
    if (ro === null || hint === observed) return;
    if (observed !== null) ro.disconnect();
    observed = hint;
    if (hint !== null) ro.observe(hint);
  };

  const view: CardView = {
    open(id, index, count, placement) {
      const card = CARDS[id];
      if (!card) return;
      const ctx: CardRenderContext = {
        data, features, index, count, placement, showBack: features.back,
        manifest: assets.manifest ?? ASSET_MANIFEST, imageUrls: assets.urls ?? BUNDLED_IMAGES,
      };
      root.replaceChildren(renderCardBody(doc, card, ctx), renderFooter(doc, card, ctx, handlers));
      root.setAttribute('data-card-id', id);
      current = id;
      root.hidden = false;
      observeHint();
      place();
      fitCard(root);
      // A picture has no height until it has loaded, so the fit just made may be wrong: refit when each one arrives.
      for (const img of root.querySelectorAll('img')) img.addEventListener('load', () => view.refit(), { once: true });
    },
    close() {
      root.hidden = true;
      root.replaceChildren();
      root.removeAttribute('data-card-id');
      root.removeAttribute('data-fit');
      root.classList.remove(...FIT_CLASSES);
      current = null;
    },
    isOpen: () => current !== null && !root.hidden,
    currentId: () => current,
    refit() {
      if (!view.isOpen()) return 'normal';
      place();
      return fitCard(root);
    },
  };

  doc.defaultView?.addEventListener('resize', () => view.refit());
  observeHint();
  return view;
}
