// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mountTerminal,
  staggerDelay,
  STAGGER_BUDGET_MS,
  MAX_DOM_LINES,
  MAX_INPUT_CHARS,
  type TerminalView,
} from '../src/terminal';

interface Mounted {
  root: HTMLElement;
  view: TerminalView;
  input: HTMLInputElement;
  out: HTMLElement;
  hint: HTMLElement;
  onEnter: ReturnType<typeof vi.fn>;
  onEsc: ReturnType<typeof vi.fn>;
  onTab: ReturnType<typeof vi.fn>;
}

function mount(): Mounted {
  document.body.innerHTML = '<div id="t"></div>';
  const root = document.getElementById('t') as HTMLElement;
  const onEnter = vi.fn();
  const onEsc = vi.fn();
  const onTab = vi.fn((p: string) => `${p}_done`);
  const view = mountTerminal(root, { onEnter, onEsc, onTab });
  return {
    root,
    view,
    input: root.querySelector('.term-input') as HTMLInputElement,
    out: root.querySelector('.term-out') as HTMLElement,
    hint: root.querySelector('.term-hint') as HTMLElement,
    onEnter,
    onEsc,
    onTab,
  };
}

function key(input: HTMLInputElement, k: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  input.dispatchEvent(e);
  return e;
}

const texts = (out: HTMLElement): string[] => Array.from(out.children).map((c) => c.textContent ?? '');

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('staggerDelay', () => {
  it('pins the per-line pause', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(1)).toBe(0);
    expect(staggerDelay(2)).toBe(220);
    expect(staggerDelay(4)).toBe(220);
    expect(staggerDelay(14)).toBe(215);
    expect(staggerDelay(40)).toBe(71);
    expect(staggerDelay(200)).toBe(14);
  });

  it('keeps every log within 3 s (spec §4.2)', () => {
    expect(STAGGER_BUDGET_MS).toBeLessThanOrEqual(3000);
    for (let n = 1; n <= 500; n++) expect((n - 1) * staggerDelay(n)).toBeLessThanOrEqual(3000);
  });
});

describe('mountTerminal structure', () => {
  it('builds output, hint and a 200-char prompt', () => {
    const m = mount();
    expect(m.root.classList.contains('term')).toBe(true);
    expect(m.out.getAttribute('role')).toBe('log');
    expect(m.hint).not.toBeNull();
    expect(m.input.maxLength).toBe(MAX_INPUT_CHARS);
    expect(MAX_INPUT_CHARS).toBe(200);
    expect(m.input.getAttribute('autocomplete')).toBe('off');
    expect(m.input.spellcheck).toBe(false);
    expect(document.activeElement).toBe(m.input);
  });
});

