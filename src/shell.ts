// App shell: storage probe, ?reset, ?test, card view, header Back button, guarded session restore + notice, wrap screen with QR, credits panel, prompt focus.
// The shell prints RESTORED_NOTICE exactly once, after the Controller is built on a restored session,
// and only when that restore actually took effect. The Controller (Task 10) never prints it.
import type { CardId, WorkshopData } from './types';
import { Controller } from './controller';
import { mountTerminal, type TerminalView } from './terminal';
import { mountCardView, type CardView } from './cardView';
import { mountCredits, type CreditsView } from './credits';
import type { AssetManifest } from './assetManifest';
import type { ImageUrls } from './assets';
import { FEATURES, type Features } from './features';
import { renderPlot } from './plots/index';
import { clearSession, loadSession, type SessionStorageLike, type SessionV2 } from './session';
import {
  APP_TITLE, BACK_BUTTON, BACK_BUTTON_LABEL, CREDITS_LINK, RESTORED_NOTICE, WRAP_BUTTON, WRAP_CLOSE, WRAP_CREDIT, WRAP_LINE,
  WRAP_QR_CAPTION,
} from './content';
import { QR_SVG, QR_URL } from './generated/qr';

export interface BootEnv {
  doc: Document;
  href: string;                                  // location.href at load
  getStorage: () => Storage;                     // may throw (blocked storage)
  replaceUrl: (url: string) => void;             // history.replaceState wrapper; may throw
  data: WorkshopData;
  features?: Features;                           // default FEATURES (the shipped set); tests pass ALL_OFF / ALL_ON
  now?: () => number;                            // default performance.now(); jsdom tests drive the card repeat guard with it
  assets?: { manifest?: AssetManifest; urls?: ImageUrls };   // default: the committed manifest and the bundled files; tests pass checked stand-ins
}

export interface Booted {
  controller: Controller;
  terminal: TerminalView;
  store: SessionStorageLike | null;
  restored: boolean;
  reset: boolean;
  cards: CardView;
  features: Features;
  test: boolean;                                 // the URL had ?test (window.__adw.openCard is attached)
}

