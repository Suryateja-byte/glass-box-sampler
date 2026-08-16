import { defineConfig } from '@playwright/test';

/**
 * No retries and a single worker, deliberately.
 *
 * Retries turn "fails sometimes" into "passes", which is precisely the kind of
 * laundering that makes an evidence bundle worthless. Parallel workers would
 * add scheduling noise to a frame-time measurement. Both are traded away for
 * results that mean what they say.
 */
export default defineConfig({
  testDir: './specs',
  workers: 1,
  retries: 0,
  fullyParallel: false,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.GB_BASE_URL ?? 'http://localhost:4173',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
  projects: [
    {
      name: 'selftest',
      testMatch: /selftest\.spec\.ts/,
    },
    {
      name: 'headless',
      testMatch: /(determinism|responsive|reduced-motion|capture)\.spec\.ts/,
    },
    {
      // Frame timing runs headed against the real compositor and real vsync.
      // Headless Chromium drives frames without a display, which flatters the
      // measurement -- and a frame-rate gate that errs toward passing is worse
      // than no gate at all.
      name: 'headed',
      testMatch: /(fps|demo-video)\.spec\.ts/,
      use: { headless: false },
    },
  ],
});
