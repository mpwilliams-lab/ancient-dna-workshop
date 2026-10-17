// Fetches, re-encodes and promotes the workshop's images (spec §7.1–§7.2, CONTRACT §4.14). Run by hand only, never by npm run build.
//   npm run fetch-assets -- --ids stonehenge,avebury [--clean]
//       Downloads each Commons thumbnail into a freshly created, empty assets/raw/ (git-ignored), records its SHA-256 and
//       size-derived orientation in assets/manifest.json, and re-encodes it with macOS sips into assets/staged/<id>.jpg
//       (git-ignored): landscape at most 900 px wide, portrait 600 px tall, JPEG quality 70 (60 or 50 only if needed for the
//       160 KB limit), PNG converted to JPEG, cropped only where the manifest has a crop box.
//   npm run fetch-assets -- --use-fallback <id>
//       After the instructor rejects an image: switches that manifest entry to its §7.1 fallback (new file, author and
//       licence; check reset) and deletes that image's old promoted file src/assets/img/<id>.jpg, which the new entry has not
//       earned. Then fetch it again with --ids <id> --clean.
//   npm run promote-assets
//       Copies assets/staged/<id>.jpg to src/assets/img/<id>.jpg only for entries the instructor has checked.
// What Commons really serves (checked against the live API): a request for a 900 px thumbnail is answered with a URL on
// thumb.wikimedia.org at the next standard width (960 px), while the answer still says 900 px; an image smaller than that comes
// as the original from upload.wikimedia.org. So the file is measured with sips after the download, and a manifest crop box, which
// is written for a 900 px wide thumbnail, is scaled onto the file that was really received.
// Safety: downloads are untrusted data. They are written only into assets/raw/, hashed, and read only by /usr/bin/sips
// (execFileSync, no shell). Nothing in assets/raw/ or assets/staged/ is ever executed, imported or served. A download comes
// only from a URL on a Wikimedia media host; no redirect is followed; a body that is not a JPEG or PNG is not read; and a body
// is refused as soon as its Content-Length or the bytes already read pass the cap (8 MB; 2 MB for the API answer).
// An entry edited by hand is checked against the licence rules before it is touched (a crop box needs the crop op; CC BY-SA is
// resized only), so a CC BY-SA image can never be staged cropped or converted.
// This script never fills visual_check; only the instructor does (npm run visual-check). A fallback switch resets it to null.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PATHS = {
  manifest: join(ROOT, 'assets/manifest.json'),
  raw: join(ROOT, 'assets/raw'),
  staged: join(ROOT, 'assets/staged'),
  img: join(ROOT, 'src/assets/img'),
  svg: join(ROOT, 'src/assets/svg'),
};
// The licence URLs and the Wikimedia media hosts are written once, in assets/asset-rules.json, which src/assetManifest.ts reads too.
const RULES = JSON.parse(readFileSync(join(ROOT, 'assets/asset-rules.json'), 'utf8'));
export const LICENCE_URLS = RULES.licence_urls;
export const MEDIA_PREFIXES = RULES.media_prefixes;
export const [UPLOAD_PREFIX, THUMB_PREFIX] = MEDIA_PREFIXES;
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
export const USER_AGENT = 'ancient-dna-workshop-asset-fetch/1.0 (https://github.com/mpwilliams-lab/ancient-dna-workshop)';
export const THUMB_WIDTH = 900;
export const PORTRAIT_HEIGHT = 600;
export const QUALITIES = [70, 60, 50];
export const IMAGE_MAX_BYTES = 160 * 1024;
export const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_JSON_BYTES = 2 * 1024 * 1024;
const SIPS = '/usr/bin/sips';
const NETWORK_TIMEOUT_MS = 60_000;

/** The Commons API query for one file's 900 px thumbnail. */
export function thumbApiUrl(commonsFile) {
  const p = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo', iiprop: 'url|size|mime',
    iiurlwidth: String(THUMB_WIDTH), titles: `File:${commonsFile}`,
  });
  return `${COMMONS_API}?${p.toString()}`;
}

