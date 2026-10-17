// @vitest-environment node
// Spec §7.1–§7.2, CONTRACT §4.14: the image manifest, attribution strings, readiness, the size budget and the fetch script.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';
import raw from '../assets/manifest.json';
import rules from '../assets/asset-rules.json';
import {
  ASSET_MANIFEST, HIDDEN_WHEN_SHOWN, LICENCE_IDS, LICENCE_URLS, MAP_IDS, MEDIA_PREFIXES, ManifestError, attributionString,
  commonsFilePage, cropAllowed, parseManifest, type ImageEntry,
} from '../src/assetManifest';
import { BUNDLED_IMAGE_IDS, cardMapId, cardShowsUpgrade, imageReady, imageUrl, mapReady, shownTileImages } from '../src/assets';
import { CARDS, cardUpgraded } from '../src/cards';
import { ALL_OFF, ALL_ON, FEATURE_FLAGS, withFeatures } from '../src/features';
import { IMAGE_MAX_BYTES, IMAGES_TOTAL_MAX_BYTES } from '../src/release';
import { CARD_IDS, type CardId, type ImageId } from '../src/types';
import * as script from '../scripts/fetch-assets.mjs';
import {
  COMMONS_API, PORTRAIT_HEIGHT, THUMB_PREFIX, THUMB_WIDTH, UPLOAD_PREFIX, cropFits, parseSipsSize, scaleCrop, sipsSteps, thumbApiUrl,
  thumbFromApi, titleOf, useFallback,
} from '../scripts/fetch-assets.mjs';
import { checkedManifest, fakeUrls, uncheckedManifest } from './helpers/assetEnv';

const ROOT = resolve(__dirname, '..');
const FETCH_SCRIPT = resolve(ROOT, 'scripts/fetch-assets.mjs');
const entry = (id: ImageId): ImageEntry => ASSET_MANIFEST.images.find((e) => e.id === id)!;
/** A copy of one entry as Task 15 shipped it (nothing checked, nothing fetched): the committed file changes as the instructor works. */
const fresh = (id: ImageId): ImageEntry => uncheckedManifest().images.find((e) => e.id === id)!;
const rawCopy = (): any => structuredClone(raw);

// Spec §7.1 first choices: id, card, Commons file (null = own drawing), author, licence, ops.
const FIRST_CHOICES: [ImageId, CardId, string | null, string, ImageEntry['licence'], ImageEntry['ops']][] = [
  ['stonehenge', 'B1', 'Stonehenge (9816864014).jpg', 'Gary Todd', 'CC0', ['resize', 'crop']],
  ['avebury', 'B1', 'Avebury in June.JPG', 'Poliphilo', 'CC0', ['resize', 'crop']],
  ['ring-of-brodgar', 'B1', 'Ring of Brogar 2000-1.jpg', 'Libasstref', 'CC0', ['resize', 'crop']],
  ['thornborough-plan', 'B1', null, 'Plan drawn for this workshop', 'own', []],
  ['castlerigg', 'B1', 'Castlerigg Stone Circle 2015 18.jpg', 'Mike Peel (www.mikepeel.net)', 'CC BY-SA 4.0', ['resize']],
  ['amesbury-archer', 'C1', 'Amesbury Archer - Salisbury and South Wiltshire Museum.jpg', 'Pasicles', 'CC0', ['resize', 'crop']],
  ['round-barrow', 'C1', 'Round barrow, Overton Hill.JPG', 'Poliphilo', 'CC0', ['resize', 'crop']],
  ['shrewton-beaker', 'C1', 'Shrewton Beaker Burial.jpg', 'TobyEditor', 'CC BY 4.0', ['resize', 'crop']],
  ['roundhouse', 'E2', 'Interior of Little Woodbury Iron Age Roundhouse 2 - 55403896108.jpg', 'Tim Sheerman-Chase', 'CC BY 4.0', ['resize', 'crop']],
  ['maiden-castle', 'E2', 'Dorset. Maiden Castle. Luchtfoto, GD000392.jpg', 'KU Leuven. EuroPhot', 'PD', ['resize', 'crop']],
  ['battersea-shield', 'E2', 'British Museum Battersea Shield.jpg', 'BabelStone', 'CC0', ['resize']],
  ['hadrians-wall', 'F1', "Hadrian's Wall west of Housesteads 3.jpg", 'Steven Fruitsmaak', 'PD', ['resize', 'crop']],
  ['bignor-medusa', 'F1', 'Bignor Roman Villa- Medusa mosaic.JPG', 'Poliphilo', 'CC0', ['resize', 'crop']],
  ['hoxne-coins', 'F1', 'Hoxne Hoard coins 6a.jpg', 'The Land', 'PD', ['resize', 'crop']],
  ['sutton-hoo-helmet', 'G2', 'Replica of the Sutton Hoo helmet, British Museum.jpg', 'APK', 'CC BY 4.0', ['resize']],
  ['square-headed-brooch', 'G2', 'Square-Headed Bow Brooch MET DP30059.jpg', 'The Metropolitan Museum of Art', 'CC0', ['resize', 'crop']],
  ['west-stow', 'G2', 'Anglo-Saxon Village re-construction, West Stow - geograph.org.uk - 6442982.jpg', 'Colin Park', 'CC BY-SA 2.0', ['resize']],
  ['milk', 'H1', 'Milk-2474993 1920.jpg', 'Couleur', 'CC0', ['resize', 'crop']],
  ['cow', 'H1', 'Cow female black white.jpg', 'Keith Weller, USDA', 'PD', ['resize', 'crop']],
  ['melanocyte', 'I1', 'Blausen 0632 Melanocyte.png', 'BruceBlaus (Blausen.com staff 2014, WikiJournal of Medicine)', 'CC BY 3.0', ['resize', 'convert']],
  ['irises', 'J1', null, 'Drawn for this workshop', 'own', []],
];

