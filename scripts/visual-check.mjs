// npm run visual-check -- <image or map ids...> [--reject]
// FOR THE INSTRUCTOR ONLY. Agents never run this script and never edit visual_check (spec §7.2, CONTRACT §6).
// Records that the instructor has viewed each item at projector size against the spec §7.2 list. Images: assets/staged/<id>.jpg
// or src/assets/svg/<id>.svg. Maps: drawn on their card. It writes visual_check { by: "instructor", at: <local ISO time> }
// into assets/manifest.json. --reject sets it back to null. It needs an interactive terminal and a typed "yes" for every
// item, so it cannot run unattended.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const MANIFEST = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'assets/manifest.json');
const CHECKLIST = [
  'the subject is correct',
  'no dates or banned words are visible (for example museum labels)',
  'no nudity',
  'at most one photo of human remains per card, shown as a museum display and not graphic',
  'no blood or injury',
  'it is legible at projector size',
];

function localIso(d = new Date()) {
  const pad = (n) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}

async function main(argv) {
  const reject = argv.includes('--reject');
  const ids = argv.filter((a) => !a.startsWith('--'));
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('visual-check: run this yourself in a terminal. It records your own check of each image or map.');
    process.exit(1);
  }
  if (ids.length === 0) {
    console.error('visual-check: name the image or map ids, e.g. npm run visual-check -- stonehenge avebury D1');
    process.exit(1);
  }
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(reject ? 'Rejecting:' : 'Check each item against this list (spec §7.2):');
  if (!reject) for (const c of CHECKLIST) console.log(`  - ${c}`);
  for (const id of ids) {
    const img = m.images.find((e) => e.id === id);
    const map = m.maps[id];
    if (!img && !map) {
      console.error(`visual-check: ${id} is not an image or map id in assets/manifest.json`);
      continue;
    }
    const what = img ? `image ${id} (${img.kind === 'own-svg' ? `src/assets/svg/${id}.svg` : `assets/staged/${id}.jpg`})` : `map ${id}`;
    const answer = await rl.question(`Type yes to ${reject ? 'reject' : 'pass'} ${what}: `);
    if (answer.trim().toLowerCase() !== 'yes') {
      console.log(`  ${id}: unchanged`);
      continue;
    }
    const value = reject ? null : { by: 'instructor', at: localIso() };
    if (img) img.visual_check = value;
    else map.visual_check = value;
    console.log(`  ${id}: ${reject ? 'check cleared' : `checked at ${value.at}`}`);
  }
  rl.close();
  writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`visual-check: ${err?.message ?? err}`);
  process.exit(1);
});
