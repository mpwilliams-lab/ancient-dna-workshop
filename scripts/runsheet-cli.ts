// CLI: vite build --ssr scripts/runsheet-cli.ts --outDir .runsheet --emptyOutDir && node .runsheet/runsheet-cli.js [outFile]
// (that is `npm run run-sheet`; extra arguments go after `--`, e.g. `npm run run-sheet -- notes/run-sheet.md`).
// No machine-specific path lives in this repo. The run sheet is written to, in order:
//   1. the first command-line argument, or
//   2. the WORKSHOP_RUNSHEET_PATH environment variable, or
//   3. local-paths.json at the repo root (git-ignored): { "runSheetPath": "<absolute path to run-sheet.md>" }.
// With none of them set, it stops and names all three.
// The sheet also names the offline master copy of the app. That is where `npm run export-offline` writes it, so the folder
// comes from the same two places as there: WORKSHOP_OFFLINE_DIR, then offlineExportDir in local-paths.json.
// Its "Freeze and verify" section records that file's byte size and sha256, read from the file each time the sheet is
// generated. If the file is missing the sheet carries a warning line instead (and so does stderr); the run still succeeds.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA } from '../src/data';
import { buildRunSheet, OFFLINE_NAME, type OfflineFileInfo } from '../src/runsheet';

// The built file sits in <repo>/.runsheet/ (the source in <repo>/scripts/), so the repo root is one folder up either way.
const LOCAL_PATHS = resolve(dirname(fileURLToPath(import.meta.url)), '../local-paths.json');

function fail(msg: string): never {
  console.error(`run-sheet: ${msg}`);
  process.exit(1);
}

/** A usable setting: a string with something in it. Blank values and values of the wrong type count as unset. */
const setting = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

let localConfig: Record<string, unknown> | undefined;
/** local-paths.json, read at most once and only when the argument and the environment do not already answer the question. */
function local(): Record<string, unknown> {
  if (localConfig) return localConfig;
  if (!existsSync(LOCAL_PATHS)) return (localConfig = {});
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(LOCAL_PATHS, 'utf8'));
  } catch (e) {
    return fail(`${LOCAL_PATHS} is not valid JSON (${(e as Error).message}).`);
  }
  return (localConfig = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {});
}

const outPath =
  setting(process.argv[2]) ??
  setting(process.env.WORKSHOP_RUNSHEET_PATH) ??
  setting(local().runSheetPath) ??
  fail(
    'no output path configured. Pass it as the first argument (npm run run-sheet -- <file>), ' +
      'set the WORKSHOP_RUNSHEET_PATH environment variable, ' +
      `or add { "runSheetPath": "<absolute path to run-sheet.md>" } to ${LOCAL_PATHS} (git-ignored).`,
  );

const offlineDir =
  setting(process.env.WORKSHOP_OFFLINE_DIR) ??
  setting(local().offlineExportDir) ??
  fail(
    'no offline export folder configured. The run sheet names the offline master copy of the app, so set the WORKSHOP_OFFLINE_DIR ' +
      'environment variable to the folder that `npm run export-offline` writes to, ' +
      `or add { "offlineExportDir": "<absolute path to the folder>" } to ${LOCAL_PATHS} (git-ignored).`,
  );

const out = resolve(outPath);
const offline = resolve(join(offlineDir, OFFLINE_NAME));

/**
 * The exported offline file's size and sha256, read now: the sheet records what is in the Drive folder at generation time and
 * no number in it is typed by hand. The bytes are read raw (a text read would change both numbers for a file with multi-byte
 * characters). Null when the file is missing or cannot be read; the sheet then carries a warning line, and this is not a crash.
 */
function readOffline(path: string): OfflineFileInfo | null {
  try {
    const bytes = readFileSync(path);
    return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch {
    return null;
  }
}

const offlineFile = readOffline(offline);
if (!offlineFile) {
  console.warn(
    `run-sheet: warning: ${offline} was not found or could not be read, so the sheet has no size and hash for it. ` +
      'Run `npm run export-offline`, then run this again.',
  );
}
const md = buildRunSheet(DATA, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), offline, offlineFile);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, md, 'utf8');
console.log(`run-sheet: wrote ${out} (${md.length} chars)`);