/** Returns a working storage, or null if the getter throws or a write/remove fails. */
export function probeStorage(get: () => Storage): SessionStorageLike | null {
  try {
    const s = get();
    if (!s) return null;
    const k = '__adw_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

/** True when the URL carries a `reset` query parameter (`?reset`, `?reset=1`, `?a=b&reset`). */
export function hasReset(href: string): boolean {
  try {
    return new URL(href).searchParams.has('reset');
  } catch {
    return false;
  }
}

/** The same URL with every `reset` parameter removed (other parameters and the hash kept). */
export function stripReset(href: string): string {
  try {
    const u = new URL(href);
    u.searchParams.delete('reset');
    return u.toString();
  } catch {
    return href;
  }
}

/** True when the URL carries a `test` query parameter (`?test`, `?reset&test`). Only then does window.__adw get openCard. */
export function hasTestFlag(href: string): boolean {
  try {
    return new URL(href).searchParams.has('test');
  } catch {
    return false;
  }
}

function el<T extends HTMLElement>(doc: Document, id: string): T {
  const e = doc.getElementById(id);
  if (!e) throw new Error(`index.html is missing #${id}`);
  return e as T;
}

export function boot(env: BootEnv): Booted {
  const { doc, data } = env;
  const features = env.features ?? FEATURES;
  const test = hasTestFlag(env.href);
  doc.title = APP_TITLE;
  el(doc, 'app-title').textContent = APP_TITLE;

  const store = probeStorage(env.getStorage);
  const reset = hasReset(env.href);
  if (reset) {
    clearSession(store);
    try {
      env.replaceUrl(stripReset(env.href));
    } catch {
      /* file:// or sandbox may refuse; the session is already cleared */
    }
  }
  let restoredSession: SessionV2 | null = reset ? null : loadSession(store);

  const termRoot = el(doc, 'terminal');
  const plotHost = el(doc, 'plot');
  let controller: Controller | null = null;
  let credits: CreditsView | null = null;
  const wrapScreen = el(doc, 'wrap');
  const backBtn = features.back ? createBackButton(doc) : null;
  /**
   * Spec §4.3: both Back buttons (the header's and each card's) step back one screen and hand the keyboard back to the prompt.
   * The credits panel and the wrap screen are modal. Shift+Tab can move focus from either one to a button behind it, and a Back
   * pressed there must not change the screen under the dialog (the same rule as Esc, §5.2).
   */
  const goBack = (): void => {
    if (credits?.isOpen() || !wrapScreen.hidden) return;
    controller?.back();
    focusPrompt(termRoot);
  };
  const terminal = mountTerminal(termRoot, {
    onEnter: (line, key) => controller?.submit(line, key),
    onEsc: (key) => {
      // The credits panel and the wrap screen take Esc before a card does (spec §5.2). Shift+Tab can move focus out of either
      // dialog to the prompt, and an Esc typed there must close the dialog only: not move a card, not fill the hinted command.
      if (credits?.isOpen() || !wrapScreen.hidden) return;
      controller?.escape(key);
    },
    onTab: (partial) => (controller ? controller.tab(partial) : partial),
  });
  // The card overlay (Task 11) is the controller's CardHost. It is mounted after the terminal, so it finds the hint line at
  // once, and before the Controller is built, because a restored session reopens its open card from the constructor (spec §4.2).
  // A click on a card button takes focus; each handler gives the keyboard back to the prompt (spec §5.2).
  const cardView = mountCardView(el(doc, 'card'), data, {
    onContinue: () => {
      controller?.continueCard();
      focusPrompt(termRoot);
    },
    onBack: goBack,
    onCredits: () => credits?.open(),          // the panel takes the keyboard (focus on its Close button) until it closes
  }, features, env.assets);
  const deps = {
    data, terminal, store,
    renderPlot: (p: Parameters<typeof renderPlot>[2], opts?: { animate?: boolean }) => renderPlot(plotHost, data, p, opts),
    cards: cardView,
    features,
    // The header Back button is disabled on the first screen. The Controller reports every change of screen, its last
    // statement included, so the button is right from the first paint, after a restore as well.
    onScreen: (_s: { step: number; card: number }, canGoBack: boolean): void => {
      if (backBtn) backBtn.disabled = !canGoBack;
    },
    ...(env.now ? { now: env.now } : {}),
  };

  try {
    controller = new Controller(deps, restoredSession);
  } catch (err) {
    // A saved session that the controller cannot replay must never crash the page. A card it opened before failing goes too.
    cardView.close();
    console.error('Controller could not replay the saved session; starting fresh', err);
    clearSession(store);
    terminal.clearScreen();
    restoredSession = null;
    controller = new Controller(deps, null);
  }
  // The Controller also swallows a failed replay itself: it logs, clears the screen and starts fresh without
  // throwing. The restore only counts when the Controller really holds saved state afterwards; otherwise the
  // stale entry is discarded and no notice is shown.
  if (restoredSession && !holdsSavedState(controller)) {
    clearSession(store);
    restoredSession = null;
  }
  // The one place the notice is printed. It goes to the terminal only, never into the saved transcript.
  if (restoredSession) terminal.notice(RESTORED_NOTICE);

  if (backBtn) {
    backBtn.addEventListener('click', goBack);
    backBtn.disabled = !controller.canGoBack;
  }

  setupWrap(doc, termRoot);
  credits = setupCredits(doc, termRoot, env.assets);
  keepPromptFocused(doc, termRoot);
  focusPrompt(termRoot);
  return { controller, terminal, store, restored: restoredSession !== null, reset, cards: cardView, features, test };
}

/** True when the Controller carries anything from a saved session: typing history, transcript lines or a step. */
function holdsSavedState(c: Controller): boolean {
  const s = c.session;
  return s.history.length > 0 || s.transcript.length > 0 || s.steps.length > 0;
}

function focusPrompt(termRoot: HTMLElement): void {
  const input = termRoot.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  input?.focus();
}

/** Buttons, links and form controls take focus or act on a click themselves; the prompt must not take it from them. */
const TAKES_OWN_CLICK = 'a[href], button, input, select, textarea';

/**
 * A click anywhere on the page puts the prompt back in focus, so typing and Esc keep working after the user clicks
 * the plot or the title bar. It stays out of the way of the wrap screen (while it is open), of anything that takes
 * the click itself (buttons, links, form controls) and of a text selection (so output can be copied).
 * Registered in the capture phase, so it sees every click whatever the page's own handlers do with the event.
 */
function keepPromptFocused(doc: Document, termRoot: HTMLElement): void {
  const wrap = el(doc, 'wrap');
  const credits = el(doc, 'credits');
  doc.addEventListener(
    'mouseup',
    (e) => {
      if (!wrap.hidden || !credits.hidden) return;
      const target = e.target as Element | null;
      if (target && typeof target.closest === 'function' && target.closest(TAKES_OWN_CLICK)) return;
      if (doc.getSelection()?.toString()) return;
      focusPrompt(termRoot);
    },
    true,
  );
}

function setupWrap(doc: Document, termRoot: HTMLElement): void {
  const wrap = el(doc, 'wrap');
  const open = el<HTMLButtonElement>(doc, 'wrap-open');
  const close = el<HTMLButtonElement>(doc, 'wrap-close');
  open.textContent = WRAP_BUTTON;
  close.textContent = WRAP_CLOSE;
  el(doc, 'wrap-line').textContent = WRAP_LINE;
  el(doc, 'wrap-caption').textContent = WRAP_QR_CAPTION;
  el(doc, 'wrap-qr').innerHTML = QR_SVG; // build-time constant from scripts/make-qr.mjs
  el(doc, 'wrap-url').textContent = QR_URL;
  el(doc, 'wrap-org').textContent = WRAP_CREDIT;

  const hide = (): void => {
    wrap.hidden = true;
    focusPrompt(termRoot);
  };
  open.addEventListener('click', () => {
    wrap.hidden = false;
    close.focus();
  });
  close.addEventListener('click', hide);
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !wrap.hidden) {
      e.preventDefault();
      hide();
    }
  });
}

