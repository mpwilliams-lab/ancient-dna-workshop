// The credits panel (spec §5.2, CONTRACT §4.14). It lists, grouped by card, the attribution string and the Commons file page
// (plain text, never a link, so nothing can make a request) of EVERY image in the build, then the Natural Earth line of every map
// in the build, then CREDITS_FOOTER (carry-forward D-L5: the spec lists every image and map, not only what is on screen).
// "In the build" is the same for the panel and for CREDITS.md: an image whose file is bundled (src/assets/img, src/assets/svg),
// whatever its card's flag says and whether or not it has been checked yet; a map that the instructor has checked, because the
// build draws only maps it has been shown, and a map is checked only after it has been drawn. A tile that is not in the build
// (no file) is never credited. Flags do not matter, so the panel takes no `features`.
import type { CardId, MapId } from './types';
import { CARD_IDS } from './types';
import { CARDS, type Card } from './cards';
import { CREDITS_CLOSE, CREDITS_FOOTER, CREDITS_TITLE, MAP_SOURCE_SUFFIX } from './content';
import { ASSET_MANIFEST, attributionString, type AssetManifest } from './assetManifest';
import { BUNDLED_IMAGES, cardMapId, imageUrl, mapReady, type ImageUrls } from './assets';

export interface CreditsGroup { cardId: CardId; title: string; lines: string[] }
export interface CreditsHandlers { onClose(): void }
export interface CreditsView { open(): void; close(): void; isOpen(): boolean }

/** The maps a card can draw: its own, and the F1 town inset. */
function mapsOf(card: Card): MapId[] {
  return [cardMapId(card), card.inset?.map].filter((m): m is MapId => m !== undefined);
}

export function creditsGroups(manifest: AssetManifest = ASSET_MANIFEST, urls: ImageUrls = BUNDLED_IMAGES): CreditsGroup[] {
  const out: CreditsGroup[] = [];
  for (const id of CARD_IDS) {
    const card = CARDS[id];
    const lines: string[] = [];
    for (const e of manifest.images) {
      if (e.card !== id || (imageUrl(e.id, urls) ?? '') === '') continue;
      lines.push(attributionString(e));
      if (e.file_page) lines.push(e.file_page);
    }
    if (mapsOf(card).some((m) => mapReady(m, manifest))) lines.push(MAP_SOURCE_SUFFIX);
    if (lines.length > 0) out.push({ cardId: id, title: card.title, lines });
  }
  return out;
}

function need<T extends HTMLElement>(doc: Document, id: string): T {
  const e = doc.getElementById(id);
  if (!e) throw new Error(`index.html is missing #${id}`);
  return e as T;
}

/** Drives #credits. Esc is taken in the capture phase, so the panel closes before the wrap screen or a card sees it. */
export function mountCredits(
  doc: Document, handlers: CreditsHandlers, manifest: AssetManifest = ASSET_MANIFEST, urls: ImageUrls = BUNDLED_IMAGES,
): CreditsView {
  const root = need(doc, 'credits');
  const list = need(doc, 'credits-list');
  const close = need<HTMLButtonElement>(doc, 'credits-close');
  need(doc, 'credits-title').textContent = CREDITS_TITLE;
  need(doc, 'credits-footer').textContent = CREDITS_FOOTER;
  close.textContent = CREDITS_CLOSE;

  const fill = (): void => {
    list.replaceChildren(...creditsGroups(manifest, urls).map((g) => {
      const section = doc.createElement('section');
      section.className = 'credits-group';
      section.dataset.card = g.cardId;
      const h = doc.createElement('h3');
      h.className = 'credits-card-title';
      h.textContent = g.title;
      section.append(h);
      for (const line of g.lines) {
        const p = doc.createElement('p');
        p.className = line.startsWith('https://') ? 'credits-url' : 'credits-line';
        p.textContent = line;
        section.append(p);
      }
      return section;
    }));
  };
  const view: CreditsView = {
    open() {
      fill();
      root.hidden = false;
      close.focus();
    },
    close() {
      if (root.hidden) return;
      root.hidden = true;
      handlers.onClose();
    },
    isOpen: () => !root.hidden,
  };
  close.addEventListener('click', () => view.close());
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !root.isConnected || root.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    view.close();
  }, true);
  return view;
}