describe('assets/manifest.json (spec §7.1)', () => {
  it('lists every §7.1 first choice with its author, licence and allowed operations, in card order', () => {
    expect(ASSET_MANIFEST.images.map((e) => [e.id, e.card, e.commons_file, e.author, e.licence, e.ops])).toEqual(FIRST_CHOICES);
  });
  it('lists the §7.1 fallbacks (null where the spec drops the tile or falls back to text)', () => {
    expect(Object.fromEntries(ASSET_MANIFEST.images.map((e) => [e.id, e.fallback?.commons_file ?? null]))).toEqual({
      stonehenge: 'Stonehenge2007 07 30.jpg',
      avebury: 'Avebury Stone Circles.jpg',
      'ring-of-brodgar': 'Ring of Brodgar, Orkney.jpg',
      'thornborough-plan': 'Thornborough southern henge - geograph.org.uk - 7398606.jpg',
      castlerigg: "Anonymous - The Druids' Circle, Castlerigg, Keswick - B2018.7.112 - Yale Center for British Art.jpg",
      'amesbury-archer': 'Amesbury Archer.jpg',
      'round-barrow': 'Three bowl barrows, once part of a round barrow cemetery, at Barrowfields.jpg',
      'shrewton-beaker': 'Bell Beaker culture artefacts from Mere Down, Wiltshire, England.png',
      roundhouse: 'Iron Age Village at Butser Ancient Farm.jpg',
      'maiden-castle': 'Maiden Castle (multivallate hillfort).jpg',
      'battersea-shield': 'Battersea shield 1.jpg',
      'hadrians-wall': "Hadrian's Wall on Housesteads Crags - 06.jpg",
      'bignor-medusa': 'Fishbourne Roman Palace, Medusa Mosaic - geograph.org.uk - 8053992.jpg',
      'hoxne-coins': 'Hoxne Hoard coins 5.JPG',
      'sutton-hoo-helmet': 'Anglo-Saxon Shoulder Clasp from Sutton Hoo Burial, 625-630 AD.jpg',
      'square-headed-brooch': 'Square-Headed Brooch MET DP30025.jpg',
      'west-stow': null,
      milk: 'Milk 2.jpg',
      cow: null,
      melanocyte: null,
      irises: null,
    });
  });
  it('has a visual_check slot for every map, A1..L3 and the F1 inset', () => {
    expect(Object.keys(ASSET_MANIFEST.maps).sort()).toEqual([...MAP_IDS].sort());
    expect(MAP_IDS).toEqual(['A1', 'D1', 'E1', 'G1', 'H2', 'I2', 'J3', 'K2', 'L3', 'F1inset']);
  });
  it('every visual check that is filled in was made by "instructor" at an ISO-8601 time (public repo: no names)', () => {
    const checks = [...ASSET_MANIFEST.images.map((e) => e.visual_check), ...Object.values(ASSET_MANIFEST.maps).map((m) => m.visual_check)];
    for (const c of checks.filter((x) => x !== null)) {
      expect(c!.by).toBe('instructor');
      expect(Number.isNaN(Date.parse(c!.at))).toBe(false);
    }
  });
  it('photos link their Commons file page; own drawings have no file, page, thumbnail or licence URL', () => {
    for (const e of ASSET_MANIFEST.images) {
      if (e.kind === 'photo') expect(e.file_page).toBe(commonsFilePage(e.commons_file!));
      else expect([e.commons_file, e.file_page, e.thumb_url, e.licence_url, e.source]).toEqual([null, null, null, null, 'this workshop']);
    }
    expect(commonsFilePage("Hadrian's Wall west of Housesteads 3.jpg")).toBe('https://commons.wikimedia.org/wiki/File:Hadrian%27s_Wall_west_of_Housesteads_3.jpg');
  });
  it('only the Ring of Brodgar (3:1 from its 900 x 356 thumbnail) and the Bignor Medusa panel have a crop box; every crop box needs the crop op', () => {
    expect(ASSET_MANIFEST.images.filter((e) => e.crop !== null).map((e) => [e.id, e.crop])).toEqual([
      ['ring-of-brodgar', { x: 0, y: 28, width: 900, height: 300 }],
      // Task 21: the Medusa panel of the Bignor photo, a 4:3 box in the 900 x 675 frame that every manifest box is written for.
      ['bignor-medusa', { x: 158, y: 150, width: 506, height: 380 }],
    ]);
    for (const e of ASSET_MANIFEST.images.filter((x) => x.crop !== null)) expect(e.ops, e.id).toContain('crop');
  });
  it('the Bignor crop box is a 4:3 box inside its 900 x 675 frame, on a CC0 photo (never share-alike), and scales to a whole box on the 960 x 720 download', () => {
    const e = entry('bignor-medusa');
    expect(e.licence).toBe('CC0');
    expect(cropFits(e.crop!, 900, 675)).toBe(true);
    expect(e.crop!.width / e.crop!.height).toBeCloseTo(4 / 3, 2);
    // What fetch-assets crops from the 960 x 720 file Commons sends for a 900 px request; the staged file is that box at 900 px
    // wide, which is what keeps it within 160 KB at JPEG quality 50 (the whole photo is over the limit at quality 50).
    expect(scaleCrop(e.crop!, 960 / 900, 960, 720)).toEqual({ x: 169, y: 160, width: 540, height: 405 });
  });
  it('rejects a cropped CC BY-SA image, a named checker, a stray crop box, a trailing slash and a missing map', () => {
    const bad: [string, (m: any) => void][] = [
      ['CC BY-SA, with a matching "cropped" change line, so only the share-alike rule can object', (m) => {
        const e = m.images.find((x: any) => x.id === 'castlerigg');
        e.ops = ['resize', 'crop'];
        e.changes = 'cropped and resized';
      }],
      ['CC BY-SA converted', (m) => {
        const e = m.images.find((x: any) => x.id === 'west-stow');
        e.ops = ['resize', 'convert'];
        e.changes = 'resized, converted to JPEG';
      }],
      ['instructor', (m) => { m.images[0].visual_check = { by: 'someone', at: '2026-10-19T15:00:00-07:00' }; }],
      ['crop', (m) => { m.images.find((e: any) => e.id === 'battersea-shield').crop = { x: 0, y: 0, width: 10, height: 10 }; }],
      ['licence_url', (m) => { m.images.find((e: any) => e.id === 'shrewton-beaker').licence_url = 'https://creativecommons.org/licenses/by/4.0/'; }],
      ['maps', (m) => { delete m.maps.L3; }],
      ['changes', (m) => { m.images.find((e: any) => e.id === 'shrewton-beaker').changes = 'resized'; }],
      ['thumb_url host', (m) => { m.images[0].thumb_url = 'https://example.org/a.jpg'; }],
      ['thumb_url lookalike', (m) => { m.images[0].thumb_url = `${UPLOAD_PREFIX.slice(0, -1)}.example.org/a.jpg`; }],
      ['thumb_url on an own drawing', (m) => { m.images.find((e: any) => e.id === 'irises').thumb_url = `${UPLOAD_PREFIX}a.jpg`; }],
    ];
    for (const [why, breakIt] of bad) {
      const m = rawCopy();
      breakIt(m);
      expect(() => parseManifest(m), why).toThrow(ManifestError);
    }
    expect(() => parseManifest(rawCopy())).not.toThrow();
  });
  it('accepts a thumbnail recorded from either Wikimedia media host', () => {
    for (const prefix of [UPLOAD_PREFIX, THUMB_PREFIX]) {
      const m = rawCopy();
      m.images[0].thumb_url = `${prefix}wikipedia/commons/thumb/a/ab/x.jpg/960px-x.jpg?utm_source=commons.wikimedia.org`;
      expect(parseManifest(m).images[0]!.thumb_url, prefix).toContain(prefix);
    }
  });
  it('is stored in the format the scripts write (2-space JSON, one trailing newline), so a script run changes only what it records', () => {
    expect(readFileSync(resolve(ROOT, 'assets/manifest.json'), 'utf8')).toBe(`${JSON.stringify(raw, null, 2)}\n`);
  });
  it('every §7.1 fallback, swapped in for its first choice, is a valid manifest entry (the spec table cannot hide an invalid row)', () => {
    for (const e of ASSET_MANIFEST.images) {
      if (e.fallback === null) continue;
      const m = rawCopy();
      m.images = m.images.map((x: any) => (x.id === e.id ? useFallback(e) : x));
      expect(() => parseManifest(m), e.id).not.toThrow();
    }
  });
});