describe('printing', () => {
  it('prints unstaggered lines synchronously', async () => {
    const m = mount();
    const done = m.view.printLines(['a', 'b', 'c']);
    expect(texts(m.out)).toEqual(['a', 'b', 'c']);
    expect(m.view.isPrinting()).toBe(false);
    await expect(done).resolves.toBeUndefined();
  });

  it('staggers lines: first at once, the rest every staggerDelay(n) ms', async () => {
    const m = mount();
    let resolved = false;
    const done = m.view.printLines(['l1', 'l2', 'l3', 'l4'], { stagger: true }).then(() => {
      resolved = true;
    });
    expect(texts(m.out)).toEqual(['l1']);
    expect(m.view.isPrinting()).toBe(true);
    vi.advanceTimersByTime(219);
    expect(texts(m.out)).toEqual(['l1']);
    vi.advanceTimersByTime(1);
    expect(texts(m.out)).toEqual(['l1', 'l2']);
    vi.advanceTimersByTime(440);
    expect(texts(m.out)).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(m.view.isPrinting()).toBe(false);
    await done;
    expect(resolved).toBe(true);
  });

  it('finishes a 40-line log within 3 s', async () => {
    const m = mount();
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const done = m.view.printLines(lines, { stagger: true });
    vi.advanceTimersByTime(2768);
    expect(m.out.childElementCount).toBe(39);
    vi.advanceTimersByTime(1);
    expect(m.out.childElementCount).toBe(40);
    expect(m.view.isPrinting()).toBe(false);
    await done;
  });

  it('flush() prints the rest at once, resolves, and later ticks add nothing', async () => {
    const m = mount();
    const done = m.view.printLines(['a', 'b', 'c', 'd'], { stagger: true });
    m.view.flush();
    expect(texts(m.out)).toEqual(['a', 'b', 'c', 'd']);
    expect(m.view.isPrinting()).toBe(false);
    await done;
    vi.advanceTimersByTime(10_000);
    expect(texts(m.out)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('flush() with nothing printing is a no-op', () => {
    const m = mount();
    expect(() => m.view.flush()).not.toThrow();
    expect(m.out.childElementCount).toBe(0);
  });

  it('a new print finishes the running one first, keeping order', async () => {
    const m = mount();
    const first = m.view.printLines(['a1', 'a2', 'a3'], { stagger: true });
    const second = m.view.printLines(['b1', 'b2'], { stagger: true });
    expect(texts(m.out)).toEqual(['a1', 'a2', 'a3', 'b1']);
    await first;
    vi.advanceTimersByTime(220);
    expect(texts(m.out)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
    await second;
  });

  it('echo, notice and clearScreen finish the running print first', () => {
    const m = mount();
    void m.view.printLines(['a1', 'a2'], { stagger: true });
    m.view.echoInput('next');
    expect(texts(m.out)).toEqual(['a1', 'a2', '> next']);
    void m.view.printLines(['c1', 'c2'], { stagger: true });
    m.view.notice('heads up');
    expect(texts(m.out)).toEqual(['a1', 'a2', '> next', 'c1', 'c2', 'heads up']);
    void m.view.printLines(['d1', 'd2'], { stagger: true });
    m.view.clearScreen();
    expect(m.out.childElementCount).toBe(0);
    expect(m.view.isPrinting()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(m.out.childElementCount).toBe(0);
  });

  it('keeps the prompt usable while a log prints', () => {
    const m = mount();
    void m.view.printLines(['a', 'b', 'c'], { stagger: true });
    expect(m.input.disabled).toBe(false);
    m.input.value = 'run_pca(';
    expect(m.input.value).toBe('run_pca(');
  });

  it('caps the DOM at MAX_DOM_LINES, dropping the oldest', () => {
    const m = mount();
    expect(MAX_DOM_LINES).toBe(400);
    m.view.printLines(Array.from({ length: 450 }, (_, i) => `line ${i}`));
    expect(m.out.childElementCount).toBe(400);
    expect(m.out.firstElementChild?.textContent).toBe('line 50');
    expect(m.out.lastElementChild?.textContent).toBe('line 449');
  });
});

describe('line rendering', () => {
  it('echoes input with the prompt symbol and kind classes', () => {
    const m = mount();
    m.view.echoInput('help()');
    m.view.printLines(['out']);
    m.view.notice('note');
    const [a, b, c] = Array.from(m.out.children);
    expect(a.textContent).toBe('> help()');
    expect(a.className).toBe('term-line term-line--input');
    expect(b.className).toBe('term-line term-line--output');
    expect(c.className).toBe('term-line term-line--notice');
  });

  it('never interprets typed or printed text as HTML', () => {
    const m = mount();
    m.view.echoInput('<img src=x onerror="alert(1)">');
    m.view.printLines(['<b>bold</b>']);
    m.view.setHint('<i>hint</i>');
    expect(m.root.querySelector('img')).toBeNull();
    expect(m.root.querySelector('b')).toBeNull();
    expect(m.root.querySelector('i')).toBeNull();
    expect(m.hint.textContent).toBe('<i>hint</i>');
  });

  it('setHint replaces the hint line; fillPrompt fills and caps at 200', () => {
    const m = mount();
    m.view.setHint('Next: load_genomes()');
    m.view.setHint('Next: run_pca(period = "Today")');
    expect(m.hint.textContent).toBe('Next: run_pca(period = "Today")');
    m.view.fillPrompt('load_genomes()');
    expect(m.input.value).toBe('load_genomes()');
    expect(document.activeElement).toBe(m.input);
    m.view.fillPrompt('x'.repeat(2000));
    expect(m.input.value.length).toBe(200);
  });
});

describe('keys', () => {
  it('Enter sends the line, clears the prompt and prevents default', () => {
    const m = mount();
    m.input.value = 'help()';
    const e = key(m.input, 'Enter');
    expect(e.defaultPrevented).toBe(true);
    expect(m.onEnter).toHaveBeenCalledWith('help()', { repeat: false });
    expect(m.input.value).toBe('');
  });

  it('Enter on an empty prompt still reaches the handler (controller ignores it)', () => {
    const m = mount();
    key(m.input, 'Enter');
    expect(m.onEnter).toHaveBeenCalledWith('', { repeat: false });
  });

  it('Enter during IME composition does nothing', () => {
    const m = mount();
    m.input.value = 'run';
    const e = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
    m.input.dispatchEvent(e);
    expect(m.onEnter).not.toHaveBeenCalled();
    expect(m.input.value).toBe('run');
  });

  it('Up/Down browse history and keep the unsent draft', () => {
    const m = mount();
    for (const v of ['a()', 'b()', 'b()']) {
      m.input.value = v;
      key(m.input, 'Enter');
    }
    m.input.value = 'draft';
    key(m.input, 'ArrowUp');
    expect(m.input.value).toBe('b()');
    key(m.input, 'ArrowUp');
    expect(m.input.value).toBe('a()');
    key(m.input, 'ArrowUp');
    expect(m.input.value).toBe('a()');
    key(m.input, 'ArrowDown');
    expect(m.input.value).toBe('b()');
    key(m.input, 'ArrowDown');
    expect(m.input.value).toBe('draft');
    key(m.input, 'ArrowDown');
    expect(m.input.value).toBe('draft');
  });

  it('blank lines are not stored in history', () => {
    const m = mount();
    m.input.value = '   ';
    key(m.input, 'Enter');
    key(m.input, 'ArrowUp');
    expect(m.input.value).toBe('');
  });

  it('setHistory seeds the history (used after a restore)', () => {
    const m = mount();
    m.view.setHistory?.(['load_genomes()', '', 'run_pca(period = "Today")']);
    key(m.input, 'ArrowUp');
    expect(m.input.value).toBe('run_pca(period = "Today")');
    key(m.input, 'ArrowUp');
    expect(m.input.value).toBe('load_genomes()');
  });

  it('Tab asks the handler and puts the result in the prompt', () => {
    const m = mount();
    m.input.value = 'run_p';
    const e = key(m.input, 'Tab');
    expect(e.defaultPrevented).toBe(true);
    expect(m.onTab).toHaveBeenCalledWith('run_p');
    expect(m.input.value).toBe('run_p_done');
  });

  it('Esc calls the handler and prevents default', () => {
    const m = mount();
    const e = key(m.input, 'Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(m.onEsc).toHaveBeenCalledTimes(1);
  });

  it('passes the keydown repeat flag to Enter and Esc (the card repeat guard reads it, spec §5.3)', () => {
    const m = mount();
    m.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true }));
    expect(m.onEnter).toHaveBeenLastCalledWith('', { repeat: true });
    m.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', repeat: true, bubbles: true, cancelable: true }));
    expect(m.onEsc).toHaveBeenLastCalledWith({ repeat: true });
    key(m.input, 'Escape');
    expect(m.onEsc).toHaveBeenLastCalledWith({ repeat: false });
  });

  it('a throwing handler is logged, never thrown into the page', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    document.body.innerHTML = '<div id="t"></div>';
    const root = document.getElementById('t') as HTMLElement;
    mountTerminal(root, {
      onEnter: () => {
        throw new Error('boom');
      },
      onEsc: () => {
        throw new Error('boom');
      },
      onTab: () => {
        throw new Error('boom');
      },
    });
    const input = root.querySelector('.term-input') as HTMLInputElement;
    input.value = 'x';
    expect(() => key(input, 'Tab')).not.toThrow();
    expect(input.value).toBe('x');
    expect(() => key(input, 'Escape')).not.toThrow();
    expect(() => key(input, 'Enter')).not.toThrow();
    expect(err).toHaveBeenCalledTimes(3);
  });

  it('clicking the terminal focuses the prompt', () => {
    const m = mount();
    m.input.blur();
    m.out.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.activeElement).toBe(m.input);
  });
});

describe('showLines (session v2 restore)', () => {
  it('replaces the log at once, without stagger, and writes input lines with the prompt in front', () => {
    const m = mount();
    void m.view.printLines(['old line']);
    m.view.showLines([
      { kind: 'input', text: 'load_genomes()' },
      { kind: 'output', text: 'Genomes loaded.' },
      { kind: 'notice', text: 'a notice' },
    ]);
    expect(texts(m.out)).toEqual(['> load_genomes()', 'Genomes loaded.', 'a notice']);
    expect([...m.out.children].map((c) => c.className)).toEqual([
      'term-line term-line--input', 'term-line term-line--output', 'term-line term-line--notice',
    ]);
    expect(m.view.isPrinting()).toBe(false);
  });

  it('finishes a running staggered log first, then replaces it', () => {
    const m = mount();
    void m.view.printLines(['a', 'b', 'c'], { stagger: true });
    expect(m.view.isPrinting()).toBe(true);
    m.view.showLines([{ kind: 'output', text: 'x' }]);
    expect(m.view.isPrinting()).toBe(false);
    expect(texts(m.out)).toEqual(['x']);
  });

  it('keeps at most MAX_DOM_LINES lines on screen', () => {
    const m = mount();
    m.view.showLines(Array.from({ length: MAX_DOM_LINES + 10 }, (_, k) => ({ kind: 'output' as const, text: `l${k}` })));
    expect(m.out.childElementCount).toBe(MAX_DOM_LINES);
    expect(texts(m.out)[MAX_DOM_LINES - 1]).toBe(`l${MAX_DOM_LINES + 9}`);
  });
});
