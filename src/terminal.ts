// DOM terminal view: output log, hint line, prompt. All text is set with textContent (never innerHTML).

export interface TerminalView {
  printLines(lines: string[], opts?: { stagger?: boolean }): Promise<void>; // stagger <= 3 s total
  flush(): void;                          // finish current printing immediately
  isPrinting(): boolean;
  echoInput(text: string): void;
  setHint(text: string): void;
  fillPrompt(text: string): void;
  clearScreen(): void;
  notice(text: string): void;
  setHistory?(lines: string[]): void;     // additive (Task 10): seeds up/down history after a restore
}

export interface TerminalHandlers {
  onEnter(line: string): void;
  onEsc(): void;
  onTab(partial: string): string;
}

/** Longest a staggered log may take, first line to last line (spec §4.2: at most 3 s). */
export const STAGGER_BUDGET_MS = 2800;
/** Upper bound on the pause between two log lines. */
export const MAX_LINE_DELAY_MS = 220;
/** Spec §4.2: input is capped at 200 characters. */
export const MAX_INPUT_CHARS = 200;
/** Oldest output lines are dropped from the DOM past this count. */
export const MAX_DOM_LINES = 400;
export const PROMPT_SYMBOL = '>';

/** Pause between lines for an n-line staggered log; (n - 1) * delay <= STAGGER_BUDGET_MS. */
export function staggerDelay(n: number): number {
  if (n <= 1) return 0;
  return Math.min(MAX_LINE_DELAY_MS, Math.floor(STAGGER_BUDGET_MS / (n - 1)));
}

interface PrintJob {
  lines: string[];
  next: number;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: () => void;
}

export function mountTerminal(root: HTMLElement, handlers: TerminalHandlers): TerminalView {
  const doc = root.ownerDocument;
  const el = (tag: string, cls: string): HTMLElement => {
    const e = doc.createElement(tag);
    e.className = cls;
    return e;
  };

  root.replaceChildren();
  root.classList.add('term');
  const out = el('div', 'term-out');
  out.setAttribute('role', 'log');
  out.setAttribute('aria-live', 'polite');
  const hint = el('div', 'term-hint');
  hint.setAttribute('aria-live', 'polite');
  const prompt = el('div', 'term-prompt');
  const ps = el('span', 'term-ps');
  ps.textContent = PROMPT_SYMBOL;
  const input = doc.createElement('input');
  input.className = 'term-input';
  input.type = 'text';
  input.maxLength = MAX_INPUT_CHARS;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('aria-label', 'Command');
  prompt.append(ps, input);
  root.append(out, hint, prompt);

  let history: string[] = [];
  let cursor = 0;
  let draft = '';
  let job: PrintJob | null = null;

  const append = (text: string, kind: 'input' | 'output' | 'notice'): void => {
    const line = el('div', `term-line term-line--${kind}`);
    line.textContent = text;
    out.append(line);
    while (out.childElementCount > MAX_DOM_LINES) out.firstElementChild?.remove();
    out.scrollTop = out.scrollHeight;
  };

  const finish = (): void => {
    const j = job;
    if (!j) return;
    job = null;
    if (j.timer !== null) clearTimeout(j.timer);
    for (; j.next < j.lines.length; j.next++) append(j.lines[j.next], 'output');
    j.resolve();
  };

  const setInput = (v: string): void => {
    input.value = v.slice(0, MAX_INPUT_CHARS);
    const end = input.value.length;
    try {
      input.setSelectionRange(end, end);
    } catch {
      /* some input types do not support selection; ignore */
    }
  };

  const safely = (fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      console.error('terminal handler failed', err);
    }
  };

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.isComposing) return;
    switch (e.key) {
      case 'Enter': {
        e.preventDefault();
        const v = input.value;
        input.value = '';
        if (v.trim() !== '' && history[history.length - 1] !== v) history.push(v);
        cursor = history.length;
        draft = '';
        safely(() => handlers.onEnter(v));
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        if (cursor === history.length) draft = input.value;
        if (cursor > 0) {
          cursor--;
          setInput(history[cursor]);
        }
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        if (cursor < history.length) {
          cursor++;
          setInput(cursor === history.length ? draft : history[cursor]);
        }
        break;
      }
      case 'Tab': {
        e.preventDefault();
        safely(() => setInput(String(handlers.onTab(input.value) ?? input.value)));
        break;
      }
      case 'Escape': {
        e.preventDefault();
        safely(() => handlers.onEsc());
        break;
      }
    }
  });

  root.addEventListener('click', () => {
    if (!doc.getSelection()?.toString()) input.focus();
  });
  input.focus();

  return {
    printLines(lines: string[], opts?: { stagger?: boolean }): Promise<void> {
      finish();
      const safe = lines.map((l) => String(l));
      if (!opts?.stagger || safe.length <= 1) {
        for (const l of safe) append(l, 'output');
        return Promise.resolve();
      }
      const delay = staggerDelay(safe.length);
      return new Promise<void>((resolve) => {
        const j: PrintJob = { lines: safe, next: 0, timer: null, resolve };
        job = j;
        const step = (): void => {
          if (job !== j) return;
          append(j.lines[j.next], 'output');
          j.next++;
          if (j.next >= j.lines.length) {
            job = null;
            resolve();
          } else {
            j.timer = setTimeout(step, delay);
          }
        };
        step();
      });
    },
    flush(): void {
      finish();
    },
    isPrinting(): boolean {
      return job !== null;
    },
    echoInput(text: string): void {
      finish();
      append(`${PROMPT_SYMBOL} ${text}`, 'input');
    },
    setHint(text: string): void {
      hint.textContent = text;
    },
    fillPrompt(text: string): void {
      setInput(text);
      input.focus();
    },
    clearScreen(): void {
      finish();
      out.replaceChildren();
    },
    notice(text: string): void {
      finish();
      append(text, 'notice');
    },
    setHistory(lines: string[]): void {
      history = lines.filter((l) => typeof l === 'string' && l.trim() !== '').slice(-200);
      cursor = history.length;
      draft = '';
    },
  };
}