describe('licence and media-host rules are written once (D-L11)', () => {
  it('src/assetManifest.ts and scripts/fetch-assets.mjs both read assets/asset-rules.json, so their tables cannot differ', () => {
    expect(LICENCE_URLS).toEqual(rules.licence_urls);
    expect(script.LICENCE_URLS).toEqual(LICENCE_URLS);
    expect([...MEDIA_PREFIXES]).toEqual(rules.media_prefixes);
    expect(script.MEDIA_PREFIXES).toEqual([...MEDIA_PREFIXES]);
    expect([UPLOAD_PREFIX, THUMB_PREFIX]).toEqual(['https://upload.wikimedia.org/', 'https://thumb.wikimedia.org/']);
  });
  it('the table has one entry for each licence id, none with a trailing slash, and only CC BY and CC BY-SA carry a URL', () => {
    expect(Object.keys(LICENCE_URLS).sort()).toEqual([...LICENCE_IDS].sort());
    expect(LICENCE_IDS).toEqual(['CC0', 'PD', 'CC BY 2.0', 'CC BY 3.0', 'CC BY 4.0', 'CC BY-SA 2.0', 'CC BY-SA 3.0', 'CC BY-SA 4.0', 'own']);
    for (const id of LICENCE_IDS) {
      const url = LICENCE_URLS[id];
      if (id.startsWith('CC BY')) {
        const [, kind, version] = /^CC (BY(?:-SA)?) (\d\.0)$/.exec(id)!;
        expect(url, id).toBe(`https://creativecommons.org/licenses/${kind!.toLowerCase()}/${version}`);
      } else {
        expect(url, id).toBeNull();
      }
    }
    expect(LICENCE_URLS['CC BY-SA 4.0']).toBe('https://creativecommons.org/licenses/by-sa/4.0');
    expect(LICENCE_URLS['CC BY 3.0']).toBe('https://creativecommons.org/licenses/by/3.0');
  });
  it('the script and the app agree on the Commons file page and on the 160 KB limit', () => {
    for (const e of ASSET_MANIFEST.images) for (const name of [e.commons_file, e.fallback?.commons_file]) {
      if (name) expect(script.commonsFilePage(name), name).toBe(commonsFilePage(name));
    }
    expect(script.IMAGE_MAX_BYTES).toBe(IMAGE_MAX_BYTES);
  });
});

describe('attributionString (spec §7.2)', () => {
  it('matches the three spec examples exactly', () => {
    expect(attributionString(entry('shrewton-beaker'))).toBe(
      '"Shrewton Beaker Burial" by TobyEditor, CC BY 4.0 (creativecommons.org/licenses/by/4.0), via Wikimedia Commons; cropped and resized');
    expect(attributionString(entry('melanocyte'))).toBe(
      '"Melanocyte" by BruceBlaus (Blausen.com staff 2014, WikiJournal of Medicine), CC BY 3.0 (creativecommons.org/licenses/by/3.0), via Wikimedia Commons; resized, converted to JPEG');
    expect(attributionString(entry('west-stow'))).toBe(
      '"Anglo-Saxon Village re-construction, West Stow" by Colin Park, CC BY-SA 2.0 (creativecommons.org/licenses/by-sa/2.0), via Geograph / Wikimedia Commons; resized');
  });
  it('CC0, public domain and own drawings use the short forms', () => {
    expect(attributionString(entry('stonehenge'))).toBe('Photo: Gary Todd (CC0), via Wikimedia Commons');
    expect(attributionString(entry('cow'))).toBe('Photo: Keith Weller, USDA (public domain), via Wikimedia Commons');
    expect(attributionString(entry('thornborough-plan'))).toBe('Plan drawn for this workshop');
    expect(attributionString(entry('irises'))).toBe('Drawn for this workshop');
  });
  it('every CC BY / BY-SA string names its licence URL and says "cropped" exactly when cropping is allowed; BY-SA is never cropped', () => {
    for (const e of ASSET_MANIFEST.images.filter((x) => x.licence.startsWith('CC BY'))) {
      const s = attributionString(e);
      expect(s, e.id).toContain('creativecommons.org/licenses/');
      expect(s.includes('cropped'), e.id).toBe(e.ops.includes('crop'));
      expect(e.licence_url!.endsWith('/'), e.id).toBe(false);
      if (e.licence.startsWith('CC BY-SA')) expect(e.ops, e.id).toEqual(['resize']);
    }
  });
  it('object-fit: cover is allowed only where cropping is allowed', () => {
    expect(cropAllowed(entry('stonehenge'))).toBe(true);
    expect(cropAllowed(entry('castlerigg'))).toBe(false);
    expect(cropAllowed(entry('battersea-shield'))).toBe(false);
  });
});

describe('readiness (CONTRACT §4.14)', () => {
  it('an image is ready only when it is both checked and bundled', () => {
    expect(imageReady('stonehenge', checkedManifest(), fakeUrls())).toBe(true);
    expect(imageReady('stonehenge', checkedManifest(['stonehenge']), fakeUrls())).toBe(false);
    expect(imageReady('stonehenge', checkedManifest(), fakeUrls(['stonehenge']))).toBe(false);
    expect(imageUrl('stonehenge', fakeUrls())).toBe('data:image/jpeg;base64,stonehenge');
  });
  it('a map is ready once checked', () => {
    expect(mapReady('D1', checkedManifest())).toBe(true);
    expect(mapReady('D1', checkedManifest(['D1']))).toBe(false);
  });
  it('a card shows its upgraded form only with its flag on and every non-optional tile (or its map) ready', () => {
    const on = withFeatures({ 'images.B1': true, 'map.D1': true }, ALL_OFF);
    expect(cardShowsUpgrade(CARDS.B1, on, checkedManifest(), fakeUrls())).toBe(true);
    expect(cardShowsUpgrade(CARDS.B1, ALL_OFF, checkedManifest(), fakeUrls())).toBe(false);
    expect(cardShowsUpgrade(CARDS.B1, on, checkedManifest(['stonehenge']), fakeUrls())).toBe(false);
    expect(cardShowsUpgrade(CARDS.B1, on, checkedManifest(['castlerigg']), fakeUrls())).toBe(true);   // optional tile
    expect(cardShowsUpgrade(CARDS.D1, on, checkedManifest(), fakeUrls())).toBe(true);
    expect(cardShowsUpgrade(CARDS.D1, on, checkedManifest(['D1']), fakeUrls())).toBe(false);
    // Task 20: a map card is upgraded only once its spec is built (MAP_SPECS_BUILT). Task 27 removes this line when it builds L3.
    expect(cardShowsUpgrade(CARDS.L3, ALL_ON, checkedManifest(), fakeUrls())).toBe(false);
    expect(cardShowsUpgrade(CARDS.D2, ALL_ON, checkedManifest(), fakeUrls())).toBe(false);          // text-only card
  });
  it('follows the same flag rule as cardUpgraded', () => {
    for (const id of CARD_IDS) {
      for (const f of [ALL_ON, ALL_OFF]) {
        if (!cardUpgraded(CARDS[id], f)) expect(cardShowsUpgrade(CARDS[id], f, checkedManifest(), fakeUrls()), id).toBe(false);
      }
    }
  });
  it('C1: the Shrewton burial photo never shows beside the Archer photo', () => {
    const on = withFeatures({ 'images.C1': true }, ALL_OFF);
    expect(HIDDEN_WHEN_SHOWN['shrewton-beaker']).toBe('amesbury-archer');
    expect(shownTileImages(CARDS.C1, on, checkedManifest(), fakeUrls())).toEqual(['amesbury-archer', 'round-barrow']);
  });
  it('every map card, and only map and distribution cards, names its map id', () => {
    for (const id of CARD_IDS) {
      const card = CARDS[id];
      const expected = card.feature?.startsWith('map.') ? card.feature.slice(4) : card.map;
      expect(cardMapId(card), id).toBe(expected);
    }
  });
  it('every card flag the manifest relies on exists', () => {
    for (const e of ASSET_MANIFEST.images) expect(FEATURE_FLAGS, e.id).toContain(`images.${e.card}`);
  });
});

