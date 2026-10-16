// Copies the data build's output into the app: B/out/workshop_data.json -> src/data/workshop_data.json.
// No machine-specific path lives in this repo. The source comes from, in order:
//   1. the WORKSHOP_DATA_SRC environment variable, or
//   2. local-paths.json at the repo root (git-ignored): { "workshopDataSrc": "<absolute path to workshop_data.json>" }.
// Env override for the destination (used by tests): WORKSHOP_DATA_DEST.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LOCAL_PATHS = resolve(here, '../local-paths.json');
const dest = process.env.WORKSHOP_DATA_DEST ?? resolve(here, '../src/data/workshop_data.json');
const SIZE_TARGET = 250 * 1024;

function fail(msg) {
  console.error(`sync-data: ${msg}`);
  process.exit(1);
}

/** WORKSHOP_DATA_SRC wins; otherwise the git-ignored local-paths.json; otherwise stop and say how to configure it. */
function sourcePath() {
  if (process.env.WORKSHOP_DATA_SRC) return process.env.WORKSHOP_DATA_SRC;
  if (!existsSync(LOCAL_PATHS)) {
    fail(
      'no data source configured. Set the WORKSHOP_DATA_SRC environment variable to the path of workshop_data.json, ' +
        `or create ${LOCAL_PATHS} (git-ignored) containing { "workshopDataSrc": "<absolute path to workshop_data.json>" }.`,
    );
  }
  let config;
  try {
    config = JSON.parse(readFileSync(LOCAL_PATHS, 'utf8'));
  } catch (e) {
    fail(`${LOCAL_PATHS} is not valid JSON (${e.message}).`);
  }
  if (typeof config?.workshopDataSrc !== 'string' || config.workshopDataSrc.trim() === '') {
    fail(`${LOCAL_PATHS} must contain { "workshopDataSrc": "<absolute path to workshop_data.json>" }.`);
  }
  return config.workshopDataSrc;
}

const src = sourcePath();

if (!existsSync(src)) fail(`${src} not found. Run the data build first (Rscript build.R in workshop-build).`);
let parsed;
try {
  parsed = JSON.parse(readFileSync(src, 'utf8'));
} catch (e) {
  fail(`${src} is not valid JSON (${e.message}).`);
}
if (parsed?.version !== 1) fail(`${src} has version ${JSON.stringify(parsed?.version)}, expected 1.`);
const bytes = statSync(src).size;
if (bytes > SIZE_TARGET) console.warn(`sync-data: warning: ${bytes} bytes is over the 250 KB target (spec §5).`);
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`sync-data: copied ${bytes} bytes to ${dest}`);
