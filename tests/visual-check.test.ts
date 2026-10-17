// @vitest-environment node
// scripts/visual-check.mjs, the instructor's tool (spec §7.2, CONTRACT §6). Every run here is on a temp copy of the manifest
// (--manifest), so no test can ever write assets/manifest.json: the last test checks that the real file is exactly as it was.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseManifest } from '../src/assetManifest';
import * as vc from '../scripts/visual-check.mjs';
import { uncheckedManifest } from './helpers/assetEnv';

const ROOT = resolve(__dirname, '..');
const SCRIPT = resolve(ROOT, 'scripts/visual-check.mjs');
const REAL_MANIFEST = resolve(ROOT, 'assets/manifest.json');
const REAL_BEFORE = readFileSync(REAL_MANIFEST, 'utf8');
const WHEN = new Date(2026, 9, 19, 15, 0, 0);

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** <tmp>/assets/manifest.json (nothing checked) with <tmp>/src/assets/img and /svg: what --manifest <that file> works on. */
function workdir() {
  const dir = mkdtempSync(join(tmpdir(), 'visual-check-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'src/assets/img'), { recursive: true });
  mkdirSync(join(dir, 'src/assets/svg'), { recursive: true });
  const manifest = join(dir, 'assets/manifest.json');
  writeFileSync(manifest, `${JSON.stringify(uncheckedManifest(), null, 2)}\n`);
  const read = () => JSON.parse(readFileSync(manifest, 'utf8')) as ReturnType<typeof uncheckedManifest>;
  return { dir, manifest, img: join(dir, 'src/assets/img'), svg: join(dir, 'src/assets/svg'), read, bytes: () => readFileSync(manifest, 'utf8') };
}

/** A fake terminal: answers are typed in order; out, err and asked record everything the tool says and asks. */
function terminal(answers: string[], tty = true) {
  const t = { out: [] as string[], err: [] as string[], asked: [] as string[] };
  const io: vc.Io = {
    isTTY: () => tty,
    asker: async () => ({ ask: async (q: string) => { t.asked.push(q); return answers.shift() ?? ''; }, close: () => {} }),
    log: (l) => t.out.push(l),
    error: (l) => t.err.push(l),
    now: () => WHEN,
  };
  return { io, ...t };
}

describe('the interactive guard', () => {
  it('refuses to run without a terminal (as npm run visual-check does under an agent), and leaves the manifest as it was', () => {
    const w = workdir();
    const before = w.bytes();
    const r = spawnSync(process.execPath, [SCRIPT, '--manifest', w.manifest, 'stonehenge'], { encoding: 'utf8', input: 'yes\nyes\n' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('run this yourself in a terminal');
    expect(w.bytes()).toBe(before);
  });
  it('the same refusal from main() when the terminal is not interactive, with or without ids; nothing is asked or written', async () => {
    const w = workdir();
    const before = w.bytes();
    for (const argv of [['--manifest', w.manifest, 'stonehenge'], ['--manifest', w.manifest]]) {
      const t = terminal(['yes'], false);
      expect(await vc.main(argv, t.io)).toBe(1);
      expect(t.err.join('\n')).toContain('run this yourself in a terminal');
      expect(t.asked).toEqual([]);
    }
    expect(w.bytes()).toBe(before);
  });
  it('asks for ids when it has none, and refuses a bad option or a --manifest with no file', async () => {
    const w = workdir();
    const noIds = terminal([]);
    expect(await vc.main(['--manifest', w.manifest], noIds.io)).toBe(1);
    expect(noIds.err.join('\n')).toContain('name the image or map ids');
    const bad = terminal([]);
    expect(await vc.main(['--bogus', 'stonehenge'], bad.io)).toBe(1);
    expect(bad.err.join('\n')).toContain('unknown option --bogus');
    const noFile = terminal([]);
    expect(await vc.main(['stonehenge', '--manifest'], noFile.io)).toBe(1);
    expect(noFile.err.join('\n')).toContain('--manifest needs a file name');
  });
});

describe('recording a check', () => {
  it('a typed yes (any case, spaces around it) writes { by: "instructor", at } for that image or map, and anything else leaves it alone', async () => {
    const w = workdir();
    const t = terminal(['yes', 'y', ' YES ', '', 'yes']);
    expect(await vc.main(['--manifest', w.manifest, 'stonehenge', 'avebury', 'D1', 'castlerigg', 'thornborough-plan'], t.io)).toBe(0);
    const at = vc.localIso(WHEN);
    const m = w.read();
    const checked = m.images.filter((e) => e.visual_check !== null).map((e) => [e.id, e.visual_check]);
    expect(checked).toEqual([['stonehenge', { by: 'instructor', at }], ['thornborough-plan', { by: 'instructor', at }]]);
    expect(m.maps.D1.visual_check).toEqual({ by: 'instructor', at });
    expect(Object.values(m.maps).filter((x) => x.visual_check !== null)).toHaveLength(1);
    expect(t.asked.map((q) => q.replace(/^Type yes to pass /, '').replace(/: $/, ''))).toEqual([
      'image stonehenge (assets/staged/stonehenge.jpg)', 'image avebury (assets/staged/avebury.jpg)', 'map D1',
      'image castlerigg (assets/staged/castlerigg.jpg)', 'image thornborough-plan (src/assets/svg/thornborough-plan.svg)',
    ]);
    expect(t.out.join('\n')).toContain(`stonehenge: checked at ${at}`);
    expect(t.out.join('\n')).toContain('avebury: unchanged');
    for (const line of vc.CHECKLIST) expect(t.out).toContain(`  - ${line}`);
    expect(w.bytes()).toBe(`${JSON.stringify(m, null, 2)}\n`);   // still the format the scripts write
    expect(() => parseManifest(m)).not.toThrow();                // and one the app accepts
  });
  it('the time stamp is ISO-8601 with the UTC offset, in every kind of zone, and the app accepts it', () => {
    class Zoned extends Date {
      constructor(private readonly off: number) {
        super(2026, 9, 19, 15, 0, 0);
      }
      override getTimezoneOffset(): number {
        return this.off;
      }
    }
    const want: [number, string][] = [[420, '-07:00'], [0, '+00:00'], [-330, '+05:30'], [-825, '+13:45'], [150, '-02:30'], [-840, '+14:00']];
    for (const [off, suffix] of want) {
      const at = vc.localIso(new Zoned(off));
      expect(at, `offset ${off}`).toBe(`2026-10-19T15:00:00${suffix}`);
      const m = uncheckedManifest();
      m.images[0]!.visual_check = { by: 'instructor', at };
      expect(() => parseManifest(m), at).not.toThrow();
    }
  });
  it('an id that is neither an image nor a map is refused with a message and never asked about, including names an object inherits', async () => {
    const w = workdir();
    const before = w.bytes();
    const t = terminal(['yes', 'yes', 'yes', 'yes', 'yes']);
    await vc.main(['--manifest', w.manifest, 'nonsense', 'constructor', '__proto__', 'toString', 'hasOwnProperty'], t.io);
    expect(t.asked).toEqual([]);
    expect(t.err).toHaveLength(5);
    expect(t.err[1]).toBe('visual-check: constructor is not an image or map id in assets/manifest.json');
    expect(w.bytes()).toBe(before);
    expect(Object.prototype.hasOwnProperty.call(Object, 'visual_check')).toBe(false);
  });
  it('applyCheck knows images, maps and nothing else (own keys only), and writes nothing for the rest', () => {
    const m = uncheckedManifest();
    const before = JSON.stringify(m);
    expect(vc.applyCheck(m, 'stonehenge', { reject: false, at: 'A' })).toBe('image');
    expect(vc.applyCheck(m, 'D1', { reject: false, at: 'B' })).toBe('map');
    expect(m.images[0]!.visual_check).toEqual({ by: 'instructor', at: 'A' });
    expect(m.maps.D1.visual_check).toEqual({ by: 'instructor', at: 'B' });
    expect(vc.applyCheck(m, 'stonehenge', { reject: true, at: 'C' })).toBe('image');
    expect(vc.applyCheck(m, 'D1', { reject: true, at: 'C' })).toBe('map');
    expect(JSON.stringify(m)).toBe(before);
    for (const id of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'nonsense', '']) {
      expect(vc.applyCheck(m, id, { reject: false, at: 'D' }), id).toBeNull();
    }
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe('--reject', () => {
  it('clears the check, deletes that photo\'s promoted file (never an own drawing\'s source file), and leaves what was answered "no" alone', async () => {
    const w = workdir();
    const m = uncheckedManifest();
    for (const e of m.images) if (['stonehenge', 'thornborough-plan', 'avebury'].includes(e.id)) e.visual_check = { by: 'instructor', at: '2026-10-19T15:00:00-07:00' };
    m.maps.D1.visual_check = { by: 'instructor', at: '2026-10-19T15:00:00-07:00' };
    writeFileSync(w.manifest, `${JSON.stringify(m, null, 2)}\n`);
    for (const id of ['stonehenge', 'avebury', 'castlerigg']) writeFileSync(join(w.img, `${id}.jpg`), `promoted ${id}`);
    writeFileSync(join(w.img, 'thornborough-plan.jpg'), 'a stale photo that an earlier fallback left under the drawing\'s id');
    writeFileSync(join(w.svg, 'thornborough-plan.svg'), '<svg/>');
    const t = terminal(['yes', 'yes', 'yes', 'no']);
    await vc.main(['--reject', '--manifest', w.manifest, 'stonehenge', 'thornborough-plan', 'D1', 'avebury'], t.io);
    const after = w.read();
    const stillChecked = after.images.filter((e) => e.visual_check !== null).map((e) => e.id);
    expect(stillChecked, 'only avebury, which was answered "no", is still checked').toEqual(['avebury']);
    expect(after.maps.D1.visual_check).toBeNull();
    expect(existsSync(join(w.img, 'stonehenge.jpg')), 'the rejected photo is no longer bundled').toBe(false);
    expect(existsSync(join(w.img, 'avebury.jpg')), 'a "no" keeps the photo').toBe(true);
    expect(existsSync(join(w.img, 'castlerigg.jpg')), 'a file that was not named is not touched').toBe(true);
    expect(existsSync(join(w.svg, 'thornborough-plan.svg')), 'an own drawing\'s source file is never deleted').toBe(true);
    expect(existsSync(join(w.img, 'thornborough-plan.jpg')), 'but a stale promoted photo under its id is').toBe(false);
    expect(t.out.join('\n')).toContain('stonehenge: deleted src/assets/img/stonehenge.jpg');
    expect(t.out.join('\n')).toContain('thornborough-plan: deleted src/assets/img/thornborough-plan.jpg');
    expect(t.out.join('\n')).not.toContain('thornborough-plan.svg');
    expect(t.out).toContain('Rejecting:');
  });
  it('with no promoted file there is nothing to delete and nothing is said about it', async () => {
    const w = workdir();
    const t = terminal(['yes']);
    await vc.main(['--reject', '--manifest', w.manifest, 'cow'], t.io);
    expect(t.out.join('\n')).toContain('cow: check cleared');
    expect(t.out.join('\n')).not.toContain('deleted');
  });
});

describe('parseArgs', () => {
  it('takes ids, --reject and --manifest in any order', () => {
    expect(vc.parseArgs(['a', '--reject', 'b', '--manifest', 'x.json'])).toEqual({ reject: true, manifest: 'x.json', ids: ['a', 'b'] });
    expect(vc.parseArgs([])).toEqual({ reject: false, manifest: null, ids: [] });
  });
});

describe('the real manifest', () => {
  it('is exactly as it was when this file loaded: nothing here can write it', () => {
    expect(readFileSync(REAL_MANIFEST, 'utf8')).toBe(REAL_BEFORE);
  });
});
