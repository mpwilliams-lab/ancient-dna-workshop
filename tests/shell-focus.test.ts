// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { boot } from '../src/shell';
import { FIXTURE, MemStore, loadIndexHtml } from './helpers/shellEnv';

// A click anywhere on the page must put the prompt back in focus, otherwise typing and Esc do nothing after the
// user clicks the plot or the title bar. It must stay out of the way of the wrap screen, of anything that takes
// the click itself (buttons, links, form controls) and of a text selection (so output can be copied).

function bootFresh(): void {
  boot({ doc: document, href: 'file:///C:/x.html', getStorage: () => new MemStore() as unknown as Storage, replaceUrl: () => {}, data: FIXTURE });
}
const prompt = (): HTMLInputElement => document.querySelector<HTMLInputElement>('#terminal input')!;
const byId = (id: string): HTMLElement => document.getElementById(id)!;
/** What the browser sends at the end of a click: a mouseup on the element under the pointer. */
const mouseup = (el: Element): void => {
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
};
/** The same click, with the prompt first taken out of focus (what a real click on a non-focusable area does). */
const clickAway = (el: Element): void => {
  prompt().blur();
  mouseup(el);
};

beforeEach(() => {
  loadIndexHtml();
  bootFresh();
});
afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

describe('a click puts the prompt back in focus', () => {
  it('starts with the prompt focused (precondition for the cases below)', () => {
    expect(document.activeElement).toBe(prompt());
  });

  it.each([
    ['the plot pane', () => byId('plot')],
    ['the title bar', () => byId('bar')],
    ['the page title', () => byId('app-title')],
    ['the terminal output', () => document.querySelector('#terminal .term-out')!],
    ['the page itself', () => document.body],
  ])('after a click on %s', (_name, target) => {
    prompt().blur();
    expect(document.activeElement).not.toBe(prompt());
    mouseup(target());
    expect(document.activeElement).toBe(prompt());
  });

  it('also when the event does not bubble (it is caught on the way down)', () => {
    prompt().blur();
    byId('plot').dispatchEvent(new MouseEvent('mouseup'));
    expect(document.activeElement).toBe(prompt());
  });
});

describe('it stays out of the way', () => {
  it('while the wrap screen is open (the close button keeps focus)', () => {
    byId('wrap-open').click();
    expect(byId('wrap').hidden).toBe(false);
    expect(document.activeElement).toBe(byId('wrap-close'));
    for (const target of [byId('wrap'), document.querySelector('.wrap-card')!, byId('wrap-line'), byId('plot'), byId('bar'), document.querySelector('#terminal .term-out')!, document.body]) {
      mouseup(target);
      expect(document.activeElement, `after a click on ${target.id || target.className || target.tagName}`).toBe(byId('wrap-close'));
    }
  });

  it('but works again once the wrap screen has been closed, with the button and with Esc', () => {
    byId('wrap-open').click();
    byId('wrap-close').click();
    expect(byId('wrap').hidden).toBe(true);
    clickAway(byId('plot'));
    expect(document.activeElement).toBe(prompt());

    byId('wrap-open').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(byId('wrap').hidden).toBe(true);
    clickAway(byId('bar'));
    expect(document.activeElement).toBe(prompt());
  });

  it.each([
    ['a button', '<button id="x" type="button">go</button>'],
    ['something inside a button', '<button type="button"><span id="x">go</span></button>'],
    ['a link', '<a id="x" href="#top">link</a>'],
    ['something inside a link', '<a href="#top"><span id="x">link</span></a>'],
    ['a select', '<select id="x"><option>a</option></select>'],
    ['a text area', '<textarea id="x"></textarea>'],
    ['a text input', '<input id="x" type="text">'],
  ])('for %s (it takes the click itself)', (_name, html) => {
    byId('plot').insertAdjacentHTML('beforeend', html);
    clickAway(byId('x'));
    expect(document.activeElement).not.toBe(prompt());
    // Control: the same mouseup on a plain part of the plot does refocus, so the check above is not vacuous.
    mouseup(byId('plot'));
    expect(document.activeElement).toBe(prompt());
  });

  it('for the "Take this home" button in the title bar', () => {
    clickAway(byId('wrap-open'));
    expect(document.activeElement).not.toBe(prompt());
    mouseup(byId('bar'));
    expect(document.activeElement).toBe(prompt());
  });

  it('while text is selected, so the output can be copied', () => {
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(byId('app-title'));
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.toString()).not.toBe(''); // jsdom really reports the selection

    clickAway(byId('plot'));
    expect(document.activeElement).not.toBe(prompt());

    selection.removeAllRanges(); // control: with no selection the same click refocuses
    mouseup(byId('plot'));
    expect(document.activeElement).toBe(prompt());
  });
});
