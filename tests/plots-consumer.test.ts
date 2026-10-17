// @vitest-environment jsdom
// Spec §3.3 consumer bars; CONTRACT §4.12. Fixture data, plus the real build's Iron Age values when REAL_DATA=1.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { execute, roundPercents } from '../src/commands';
import {
  CONSUMER_PLOT_NOTE, CONSUMER_PLOT_SUBTITLE, HOOK_NOTE, ME_HEADING, ME_RESULT, PERIOD_LABELS, consumerTitle,
} from '../src/content';
import { validateData } from '../src/data';
import { withFeatures } from '../src/features';
import { CONSUMER_VIEW, consumerRows, renderConsumer } from '../src/plots/consumer';
import { renderPlot } from '../src/plots/index';
import { INITIAL_PLOT, reducePlot } from '../src/plotState';
import { derive } from '../src/replay';
import { PERIOD_IDS, type PeriodId, type WorkshopData } from '../src/types';
import { ruleViolations } from './contentRules';
import { FIXTURE } from './fixtures/fixture';

const svg = (): SVGSVGElement => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(s);
  return s;
};
const text = (el: Element, sel: string): string => (el.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const PEOPLE: (PeriodId | 'me')[] = ['me', ...PERIOD_IDS];

describe('consumerRows', () => {
  it('matches the terminal: sorted by share, whole percents by largest remainder', () => {
    const shares = FIXTURE.consumer.IronAge!;
    const sorted = [...shares].sort((a, b) => b.share - a.share);
    expect(consumerRows(FIXTURE, 'IronAge')).toEqual(
      sorted.map((s, i) => ({ label: s.label, pct: roundPercents(sorted.map((x) => x.share))[i] })),
    );
  });
  it('"me" uses the made-up example customer', () => {
    expect(consumerRows(FIXTURE, 'me')).toEqual([{ label: 'British', pct: 92 }, { label: 'Scandinavian', pct: 8 }]);
    expect(ME_RESULT).toHaveLength(2);
  });
  it.each(PEOPLE)('%s: the rows are the percents the terminal prints, line by line', (person) => {
    // Read back from the terminal's own text, so the two can only agree by showing the same numbers.
    const r = execute({ name: 'ancestry_test', person }, FIXTURE, { todayShown: false, features: withFeatures({ consumerBars: false }) });
    const printed = r.lines
      .map((l) => /^ {2}(\w+) +\[[#.]{20}\] +(\d+)%$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ label: m[1], pct: Number(m[2]) }));
    expect(printed.length).toBeGreaterThan(0);
    expect(consumerRows(FIXTURE, person)).toEqual(printed);
  });
  it('rounds by largest remainder, as the terminal does, so the whole percents add up to 100 (the build\'s Iron Age shares give 72, 20, 8, 0, not 72, 20, 8, 1)', () => {
    const d: WorkshopData = structuredClone(FIXTURE);
    d.consumer.IronAge = [
      { label: 'French', share: 0.2022 }, { label: 'British', share: 0.717 }, { label: 'Italian', share: 0.0054 }, { label: 'Scandinavian', share: 0.0755 },
    ];
    expect(consumerRows(d, 'IronAge')).toEqual([
      { label: 'British', pct: 72 }, { label: 'French', pct: 20 }, { label: 'Scandinavian', pct: 8 }, { label: 'Italian', pct: 0 },
    ]);
    const s = svg();
    renderConsumer(s, d, 'IronAge');
    expect([...s.querySelectorAll('g.consumer-bar')].map((g) => g.querySelector('.consumer-pct')!.textContent)).toEqual(['72%', '20%', '8%', '0%']);
    expect(s.querySelector('g.consumer-bar[data-label="Italian"] .consumer-fill')).toBeNull();
  });
  it('a period with no result has no rows, and "me" never reads the data', () => {
    const d: WorkshopData = structuredClone(FIXTURE);
    delete d.consumer.Viking;
    expect(consumerRows(d, 'Viking')).toEqual([]);
    expect(consumerRows({ ...FIXTURE, consumer: {} }, 'me')).toHaveLength(ME_RESULT.length);
  });
});

describe('renderConsumer (spec §3.3)', () => {
  it.each(['IronAge', 'Today', 'FirstFarmers'] as PeriodId[])('%s: title, subtitle, one bar per label sorted by share, note', (p) => {
    const s = svg();
    renderConsumer(s, FIXTURE, p);
    const n = FIXTURE.periods.find((x) => x.id === p)!.n_pca;
    expect(s.getAttribute('viewBox')).toBe(`0 0 ${CONSUMER_VIEW.width} ${CONSUMER_VIEW.height}`);
    expect(s.getAttribute('data-view')).toBe('consumer');
    expect(s.getAttribute('data-person')).toBe(p);
    expect(text(s, '.consumer-title')).toBe(consumerTitle(PERIOD_LABELS[p], n));
    expect(s.getAttribute('aria-label')).toBe(consumerTitle(PERIOD_LABELS[p], n));
    expect(text(s, '.consumer-subtitle')).toBe(CONSUMER_PLOT_SUBTITLE);
    expect(text(s, '.consumer-note')).toBe(CONSUMER_PLOT_NOTE);
    const rows = consumerRows(FIXTURE, p);
    const bars = [...s.querySelectorAll('g.consumer-bar')];
    expect(bars.map((g) => g.getAttribute('data-label'))).toEqual(rows.map((r) => r.label));
    expect(bars.map((g) => g.querySelector('.consumer-pct')!.textContent)).toEqual(rows.map((r) => `${r.pct}%`));
    const widths = bars.map((g) => Number(g.querySelector('.consumer-fill')?.getAttribute('width') ?? 0));
    expect([...widths].sort((a, b) => b - a)).toEqual(widths);       // longest first
    expect(ruleViolations(s.textContent ?? '')).toEqual([]);
  });
  it('"me": the existing heading and hook note', () => {
    const s = svg();
    renderConsumer(s, FIXTURE, 'me');
    expect(text(s, '.consumer-title')).toBe(ME_HEADING);
    expect(s.getAttribute('aria-label')).toBe(ME_HEADING);
    expect(text(s, '.consumer-note')).toBe(HOOK_NOTE);
    expect([...s.querySelectorAll('g.consumer-bar')].map((g) => g.getAttribute('data-pct'))).toEqual(['92', '8']);
  });
  it.each(PEOPLE)('%s: every row has its label, a track, and a percent that matches its data-pct and the length of its bar', (person) => {
    const s = svg();
    renderConsumer(s, FIXTURE, person);
    for (const g of s.querySelectorAll('g.consumer-bar')) {
      const pct = Number(g.getAttribute('data-pct'));
      expect(g.querySelector('.consumer-label')?.textContent).toBe(g.getAttribute('data-label'));
      expect(g.querySelector('.consumer-pct')?.textContent).toBe(`${pct}%`);
      const track = Number(g.querySelector('.consumer-track')!.getAttribute('width'));
      const fill = Number(g.querySelector('.consumer-fill')?.getAttribute('width') ?? 0);
      expect(fill / track, `${g.getAttribute('data-label')} ${pct}%`).toBeCloseTo(pct / 100, 2);
    }
  });
  it('a zero share keeps its row and its label, with no filled bar', () => {
    const d: WorkshopData = structuredClone(FIXTURE);
    d.consumer.IronAge = [{ label: 'British', share: 0.995 }, { label: 'Italian', share: 0.004 }];
    const s = svg();
    renderConsumer(s, d, 'IronAge');
    const italian = s.querySelector('g.consumer-bar[data-label="Italian"]')!;
    expect(italian.querySelector('.consumer-pct')!.textContent).toBe('0%');
    expect(italian.querySelector('.consumer-track')).not.toBeNull();
    expect(italian.querySelector('.consumer-fill')).toBeNull();
  });
  it('one colour: every filled bar has the same fill, and no text takes a colour from it', () => {
    const s = svg();
    renderConsumer(s, FIXTURE, 'FirstFarmers');
    const fills = new Set([...s.querySelectorAll('.consumer-fill')].map((e) => e.getAttribute('fill')));
    expect(fills.size).toBe(1);
    const [bar] = fills;
    for (const t of s.querySelectorAll('text')) expect(t.getAttribute('fill'), t.outerHTML).not.toBe(bar);
  });
  it('everything stays inside the viewBox, text lines included', () => {
    for (const person of PEOPLE) {
      const s = svg();
      renderConsumer(s, FIXTURE, person);
      for (const el of s.querySelectorAll('rect')) {
        const x = Number(el.getAttribute('x'));
        const y = Number(el.getAttribute('y'));
        expect(x, el.outerHTML).toBeGreaterThanOrEqual(0);
        expect(x + Number(el.getAttribute('width')), el.outerHTML).toBeLessThanOrEqual(CONSUMER_VIEW.width);
        expect(y, el.outerHTML).toBeGreaterThanOrEqual(0);
        expect(y + Number(el.getAttribute('height')), el.outerHTML).toBeLessThanOrEqual(CONSUMER_VIEW.height);
      }
      for (const el of s.querySelectorAll('text')) {
        const size = Number(el.getAttribute('font-size'));
        const x = Number(el.getAttribute('x'));
        const spans = [...el.querySelectorAll('tspan')];
        const lines = spans.length > 0 ? spans.map((t) => t.textContent ?? '') : [el.textContent ?? ''];
        const last = Number(el.getAttribute('y')) + spans.reduce((sum, t) => sum + Number(t.getAttribute('dy') ?? 0), 0);
        expect(last + 0.3 * size, `${person}: the last line of ${el.outerHTML}`).toBeLessThanOrEqual(CONSUMER_VIEW.height);
        // A generous width for a bold sans-serif (0.6 em a character): the line must not run off the side it grows toward.
        const width = Math.max(...lines.map((l) => l.length)) * 0.6 * size;
        if (el.getAttribute('text-anchor') === 'end') expect(x - width, `${person}: ${el.outerHTML}`).toBeGreaterThanOrEqual(0);
        else expect(x + width, `${person}: ${el.outerHTML}`).toBeLessThanOrEqual(CONSUMER_VIEW.width);
      }
    }
  });
  it('drawing again replaces the first drawing: one title, one bar per label, nothing left over', () => {
    const s = svg();
    renderConsumer(s, FIXTURE, 'IronAge');
    renderConsumer(s, FIXTURE, 'Today');
    expect(s.querySelectorAll('.consumer-title')).toHaveLength(1);
    expect(s.getAttribute('data-person')).toBe('Today');
    expect(s.querySelectorAll('g.consumer-bar')).toHaveLength(consumerRows(FIXTURE, 'Today').length);
    expect(text(s, '.consumer-title')).toBe(consumerTitle(PERIOD_LABELS.Today, FIXTURE.periods.find((x) => x.id === 'Today')!.n_pca));
  });
  it('takes the bars\' markers off the svg: no frame, focus, callout or animation flag from an earlier view', () => {
    const s = svg();
    for (const a of ['data-frame', 'data-focus', 'data-callout', 'data-animating']) s.setAttribute(a, 'x');
    renderConsumer(s, FIXTURE, 'IronAge');
    for (const a of ['data-frame', 'data-focus', 'data-callout', 'data-animating']) expect(s.hasAttribute(a), a).toBe(false);
  });
  it('a result missing from the data draws the title and the note and no bars, and does not throw', () => {
    const d: WorkshopData = structuredClone(FIXTURE);
    delete d.consumer.Viking;
    const s = svg();
    expect(() => renderConsumer(s, d, 'Viking')).not.toThrow();
    expect(s.querySelectorAll('g.consumer-bar')).toHaveLength(0);
    expect(text(s, '.consumer-title')).toBe(consumerTitle(PERIOD_LABELS.Viking, FIXTURE.periods.find((x) => x.id === 'Viking')!.n_pca));
  });
  it.each(PEOPLE)('%s: no on-screen text breaks a content rule', (person) => {
    const s = svg();
    renderConsumer(s, FIXTURE, person);
    expect(ruleViolations(s.textContent ?? '')).toEqual([]);
  });
});

describe('the consumer view in the router, the reducer and replay', () => {
  it('renderPlot draws it and drops the PCA caption strip', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const pca = reducePlot(INITIAL_PLOT, { kind: 'pca', period: 'IronAge' }, FIXTURE);
    renderPlot(host, FIXTURE, pca);
    const p = reducePlot(pca, { kind: 'consumer', person: 'IronAge' }, FIXTURE);
    renderPlot(host, FIXTURE, p);
    expect(host.getAttribute('data-view')).toBe('consumer');
    expect(host.querySelector('svg.plot-svg[data-view="consumer"]')).not.toBeNull();
    expect(host.querySelector('.pca-captions')).toBeNull();
    expect(host.querySelectorAll('g.consumer-bar').length).toBe(consumerRows(FIXTURE, 'IronAge').length);
  });
  it('replay rebuilds the consumer view from the command log', () => {
    const steps = [{ cmd: 'run_pca(period = "IronAge")' }, { cmd: 'ancestry_test(person = "IronAge")' }];
    const on = derive(FIXTURE, steps, 2, withFeatures({ consumerBars: true }));
    expect(on.plot).toMatchObject({ view: 'consumer', person: 'IronAge', layers: ['IronAge'] });
    const off = derive(FIXTURE, steps, 2, withFeatures({ consumerBars: false }));
    expect(off.plot.view).toBe('pca');
  });
});

const REAL = resolve(__dirname, '../src/data/workshop_data.json');
describe.runIf(process.env.REAL_DATA === '1' && existsSync(REAL))('real data (spec §2.1 step 8, §3.3)', () => {
  const real = (): WorkshopData => validateData(JSON.parse(readFileSync(REAL, 'utf8')));
  it('the Iron Age bars are British 72, French 20, Scandinavian 8, Italian 0', () => {
    expect(consumerRows(real(), 'IronAge')).toEqual([
      { label: 'British', pct: 72 }, { label: 'French', pct: 20 }, { label: 'Scandinavian', pct: 8 }, { label: 'Italian', pct: 0 },
    ]);
  });
  it('the Iron Age bars draw four rows, the Italian one empty, and no Britain today', () => {
    const s = svg();
    renderConsumer(s, real(), 'IronAge');
    expect([...s.querySelectorAll('g.consumer-bar')].map((g) => `${g.getAttribute('data-label')} ${g.getAttribute('data-pct')}`))
      .toEqual(['British 72', 'French 20', 'Scandinavian 8', 'Italian 0']);
    expect(s.querySelector('g.consumer-bar[data-label="Italian"] .consumer-fill')).toBeNull();
    expect(s.textContent).not.toContain(PERIOD_LABELS.Today);
  });
  it.each(PEOPLE)('%s: the bars show the percents the terminal prints', (person) => {
    const d = real();
    const r = execute({ name: 'ancestry_test', person }, d, { todayShown: false, features: withFeatures({ consumerBars: false }) });
    const printed = r.lines
      .map((l) => /^ {2}(\w+) +\[[#.]{20}\] +(\d+)%$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ label: m[1], pct: Number(m[2]) }));
    expect(consumerRows(d, person)).toEqual(printed);
  });
});
