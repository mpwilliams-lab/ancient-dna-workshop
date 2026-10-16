// Copies the single-file build (dist/index.html) to the offline copy, after checking that it is fully
// self-contained (no external scripts, styles, images, fonts or imports; a <link> must be a data: URL).
// Usage: node scripts/export-offline.mjs [outFile] [srcFile]
// No machine-specific path lives in this repo. Without an outFile argument, the destination folder comes from, in order:
//   1. the WORKSHOP_OFFLINE_DIR environment variable, or
//   2. local-paths.json at the repo root (git-ignored): { "offlineExportDir": "<absolute path to the folder>" }.
// The copy is named ancient-dna-workshop.html inside that folder, and the folder is created if it is missing.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_NAME = 'ancient-dna-workshop.html';
const here = dirname(fileURLToPath(import.meta.url));
const LOCAL_PATHS = resolve(here, '../local-paths.json');

function fail(msg) {
  console.error(`export-offline: ${msg}`);
  process.exit(1);
}

/** WORKSHOP_OFFLINE_DIR wins; otherwise the git-ignored local-paths.json; otherwise stop and say how to configure it. */
function exportDir() {
  const fromEnv = process.env.WORKSHOP_OFFLINE_DIR;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  let fromFile;
  if (existsSync(LOCAL_PATHS)) {
    let config;
    try {
      config = JSON.parse(readFileSync(LOCAL_PATHS, 'utf8'));
    } catch (e) {
      fail(`${LOCAL_PATHS} is not valid JSON (${e.message}).`);
    }
    fromFile = config?.offlineExportDir;
  }
  if (typeof fromFile === 'string' && fromFile.trim() !== '') return fromFile;
  return fail(
    'no offline export folder configured. Set the WORKSHOP_OFFLINE_DIR environment variable to the folder for the offline copy, ' +
      `or add { "offlineExportDir": "<absolute path to the folder>" } to ${LOCAL_PATHS} (git-ignored).`,
  );
}

const out = resolve(process.argv[2] || join(exportDir(), OUT_NAME));
const src = resolve(process.argv[3] || resolve(here, '../dist/index.html'));

if (!existsSync(src)) fail(`${src} not found. Run \`npm run build\` first.`);
const bytes = readFileSync(src);
const html = bytes.toString('utf8');

const problems = [];
const markupChecks = [
  [/<script\b[^>]*\bsrc\s*=/i, 'a <script src=...> (scripts must be inlined)'],
  // A data: href or src is inline content (index.html's <link rel="icon" href="data:,"> keeps browsers from asking for /favicon.ico).
  // The lookahead sits right after `=` so the engine cannot back off into the quote or the spaces and flag a data: URL.
  [/<link\b[^>]*\bhref\s*=(?!\s*["']?data:)/i, 'a <link href=...> that is not a data: URL (styles/icons must be inlined)'],
  [/<(img|iframe|source|video|audio|embed)\b[^>]*\bsrc\s*=(?!\s*["']?data:)/i, 'an element loading a non-data: src'],
];
// Only CSS inside <style> is checked for url(: the inlined JS legitimately contains `new URL(`.
const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
const cssChecks = [
  [/url\(\s*["']?(?!data:|#)/i, 'a CSS url(...) that is not data: or #fragment'],
  [/@import\b/i, 'a CSS @import'],
];
for (const [re, what] of markupChecks) if (re.test(html)) problems.push(what);
for (const [re, what] of cssChecks) if (re.test(css)) problems.push(what);
if (!/<script\b[^>]*type="module"[^>]*>[\s\S]{1000,}<\/script>/i.test(html)) problems.push('no inlined module script');
if (problems.length) fail(`${src} is not self-contained: ${problems.join('; ')}`);

mkdirSync(dirname(out), { recursive: true });
copyFileSync(src, out);
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const [a, b] = [sha(src), sha(out)];
if (a !== b) fail(`copy verification failed (${a} != ${b})`);
console.log(`export-offline: ${out}`);
console.log(`export-offline: ${bytes.length} bytes, sha256 ${b}`);
