// Leaf module: no run-time imports. Holds the few on-screen values that BOTH content.ts and cards.ts read while they load.
// content.ts imports CARDS at run time (for allRenderableStrings), so cards.ts may import from content.ts with
// `import type` only (CONTRACT §4.1); these values therefore live here. content.ts re-exports every name below, so they
// are importable from content.ts and are scanned by allRenderableStrings() like any other content string.
import type { TraitMapLabelKey } from './types';

/** Open check 1 (spec §11) passed: Silva et al. 2026 is shown. false selects every §3.3 fallback (F1 bullets 1-2, G1 bullet 2, Roman log line). */
export const SILVA_2026_SHOWN: boolean = true;

/** Trailing part of a map card's source line (spec §6). Dropped in the text form, where no map is shown (CONTRACT decision 4). */
export const MAP_SOURCE_SUFFIX = 'Map outline: Made with Natural Earth.';

/** H2 side-list footnote (spec §3.4). */
export const IRELAND_FOOTNOTE = 'Ireland: small sample.';

/** Plain-English labels for trait_maps rows (spec §3.4, CONTRACT §4.1). The build-internal codes are never shown. */
export const TRAIT_MAP_LABELS: Readonly<Record<TraitMapLabelKey, string>> = {
  'country:Ireland': 'Ireland',
  'country:Norway': 'Norway',
  'country:UK': 'United Kingdom',
  'country:Sweden': 'Sweden',
  'country:Netherlands': 'Netherlands',
  'country:Finland': 'Finland',
  'country:France': 'France',
  'country:Germany': 'Germany',
  'country:Estonia': 'Estonia',
  'country:Hungary': 'Hungary',
  'country:Portugal': 'Portugal',
  'country:Spain': 'Spain',
  'country:Poland': 'Poland',
  'country:Russia': 'Russia',
  'country:Romania': 'Romania',
  'country:Macedonia': 'North Macedonia',
  'country:Belarus': 'Belarus',
  'country:Ukraine': 'Ukraine',
  'country:Italy': 'Italy',
  'country:Greece': 'Greece',
  '1kg:GBR': 'Britain',
  '1kg:FIN': 'Finland',
  '1kg:TSI': 'Tuscany',
  '1kg:IBS': 'Spain',
  '1kg:PJL': 'Pakistan',
  '1kg:BEB': 'Bangladesh',
  '1kg:CHB': 'China',
  '1kg:JPT': 'Japan',
  '1kg:YRI': 'Nigeria',
  '1kg:LWK': 'Kenya',
  'gnomad:nfe': 'Europe (large sample)',
  'gnomad:mid': 'Middle East',
  'gnomad:fin': 'Finland',
};