describe('manifest and cards agree', () => {
  it('each card tile image is a manifest entry of that card, and every manifest image belongs to a tile', () => {
    const fromCards = CARD_IDS.flatMap((id) => (CARDS[id].tiles ?? []).map((t) => `${id}:${t.image}`)).sort();
    const fromManifest = ASSET_MANIFEST.images.map((e) => `${e.card}:${e.id}`).sort();
    expect(fromManifest).toEqual(fromCards);
  });
});

describe('size budget (spec §7.2)', () => {
  const dir = join(ROOT, 'src/assets/img');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jpg')) : [];
  it('every inlined JPEG is at most 160 KB and all of them together at most 2.2 MB', () => {
    let total = 0;
    for (const f of files) {
      const size = statSync(join(dir, f)).size;
      expect(size, f).toBeLessThanOrEqual(IMAGE_MAX_BYTES);
      total += size;
    }
    expect(total).toBeLessThanOrEqual(IMAGES_TOTAL_MAX_BYTES);
  });
  it('src/assets/img holds only checked manifest photos (nothing unchecked reaches the public repo)', () => {
    for (const f of files) {
      const e = ASSET_MANIFEST.images.find((x) => `${x.id}.jpg` === f);
      expect(e, f).toBeDefined();
      expect(e!.visual_check, f).not.toBeNull();
    }
  });
  it('the bundled ids are exactly the files on disk', () => {
    const svgDir = join(ROOT, 'src/assets/svg');
    const svgs = existsSync(svgDir) ? readdirSync(svgDir).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)) : [];
    expect([...BUNDLED_IMAGE_IDS].sort()).toEqual([...files.map((f) => f.slice(0, -4)), ...svgs].sort());
  });
});

