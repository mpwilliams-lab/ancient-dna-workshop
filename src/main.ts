import './style.css';
import { DATA } from './data';
import { boot } from './shell';

const booted = boot({
  doc: document,
  href: window.location.href,
  getStorage: () => window.sessionStorage,
  replaceUrl: (url) => window.history.replaceState(null, '', url),
  data: DATA,
});

// Read-only test hook for the Playwright suite (no state can be changed through it).
declare global {
  interface Window {
    __adw?: { hintIndex(): number; isPrinting(): boolean; restored: boolean; storage: boolean };
  }
}
window.__adw = {
  hintIndex: () => booted.controller.hintIndex,
  isPrinting: () => booted.terminal.isPrinting(),
  restored: booted.restored,
  storage: booted.store !== null,
};
