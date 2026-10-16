import { existsSync } from 'node:fs';
import { defineConfig, devices, type Project } from '@playwright/test';

// Microsoft Edge is the lab browser, and spec §8 requires the `msedge` project. Playwright drives
// the installed Edge through the `msedge` channel. Without Edge the local suite refuses to run,
// unless E2E_CHROMIUM_ONLY=1 is set, which needs Matthew's recorded approval (Task 14 Step 3).
const EDGE_EXECUTABLES: Record<string, string[]> = {
  darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  win32: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  linux: ['/opt/microsoft/msedge/msedge'],
};
const hasEdge = (EDGE_EXECUTABLES[process.platform] ?? []).some((p) => existsSync(p));
const chromiumOnly = process.env.E2E_CHROMIUM_ONLY === '1';
if (!process.env.LIVE && !hasEdge) {
  if (!chromiumOnly) {
    throw new Error('[playwright] Microsoft Edge is not installed, and spec §8 requires the msedge project. Install it with `npx playwright install msedge`. Set E2E_CHROMIUM_ONLY=1 only with Matthew\'s recorded approval (Task 14 Step 3).');
  }
  console.warn('[playwright] E2E_CHROMIUM_ONLY=1: Microsoft Edge is not installed, so the msedge project is skipped (Chromium-only run approved by Matthew, Task 14 Step 3).');
}

const local: Project[] = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /live\.spec\.ts/ },
];
if (hasEdge) {
  local.push({
    name: 'msedge',
    use: {
      ...devices['Desktop Edge'],
      channel: 'msedge',
      // Measured on the dev Mac (Edge 155, Playwright 1.63.0) inside the agent sandbox, which denies Edge its own
      // "~/Library/Application Support/Microsoft Edge": with Edge's separate GPU process the page gets no animation
      // frames, headed or headless. requestAnimationFrame never fires, so page.screenshot(), the click stability
      // check and rAF polling all hang. With the GPU inside the browser process it gives about 36 frames a second
      // and everything works. The flag changes where the compositor runs, not layout or script behaviour.
      launchOptions: { args: ['--in-process-gpu'] },
    },
    testIgnore: /live\.spec\.ts/,
  });
}
const live: Project[] = process.env.LIVE
  ? [{ name: 'live', use: { ...devices['Desktop Chrome'] }, testMatch: /live\.spec\.ts/ }]
  : [];

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: process.env.LIVE ? live : local,
});