describe('scripts/fetch-assets.mjs helpers', () => {
  it('asks the Commons API for a 900 px thumbnail of the named file', () => {
    const u = new URL(thumbApiUrl("Hadrian's Wall west of Housesteads 3.jpg"));
    expect(`${u.origin}${u.pathname}`).toBe(COMMONS_API);
    expect(u.searchParams.get('titles')).toBe("File:Hadrian's Wall west of Housesteads 3.jpg");
    expect(u.searchParams.get('iiurlwidth')).toBe(String(THUMB_WIDTH));
    expect(u.searchParams.get('prop')).toBe('imageinfo');
  });
  it('accepts only images served from Wikimedia\'s own media hosts, upload.wikimedia.org and thumb.wikimedia.org', () => {
    const answer = (url: string) => ({ query: { pages: [{ imageinfo: [{ thumburl: url, thumbwidth: 900, thumbheight: 356, mime: 'image/jpeg' }] }] } });
    const ok = answer(`${UPLOAD_PREFIX}x/900px-a.jpg`);
    expect(thumbFromApi(ok)).toEqual({ url: `${UPLOAD_PREFIX}x/900px-a.jpg`, width: 900, height: 356, mime: 'image/jpeg' });
    // The live API serves thumbnails from thumb.wikimedia.org, at the next standard width (960 px for a 900 px request).
    const live = `${THUMB_PREFIX}wikipedia/commons/thumb/6/6a/Ring_of_Brogar_2000-1.jpg/960px-Ring_of_Brogar_2000-1.jpg?utm_source=commons.wikimedia.org`;
    expect(thumbFromApi(answer(live)).url).toBe(live);
    for (const bad of ['https://example.org/a.jpg', 'http://upload.wikimedia.org/a.jpg', `${UPLOAD_PREFIX.slice(0, -1)}.example.org/a.jpg`, 'file:///etc/passwd']) {
      expect(() => thumbFromApi(answer(bad)), bad).toThrow();
    }
    expect(() => thumbFromApi({})).toThrow();
    expect(() => thumbFromApi({ query: { pages: [{ title: 'File:X.jpg', missing: true }] } })).toThrow(/does not exist/);
    // A download that was redirected away from Wikimedia is refused by the same rule (script.isMediaUrl guards the final URL).
    expect([UPLOAD_PREFIX + 'a.jpg', THUMB_PREFIX + 'a.jpg'].map(script.isMediaUrl)).toEqual([true, true]);
    expect(['https://example.org/a.jpg', `${UPLOAD_PREFIX.slice(0, -1)}.example.org/a.jpg`, '', undefined, 42].map(script.isMediaUrl)).toEqual([false, false, false, false, false]);
  });
  it('falls back to the original file for an image smaller than the thumbnail (no thumburl), on the same host rule', () => {
    const small = { query: { pages: [{ imageinfo: [{ url: `${UPLOAD_PREFIX}wikipedia/commons/a/ab/Small.jpg`, width: 879, height: 891, mime: 'image/jpeg' }] }] } };
    expect(thumbFromApi(small)).toEqual({ url: `${UPLOAD_PREFIX}wikipedia/commons/a/ab/Small.jpg`, width: 879, height: 891, mime: 'image/jpeg' });
  });
  it('re-encodes landscape to 900 px, portrait to 600 px tall, JPEG at the given quality, cropping first only with a box', () => {
    expect(sipsSteps({ id: 'a', orientation: 'landscape', crop: null }, 'raw/a.jpg', 'staged/a.jpg', 70)).toEqual([
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', String(THUMB_WIDTH), 'raw/a.jpg', '--out', 'staged/a.jpg'],
    ]);
    expect(sipsSteps({ id: 'b', orientation: 'portrait', crop: null }, 'raw/b.png', 'staged/b.jpg', 60)[0]).toEqual(
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', '60', '--resampleHeight', String(PORTRAIT_HEIGHT), 'raw/b.png', '--out', 'staged/b.jpg']);
    const crop = sipsSteps({ id: 'c', orientation: 'landscape', crop: { x: 0, y: 28, width: 900, height: 300 } }, 'raw/c.jpg', 'staged/c.jpg', 70);
    expect(crop).toHaveLength(2);
    expect(crop[0]).toEqual(['-s', 'format', 'png', '-c', '300', '900', '--cropOffset', '28', '0', 'raw/c.jpg', '--out', 'staged/c.crop.png']);
    expect(crop[1]!.at(-3)).toBe('staged/c.crop.png');
  });
  it('checks a crop box against the thumbnail size', () => {
    expect(cropFits({ x: 0, y: 28, width: 900, height: 300 }, 900, 356)).toBe(true);
    expect(cropFits({ x: 0, y: 60, width: 900, height: 300 }, 900, 356)).toBe(false);
    expect(cropFits({ x: 0, y: 0, width: 0, height: 10 }, 900, 356), 'an empty box').toBe(false);
  });
  it('a crop box is written for a 900 px wide thumbnail; scaleCrop moves it onto the file that was really downloaded (Commons serves 960 px)', () => {
    const brodgar = { x: 0, y: 28, width: 900, height: 300 };
    expect(scaleCrop(brodgar, 960 / 900, 960, 380)).toEqual({ x: 0, y: 30, width: 960, height: 320 });
    expect(scaleCrop(brodgar, 1, 900, 356)).toEqual(brodgar);
    expect(scaleCrop({ x: 0, y: 28, width: 900, height: 300 }, 1.2, 1080, 330), 'rounding never leaves the image').toEqual({ x: 0, y: 34, width: 1080, height: 296 });
  });
  it('reads the size sips prints, and refuses what is not an image', () => {
    expect(parseSipsSize('/x/a.jpg\n  pixelWidth: 960\n  pixelHeight: 380\n')).toEqual({ width: 960, height: 380 });
    expect(() => parseSipsSize('/x/a.bin\n  pixelWidth: <nil>\n  pixelHeight: <nil>\n')).toThrow(/not an image/);
  });
  it('switches an entry to its §7.1 fallback, resets its check, and the result is a valid manifest entry', () => {
    const fb = useFallback(entry('castlerigg'));
    expect(fb).toMatchObject({
      id: 'castlerigg', card: 'B1', kind: 'photo', licence: 'CC0', licence_url: null, author: 'Yale Center for British Art',
      ops: ['resize', 'crop'], changes: null, crop: null, thumb_url: null, raw_sha256: null, fallback: null, visual_check: null,
      title: "Anonymous - The Druids' Circle, Castlerigg, Keswick - B2018.7.112 - Yale Center for British Art",
    });
    const m = rawCopy();
    m.images = m.images.map((e: any) => (e.id === 'castlerigg' ? fb : e));
    expect(() => parseManifest(m)).not.toThrow();
    const by = useFallback(entry('battersea-shield'));
    expect([by.licence, by.ops, by.changes]).toEqual(['CC BY 3.0', ['resize'], 'resized']);
    expect(() => useFallback(entry('west-stow'))).toThrow(/no .*fallback/i);
    expect(titleOf('Fishbourne Roman Palace, Medusa Mosaic - geograph.org.uk - 8053992.jpg')).toBe('Fishbourne Roman Palace, Medusa Mosaic');
  });
  it('without arguments it stops with a message and exit status 1, and touches no network', () => {
    const r = spawnSync(process.execPath, [FETCH_SCRIPT], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('nothing to do');
    expect(spawnSync(process.execPath, [FETCH_SCRIPT, '--bogus'], { encoding: 'utf8' }).status).toBe(1);
  });
});

// ---- The pipeline against the real macOS sips, on images this test draws itself (nothing is downloaded) ----

const HAS_SIPS = process.platform === 'darwin' && existsSync('/usr/bin/sips');
const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'assets-test-'));
  tempDirs.push(d);
  return d;
};
/** A PNG of the given size: a smooth gradient (compresses well) or deterministic noise (does not). */
function drawPng(width: number, height: number, kind: 'smooth' | 'noise' = 'smooth'): Buffer {
  const png = new PNG({ width, height });
  let seed = 12345;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (kind === 'noise') {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        png.data[i] = seed & 255;
        png.data[i + 1] = (seed >> 8) & 255;
        png.data[i + 2] = (seed >> 16) & 255;
      } else {
        png.data[i] = Math.round((x / width) * 255);
        png.data[i + 1] = Math.round((y / height) * 255);
        png.data[i + 2] = 128;
      }
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
const sizeOf = (path: string) => script.imageSize(path);
/** A PNG that is grey, with a red band on its right edge (x >= 900) and blue bands on its top and bottom 30 rows. */
function drawBanded(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b] = x >= 900 ? [255, 0, 0] : y < 30 || y >= height - 30 ? [0, 0, 255] : [128, 128, 128];
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
/** The RGB of one pixel of a JPEG, read back through sips (converted to PNG first). */
function pixelOf(jpeg: string, x: number, y: number): [number, number, number] {
  const out = `${jpeg}.read.png`;
  execFileSync('/usr/bin/sips', ['-s', 'format', 'png', jpeg, '--out', out], { stdio: 'ignore' });
  const png = PNG.sync.read(readFileSync(out));
  const i = (y * png.width + x) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}
/** What Commons answers for a 900 px request: a thumbnail on thumb.wikimedia.org, with "virtual" 900 px dimensions. */
const apiAnswer = (width: number, height: number) => ({
  query: { pages: [{ imageinfo: [{ thumburl: `${THUMB_PREFIX}wikipedia/commons/thumb/a/ab/X.jpg/960px-X.jpg?utm_source=commons.wikimedia.org`, thumbwidth: width, thumbheight: height, mime: 'image/jpeg' }] }] },
});
function fakeIo(png: Buffer, answer: unknown) {
  const calls: string[] = [];
  return {
    calls,
    io: {
      getJson: async (url: string) => { calls.push(url); return answer; },
      download: async (url: string) => { calls.push(url); return { buf: png, type: 'image/png' }; },
    },
  };
}
const STAMP = { by: 'instructor', at: '2026-10-19T15:00:00-07:00' } as const;
/** <tmp>/assets/manifest.json, assets/raw, assets/staged, src/assets/img and src/assets/svg: the folders main() works on. */
function tempPaths(setUp: (m: ReturnType<typeof uncheckedManifest>) => void = () => {}) {
  const base = tempDir();
  const p = {
    manifest: join(base, 'assets/manifest.json'), raw: join(base, 'assets/raw'), staged: join(base, 'assets/staged'),
    img: join(base, 'src/assets/img'), svg: join(base, 'src/assets/svg'),
  };
  for (const dir of [dirname(p.manifest), p.img, p.svg]) mkdirSync(dir, { recursive: true });
  const m = uncheckedManifest();
  setUp(m);
  writeFileSync(p.manifest, `${JSON.stringify(m, null, 2)}\n`);
  return { ...p, read: () => JSON.parse(readFileSync(p.manifest, 'utf8')) as typeof m };
}
const dirsOf = () => {
  const base = tempDir();
  return { raw: join(base, 'raw'), staged: join(base, 'staged'), img: join(base, 'img') };
};

describe.skipIf(!HAS_SIPS)('stageImage through the real sips (macOS)', () => {
  it('resizes a landscape image to 900 px wide, as a JPEG of at most 160 KB at quality 70', () => {
    const d = dirsOf();
    mkdirSync(d.raw, { recursive: true });
    writeFileSync(join(d.raw, 'a.png'), drawPng(1200, 800));
    const r = script.stageImage({ id: 'a', orientation: 'landscape', crop: null }, join(d.raw, 'a.png'), d.staged);
    expect(sizeOf(r.staged)).toEqual({ width: 900, height: 600 });
    expect(r.quality).toBe(70);
    expect(r.size).toBeLessThanOrEqual(IMAGE_MAX_BYTES);
    expect(readFileSync(r.staged).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));   // a JPEG, not the PNG it came from
    expect(readdirSync(d.staged)).toEqual(['a.jpg']);
  });
  it('caps a portrait image at 600 px tall', () => {
    const d = dirsOf();
    mkdirSync(d.raw, { recursive: true });
    writeFileSync(join(d.raw, 'p.png'), drawPng(500, 1500));
    const r = script.stageImage({ id: 'p', orientation: 'portrait', crop: null }, join(d.raw, 'p.png'), d.staged);
    expect(sizeOf(r.staged)).toEqual({ width: 200, height: 600 });
  });
  it('crops first when the entry has a box (960 x 380 raw, scaled 3:1 box), then resizes to 900 x 300, and leaves no temporary file', () => {
    const d = dirsOf();
    mkdirSync(d.raw, { recursive: true });
    writeFileSync(join(d.raw, 'c.png'), drawPng(960, 380));
    const r = script.stageImage({ id: 'c', orientation: 'landscape', crop: { x: 0, y: 30, width: 960, height: 320 } }, join(d.raw, 'c.png'), d.staged);
    expect(sizeOf(r.staged)).toEqual({ width: 900, height: 300 });
    expect(readdirSync(d.staged)).toEqual(['c.jpg']);
  });
  it('steps the quality down for a detailed image, and refuses (leaving nothing behind) one that is still over 160 KB at quality 50', () => {
    const d = dirsOf();
    mkdirSync(d.raw, { recursive: true });
    writeFileSync(join(d.raw, 'n.png'), drawPng(900, 700, 'noise'));
    expect(() => script.stageImage({ id: 'n', orientation: 'landscape', crop: null }, join(d.raw, 'n.png'), d.staged)).toThrow(/still over 163840 bytes at quality 50/);
    expect(existsSync(d.staged) ? readdirSync(d.staged) : []).toEqual([]);
  });
  it('refuses a file that is not an image', () => {
    const d = dirsOf();
    mkdirSync(d.raw, { recursive: true });
    writeFileSync(join(d.raw, 'x.jpg'), '<html>error page</html>');
    expect(() => script.imageSize(join(d.raw, 'x.jpg'))).toThrow(/not an image/);
  });
});

