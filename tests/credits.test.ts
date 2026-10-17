// @vitest-environment jsdom
// Spec §5.2 credits panel, §7.2 CREDITS.md and attribution; CONTRACT §4.14. Also the content-rule scan of every credits string
// (decision 4: manifest strings are scanned here, not through allRenderableStrings()).
// D-L5 (carry-forward): the panel lists EVERY image and map that is in the build, whatever the flags say and whether or not the
// card is on screen. "In the build" means: an image whose file is bundled (src/assets/img, src/assets/svg), and a map that the
// instructor has checked (it is drawn by the build; its manifest slot is filled).
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSET_MANIFEST, MAP_IDS, attributionString } from '../src/assetManifest';
import { CARDS } from '../src/cards';
import { CREDITS_CLOSE, CREDITS_FOOTER, CREDITS_LINK, CREDITS_TITLE, MAP_SOURCE_SUFFIX } from '../src/content';
import { BUNDLED_IMAGES } from '../src/assets';
import { creditsGroups } from '../src/credits';
import { ALL_OFF } from '../src/features';
import { boot, type BootEnv } from '../src/shell';
import { CARD_IDS } from '../src/types';
import { ruleViolations } from './contentRules';
import { checkedManifest, fakeUrls, onlyChecked, uncheckedManifest } from './helpers/assetEnv';
import { FIXTURE, MemStore, loadIndexHtml } from './helpers/shellEnv';

const MAKE_CREDITS = resolve(__dirname, '../scripts/make-credits.mjs');
const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const prompt = (): HTMLInputElement => document.querySelector<HTMLInputElement>('#terminal input')!;
const esc = (target: Element): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
};
function bootApp(over: Partial<BootEnv> = {}) {
  loadIndexHtml();
  return boot({
    doc: document, href: 'file:///C:/Users/lab/Desktop/ancient-dna-workshop.html',
    getStorage: () => new MemStore() as unknown as Storage, replaceUrl: () => {}, data: FIXTURE, ...over,
  });
}
const sectionLines = (card: string): string[] =>
  [...document.querySelectorAll(`#credits-list section[data-card="${card}"] p`)].map((p) => p.textContent ?? '');

afterEach(() => {
  vi.useRealTimers();
});

