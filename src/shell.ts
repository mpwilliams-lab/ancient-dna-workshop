// App shell: storage probe, ?reset, guarded session restore + notice, wrap screen with QR, prompt focus.
// The shell prints RESTORED_NOTICE exactly once, after the Controller is built on a restored session,
// and only when that restore actually took effect. The Controller (Task 10) never prints it.
import type { WorkshopData } from './types';
import { Controller } from './controller';
import { mountTerminal, type TerminalView } from './terminal';
import { renderPlot } from './plots/index';
import { clearSession, loadSession, type SessionStorageLike, type SessionV2 } from './session';
import {
  APP_TITLE, RESTORED_NOTICE, WRAP_BUTTON, WRAP_CLOSE, WRAP_CREDIT, WRAP_LINE, WRAP_QR_CAPTION,
} from './content';
import { QR_SVG, QR_URL } from './generated/qr';

export interface BootEnv {
  doc: Document;
  href: string;                                  // location.href at load
  getStorage: () => Storage;                     // may throw (blocked storage)
  replaceUrl: (url: string) => void;             // history.replaceState wrapper; may throw
  data: WorkshopData;
}

export interface Booted {
  controller: Controller;
  terminal: TerminalView;
  store: SessionStorageLike | null;
  restored: boolean;
  reset: boolean;
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

function el<T extends HTMLElement>(doc: Document, id: string): T {
  const e = doc.getElementById(id);
  if (!e) throw new Error(`index.html is missing #${id}`);
  return e as T;
}

export function boot(env: BootEnv): Booted {
  const { doc, data } = env;
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
  const terminal = mountTerminal(termRoot, {
    onEnter: (line) => controller?.submit(line),
    onEsc: () => controller?.escape(),
    onTab: (partial) => (controller ? controller.tab(partial) : partial),
  });
  const deps = {
    data, terminal, store,
    renderPlot: (p: Parameters<typeof renderPlot>[2], opts?: { animate?: boolean }) => renderPlot(plotHost, data, p, opts),
  };

  try {
    controller = new Controller(deps, restoredSession);
  } catch (err) {
    // A saved session that the controller cannot replay must never crash the page.
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

  setupWrap(doc, termRoot);
  keepPromptFocused(doc, termRoot);
  focusPrompt(termRoot);
  return { controller, terminal, store, restored: restoredSession !== null, reset };
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
  doc.addEventListener(
    'mouseup',
    (e) => {
      if (!wrap.hidden) return;
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
