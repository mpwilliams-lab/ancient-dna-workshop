// Build-time feature flags (spec v3 §10.3, CONTRACT §1). Every P2/P3 item sits behind one of these.
// Rules:
//   - Flags are constants of the build. No URL parameter, storage key or UI changes them.
//   - Every flag starts false. A P2/P3 task sets ITS OWN flag(s) to true only in its last commit, after its vitest and
//     Playwright tests pass. The release task (31) sets unfinished ones back to false at the Wed 21 Oct 12:00 cutoff.
//   - A function whose output depends on a flag takes `features: Features = FEATURES` as its LAST optional parameter,
//     so each flag's false path has a vitest that passes withFeatures({ <flag>: false }).
//   - e2e specs import FEATURES and assert only the shipped set.
// This module imports nothing from the app, so any module may import it without a cycle.

export const FEATURE_FLAGS = [
  'back', 'consumerBars', 'finaleAnimation',
  'map.A1', 'map.D1', 'map.E1', 'map.G1', 'map.H2', 'map.I2', 'map.J3', 'map.K2', 'map.L3',
  'images.B1', 'images.C1', 'images.E2', 'images.F1', 'images.G2', 'images.H1', 'images.I1', 'images.J1',
  'yorkTraveller', 'romanInset', 'cartoons',
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type Features = Readonly<Record<FeatureFlag, boolean>>;

function allFlags(value: boolean): Features {
  const out = {} as Record<FeatureFlag, boolean>;
  for (const f of FEATURE_FLAGS) out[f] = value;
  return Object.freeze(out);
}

/** Every flag false (tests of the fallbacks). */
export const ALL_OFF: Features = allFlags(false);
/** Every flag true (tests of the upgraded forms). */
export const ALL_ON: Features = allFlags(true);

/**
 * The shipped flag set. Written out flag by flag so each task's last commit is a one-line diff (false -> true).
 * Every flag starts false (spec §10.3).
 */
export const FEATURES: Features = Object.freeze({
  back: false,
  consumerBars: false,
  finaleAnimation: false,
  'map.A1': false,
  'map.D1': false,
  'map.E1': false,
  'map.G1': false,
  'map.H2': false,
  'map.I2': false,
  'map.J3': false,
  'map.K2': false,
  'map.L3': false,
  'images.B1': false,
  'images.C1': false,
  'images.E2': false,
  'images.F1': false,
  'images.G2': false,
  'images.H1': false,
  'images.I1': false,
  'images.J1': false,
  yorkTraveller: false,
  romanInset: false,
  cartoons: false,
});

/** A copy of `base` (default FEATURES) with some flags overridden. Unknown keys throw, so a typo never passes silently. */
export function withFeatures(over: Partial<Record<FeatureFlag, boolean>>, base: Features = FEATURES): Features {
  const out = { ...base } as Record<FeatureFlag, boolean>;
  for (const [k, v] of Object.entries(over)) {
    if (!(FEATURE_FLAGS as readonly string[]).includes(k)) throw new Error(`withFeatures: unknown flag ${k}`);
    if (typeof v !== 'boolean') throw new Error(`withFeatures: ${k} must be true or false`);
    out[k as FeatureFlag] = v;
  }
  return Object.freeze(out);
}
