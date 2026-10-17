// @vitest-environment jsdom
// Spec §4.4 / §2.3: during the finale a blank Enter, any new command, or Back jumps to the final frame.
import { describe, expect, it, vi } from 'vitest';
import { Controller, type ControllerDeps } from '../src/controller';
import type { TerminalView } from '../src/terminal';
import { FIXTURE } from './fixtures/fixture';

class QuietTerminal implements TerminalView {
  printLines(): Promise<void> { return Promise.resolve(); }
  flush(): void {}
  isPrinting(): boolean { return false; }
  echoInput(): void {}
  setHint(): void {}
  fillPrompt(): void {}
  clearScreen(): void {}
  notice(): void {}
  setHistory(): void {}
  showLines(): void {}
}

function make() {
  const state = { animating: false };
  const events: string[] = [];
  const finish = vi.fn(() => {
    events.push('finish');
    state.animating = false;
  });
  const deps: ControllerDeps = {
    data: FIXTURE,
    terminal: new QuietTerminal(),
    renderPlot: (_p, opts) => events.push(`render:${opts?.animate === false ? 'static' : 'live'}`),
    store: null,
    now: () => 100_000,
    plotAnimating: () => state.animating,
    finishPlotAnimation: finish,
  };
  return { c: new Controller(deps, null), state, finish, events };
}

describe('the finale and the keys', () => {
  it('a blank Enter during the finale jumps to the final frame and runs nothing', () => {
    const { c, state, finish } = make();
    state.animating = true;
    const before = c.hintIndex;
    c.submit('');
    expect(finish).toHaveBeenCalledTimes(1);
    expect(c.hintIndex).toBe(before);
    expect(c.session.steps).toHaveLength(0);
  });

  it('a blank Enter with nothing animating is ignored (v2.1)', () => {
    const { c, finish } = make();
    c.submit('');
    expect(finish).not.toHaveBeenCalled();
  });

  it('any new command, even help(), jumps to the final frame before it runs', () => {
    const { c, state, finish, events } = make();
    state.animating = true;
    c.submit('help()');
    expect(finish).toHaveBeenCalledTimes(1);
    state.animating = true;
    events.length = 0;
    c.submit('load_genomes()');
    expect(events[0]).toBe('finish');
  });

  it('Back during the finale jumps to the final frame, then draws the earlier screen without animation', () => {
    const { c, state, finish, events } = make();
    c.submit('ancestry_test(person = "me")');
    c.submit('load_genomes()');
    expect(c.canGoBack).toBe(true);
    state.animating = true;
    events.length = 0;
    c.back();
    expect(finish).toHaveBeenCalled();
    expect(events.indexOf('finish')).toBeLessThan(events.findIndex((e) => e.startsWith('render:')));
    expect(events.filter((e) => e.startsWith('render:'))).toEqual(['render:static']);
  });
});
