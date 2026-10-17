// Build-time feature flags (spec v3 §10.3, CONTRACT §1). Each flag task (16-30) adds its false-path test here.
import { describe, expect, it } from 'vitest';
import { BUNDLED_IMAGES } from '../src/assets';
import { CARDS } from '../src/cards';
import { renderCardBody } from '../src/cardView';
import { execute } from '../src/commands';
import { ALL_OFF, ALL_ON, FEATURE_FLAGS, FEATURES, withFeatures, type FeatureFlag } from '../src/features';
import { CONSUMER_BARS_LOG, HELP_LINES, helpLines } from '../src/content';
import { INITIAL_PLOT, reducePlot } from '../src/plotState';
import { plotIsAnimating, renderPlot } from '../src/plots/index';
import { ruleViolations } from './contentRules';
import { FIXTURE } from './fixtures/fixture';
import { checkedManifest } from './helpers/assetEnv';
import { cardCtx, flagSet, openOnCard } from './helpers/cardCtx';
import { installFakeAnimate } from './helpers/fakeAnimation';

// The flags switched on so far, in landing order (spec §10.3). Each P2/P3 task appends its own flag(s) in its last commit;
// the release task (31) removes any that are cut at the merge cutoff.
const SHIPPED: readonly FeatureFlag[] = ['back', 'consumerBars'];

const BACK_LINE = '      Back button: step back one screen.';
const BARS_LINE = '      a consumer-style test: "me" or any period (bars)';
const PLAIN_ANCESTRY_LINE = '      a consumer-style test: "me" or any period';

describe('the 23 flags (spec §10.3)', () => {
  it('are exactly the spec list, in order', () => {
    expect(FEATURE_FLAGS).toEqual([
      'back', 'consumerBars', 'finaleAnimation',
      'map.A1', 'map.D1', 'map.E1', 'map.G1', 'map.H2', 'map.I2', 'map.J3', 'map.K2', 'map.L3',
      'images.B1', 'images.C1', 'images.E2', 'images.F1', 'images.G2', 'images.H1', 'images.I1', 'images.J1',
      'yorkTraveller', 'romanInset', 'cartoons',
    ]);
    expect(FEATURE_FLAGS).toHaveLength(23);
  });
  it('FEATURES has every flag and nothing else; ALL_ON and ALL_OFF are what they say', () => {
    expect(Object.keys(FEATURES).sort()).toEqual([...FEATURE_FLAGS].sort());
    expect(Object.keys(ALL_ON).sort()).toEqual([...FEATURE_FLAGS].sort());
    expect(Object.keys(ALL_OFF).sort()).toEqual([...FEATURE_FLAGS].sort());
    for (const f of FEATURE_FLAGS) {
      expect(ALL_ON[f], f).toBe(true);
      expect(ALL_OFF[f], f).toBe(false);
    }
  });
  it('FEATURES is exactly the shipped set', () => {
    for (const f of FEATURE_FLAGS) expect(FEATURES[f], f).toBe(SHIPPED.includes(f));
  });
  it('the flag objects are frozen: nothing at run time can change them', () => {
    expect(Object.isFrozen(FEATURES)).toBe(true);
    expect(Object.isFrozen(ALL_ON)).toBe(true);
    expect(Object.isFrozen(ALL_OFF)).toBe(true);
  });
  it('withFeatures overrides only the named flags, on FEATURES by default or on a given base, and never mutates', () => {
    // Written so that it holds whichever flags the build ships: it flips `back` from whatever the shipped set has.
    const shipped = FEATURES.back;
    const flipped = withFeatures({ back: !shipped });
    expect(flipped.back).toBe(!shipped);
    expect({ ...flipped, back: shipped }).toEqual(FEATURES);
    expect(FEATURES.back).toBe(shipped);
    expect(withFeatures({})).toEqual(FEATURES);
    const on = withFeatures({ back: true }, ALL_OFF);
    expect(on.back).toBe(true);
    expect({ ...on, back: false }).toEqual(ALL_OFF);
    expect(ALL_OFF.back).toBe(false);
    const off = withFeatures({ 'map.A1': false }, ALL_ON);
    expect(off['map.A1']).toBe(false);
    expect(off.back).toBe(true);
    expect(ALL_ON['map.A1']).toBe(true);
    expect(Object.isFrozen(off)).toBe(true);
    expect(() => withFeatures({ bogus: true } as never)).toThrow(/unknown flag/);
  });
});