describe('creditsGroups (D-L5: every image and map in the build)', () => {
  it('lists nothing while no image is bundled and no map is checked', () => {
    expect(creditsGroups(uncheckedManifest(), {})).toEqual([]);
  });
  it('reads the committed manifest and the bundled files unless it is given others', () => {
    expect(creditsGroups()).toEqual(creditsGroups(ASSET_MANIFEST, BUNDLED_IMAGES));
  });
  it('lists every bundled image, grouped by card in card order: the attribution string, then the Commons file page as plain text', () => {
    const groups = creditsGroups(uncheckedManifest(), fakeUrls());
    expect(groups.map((g) => g.cardId)).toEqual(['B1', 'C1', 'E2', 'F1', 'G2', 'H1', 'I1', 'J1']);
    expect(groups.map((g) => g.title)).toEqual(groups.map((g) => CARDS[g.cardId].title));
    expect(groups.find((g) => g.cardId === 'C1')).toEqual({
      cardId: 'C1',
      title: CARDS.C1.title,
      lines: [
        'Photo: Pasicles (CC0), via Wikimedia Commons',
        'https://commons.wikimedia.org/wiki/File:Amesbury_Archer_-_Salisbury_and_South_Wiltshire_Museum.jpg',
        'Photo: Poliphilo (CC0), via Wikimedia Commons',
        'https://commons.wikimedia.org/wiki/File:Round_barrow,_Overton_Hill.JPG',
        '"Shrewton Beaker Burial" by TobyEditor, CC BY 4.0 (creativecommons.org/licenses/by/4.0), via Wikimedia Commons; resized',
        'https://commons.wikimedia.org/wiki/File:Shrewton_Beaker_Burial.jpg',
      ],
    });
    const total = groups.flatMap((g) => g.lines).filter((l) => l.startsWith('https://')).length;
    expect(total, 'one file page per photo, none for the two own drawings').toBe(19);
  });
  it('does not look at flags or checks: an unchecked image of a card that is off is credited as soon as its file is in the build', () => {
    expect(creditsGroups(uncheckedManifest(), { stonehenge: 'data:image/jpeg;base64,x' })).toEqual([{
      cardId: 'B1', title: CARDS.B1.title,
      lines: ['Photo: Gary Todd (CC0), via Wikimedia Commons', 'https://commons.wikimedia.org/wiki/File:Stonehenge_(9816864014).jpg'],
    }]);
    expect(creditsGroups(onlyChecked([], ['stonehenge']), { stonehenge: 'data:image/jpeg;base64,x' })[0]!.lines, 'checked or not, the same lines').toHaveLength(2);
  });
  it('an image that is not bundled is not in the build, so it is not credited, however well it is checked', () => {
    const groups = creditsGroups(checkedManifest(), fakeUrls(['shrewton-beaker', 'cow']));
    const all = groups.flatMap((g) => g.lines).join('\n');
    expect(all).not.toContain('Shrewton');
    expect(all).not.toContain('Keith Weller');
    expect(all).toContain('Couleur');
  });
  it('an own drawing has its attribution line and no URL', () => {
    const b1 = creditsGroups(uncheckedManifest(), fakeUrls()).find((g) => g.cardId === 'B1')!;
    expect(b1.lines).toContain('Plan drawn for this workshop');
    expect(b1.lines.filter((l) => l.startsWith('https://'))).toHaveLength(4);
    expect(creditsGroups(uncheckedManifest(), fakeUrls()).find((g) => g.cardId === 'J1')!.lines).toEqual(['Drawn for this workshop']);
  });
  it('lists each map the instructor has checked, once, as the Natural Earth line under its card; the F1 inset under F1', () => {
    expect(creditsGroups(onlyChecked(['D1', 'H2', 'F1inset']), {})).toEqual([
      { cardId: 'D1', title: CARDS.D1.title, lines: [MAP_SOURCE_SUFFIX] },
      { cardId: 'F1', title: CARDS.F1.title, lines: [MAP_SOURCE_SUFFIX] },
      { cardId: 'H2', title: CARDS.H2.title, lines: [MAP_SOURCE_SUFFIX] },
    ]);
    expect(creditsGroups(onlyChecked(['D1']), {}).flatMap((g) => g.lines), 'a map that is not checked is not credited').toEqual([MAP_SOURCE_SUFFIX]);
    const f1 = creditsGroups(onlyChecked(['F1inset']), fakeUrls()).find((g) => g.cardId === 'F1')!;
    expect(f1.lines.at(-1), 'a card with photos and a map: photos first, the map line last').toBe(MAP_SOURCE_SUFFIX);
    expect(f1.lines).toHaveLength(7);
  });
  it('with everything bundled and checked it lists every card that has an image or a map, and every manifest image once', () => {
    const groups = creditsGroups(checkedManifest(), fakeUrls());
    const cardsWithAssets = CARD_IDS.filter((id) => ASSET_MANIFEST.images.some((e) => e.card === id) || MAP_IDS.some((m) => (m === 'F1inset' ? 'F1' : m) === id));
    expect(groups.map((g) => g.cardId)).toEqual(cardsWithAssets);
    const lines = groups.flatMap((g) => g.lines);
    // (Two CC0 photos by one author share an attribution string: the file page tells them apart, so the pair is what is unique.)
    for (const e of ASSET_MANIFEST.images) {
      const at = e.file_page === null ? lines.indexOf(attributionString(e)) : lines.indexOf(e.file_page) - 1;
      expect(lines.filter((l) => l === (e.file_page ?? attributionString(e))), e.id).toHaveLength(1);
      expect(lines[at], e.id).toBe(attributionString(e));
    }
  });
  it('every credits string passes the content rules (spec §9 rule scan, extended to credits)', () => {
    const all = [
      ...ASSET_MANIFEST.images.map(attributionString),
      ...ASSET_MANIFEST.images.flatMap((e) => (e.file_page ? [e.file_page] : [])),
      ...creditsGroups(checkedManifest(), fakeUrls()).flatMap((g) => [g.title, ...g.lines]),
      CREDITS_TITLE, CREDITS_LINK, CREDITS_CLOSE, CREDITS_FOOTER,
    ];
    expect(all.filter((s) => ruleViolations(s).length > 0)).toEqual([]);
  });
});

