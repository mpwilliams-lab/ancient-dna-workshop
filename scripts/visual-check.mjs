// npm run visual-check -- <image or map ids...> [--reject] [--manifest <file>]
// FOR THE INSTRUCTOR ONLY. Agents never run this script and never edit visual_check (spec §7.2, CONTRACT §6).
// Records that the instructor has viewed each item at projector size against the spec §7.2 list. Images: assets/staged/<id>.jpg
// or src/assets/svg/<id>.svg. Maps: drawn on their card. It writes visual_check { by: "instructor", at: <local ISO time> }
// into assets/manifest.json. --reject sets it back to null and deletes that image's promoted file src/assets/img/<id>.jpg, which
// the check no longer covers (an own drawing's source file in src/assets/svg is never deleted). It needs an interactive terminal
// and a typed "yes" for every item, so it cannot run unattended.
// --manifest <file> works on another manifest (the tests use a temp copy, so no test can ever write the real one); the folder of
// promoted files is then src/assets/img next to that file's assets/ folder.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { removePromoted } from './fetch-assets.mjs';

const DEFAULT_MANIFEST = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'assets/manifest.json');
export const CHECKLIST = [
  'the subject is correct',
  'no dates or banned words are visible (for example museum labels)',
  'no nudity',
  'at most one photo of human remains per card, shown as a museum display and not graphic',
  'no blood or injury',
  'it is legible at projector size',
];

/** The local time as ISO-8601 with its UTC offset, e.g. 2026-10-19T15:00:00-07:00. */
export function localIso(d = new Date()) {
  const pad = (n) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}

export function parseArgs(argv) {
  const a = { reject: false, manifest: null, ids: [] };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--reject') a.reject = true;
    else if (v === '--manifest') {
      a.manifest = argv[++i] ?? '';
      if (a.manifest === '') throw new Error('--manifest needs a file name');
    } else if (v.startsWith('--')) throw new Error(`unknown option ${v}`);
    else a.ids.push(v);
  }
  return a;
}

/**
 * Records (or with reject clears) one check in the manifest and returns what the id was: 'image', 'map', or null when it is
 * neither. A map id must be an own key of manifest.maps: "constructor" or "toString" is not a map.
 */
export function applyCheck(manifest, id, { reject, at }) {
  const value = reject ? null : { by: 'instructor', at };
  const img = manifest.images.find((e) => e.id === id);
  if (img) {
    img.visual_check = value;
    return 'image';
  }
  if (Object.hasOwn(manifest.maps, id)) {
    manifest.maps[id].visual_check = value;
    return 'map';
  }
  return null;
}

const realIo = {
  isTTY: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  async asker() {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return { ask: (q) => rl.question(q), close: () => rl.close() };
  },
  log: (line) => console.log(line),
  error: (line) => console.error(line),
  now: () => new Date(),
};

/** The command line. The tests pass a fake terminal and canned answers as io; the real one is this process's terminal. Returns the exit code. */
export async function main(argv, io = realIo) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    io.error(`visual-check: ${err.message}`);
    return 1;
  }
  if (!io.isTTY()) {
    io.error('visual-check: run this yourself in a terminal. It records your own check of each image or map.');
    return 1;
  }
  if (args.ids.length === 0) {
    io.error('visual-check: name the image or map ids, e.g. npm run visual-check -- stonehenge avebury D1');
    return 1;
  }
  const manifestPath = resolve(args.manifest ?? DEFAULT_MANIFEST);
  const imgDir = resolve(dirname(manifestPath), '../src/assets/img');
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const { ask, close } = await io.asker();
  try {
    io.log(args.reject ? 'Rejecting:' : 'Check each item against this list (spec §7.2):');
    if (!args.reject) for (const c of CHECKLIST) io.log(`  - ${c}`);
    for (const id of args.ids) {
      const img = m.images.find((e) => e.id === id);
      if (!img && !Object.hasOwn(m.maps, id)) {
        io.error(`visual-check: ${id} is not an image or map id in assets/manifest.json`);
        continue;
      }
      const what = img ? `image ${id} (${img.kind === 'own-svg' ? `src/assets/svg/${id}.svg` : `assets/staged/${id}.jpg`})` : `map ${id}`;
      const answer = await ask(`Type yes to ${args.reject ? 'reject' : 'pass'} ${what}: `);
      if (answer.trim().toLowerCase() !== 'yes') {
        io.log(`  ${id}: unchanged`);
        continue;
      }
      const at = localIso(io.now());
      applyCheck(m, id, { reject: args.reject, at });
      io.log(`  ${id}: ${args.reject ? 'check cleared' : `checked at ${at}`}`);
      if (args.reject && img && removePromoted(imgDir, id)) {
        io.log(`  ${id}: deleted src/assets/img/${id}.jpg (a rejected image must not stay bundled)`);
      }
    }
    writeFileSync(manifestPath, `${JSON.stringify(m, null, 2)}\n`);
  } finally {
    close();
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`visual-check: ${err?.message ?? err}`);
      process.exit(1);
    },
  );
}