describe('help() per flag (spec v3 §3.5; RF5: a cut flag leaves no trace in help)', () => {
  it('HELP_LINES is helpLines(FEATURES)', () => {
    expect(HELP_LINES).toEqual(helpLines(FEATURES));
    expect(helpLines()).toEqual(helpLines(FEATURES));
  });
  it('back false path: no Back line', () => {
    const lines = helpLines(withFeatures({ back: false }, ALL_ON));
    expect(lines).not.toContain(BACK_LINE);
    expect(lines.join('\n')).not.toMatch(/Back button/);
  });
  it('back true: the Back line closes the keys section', () => {
    const lines = helpLines(withFeatures({ back: true }, ALL_OFF));
    expect(lines[lines.length - 1]).toBe(BACK_LINE);
    expect(lines[lines.length - 2]).toBe('      Esc fills in the hint.');
  });
  it('consumerBars false path: no " (bars)"', () => {
    const lines = helpLines(withFeatures({ consumerBars: false }, ALL_ON));
    expect(lines).toContain(PLAIN_ANCESTRY_LINE);
    expect(lines.join('\n')).not.toContain('(bars)');
  });
  it('consumerBars true: the ancestry_test description ends " (bars)"', () => {
    const lines = helpLines(withFeatures({ consumerBars: true }, ALL_OFF));
    expect(lines).toContain(BARS_LINE);
    expect(lines).not.toContain(PLAIN_ANCESTRY_LINE);
  });
  it('the other 21 flags do not change help()', () => {
    const others = FEATURE_FLAGS.filter((f) => f !== 'back' && f !== 'consumerBars');
    for (const f of others) expect(helpLines(withFeatures({ [f]: true }, ALL_OFF)), f).toEqual(helpLines(ALL_OFF));
  });
  it('every line of every variant is at most 60 characters and breaks no rule', () => {
    for (const set of [ALL_OFF, ALL_ON, withFeatures({ back: true }, ALL_OFF), withFeatures({ consumerBars: true }, ALL_OFF)]) {
      for (const line of helpLines(set)) {
        expect(line.length, line).toBeLessThanOrEqual(60);
        expect(ruleViolations(line), line).toEqual([]);
      }
    }
  });
});

describe('back (Task 17) false path', () => {
  it('the help text has no Back line without the flag, and has it with the flag', () => {
    expect(helpLines(withFeatures({ back: false })).join('\n')).not.toContain('Back button');
    expect(helpLines(withFeatures({ back: true }))).toContain('      Back button: step back one screen.');
  });
});

