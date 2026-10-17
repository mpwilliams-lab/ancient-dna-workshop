// Build-time feature flags (spec v3 §10.3, CONTRACT §1). Each flag task (16-30) adds its false-path test here.
import { describe, expect, it } from 'vitest';
import { ALL_OFF, ALL_ON, FEATURE_FLAGS, FEATURES, withFeatures, type FeatureFlag } from '../src/features';
import { HELP_LINES, helpLines } from '../src/content';
import { ruleViolations } from './contentRules';

// The flags switched on so far, in landing order (spec §10.3). Each P2/P3 task appends its own flag(s) in its last commit;
// the release task (31) removes any that are cut at the merge cutoff.
const SHIPPED: readonly FeatureFlag[] = ['back'];

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
