// Shared Controller test rig (Tasks 6, 12, 17): a fake terminal and a fake card host that record every call into one
// event log, an in-memory session store, and a clock for the card repeat guard (by default every read is 1 s later,
// so the guard never blocks unless a test passes its own clock).
import { FIXTURE } from '../fixtures/fixture';
import type { CardId, WorkshopData } from '../../src/types';
import { Controller, type CardHost, type RenderOpts, type Screen } from '../../src/controller';
import type { TerminalView } from '../../src/terminal';
import type { PlotState } from '../../src/plotState';
import type { SessionStorageLike, SessionV2 } from '../../src/session';
import type { Features } from '../../src/features';
import { formatCommand } from '../../src/parser';
import { SCRIPT } from '../../src/hints';

export const data: WorkshopData = FIXTURE;

export interface ShownLine { kind: 'input' | 'output' | 'notice'; text: string }

/** With holdPrints, a staggered print stays "printing" until flush() (which resolves its promise, like the real log ending). */
export class FakeTerminal implements TerminalView {
  hint = '';
  prompt = '';
  history: string[] = [];
  shownLines: ShownLine[] = [];
  holdPrints = false;
  private printing: { lines: string[]; resolve: () => void } | null = null;
  constructor(readonly events: string[] = []) {}
  printLines(lines: string[], opts?: { stagger?: boolean }): Promise<void> {
    if (this.printing) this.flush();
    if (opts?.stagger && this.holdPrints && lines.length > 0) {
      return new Promise<void>((resolve) => {
        this.printing = { lines, resolve };
      });
    }
    for (const l of lines) this.events.push(`out:${l}`);
    return Promise.resolve();
  }
  flush(): void {
    const p = this.printing;
    if (!p) return;
    this.printing = null;
    for (const l of p.lines) this.events.push(`out:${l}`);
    p.resolve();
  }
  isPrinting(): boolean {
    return this.printing !== null;
  }
  echoInput(text: string): void {
    this.events.push(`echo:${text}`);
  }
  setHint(text: string): void {
    this.hint = text;
  }
  fillPrompt(text: string): void {
    this.prompt = text;
  }
  clearScreen(): void {
    this.events.push('clear');
  }
  notice(text: string): void {
    this.events.push(`notice:${text}`);
  }
  setHistory(lines: string[]): void {
    this.history = [...lines];
  }
  showLines(lines: readonly ShownLine[]): void {
    this.events.push('showLines');
    this.shownLines = lines.map((l) => ({ kind: l.kind, text: l.text }));
  }
  get output(): string[] {
    return this.events.filter((e) => e.startsWith('out:')).map((e) => e.slice(4));
  }
}

export interface CardOpenCall { id: CardId; index: number; count: number; placement: 'after' | 'before' }

export class FakeCards implements CardHost {
  current: CardId | null = null;
  opens: CardOpenCall[] = [];
  constructor(readonly events: string[] = []) {}
  open(id: CardId, index: number, count: number, placement: 'after' | 'before'): void {
    this.current = id;
    this.opens.push({ id, index, count, placement });
    this.events.push(`card:open:${id}`);
  }
  close(): void {
    this.current = null;
    this.events.push('card:close');
  }
}

export type MemStore = SessionStorageLike & { map: Map<string, string> };

export function memStore(): MemStore {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

export const blockedStore: SessionStorageLike = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('quota', 'QuotaExceededError');
  },
  removeItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
};

export interface RigOptions {
  restored?: SessionV2 | null;
  store?: SessionStorageLike | null;
  now?: () => number;
  features?: Features;
  /** false: no card host at all (card state is still tracked headlessly). */
  cards?: boolean;
  plotAnimating?: () => boolean;
  finishPlotAnimation?: () => void;
  onScreen?: (s: Screen, canGoBack: boolean) => void;
}

export interface Rig {
  c: Controller;
  term: FakeTerminal;
  cards: FakeCards;
  events: string[];
  renders: PlotState[];
  renderOpts: (RenderOpts | undefined)[];
  store: SessionStorageLike | null;
}

export function rig(o: RigOptions = {}): Rig {
  const events: string[] = [];
  const renders: PlotState[] = [];
  const renderOpts: (RenderOpts | undefined)[] = [];
  const term = new FakeTerminal(events);
  const cards = new FakeCards(events);
  const store = o.store === undefined ? memStore() : o.store;
  let tick = 0;
  const c = new Controller(
    {
      data,
      terminal: term,
      renderPlot: (p, opts) => {
        renders.push(p);
        renderOpts.push(opts);
        events.push(`render:${p.view}`);
      },
      store,
      cards: o.cards === false ? undefined : cards,
      features: o.features,
      now: o.now ?? (() => (tick += 1000)),
      plotAnimating: o.plotAnimating,
      finishPlotAnimation: o.finishPlotAnimation,
      onScreen: o.onScreen,
    },
    o.restored ?? null,
  );
  return { c, term, cards, events, renders, renderOpts, store };
}

export const STEP = (k: number): string => formatCommand(SCRIPT[k]!);

/** Clicks Continue until no card is open (never throttled). */
export function closeCards(c: Controller): void {
  for (let i = 0; i < 10 && c.cardOpen !== null; i += 1) c.continueCard();
}

/** Runs guided steps [from, to) with an unheld terminal, closing each step's cards. */
export function runSteps(r: Rig, from: number, to: number): void {
  for (let k = from; k < to; k += 1) {
    r.c.submit(STEP(k));
    closeCards(r.c);
    if (r.c.hintIndex !== k + 1) throw new Error(`runSteps: step ${k} (${STEP(k)}) did not advance the hint pointer`);
  }
}

export const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

/** Lets a held staggered log finish on its own, then runs its promise callbacks. */
export async function settle(r: Rig): Promise<void> {
  if (r.term.isPrinting()) r.term.flush();
  await flushMicrotasks();
}