describe('consumerBars (Task 18) false path', () => {
  it('ancestry_test stays terminal-only and help has no " (bars)"', () => {
    const off = { todayShown: false, features: withFeatures({ consumerBars: false }) };
    for (const person of ['me', 'IronAge', 'Today'] as const) {
      const r = execute({ name: 'ancestry_test', person }, FIXTURE, off);
      expect(r.plot, person).toEqual({ kind: 'none' });
      expect(r.lines, person).not.toContain(CONSUMER_BARS_LOG);
    }
    expect(helpLines(withFeatures({ consumerBars: false })).join('\n')).not.toContain(' (bars)');
    expect(helpLines(withFeatures({ consumerBars: true })).join('\n')).toContain('      a consumer-style test: "me" or any period (bars)');
  });
  it('with the flag on, ancestry_test draws bars and no other command changes', () => {
    const on = { todayShown: false, features: withFeatures({ consumerBars: true }, ALL_OFF) };
    const off = { todayShown: false, features: ALL_OFF };
    const r = execute({ name: 'ancestry_test', person: 'IronAge' }, FIXTURE, on);
    expect(r.plot).toEqual({ kind: 'consumer', person: 'IronAge' });
    expect(r.lines.at(-1)).toBe(CONSUMER_BARS_LOG);
    for (const c of [{ name: 'load_genomes' }, { name: 'run_pca', period: 'IronAge' }, { name: 'run_admixture', K: 3 }, { name: 'allele_freq', gene: 'LCT' }] as const) {
      expect(execute(c, FIXTURE, on), c.name).toEqual(execute(c, FIXTURE, off));
    }
  });
});

describe('map.D1 / map.E1 / map.G1 false paths (Task 20, spec §10.3)', () => {
  const MAPS = [['D1', 'map.D1'], ['E1', 'map.E1'], ['G1', 'map.G1']] as const;
  for (const [id, flag] of MAPS) {
    it(`${flag} false: ${id} renders its P1 text form even with its map checked`, () => {
      const el = renderCardBody(document, CARDS[id], cardCtx(FIXTURE, flagSet(flag, false), checkedManifest()));
      expect(el.querySelector('.card-map')).toBeNull();
      expect(el.querySelector('svg.map-svg')).toBeNull();
      expect(el.querySelector('.card-source')?.textContent ?? '').not.toContain('Natural Earth');
      if (id === 'E1') expect(el.textContent).toContain('The earliest found so far were buried in Kent.');
      expect(openOnCard(id, FIXTURE, flagSet(flag, false), checkedManifest()).querySelector('.card-credits')).toBeNull();
    });
    it(`${flag} true with its map checked: ${id} draws the map, with its full source line and the Image credits button`, () => {
      const el = renderCardBody(document, CARDS[id], cardCtx(FIXTURE, flagSet(flag, true), checkedManifest()));
      expect(el.querySelector(`.card-map[data-map="${id}"] svg.map-svg`)).not.toBeNull();
      expect(el.querySelector('.card-source')?.textContent ?? '').toContain('Map outline: Made with Natural Earth.');
      expect(openOnCard(id, FIXTURE, flagSet(flag, true), checkedManifest()).querySelector('.card-credits')).not.toBeNull();
    });
  }
  it('each map has its own flag: with only map.D1 on, E1 and G1 stay in their text form', () => {
    const only = flagSet('map.D1', true, ALL_OFF);
    expect(renderCardBody(document, CARDS.D1, cardCtx(FIXTURE, only, checkedManifest())).querySelector('.card-map')).not.toBeNull();
    for (const id of ['E1', 'G1'] as const) {
      expect(renderCardBody(document, CARDS[id], cardCtx(FIXTURE, only, checkedManifest())).querySelector('.card-map'), id).toBeNull();
    }
  });
});

