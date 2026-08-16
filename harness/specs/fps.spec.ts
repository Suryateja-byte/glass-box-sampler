import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ConsoleGuard,
  FRAME_BUDGET_MS,
  evidenceDir,
  judgeFrames,
  measureFrames,
  writeJson,
  type FrameStats,
} from '../lib/gates';

/**
 * The frame-time gate: p95 <= 16.7ms while streaming with bars animating.
 *
 * Runs headed, against the real compositor and real vsync. Headless Chromium
 * drives frames without a display, so its timings are smoother than what a user
 * would see -- and a frame-rate gate whose errors point toward passing is worse
 * than no gate.
 *
 * The slider sweep is a real mouse drag, not a hook call. The claim being tested
 * is that moving a control repaints within a frame, and a JavaScript setter
 * bypasses the entire input path that claim is about.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, '..', 'lib', 'frame-probe.js');
const APP = '/?deterministic=1&seed=42&fixture=factual&cadence=80';

const RUNS = 3;
/** Spread wider than this means the machine, not the app, is deciding. */
const MAX_SPREAD_MS = 4;

/** Streams tokens while sweeping the temperature slider with the real mouse. */
async function stressScenario(page: Page): Promise<void> {
  const slider = page.getByTestId('temperature');
  const box = await slider.boundingBox();
  if (!box) throw new Error('temperature slider has no bounding box');

  const y = box.y + box.height / 2;
  const left = box.x + 4;
  const right = box.x + box.width - 4;

  // Let the stream settle into its cadence before adding input pressure.
  await page.waitForTimeout(1200);

  await page.mouse.move(left, y);
  await page.mouse.down();
  const STEPS = 40;
  for (let i = 0; i <= STEPS; i += 1) {
    await page.mouse.move(left + ((right - left) * i) / STEPS, y);
    await page.waitForTimeout(35);
  }
  await page.mouse.up();

  // Keep streaming after the drag so the sample is not all drag frames.
  await page.waitForTimeout(1200);
}

test('p95 frame time stays within budget while streaming and dragging', async ({ browser }) => {
  const evidence = evidenceDir();
  const guard = new ConsoleGuard('fps');
  const runs: (FrameStats & { verdict: string })[] = [];

  for (let run = 0; run < RUNS; run += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript({ path: PROBE });
    guard.attach(page);

    await page.goto(APP);
    await page.waitForFunction(() => window.__glassbox !== undefined);
    await page.evaluate(() => window.__glassbox!.ready);

    await page.getByTestId('run').click();

    const stats = await measureFrames(page, () => stressScenario(page));
    runs.push({ ...stats, verdict: judgeFrames(stats) });

    await context.close();
    // A short cool-down so one run's thermal load does not colour the next.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  const p95s = runs.map((r) => r.p95).sort((a, b) => a - b);
  const medianP95 = p95s[Math.floor(p95s.length / 2)]!;
  const spread = p95s[p95s.length - 1]! - p95s[0]!;

  let verdict: string;
  if (runs.some((r) => r.verdict === 'INSUFFICIENT_DATA')) verdict = 'INSUFFICIENT_DATA';
  else if (spread > MAX_SPREAD_MS) verdict = 'UNSTABLE';
  else verdict = medianP95 <= FRAME_BUDGET_MS ? 'PASS' : 'FAIL';

  writeJson(join(evidence, 'fps-metrics.json'), {
    verdict,
    budgetMs: FRAME_BUDGET_MS,
    medianP95,
    spreadMs: Number(spread.toFixed(3)),
    // The observed display interval. A 6ms median means a 144Hz+ panel, where
    // the 16.7ms budget is generous; recording it keeps the number honest.
    observedFrameIntervalMs: runs[0]?.p50 ?? null,
    runs: runs.map((r) => ({
      verdict: r.verdict,
      p50: r.p50,
      p95: r.p95,
      p99: r.p99,
      max: r.max,
      frames: r.count,
      spanMs: Math.round(r.spanMs),
      longFrameCount: r.longFrameCount,
      worstLongFrames: r.longFrames.slice(0, 5),
    })),
    // Raw deltas from the first run, so a suspicious percentile can be
    // recomputed from the data instead of taken on trust.
    rawDeltasRun1: runs[0]?.deltas ?? [],
  });
  guard.writeFragment(evidence);

  expect(
    verdict,
    `median p95 ${medianP95.toFixed(2)}ms across ${RUNS} runs, spread ${spread.toFixed(2)}ms. ` +
      'UNSTABLE means the runs disagreed too much to rule; INSUFFICIENT_DATA means the sample was starved.',
  ).toBe('PASS');
  expect(guard.clean, JSON.stringify(guard.entries, null, 2)).toBe(true);
});