/** True for a URL on one of Wikimedia's own media hosts (the prefixes end in "/", so "upload.wikimedia.org.example.org" does not pass). */
export function isMediaUrl(url) {
  return typeof url === 'string' && MEDIA_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/** The image record from an API answer. Throws unless it is served from one of Wikimedia's own media hosts. */
export function thumbFromApi(json) {
  const page = json?.query?.pages?.[0];
  if (page?.missing) throw new Error(`${page.title ?? 'the file'} does not exist on Commons`);
  const info = page?.imageinfo?.[0];
  const url = info?.thumburl ?? info?.url;
  if (!isMediaUrl(url)) throw new Error(`the Commons answer has no image on ${MEDIA_PREFIXES.join(' or ')}`);
  const width = Number(info.thumbwidth ?? info.width);
  const height = Number(info.thumbheight ?? info.height);
  if (!(width > 0 && height > 0)) throw new Error('the Commons answer has no thumbnail size');
  return { url, width, height, mime: String(info.thumbmime ?? info.mime ?? '') };
}

/** The pixel size of an image file, as sips prints it. Throws when sips cannot read the file as an image. */
export function parseSipsSize(output) {
  const w = /pixelWidth:\s*(\d+)/.exec(output)?.[1];
  const h = /pixelHeight:\s*(\d+)/.exec(output)?.[1];
  if (w === undefined || h === undefined) throw new Error('sips could not read the download: it is not an image');
  return { width: Number(w), height: Number(h) };
}

/** Width and height of the file at `path`, read by sips (which only parses it). */
export function imageSize(path) {
  let out;
  try {
    out = execFileSync(SIPS, ['-g', 'pixelWidth', '-g', 'pixelHeight', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error('sips could not read the download: it is not an image');
  }
  return parseSipsSize(out);
}

export const orientationOf = (width, height) => (height > width ? 'portrait' : 'landscape');

/** A crop box written for the 900 px wide thumbnail, moved onto a file `factor` times as wide, rounded and kept inside it. */
export function scaleCrop(crop, factor, width, height) {
  const x = Math.round(crop.x * factor);
  const y = Math.round(crop.y * factor);
  return { x, y, width: Math.min(Math.round(crop.width * factor), width - x), height: Math.min(Math.round(crop.height * factor), height - y) };
}

export function cropFits(crop, width, height) {
  return crop.width > 0 && crop.height > 0 && crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= width && crop.y + crop.height <= height;
}

/** The sips argument lists for one image: an optional crop to a temporary PNG, then the resize and JPEG re-encode. */
export function sipsSteps(entry, rawPath, stagedPath, quality) {
  const steps = [];
  let src = rawPath;
  if (entry.crop) {
    const tmp = stagedPath.replace(/\.jpg$/, '.crop.png');
    const c = entry.crop;
    steps.push(['-s', 'format', 'png', '-c', String(c.height), String(c.width), '--cropOffset', String(c.y), String(c.x), src, '--out', tmp]);
    src = tmp;
  }
  const size = entry.orientation === 'portrait' ? ['--resampleHeight', String(PORTRAIT_HEIGHT)] : ['-Z', String(THUMB_WIDTH)];
  steps.push(['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), ...size, src, '--out', stagedPath]);
  return steps;
}

/** "Thornborough southern henge - geograph.org.uk - 7398606.jpg" -> "Thornborough southern henge". */
export function titleOf(commonsFile) {
  return commonsFile.replace(/\.[A-Za-z]+$/, '').replace(/ - geograph\.org\.uk - \d+$/, '');
}

export function commonsFilePage(name) {
  return `https://commons.wikimedia.org/wiki/File:${name.replace(/ /g, '_').replace(/'/g, '%27')}`;
}

/** The manifest entry rewritten for its §7.1 fallback. The new image has not been checked, so visual_check resets to null. */
export function useFallback(entry) {
  const f = entry.fallback;
  if (!f) throw new Error(`${entry.id} has no §7.1 fallback (spec: drop the tile or fall back to text; that is a card change, not a new image)`);
  const isPng = /\.png$/i.test(f.commons_file);
  const free = f.licence === 'CC0' || f.licence === 'PD';
  if (f.licence.startsWith('CC BY-SA') && isPng) throw new Error(`${entry.id}: a CC BY-SA PNG would need converting, which is an adaptation`);
  const ops = free ? ['resize', 'crop'] : ['resize'];
  if (isPng) ops.push('convert');
  return {
    ...entry,
    kind: 'photo',
    title: titleOf(f.commons_file),
    commons_file: f.commons_file,
    file_page: commonsFilePage(f.commons_file),
    thumb_url: null,
    author: f.author,
    licence: f.licence,
    licence_url: LICENCE_URLS[f.licence],
    source: /geograph\.org\.uk/.test(f.commons_file) ? 'Geograph / Wikimedia Commons' : 'Wikimedia Commons',
    ops,
    crop: null,
    changes: free ? null : isPng ? 'resized, converted to JPEG' : 'resized',
    raw_sha256: null,
    fallback: null,
    visual_check: null,
  };
}

/** assets/raw/ is created empty for every run. A non-empty one is refused unless `clean`, which deletes it first. */
export function freshRawDir(dirs, clean) {
  if (existsSync(dirs.raw) && readdirSync(dirs.raw).length > 0) {
    if (!clean) throw new Error('assets/raw/ is not empty. Downloads always go into a fresh, empty folder: rerun with --clean to delete it first.');
    rmSync(dirs.raw, { recursive: true, force: true });
  }
  mkdirSync(dirs.raw, { recursive: true });
  mkdirSync(dirs.staged, { recursive: true });
}

/**
 * Re-encodes one raw file into <stagedDir>/<id>.jpg: crop (when the entry has a box), resize, JPEG at quality 70, then 60 and 50
 * until it is within 160 KB. A file still too big at quality 50 is deleted and refused.
 */
export function stageImage(entry, rawPath, stagedDir) {
  mkdirSync(stagedDir, { recursive: true });
  const staged = join(stagedDir, `${entry.id}.jpg`);
  const cropped = staged.replace(/\.jpg$/, '.crop.png');
  const run = (args) => execFileSync(SIPS, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    for (const args of sipsSteps(entry, rawPath, staged, QUALITIES[0]).slice(0, -1)) run(args);
    for (const q of QUALITIES) {
      run(sipsSteps(entry, rawPath, staged, q).at(-1));
      const size = statSync(staged).size;
      if (size <= IMAGE_MAX_BYTES) return { staged, size, quality: q };
    }
  } finally {
    rmSync(cropped, { force: true });
  }
  rmSync(staged, { force: true });
  throw new Error(`${entry.id}: still over ${IMAGE_MAX_BYTES} bytes at quality ${QUALITIES.at(-1)}. Ask the instructor about the §7.1 fallback.`);
}

/**
 * One GET. A redirect is refused, not followed: the URL that Commons names (and that thumbFromApi has checked against the
 * Wikimedia hosts) must answer itself, so nothing can send the download somewhere else. Any status but 2xx is an error.
 */
async function get(url, headers) {
  const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    throw new Error(`${url} answered ${res.status}, a redirect to ${res.headers.get('location') ?? 'somewhere'}. Redirects are not followed.`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res;
}

/** The whole body as a Buffer. Refused as soon as Content-Length says, or the bytes read show, that it is over `max`; the transfer is then cancelled. */
async function readLimited(res, url, max) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel();
    throw new Error(`${url} says it is ${declared} bytes, over the ${max}-byte cap`);
  }
  if (!res.body) throw new Error(`${url} sent no body`);
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > max) throw new Error(`${url} is over the ${max}-byte cap`);   // leaving the loop cancels the transfer
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

/** The network, as the script uses it. Tests pass stand-ins, or point these at a server on 127.0.0.1. */
export const NETWORK = {
  async getJson(url, max = MAX_JSON_BYTES) {
    const res = await get(url, { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT });
    return JSON.parse((await readLimited(res, url, max)).toString('utf8'));
  },
  async download(url, max = MAX_DOWNLOAD_BYTES) {
    const res = await get(url, { 'User-Agent': USER_AGENT });
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (type !== 'image/jpeg' && type !== 'image/png') {
      await res.body?.cancel();
      throw new Error(`${url} is ${type || 'of unknown type'}, not a JPEG or PNG`);
    }
    return { buf: await readLimited(res, url, max), type };
  },
};

/**
 * The licence rules of spec §7.1 as the script applies them before it touches an entry, so that an entry edited by hand and not
 * yet seen by a build (src/assetManifest.ts checks the same rules at load) can never be staged: a crop box needs the crop op, and
 * a CC BY-SA image is resized only (never cropped, overlaid, annotated or converted).
 */
export function assertProcessable(entry) {
  const ops = Array.isArray(entry.ops) ? entry.ops : [];
  if (entry.crop && !ops.includes('crop')) throw new Error(`${entry.id}: the manifest has a crop box but ops does not allow cropping`);
  if (String(entry.licence).startsWith('CC BY-SA') && (entry.crop || ops.length !== 1 || ops[0] !== 'resize')) {
    throw new Error(`${entry.id}: CC BY-SA images are resized only: never cropped, overlaid, annotated or converted (spec §7.1)`);
  }
}

/**
 * Downloads one photo, writes it into dirs.raw, records its thumbnail URL, SHA-256 and orientation on `entry`, and stages it.
 * `entry` is only changed once the download has passed every check. visual_check is never touched.
 */
export async function fetchEntry(entry, io = NETWORK, dirs = PATHS) {
  if (entry.kind !== 'photo') throw new Error(`${entry.id} is an own drawing (src/assets/svg/${entry.id}.svg); there is nothing to download`);
  assertProcessable(entry);
  const meta = thumbFromApi(await io.getJson(thumbApiUrl(entry.commons_file)));
  const { buf, type } = await io.download(meta.url);
  if (type === 'image/png' && String(entry.licence).startsWith('CC BY') && !entry.ops.includes('convert')) {
    throw new Error(`${entry.id}: Commons sent a PNG, which is converted to JPEG, but ops does not say "convert", so the attribution string would not say so`);
  }
  const sha = createHash('sha256').update(buf).digest('hex');
  if (entry.visual_check !== null && entry.raw_sha256 !== null && entry.raw_sha256 !== sha) {
    throw new Error(`${entry.id}: the file on Commons has changed since the instructor checked it (sha256 ${sha} vs ${entry.raw_sha256}). Stop and ask.`);
  }
  const rawPath = join(dirs.raw, `${entry.id}.${type === 'image/png' ? 'png' : 'jpg'}`);
  writeFileSync(rawPath, buf);
  const real = imageSize(rawPath);
  let box = null;
  if (entry.crop) {
    const reference = { width: THUMB_WIDTH, height: Math.round((THUMB_WIDTH * real.height) / real.width) };
    if (!cropFits(entry.crop, reference.width, reference.height)) {
      throw new Error(`${entry.id}: crop box ${JSON.stringify(entry.crop)} does not fit the ${reference.width}x${reference.height} thumbnail`);
    }
    box = scaleCrop(entry.crop, real.width / THUMB_WIDTH, real.width, real.height);
    if (!cropFits(box, real.width, real.height)) throw new Error(`${entry.id}: crop box ${JSON.stringify(box)} does not fit the ${real.width}x${real.height} download`);
  }
  const orientation = orientationOf(real.width, real.height);
  const staged = stageImage({ id: entry.id, orientation, crop: box }, rawPath, dirs.staged);
  entry.thumb_url = meta.url;
  entry.raw_sha256 = sha;
  entry.orientation = orientation;
  return { ...staged, sha, type, real, meta };
}

/** Copies staged/<id>.jpg to img/<id>.jpg for every photo the instructor has checked. Returns the ids copied. */
export function promote(manifest, dirs = PATHS) {
  mkdirSync(dirs.img, { recursive: true });
  const done = [];
  for (const e of manifest.images) {
    if (e.kind !== 'photo' || e.visual_check === null) continue;
    const staged = join(dirs.staged, `${e.id}.jpg`);
    const dest = join(dirs.img, `${e.id}.jpg`);
    if (!existsSync(staged)) {
      if (existsSync(dest)) continue;
      throw new Error(`${e.id} is checked but assets/staged/${e.id}.jpg is missing: fetch it again and have it checked again.`);
    }
    const size = statSync(staged).size;
    if (size > IMAGE_MAX_BYTES) throw new Error(`${e.id}: ${size} bytes, over the ${IMAGE_MAX_BYTES}-byte limit`);
    copyFileSync(staged, dest);
    done.push(e.id);
  }
  return done;
}

/**
 * Deletes src/assets/img/<id>.jpg, a photo that was promoted after a check that no longer applies (the image was rejected or
 * switched to its fallback). Left in place it would stay bundled and credited, under a manifest entry that has not been checked.
 * Returns true when it deleted a file.
 */
export function removePromoted(imgDir, id) {
  const file = join(imgDir, `${id}.jpg`);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

function parseArgs(argv) {
  const a = { ids: [], clean: false, promote: false, fallback: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--clean') a.clean = true;
    else if (v === '--promote') a.promote = true;
    else if (v === '--ids') a.ids.push(...String(argv[++i] ?? '').split(',').map((x) => x.trim()).filter(Boolean));
    else if (v === '--use-fallback') a.fallback = String(argv[++i] ?? '');
    else throw new Error(`unknown argument ${v}`);
  }
  return a;
}

/** The command line. `env` is for tests: the folders (default: this repository's), the network and where messages go. */
export async function main(argv, env = {}) {
  const { paths = PATHS, network = NETWORK, log = console.log } = env;
  const readManifest = () => JSON.parse(readFileSync(paths.manifest, 'utf8'));
  const writeManifest = (m) => writeFileSync(paths.manifest, `${JSON.stringify(m, null, 2)}\n`);
  const args = parseArgs(argv);
  if (args.promote) {
    const ids = promote(readManifest(), paths);
    for (const id of ids) log(`promote-assets: ${id} -> src/assets/img/${id}.jpg (${Math.round(statSync(join(paths.img, `${id}.jpg`)).size / 1024)} KB)`);
    log(`promote-assets: ${ids.length} checked image(s) promoted. Unchecked images stay in assets/staged/.`);
    return;
  }
  if (args.fallback !== null) {
    const manifest = readManifest();
    const i = manifest.images.findIndex((x) => x.id === args.fallback);
    if (i < 0) throw new Error(`unknown image id ${args.fallback}`);
    const was = manifest.images[i];
    manifest.images[i] = useFallback(was);
    writeManifest(manifest);
    log(`fetch-assets: ${args.fallback} now uses its fallback "${manifest.images[i].commons_file}". Next: npm run fetch-assets -- --ids ${args.fallback} --clean`);
    // The rejected image's promoted file belongs to a check that no longer applies.
    if (removePromoted(paths.img, args.fallback)) log(`fetch-assets: deleted the old promoted file src/assets/img/${args.fallback}.jpg (it was the rejected image). Promote the new one after the instructor has checked it.`);
    if (was.kind === 'own-svg' && paths.svg && existsSync(join(paths.svg, `${args.fallback}.svg`))) {
      log(`fetch-assets: WARNING: src/assets/svg/${args.fallback}.svg is still there. Delete it, or the drawing would be shown under the new photo's credit.`);
    }
    return;
  }
  if (args.ids.length === 0) throw new Error('nothing to do: pass --ids <id,id,...>, --use-fallback <id> or --promote.');
  if (process.platform !== 'darwin' || !existsSync(SIPS)) throw new Error('this step needs macOS sips (/usr/bin/sips).');
  const manifest = readManifest();
  for (const id of args.ids) if (!manifest.images.some((x) => x.id === id)) throw new Error(`unknown image id ${id}`);
  freshRawDir(paths, args.clean);
  for (const id of args.ids) {
    const e = manifest.images.find((x) => x.id === id);
    if (e.kind !== 'photo') {
      log(`fetch-assets: ${id} is an own drawing (src/assets/svg/${id}.svg); nothing to download.`);
      continue;
    }
    const r = await fetchEntry(e, network, paths);
    writeManifest(manifest);       // one image at a time: a later failure never loses what the earlier files recorded
    log(`fetch-assets: ${id}: ${r.real.width}x${r.real.height} ${r.type} -> assets/staged/${id}.jpg (${Math.round(r.size / 1024)} KB, quality ${r.quality}, ${e.orientation})`);
  }
  log('fetch-assets: next, the instructor views every staged file at projector size against the spec §7.2 list and runs npm run visual-check -- <ids>.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`fetch-assets: ${err?.message ?? String(err)}`);
    process.exit(1);
  });
}