// Task 21. Both flag states are proved with in-memory manifests (checkedManifest, fakeUrls), never the committed assets/manifest.json
// or src/assets/img/, which change as the instructor checks and promotes images: this passes before and after the check.
describe('images.E2 / images.F1 / images.G2 (Task 21, spec §10.3)', () => {
  for (const [id, flag] of [['E2', 'images.E2'], ['F1', 'images.F1'], ['G2', 'images.G2']] as const) {
    const tiles = CARDS[id].tiles ?? [];
    it(`${flag} false: ${id} shows its captions as text and no <img>, even with every image checked and bundled`, () => {
      expect(tiles.length, 'a card with no tiles would pass these tests for nothing').toBeGreaterThanOrEqual(2);   // G2 keeps two if West Stow is dropped
      const el = renderCardBody(document, CARDS[id], cardCtx(FIXTURE, flagSet(flag, false), checkedManifest()));
      expect(el.querySelectorAll('img')).toHaveLength(0);
      for (const t of tiles) expect(el.textContent).toContain(t.caption);
      expect(openOnCard(id, FIXTURE, flagSet(flag, false), checkedManifest()).querySelector('.card-credits')).toBeNull();
    });
    it(`${flag} true: ${id} shows one image per tile when every image is checked and bundled`, () => {
      expect(tiles.length).toBeGreaterThanOrEqual(2);
      const el = renderCardBody(document, CARDS[id], cardCtx(FIXTURE, flagSet(flag, true, ALL_OFF), checkedManifest()));
      expect(el.querySelectorAll('img')).toHaveLength(tiles.length);
      expect(openOnCard(id, FIXTURE, flagSet(flag, true, ALL_OFF), checkedManifest()).querySelector('.card-credits')).not.toBeNull();
    });
    // Runs once Part B has promoted this card's files into src/assets/img/ (skipped until then, by design).
    it.runIf(tiles.every((t) => BUNDLED_IMAGES[t.image] !== undefined))(`${id}: the promoted files are inlined JPEGs`, () => {
      const el = renderCardBody(document, CARDS[id], cardCtx(FIXTURE, flagSet(flag, true, ALL_OFF), checkedManifest(), { imageUrls: BUNDLED_IMAGES }));
      const srcs = [...el.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '');
      expect(srcs).toHaveLength(tiles.length);
      for (const s of srcs) expect(s).toMatch(/^data:image\/jpeg;base64,/);
    });
  }
});

describe('finaleAnimation (Task 22, spec §10.3)', () => {
  const all = reducePlot(INITIAL_PLOT, { kind: 'pca', period: 'all' }, FIXTURE);
  /** run_pca(period = "all") drawn live (no animate option) under the given flag set, with Web Animations recorded. */
  function drawLive(features: ReturnType<typeof withFeatures>) {
    const fake = installFakeAnimate();
    const host = document.createElement('div');
    try {
      renderPlot(host, FIXTURE, all, { features });
      return {
        finale: fake.created.filter((a) => a.target.matches('g.layer.period, circle.finale-pulse')).length,
        animating: host.querySelector('svg.plot-svg')!.hasAttribute('data-animating'),
        captionHidden: host.querySelector<HTMLElement>('p.pca-caption[data-caption="FINALE_CAPTION"]')!.hidden,
        layers: host.querySelectorAll('g.layer.period').length,
        host,
      };
    } finally {
      fake.restore();
    }
  }

  it('false: run_pca(period = "all") is the static plot with FINALE_CAPTION at once', () => {
    const r = drawLive(withFeatures({ finaleAnimation: false }));
    expect(r.finale).toBe(0);
    expect(r.animating).toBe(false);
    expect(r.captionHidden).toBe(false);
    expect(r.layers).toBe(8);
    expect(plotIsAnimating(r.host)).toBe(false);
  });
  it('true: the same call plays the finale (eight fades and the pulse ring) and holds the caption back', () => {
    const r = drawLive(withFeatures({ finaleAnimation: true }));
    expect(r.finale).toBe(9);
    expect(r.animating).toBe(true);
    expect(r.captionHidden).toBe(true);
    expect(r.layers).toBe(8);
    expect(plotIsAnimating(r.host)).toBe(true);
  });
  it('the flag changes nothing but the animation: the false path and the true path draw the same layers and captions', () => {
    const off = drawLive(withFeatures({ finaleAnimation: false })).host;
    const on = drawLive(withFeatures({ finaleAnimation: true })).host;
    const shape = (h: HTMLElement): string[] => [...h.querySelectorAll('g.layer, .pca-captions > *')].map((e) => `${e.tagName}:${e.getAttribute('data-layer') ?? e.getAttribute('data-caption') ?? e.getAttribute('data-chip') ?? ''}`);
    expect(shape(on)).toEqual(shape(off));
  });
});