describe.skipIf(!HAS_SIPS)('fetchEntry with a stubbed Commons (the live API answers 900 px, and serves 960 px)', () => {
  it('records the thumbnail URL and the sha256, measures the file it really got, scales the crop box onto it, and never touches visual_check', async () => {
    const d = dirsOf();
    mkdirSync(d.raw, { recursive: true });
    const png = drawBanded(960, 380);
    const { io, calls } = fakeIo(png, apiAnswer(900, 356));
    const e = fresh('ring-of-brodgar');
    const out = await script.fetchEntry(e, io, d);
    expect(calls).toHaveLength(2);
    // The box {0, 28, 900, 300} was written for a 900 px thumbnail. On the 960 px file it must cover the whole width and the
    // middle 320 rows (scaled to {0, 30, 960, 320}): the red right band and the blue bands are all cut or kept accordingly.
    const [r, g, b] = pixelOf(out.staged, 897, 150);
    expect(r, `right edge is the red band (got ${[r, g, b]})`).toBeGreaterThan(180);
    expect(g).toBeLessThan(90);
    const [tr, , tb] = pixelOf(out.staged, 450, 1);
    expect(tb - tr, `the blue band above row 30 is cut off (got ${[tr, tb]})`).toBeLessThan(40);
    expect(calls[0]).toContain('iiurlwidth=900');
    expect(calls[1]).toContain('/960px-X.jpg');
    expect(e.thumb_url).toContain(THUMB_PREFIX);
    expect(e.raw_sha256).toBe(createHash('sha256').update(png).digest('hex'));
    expect(e.orientation).toBe('landscape');
    expect(e.visual_check).toBeNull();
    expect(e.crop, 'the manifest keeps the box for the 900 px frame').toEqual({ x: 0, y: 28, width: 900, height: 300 });
    expect(sizeOf(out.staged)).toEqual({ width: 900, height: 300 });
    expect(readdirSync(d.raw)).toEqual(['ring-of-brodgar.png']);
  });
  it('orientation comes from the downloaded file, not from the API: a tall shield is portrait, a small near-square original is too', async () => {
    const d = dirsOf();
    mkdirSync(d.raw, { recursive: true });
    const shield = fresh('battersea-shield');
    const a = await script.fetchEntry(shield, fakeIo(drawPng(480, 1048), apiAnswer(900, 1966)).io, d);
    expect(shield.orientation).toBe('portrait');
    expect(sizeOf(a.staged).height).toBe(PORTRAIT_HEIGHT);
    const coins = fresh('hoxne-coins');
    coins.orientation = 'landscape';
    const b = await script.fetchEntry(coins, fakeIo(drawPng(879, 891), apiAnswer(900, 912)).io, d);
    expect(coins.orientation).toBe('portrait');
    expect(sizeOf(b.staged).height).toBe(PORTRAIT_HEIGHT);
    // Even when the API's size says the opposite, the file decides.
    const tall = fresh('stonehenge');
    const c = await script.fetchEntry(tall, fakeIo(drawPng(400, 800), apiAnswer(900, 600)).io, d);
    expect(tall.orientation).toBe('portrait');
    expect(sizeOf(c.staged).height).toBe(PORTRAIT_HEIGHT);
  });
  it('converts a PNG to JPEG when the entry says so (the Blausen melanocyte: CC BY 3.0, "resized, converted to JPEG")', async () => {
    const d = dirsOf();
    mkdirSync(d.raw, { recursive: true });
    const e = fresh('melanocyte');
    const out = await script.fetchEntry(e, fakeIo(drawPng(960, 768), apiAnswer(900, 720)).io, d);
    expect(sizeOf(out.staged)).toEqual({ width: 900, height: 720 });
    expect(readFileSync(out.staged).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(readdirSync(d.raw)).toEqual(['melanocyte.png']);
  });
  it('main --ids records each image in the manifest as soon as it is staged: a later failure keeps what the earlier ones recorded', async () => {
    const p = tempPaths();
    let downloads = 0;
    const network = {
      getJson: async () => apiAnswer(900, 600),
      download: async () => {
        downloads += 1;
        if (downloads === 2) throw new Error('HTTP 503 from the second download');
        return { buf: drawPng(960, 640), type: 'image/png' };
      },
    };
    const log: string[] = [];
    await expect(script.main(['--ids', 'avebury,stonehenge', '--clean'], { paths: p, network, log: (l) => log.push(l) })).rejects.toThrow(/HTTP 503/);
    const m = p.read();
    expect(entryIn(m, 'avebury').raw_sha256, 'the first image was recorded').toMatch(/^[0-9a-f]{64}$/);
    expect(entryIn(m, 'avebury').thumb_url).toContain(THUMB_PREFIX);
    expect(entryIn(m, 'stonehenge').raw_sha256, 'the second never was').toBeNull();
    expect(entryIn(m, 'avebury').visual_check, 'and no check is ever written').toBeNull();
    expect(readdirSync(p.staged)).toEqual(['avebury.jpg']);
    expect(log[0]).toMatch(/^fetch-assets: avebury: 960x640 image\/png -> assets\/staged\/avebury\.jpg \(\d+ KB, quality 70, landscape\)$/);
  });
  it('stops when the file on Commons changed after the instructor checked it, and records nothing', async () => {
    const d = dirsOf();
    mkdirSync(d.raw, { recursive: true });
    const e = fresh('avebury');
    e.visual_check = { by: 'instructor', at: '2026-10-19T15:00:00-07:00' };
    e.raw_sha256 = 'a'.repeat(64);
    await expect(script.fetchEntry(e, fakeIo(drawPng(960, 715), apiAnswer(900, 670)).io, d)).rejects.toThrow(/changed since the instructor checked it/);
    expect(e.thumb_url).toBeNull();
    expect(e.raw_sha256).toBe('a'.repeat(64));
    expect(readdirSync(d.raw)).toEqual([]);
    expect(e.visual_check).not.toBeNull();
  });
  it('refuses a crop box that does not fit the thumbnail, and an own drawing', async () => {
    const d = dirsOf();
    mkdirSync(d.raw, { recursive: true });
    const e = fresh('ring-of-brodgar');
    e.crop = { x: 0, y: 100, width: 900, height: 300 };
    await expect(script.fetchEntry(e, fakeIo(drawPng(960, 380), apiAnswer(900, 356)).io, d)).rejects.toThrow(/does not fit/);
    await expect(script.fetchEntry(fresh('irises'), fakeIo(drawPng(10, 10), apiAnswer(10, 10)).io, d)).rejects.toThrow(/own drawing/);
  });
});

describe('an entry edited by hand cannot be staged (spec §7.1: CC BY-SA resized only, a crop box needs the crop op)', () => {
  const box = { x: 0, y: 0, width: 900, height: 300 };
  const can = (over: Partial<ImageEntry>): void => script.assertProcessable({ ...fresh('stonehenge'), ...over });
  it('assertProcessable allows what the manifest validator allows and refuses the rest', () => {
    expect(() => can({})).not.toThrow();
    expect(() => can({ ops: ['resize', 'crop'], crop: box }), 'a CC0 crop').not.toThrow();
    expect(() => can({ licence: 'CC BY-SA 4.0', ops: ['resize'] }), 'a CC BY-SA resize').not.toThrow();
    expect(() => can({ ops: ['resize'], crop: box })).toThrow(/crop box but ops does not allow cropping/);
    expect(() => can({ ops: [], crop: box })).toThrow(/does not allow cropping/);
    expect(() => can({ licence: 'CC BY-SA 4.0', ops: ['resize', 'crop'] })).toThrow(/CC BY-SA images are resized only/);
    expect(() => can({ licence: 'CC BY-SA 2.0', ops: ['resize', 'crop'], crop: box })).toThrow(/CC BY-SA images are resized only/);
    expect(() => can({ licence: 'CC BY-SA 3.0', ops: ['resize', 'convert'] })).toThrow(/never cropped, overlaid, annotated or converted/);
    expect(() => can({ licence: 'CC BY-SA 3.0', ops: [] })).toThrow(/resized only/);
    expect(() => can({ licence: 'CC BY-SA 3.0', ops: ['crop'] })).toThrow(/resized only/);
  });
  it('fetchEntry refuses a hand-edited CC BY-SA entry with a crop box before it asks Commons for anything', async () => {
    const d = dirsOf();
    mkdirSync(d.raw, { recursive: true });
    const e = fresh('castlerigg');
    e.ops = ['resize', 'crop'];
    e.crop = box;
    const f = fakeIo(drawPng(10, 10), apiAnswer(900, 600));
    await expect(script.fetchEntry(e, f.io, d)).rejects.toThrow(/CC BY-SA images are resized only/);
    expect(f.calls, 'no API call and no download').toEqual([]);
    expect(readdirSync(d.raw)).toEqual([]);
  });
  it('fetchEntry refuses a crop box on an entry whose ops do not include crop', async () => {
    const d = dirsOf();
    mkdirSync(d.raw, { recursive: true });
    const e = fresh('battersea-shield');
    e.crop = box;
    const f = fakeIo(drawPng(10, 10), apiAnswer(900, 600));
    await expect(script.fetchEntry(e, f.io, d)).rejects.toThrow(/crop box but ops does not allow cropping/);
    expect(f.calls).toEqual([]);
  });
  it('fetchEntry refuses a PNG for a CC BY entry that does not say "convert", and any PNG for a CC BY-SA entry; nothing is written', async () => {
    const d = dirsOf();
    mkdirSync(d.raw, { recursive: true });
    for (const id of ['shrewton-beaker', 'castlerigg'] as const) {
      const f = fakeIo(drawPng(10, 10), apiAnswer(900, 600));      // fakeIo answers with a PNG
      await expect(script.fetchEntry(fresh(id), f.io, d), id).rejects.toThrow(/Commons sent a PNG, which is converted to JPEG, but ops does not say "convert"/);
    }
    expect(readdirSync(d.raw)).toEqual([]);
  });
});

describe('rejecting an image leaves nothing stale behind (removePromoted, --use-fallback)', () => {
  it('removePromoted deletes <id>.jpg and only that, and says whether it deleted anything', () => {
    const p = tempPaths();
    for (const f of ['castlerigg.jpg', 'avebury.jpg', 'castlerigg.jpg.bak']) writeFileSync(join(p.img, f), 'x');
    expect(script.removePromoted(p.img, 'castlerigg')).toBe(true);
    expect(readdirSync(p.img).sort()).toEqual(['avebury.jpg', 'castlerigg.jpg.bak']);
    expect(script.removePromoted(p.img, 'castlerigg')).toBe(false);
    expect(script.removePromoted(join(p.img, 'no-such-folder'), 'castlerigg')).toBe(false);
  });
  it('--use-fallback switches the entry, resets its check and its fetch records, and deletes the promoted file of the image that was rejected', async () => {
    const p = tempPaths((m) => {
      entryIn(m, 'castlerigg').visual_check = { ...STAMP };
      entryIn(m, 'castlerigg').raw_sha256 = 'b'.repeat(64);
      entryIn(m, 'avebury').visual_check = { ...STAMP };
    });
    for (const id of ['castlerigg', 'avebury']) writeFileSync(join(p.img, `${id}.jpg`), `promoted ${id}`);
    const log: string[] = [];
    await script.main(['--use-fallback', 'castlerigg'], { paths: p, log: (l) => log.push(l) });
    const after = p.read();
    expect(entryIn(after, 'castlerigg')).toMatchObject({
      licence: 'CC0', author: 'Yale Center for British Art', visual_check: null, thumb_url: null, raw_sha256: null, fallback: null,
    });
    expect(entryIn(after, 'avebury').visual_check, 'another image keeps its check').not.toBeNull();
    expect(existsSync(join(p.img, 'castlerigg.jpg')), 'the rejected image is no longer bundled').toBe(false);
    expect(existsSync(join(p.img, 'avebury.jpg'))).toBe(true);
    expect(log.join('\n')).toContain('castlerigg now uses its fallback');
    expect(log.join('\n')).toContain('deleted the old promoted file src/assets/img/castlerigg.jpg');
    expect(() => parseManifest(after)).not.toThrow();
  });
  it('--use-fallback on an image with no fallback is refused, and deletes nothing', async () => {
    const p = tempPaths((m) => {
      entryIn(m, 'west-stow').visual_check = { ...STAMP };
    });
    writeFileSync(join(p.img, 'west-stow.jpg'), 'promoted');
    const before = readFileSync(p.manifest, 'utf8');
    await expect(script.main(['--use-fallback', 'west-stow'], { paths: p, log: () => {} })).rejects.toThrow(/no .*fallback/i);
    expect(readFileSync(p.manifest, 'utf8')).toBe(before);
    expect(existsSync(join(p.img, 'west-stow.jpg'))).toBe(true);
    await expect(script.main(['--use-fallback', 'no-such-image'], { paths: p, log: () => {} })).rejects.toThrow(/unknown image id/);
  });
  it('switching an own drawing to its photo fallback warns that the drawing is still there, and does not delete it', async () => {
    const p = tempPaths();
    writeFileSync(join(p.svg, 'thornborough-plan.svg'), '<svg/>');
    const log: string[] = [];
    await script.main(['--use-fallback', 'thornborough-plan'], { paths: p, log: (l) => log.push(l) });
    expect(entryIn(p.read(), 'thornborough-plan').kind).toBe('photo');
    expect(existsSync(join(p.svg, 'thornborough-plan.svg'))).toBe(true);
    expect(log.join('\n')).toContain('WARNING: src/assets/svg/thornborough-plan.svg is still there');
  });
  it('--promote copies the checked photos and says so (the command-line path), and a stale file is not among them', async () => {
    const p = tempPaths((m) => {
      entryIn(m, 'avebury').visual_check = { ...STAMP };
    });
    mkdirSync(p.staged, { recursive: true });
    writeFileSync(join(p.staged, 'avebury.jpg'), 'jpeg');
    writeFileSync(join(p.staged, 'stonehenge.jpg'), 'jpeg');
    const log: string[] = [];
    await script.main(['--promote'], { paths: p, log: (l) => log.push(l) });
    expect(readdirSync(p.img)).toEqual(['avebury.jpg']);
    expect(log.at(-1)).toBe('promote-assets: 1 checked image(s) promoted. Unchecked images stay in assets/staged/.');
  });
});

describe('fresh download folder and promote (no sips needed)', () => {
  it('creates raw/ empty for every run, and refuses a non-empty one unless it was asked to clean it', () => {
    const d = dirsOf();
    script.freshRawDir(d, false);
    expect(readdirSync(d.raw)).toEqual([]);
    writeFileSync(join(d.raw, 'old.jpg'), 'x');
    expect(() => script.freshRawDir(d, false)).toThrow(/not empty/);
    expect(readdirSync(d.raw)).toEqual(['old.jpg']);
    script.freshRawDir(d, true);
    expect(readdirSync(d.raw)).toEqual([]);
  });
  it('promotes only the images the instructor has checked, and says so; an unchecked image stays in staged/', () => {
    const d = dirsOf();
    mkdirSync(d.staged, { recursive: true });
    for (const id of ['stonehenge', 'avebury']) writeFileSync(join(d.staged, `${id}.jpg`), `jpeg of ${id}`);
    const m = uncheckedManifest();
    entryIn(m, 'stonehenge').visual_check = { by: 'instructor', at: '2026-10-19T15:00:00-07:00' };
    expect(script.promote(m, d)).toEqual(['stonehenge']);
    expect(readdirSync(d.img)).toEqual(['stonehenge.jpg']);
    expect(readFileSync(join(d.img, 'stonehenge.jpg'), 'utf8')).toBe('jpeg of stonehenge');
  });
  it('promotes nothing for an own drawing, refuses a checked image with no staged file, and refuses a file over 160 KB', () => {
    const d = dirsOf();
    mkdirSync(d.staged, { recursive: true });
    const m = uncheckedManifest();
    entryIn(m, 'thornborough-plan').visual_check = { by: 'instructor', at: '2026-10-19T15:00:00-07:00' };
    expect(script.promote(m, d)).toEqual([]);
    entryIn(m, 'avebury').visual_check = { by: 'instructor', at: '2026-10-19T15:00:00-07:00' };
    expect(() => script.promote(m, d)).toThrow(/avebury is checked but assets\/staged\/avebury\.jpg is missing/);
    writeFileSync(join(d.staged, 'avebury.jpg'), Buffer.alloc(IMAGE_MAX_BYTES + 1));
    expect(() => script.promote(m, d)).toThrow(/over the 163840-byte limit/);
    expect(existsSync(join(d.img, 'avebury.jpg'))).toBe(false);
  });
  it('keeps a promoted file when the staged copy is gone, but never fills visual_check itself', () => {
    const d = dirsOf();
    mkdirSync(d.staged, { recursive: true });
    mkdirSync(d.img, { recursive: true });
    writeFileSync(join(d.img, 'avebury.jpg'), 'already promoted');
    const m = uncheckedManifest();
    entryIn(m, 'avebury').visual_check = { by: 'instructor', at: '2026-10-19T15:00:00-07:00' };
    const before = JSON.stringify(m);
    expect(script.promote(m, d)).toEqual([]);
    expect(JSON.stringify(m), 'promote reads the manifest and changes nothing in it').toBe(before);
  });
});

function entryIn(m: typeof ASSET_MANIFEST, id: ImageId): ImageEntry {
  return m.images.find((e) => e.id === id)!;
}
