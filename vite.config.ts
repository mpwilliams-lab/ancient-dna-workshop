import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vitest/config';

const REAL_DATA = fileURLToPath(new URL('./src/data/workshop_data.json', import.meta.url));
const FIXTURE_DATA = fileURLToPath(new URL('./tests/fixtures/data.fixture.json', import.meta.url));

export default defineConfig(({ command, mode }) => {
  const useFixture = mode === 'test' || mode === 'fixture';
  if (command === 'build' && !useFixture && !existsSync(REAL_DATA)) {
    throw new Error('src/data/workshop_data.json is missing. Run `npm run sync-data` after the data build (Rscript build.R).');
  }
  return {
    base: './',
    plugins: [viteSingleFile()],
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