describe('credits panel (spec §5.2)', () => {
  it('index.html has the dialog and the wrap-screen button', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    for (const id of ['credits', 'credits-title', 'credits-list', 'credits-footer', 'credits-close', 'wrap-credits']) expect(html).toContain(`id="${id}"`);
    expect(html).toMatch(/<div id="credits" hidden role="dialog" aria-modal="true" aria-labelledby="credits-title">/);
  });
  it('opens from the wrap screen with plain-text credits, focuses Close, and Esc closes it but leaves the wrap screen open', () => {
    bootApp();
    byId('wrap-open').click();
    expect(byId('wrap-credits').textContent).toBe(CREDITS_LINK);
    byId('wrap-credits').click();
    const panel = byId('credits');
    expect(panel.hidden).toBe(false);
    expect(byId('credits-title').textContent).toBe(CREDITS_TITLE);
    expect(byId('credits-close').textContent).toBe(CREDITS_CLOSE);
    expect(byId('credits-footer').textContent).toBe(CREDITS_FOOTER);
    expect(document.activeElement).toBe(byId('credits-close'));
    expect(panel.querySelectorAll('a')).toHaveLength(0);
    esc(document.activeElement!);
    expect(panel.hidden).toBe(true);
    expect(byId('wrap').hidden).toBe(false);
    expect(document.activeElement).toBe(byId('wrap-close'));
  });
  it('shows every bundled image and checked map with its attribution, whatever the flags: plain text, no link anywhere', () => {
    bootApp({ features: ALL_OFF, assets: { manifest: checkedManifest(), urls: fakeUrls() } });
    byId('wrap-open').click();
    byId('wrap-credits').click();
    const expected = creditsGroups(checkedManifest(), fakeUrls());
    const sections = [...document.querySelectorAll('#credits-list section')];
    expect(sections.map((s) => s.getAttribute('data-card'))).toEqual(expected.map((g) => g.cardId));
    expect(sections.map((s) => s.querySelector('h3')!.textContent)).toEqual(expected.map((g) => g.title));
    for (const g of expected) expect(sectionLines(g.cardId), g.cardId).toEqual(g.lines);
    expect(byId('credits').querySelectorAll('a, [href], [src]')).toHaveLength(0);
    expect([...document.querySelectorAll('#credits-list .credits-url')].every((p) => (p.textContent ?? '').startsWith('https://'))).toBe(true);
    expect(document.querySelectorAll('#credits-list .credits-url')).toHaveLength(19);
    // Closing and opening again rebuilds the list (no duplicate sections).
    byId('credits-close').click();
    byId('wrap-credits').click();
    expect(document.querySelectorAll('#credits-list section')).toHaveLength(expected.length);
  });
  it('is empty of images while no image is bundled: the title, the data credits footer and Close', () => {
    bootApp({ assets: { manifest: uncheckedManifest(), urls: {} } });
    byId('wrap-open').click();
    byId('wrap-credits').click();
    expect(document.querySelectorAll('#credits-list section')).toHaveLength(0);
    expect(byId('credits-footer').textContent).toBe(CREDITS_FOOTER);
  });
  it('Esc on the panel closes only the panel: an open card stays open and the prompt gets focus back', () => {
    const app = bootApp();
    app.controller.openCardForTest('B1');
    expect(app.controller.cardOpen).toBe('B1');
    byId('wrap-credits').click();
    esc(document.activeElement!);
    expect(byId('credits').hidden).toBe(true);
    expect(app.controller.cardOpen).toBe('B1');
    expect(document.activeElement).toBe(prompt());
  });
  it('Close returns focus to the prompt', () => {
    bootApp();
    byId('wrap-credits').click();
    byId('credits-close').click();
    expect(byId('credits').hidden).toBe(true);
    expect(document.activeElement).toBe(prompt());
  });
  it('a click elsewhere does not take focus from the open panel (like the wrap screen)', () => {
    bootApp();
    byId('wrap-credits').click();
    expect(document.activeElement).toBe(byId('credits-close'));
    for (const target of [byId('credits'), document.querySelector('.credits-card')!, byId('credits-title'), byId('plot'), byId('bar'), document.body]) {
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      expect(document.activeElement, `after a click on ${target.id || target.className || target.tagName}`).toBe(byId('credits-close'));
    }
  });
  it('is a dialog the document reaches through Esc in the capture phase: nothing else sees the key while it is open', () => {
    bootApp();
    byId('wrap-credits').click();
    const seen = vi.fn();
    prompt().addEventListener('keydown', seen);
    document.addEventListener('keydown', seen);   // bubbling phase
    esc(prompt());                                // focus moved out of the panel (Shift+Tab): the prompt receives Esc
    expect(byId('credits').hidden).toBe(true);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('CREDITS.md (spec §7.2)', () => {
  it('is up to date with assets/manifest.json (run npm run credits)', () => {
    const r = spawnSync(process.execPath, [MAKE_CREDITS, '--check'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  });
  it('the script uses the same attribution strings and footer as the app', () => {
    const r = spawnSync(process.execPath, [MAKE_CREDITS, '--print'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { footer: string; attributions: Record<string, string> };
    expect(out.footer).toBe(CREDITS_FOOTER);
    for (const e of ASSET_MANIFEST.images) expect(out.attributions[e.id], e.id).toBe(attributionString(e));
  });
  it('says the code licence does not cover the images', () => {
    expect(readFileSync(resolve(__dirname, '../CREDITS.md'), 'utf8')).toContain('does not cover the images');
  });
  it('says the photos are shown whole and what "cropped and resized" means', () => {
    const text = readFileSync(resolve(__dirname, '../CREDITS.md'), 'utf8');
    expect(text).toContain('Photos are shown whole in the app.');
    expect(text).toContain('"cropped and resized" names a photo that was cropped before it was resized; every other photo was only resized.');
  });
  it('the Changes line says "cropped and resized" only where a crop box is applied, "resized" for every other photo, "none" for a drawing (Task 21)', () => {
    // The real script in a throw-away repository: it reads assets/manifest.json and the files bundled under src/assets/.
    const root = mkdtempSync(join(tmpdir(), 'credits-'));
    try {
      for (const dir of ['scripts', 'assets', 'src/assets/img', 'src/assets/svg']) mkdirSync(join(root, dir), { recursive: true });
      copyFileSync(MAKE_CREDITS, join(root, 'scripts/make-credits.mjs'));
      const manifest = JSON.parse(readFileSync(resolve(__dirname, '../assets/manifest.json'), 'utf8'));
      const round = manifest.images.find((e: { id: string }) => e.id === 'roundhouse');
      round.crop = { x: 0, y: 0, width: 600, height: 400 };   // a CC BY photo that really is cropped
      round.changes = 'cropped and resized';
      writeFileSync(join(root, 'assets/manifest.json'), JSON.stringify(manifest));
      for (const id of ['ring-of-brodgar', 'stonehenge', 'roundhouse', 'castlerigg', 'melanocyte']) writeFileSync(join(root, 'src/assets/img', `${id}.jpg`), 'x');
      writeFileSync(join(root, 'src/assets/svg/thornborough-plan.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
      const r = spawnSync(process.execPath, [join(root, 'scripts/make-credits.mjs')], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      expect(spawnSync(process.execPath, [join(root, 'scripts/make-credits.mjs'), '--check'], { encoding: 'utf8' }).status).toBe(0);
      // credit line -> its "Changes:" line
      const changes: Record<string, string> = {};
      let credit = '';
      for (const line of readFileSync(join(root, 'CREDITS.md'), 'utf8').split('\n')) {
        if (line.startsWith('- ')) credit = line.slice(2);
        else if (line.startsWith('  - Changes: ')) changes[credit] = line.slice('  - Changes: '.length);
      }
      const of = (needle: string): string | undefined => Object.entries(changes).find(([c]) => c.includes(needle))?.[1];
      expect(of('Libasstref'), 'the Ring of Brodgar (CC0), pixel-cropped to 3:1').toBe('cropped and resized');
      expect(of('Gary Todd'), 'Stonehenge (CC0): cropping allowed, no box').toBe('resized');
      expect(of('Tim Sheerman-Chase'), 'the roundhouse with a box in this copy (CC BY)').toBe('cropped and resized');
      expect(of('Mike Peel'), 'Castlerigg (CC BY-SA)').toBe('resized');
      expect(of('BruceBlaus'), 'the melanocyte (CC BY, PNG converted)').toBe('resized, converted to JPEG');
      expect(of('Plan drawn for this workshop'), 'an own drawing').toBe('none');
      expect(Object.keys(changes)).toHaveLength(6);
      expect(readFileSync(join(root, 'CREDITS.md'), 'utf8')).not.toContain('may be shown cropped');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
