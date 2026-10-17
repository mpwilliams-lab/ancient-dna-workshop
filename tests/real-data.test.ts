// @vitest-environment node
// Checks the REAL synced data (src/data/workshop_data.json), not the fixture.
// Skipped in a plain `npm test`; run with `npm run check-data` after `npm run sync-data`.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { traitCaption } from '../src/content';
import { validateData } from '../src/data';
import { zoomFactor } from '../src/plotState';
import { ruleViolations } from './contentRules';

const REAL = fileURLToPath(new URL('../src/data/workshop_data.json', import.meta.url));

describe.runIf(process.env.REAL_DATA === '1')('real workshop_data.json', () => {
  it('exists (run npm run sync-data first)', () => {
    expect(existsSync(REAL)).toBe(true);
  });

  const raw = () => JSON.parse(readFileSync(REAL, 'utf8'));

  it('passes validateData', () => {
    expect(() => validateData(raw())).not.toThrow();
  });

  it('is under the 250 KB target', () => {
    expect(readFileSync(REAL).byteLength).toBeLessThan(250 * 1024);
  });

  it('no string anywhere in the JSON breaks a §6 rule', () => {
    const strings: string[] = [];
    JSON.stringify(raw(), (k, v) => {
      if (k) strings.push(k);
      if (typeof v === 'string') strings.push(v);
      return v;
    });
    expect(strings.filter((s) => ruleViolations(s).length > 0)).toEqual([]);
  });

  // Spec §6 rule 6 as amended in v2.1 (approved by Matthew): whole-percent match, rounded half-up as in Task 4.
  it('TYK2 caption whole-percent present-day number matches the plotted present-day value (same rule as tyk2_caption in Task 4)', () => {
    const d = validateData(raw());
    const t = d.traits.find((x) => x.gene === 'TYK2')!;
    const p = [...t.points].sort((a, b) => a.t - b.t)[0]!;
    const m = /About (\d+)% today/.exec(traitCaption(t));
    expect(m).not.toBeNull();
    expect(p.lo).toBeLessThanOrEqual(p.f);
    expect(p.f).toBeLessThanOrEqual(p.hi);
    expect(Math.round(Number((100 * p.f).toFixed(2)))).toBe(Number(m![1]));
  });
});

// ---------- v3 (Task 5): the zoom factor the caption strip and card E3 print ----------
describe.runIf(process.env.REAL_DATA === '1')('real workshop_data.json: v3 plot state', () => {
  it('zoomFactor is 5 (frames unchanged by the Today frame change, RF2)', () => {
    const d = validateData(JSON.parse(readFileSync(REAL, 'utf8')));
    expect(zoomFactor(d)).toBe(5);
  });
});