/** Spec §4.3: the header Back button, left of "Take this home". Created only when the back flag is on; disabled until a step has run. */
function createBackButton(doc: Document): HTMLButtonElement {
  const btn = doc.createElement('button');
  btn.id = 'back';
  btn.type = 'button';
  btn.textContent = BACK_BUTTON;
  btn.setAttribute('aria-label', BACK_BUTTON_LABEL);
  btn.disabled = true;
  el(doc, 'bar').insertBefore(btn, el(doc, 'wrap-open'));
  return btn;
}

/**
 * Spec §5.2: the credits panel, opened from a card's "Image credits" button and from the wrap screen. Closing it gives focus back
 * to the wrap screen's Close button when that screen is open underneath, and to the prompt otherwise.
 */
function setupCredits(doc: Document, termRoot: HTMLElement, assets: BootEnv['assets']): CreditsView {
  const wrap = el(doc, 'wrap');
  const view = mountCredits(doc, {
    onClose: () => {
      if (!wrap.hidden) el<HTMLButtonElement>(doc, 'wrap-close').focus();
      else focusPrompt(termRoot);
    },
  }, assets?.manifest, assets?.urls);
  const fromWrap = el<HTMLButtonElement>(doc, 'wrap-credits');
  fromWrap.textContent = CREDITS_LINK;
  fromWrap.addEventListener('click', () => view.open());
  return view;
}

/** window.__adw (CONTRACT §4.15). Read-only, except openCard, which exists only with ?test and changes no session state. */
export interface AdwHook {
  hintIndex(): number;
  isPrinting(): boolean;
  restored: boolean;
  storage: boolean;
  screen(): { step: number; card: number };
  cardOpen(): CardId | null;
  features: Features;
  openCard?(id: CardId): void;
}

export function makeTestHook(b: Booted): AdwHook {
  const hook: AdwHook = {
    hintIndex: () => b.controller.hintIndex,
    isPrinting: () => b.terminal.isPrinting(),
    restored: b.restored,
    storage: b.store !== null,
    screen: () => ({ ...b.controller.screen }),
    cardOpen: () => b.controller.cardOpen,
    features: Object.freeze({ ...b.features }),
  };
  if (b.test) hook.openCard = (id: CardId) => b.controller.openCardForTest(id);
  return hook;
}
