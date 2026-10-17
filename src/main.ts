import './style.css';
import { DATA } from './data';
import { boot, makeTestHook, type AdwHook } from './shell';

const booted = boot({
  doc: document,
  href: window.location.href,
  getStorage: () => window.sessionStorage,
  replaceUrl: (url) => window.history.replaceState(null, '', url),
  data: DATA,
});

// Test hook for the Playwright suite. Read-only (hint index, printing, restore, storage, screen, open card, flags),
// except openCard(id), which is attached ONLY when the URL carries ?test (read in boot) and shows a card over the
// current plot without changing the session (spec §5.4).
declare global {
  interface Window {
    __adw?: AdwHook;
  }
}
window.__adw = makeTestHook(booted);
