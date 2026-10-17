// The imports from ./src carry explicit .ts extensions: Vite's config loader asks for them (see src/assetManifest.ts).
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vitest/config';
import { ASSET_MANIFEST, type AssetManifest } from './src/assetManifest.ts';
import { FEATURES, type Features } from './src/features.ts';
import { uncheckedAssets } from './src/release.ts';

const REAL_DATA = fileURLToPath(new URL('./src/data/workshop_data.json', import.meta.url));
const FIXTURE_DATA = fileURLToPath(new URL('./tests/fixtures/data.fixture.json', import.meta.url));
const IMG_DIR = fileURLToPath(new URL('./src/assets/img/', import.meta.url));
const SVG_DIR = fileURLToPath(new URL('./src/assets/svg/', import.meta.url));

function baseNames(dir: string, ext: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)) : [];
}

/** The image files the build will inline: the ids of src/assets/img/*.jpg and src/assets/svg/*.svg. */
function filesOnDisk(): ReadonlySet<string> {
  return new Set([...baseNames(IMG_DIR, '.jpg'), ...baseNames(SVG_DIR, '.svg')]);
}

/**
 * Spec §7.2: `npm run build` never fails on an unchecked image or map. It prints one warning per affected card (that card
 * shows its text form). `npm run check-release` is the gate that fails. The arguments are for tests; a build uses the
 * shipped flags, the committed manifest and the files on disk.
 */
export function releaseWarnings(
  features: Features = FEATURES, manifest: AssetManifest = ASSET_MANIFEST, bundled: () => ReadonlySet<string> = filesOnDisk,
): Plugin {
  return {
    name: 'release-warnings',
    apply: 'build',
    buildStart() {
      for (const line of uncheckedAssets(features, manifest, bundled())) {
        console.warn(`[release-warnings] ${line}. That card shows its text form until this is fixed.`);
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const useFixture = mode === 'test' || mode === 'fixture';
  if (command === 'build' && !useFixture && !existsSync(REAL_DATA)) {
    throw new Error('src/data/workshop_data.json is missing. Run `npm run sync-data` after the data build (Rscript build.R).');
  }
  return {
    base: './',
    plugins: [viteSingleFile(), releaseWarnings()],
    resolve: { alias: { '@workshop-data': useFixture ? FIXTURE_DATA : REAL_DATA } },
    build: {
      // Anything built from the fixture data (modes 'test' and 'fixture') can never overwrite the real dist/
      // that gets deployed or copied to Drive.
      outDir: useFixture ? 'dist-fixture' : 'dist',
      // The page makes no network requests. The module-preload helper is not needed for one inline script,
      // and its polyfill calls fetch().
      modulePreload: false,
    },
    test: {
      environment: 'jsdom',
      include: ['tests/**/*.test.ts'],
    },
  };
});
