// npm run check-release (spec §7.2): run at the code freeze and before every export. Exits 1 when any card whose flag is on
// would show an image or map that the instructor has not checked, or an image whose file is not bundled.
// Built with `vite build --ssr` (like the run-sheet CLI) so src/assets.ts can list the inlined files. The decision itself is
// checkRelease() in src/release.ts, which tests/release.test.ts covers.
import { FEATURES } from '../src/features';
import { ASSET_MANIFEST } from '../src/assetManifest';
import { BUNDLED_IMAGE_IDS } from '../src/assets';
import { checkRelease } from '../src/release';

const report = checkRelease(FEATURES, ASSET_MANIFEST, BUNDLED_IMAGE_IDS);
for (const line of report.stdout) console.log(line);
for (const line of report.stderr) console.error(line);
if (!report.ok) process.exit(1);
