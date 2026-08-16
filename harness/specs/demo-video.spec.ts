import { expect, test } from '@playwright/test';
import { renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ConsoleGuard, evidenceDir } from '../lib/gates';

/**
 * Records the scripted demo as evidence of the app in motion.
 *
 * Runs headed so the recording shows the same compositing a viewer would get.
 * The demo is triggered by the keypress a user would press rather than by
 * calling the hook, so the recording doubles as proof that the shortcut works.
 */

const APP = '/?deterministic=1&seed=42&fixture=factual';

test('records the demo showcase', async ({ browser }) => {
  const evidence = evidenceDir();
  const videoDir = join(evidence, 'video');
  mkdirSync(videoDir, { recursive: true });

  const guard = new ConsoleGuard('demo-video');
  const context = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  guard.attach(page);

  await page.goto(APP);
  await page.waitForFunction(() => window.__glassbox !== undefined);
  await page.evaluate(() => window.__glassbox!.ready);

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('d');

  // The demo resolves when its script finishes; waiting on the promise rather
  // than a fixed sleep keeps the recording tight even if pacing changes.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        const poll = (): void => {
          const status = window.__glassbox!.getState().status;
          if (status === 'done' || performance.now() - start > 45_000) resolve();
          else setTimeout(poll, 250);
        };
        poll();
      }),
  );

  const video = page.video();
  await context.close(); // flushes the recording to disk

  if (video) {
    const raw = await video.path();
    renameSync(raw, join(videoDir, 'demo.webm'));
  }

  guard.writeFragment(evidence);
  expect(guard.clean, JSON.stringify(guard.entries, null, 2)).toBe(true);
});
