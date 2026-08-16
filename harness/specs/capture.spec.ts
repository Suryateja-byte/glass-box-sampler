import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { ConsoleGuard, auditViewport, evidenceDir, settle, writeJson } from '../lib/gates';

/**
 * Screenshot evidence and the responsive gate, in one pass.
 *
 * These images are what blind critics judge, so filenames are stable and carry
 * no timestamps: wave-4 can be diffed against wave-3 directly. Timestamps live
 * in manifest.json where they belong.
 *
 * Interactions here are real clicks and real drags. A capture driven through
 * JavaScript hooks would produce a screenshot of a state no user can reach.
 */

const APP = '/?deterministic=1&seed=42&fixture=factual&cadence=80';

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900, deviceScaleFactor: 1 },
  // The narrow case uses 2x, matching the phones this width represents.
  { name: '375', width: 375, height: 812, deviceScaleFactor: 2 },
];

interface ViewportFinding {
  viewport: string;
  state: string;
  overflows: boolean;
  scrollWidth: number;
  innerWidth: number;
  widestElements: { selector: string; right: number }[];
}

const findings: ViewportFinding[] = [];

async function shoot(page: Page, viewport: string, name: string, state: string): Promise<void> {
  await settle(page);
  await page.screenshot({
    path: join(evidenceDir(), 'screens', viewport, `${name}.png`),
    fullPage: true,
  });
  const audit = await auditViewport(page);
  findings.push({
    viewport,
    state,
    overflows: audit.overflows,
    scrollWidth: audit.scrollWidth,
    innerWidth: audit.innerWidth,
    widestElements: audit.widestElements,
  });
}

test.afterAll(() => {
  const evidence = evidenceDir();
  writeJson(join(evidence, 'responsive.json'), {
    verdict: findings.every((f) => !f.overflows) ? 'PASS' : 'FAIL',
    findings,
  });
});

for (const viewport of VIEWPORTS) {
  test(`captures the story at ${viewport.name}px`, async ({ browser }) => {
    const evidence = evidenceDir();
    const guard = new ConsoleGuard(`capture-${viewport.name}`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
    });
    const page = await context.newPage();
    guard.attach(page);

    await page.goto(APP);
    await page.waitForFunction(() => window.__glassbox !== undefined);
    await page.evaluate(() => window.__glassbox!.ready);

    await shoot(page, viewport.name, '01-idle', 'loaded, before running');

    // Mid-stream, paused at a fixed step so the frame is identical every wave.
    await page.evaluate(() => window.__glassbox!.advanceToStep(12));
    await shoot(page, viewport.name, '02-midstream', 'paused after 12 tokens');

    // A real drag to maximum temperature: this is the flattening the app exists
    // to show, so it must be captured through the control a user would touch.
    const slider = page.getByTestId('temperature');
    const box = await slider.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 20 });
      await page.mouse.up();
    }
    await shoot(page, viewport.name, '03-temperature-max', 'temperature dragged to 2.0');

    // Back to a middle setting, then narrow the nucleus with top-p.
    const topP = page.getByTestId('top-p');
    const topPBox = await topP.boundingBox();
    if (topPBox) {
      await page.mouse.move(topPBox.x + topPBox.width / 2, topPBox.y + topPBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(topPBox.x + topPBox.width * 0.35, topPBox.y + topPBox.height / 2, {
        steps: 20,
      });
      await page.mouse.up();
    }
    await shoot(page, viewport.name, '04-nucleus-cut', 'top-p tightened, cut candidates dimmed');

    // A real fork click on an alternative candidate.
    const alternative = page.getByTestId('fork-button').nth(2);
    if (await alternative.count()) {
      await alternative.click();
      await page.waitForTimeout(300);
    }
    await shoot(page, viewport.name, '05-forked', 'branched from an alternative token');

    await page.evaluate(() => window.__glassbox!.runToEnd());
    await shoot(page, viewport.name, '06-complete', 'generation finished on the branch');

    guard.writeFragment(evidence);
    await context.close();

    const overflowing = findings.filter((f) => f.viewport === viewport.name && f.overflows);
    expect(
      overflowing,
      `horizontal overflow at ${viewport.name}px: ${JSON.stringify(overflowing, null, 2)}`,
    ).toEqual([]);
    expect(guard.clean, JSON.stringify(guard.entries, null, 2)).toBe(true);
  });
}
