import { chromium, expect, test, type Browser } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ConsoleGuard,
  auditMotion,
  auditViewport,
  evidenceDir,
  judgeFrames,
  measureFrames,
  writeJson,
  type FrameVerdict,
} from '../lib/gates';

/**
 * The harness testing itself.
 *
 * Every gate below runs against a mock page built to fail it, and against a
 * mock built to pass. A gate that cannot be shown to fire is not a gate, and a
 * harness written before the application has no other way to earn trust.
 *
 * Each case asserts something stronger than "the broken page fails": the broken
 * page must fail its OWN gate and no other, so a real failure later points at
 * the right thing.
 *
 * The green mock doubles as the environment baseline. It animates ten bars with
 * trivial per-frame work, so if it cannot hold the frame budget then the machine
 * or the harness is at fault -- and every run says so before any verdict is
 * passed on the application.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, '..', 'lib', 'frame-probe.js');
const MOCKS = process.env.GB_SELFTEST_URL ?? 'http://localhost:4174';

interface GateOutcome {
  mock: string;
  consoleClean: boolean;
  frameVerdict: FrameVerdict;
  framesP50: number;
  framesP95: number;
  framesSpanMs: number;
  motionViolations: number;
  motionPass: boolean;
  viewportPass: boolean;
  deterministic: boolean;
}

const outcomes: GateOutcome[] = [];

// Frame timing is measured against the real compositor and real vsync, exactly
// as the application gate measures it. A self-test that exercised headless
// timing would be validating a configuration the real run never uses.
let headedBrowser: Browser;

test.beforeAll(async () => {
  headedBrowser = await chromium.launch({ headless: false });
});

test.afterAll(async () => {
  await headedBrowser?.close();
  writeJson(join(evidenceDir(), 'selftest.json'), { outcomes });
});

async function runGates(browser: Browser, mock: string): Promise<GateOutcome> {
  const url = `${MOCKS}/mock-${mock}.html?deterministic=1&seed=42`;

  // --- frame timing, headed -------------------------------------------------
  const headedContext = await headedBrowser.newContext();
  const headedPage = await headedContext.newPage();
  await headedPage.addInitScript({ path: PROBE });
  await headedPage.goto(url);
  await headedPage.waitForFunction(() => window.__glassbox !== undefined);
  const frames = await measureFrames(headedPage, async () => {
    await headedPage.waitForTimeout(3000);
  });
  await headedContext.close();

  // --- console, motion, viewport under reduced motion -----------------------
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const guard = new ConsoleGuard(`selftest-${mock}`).attach(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__glassbox !== undefined);
  const motion = await auditMotion(page);
  const viewport = await auditViewport(page);
  await context.close();

  // --- determinism: two fresh contexts running an identical schedule --------
  const records: string[] = [];
  for (let run = 0; run < 2; run += 1) {
    const runContext = await browser.newContext();
    const runPage = await runContext.newPage();
    await runPage.goto(url);
    await runPage.waitForFunction(() => window.__glassbox !== undefined);
    await runPage.evaluate(async () => {
      const gb = window.__glassbox!;
      await gb.advanceToStep(5);
      gb.setParams({ temperature: 2 });
      await gb.advanceToStep(12);
      gb.setParams({ temperature: 0.7, topP: 0.9 });
      await gb.fork(8, 2);
      await gb.runToEnd();
    });
    records.push(
      JSON.stringify(await runPage.evaluate(() => window.__glassbox!.serializeRun()), null, 2),
    );
    await runContext.close();
  }

  return {
    mock,
    consoleClean: guard.clean,
    frameVerdict: judgeFrames(frames),
    framesP50: frames.p50,
    framesP95: frames.p95,
    framesSpanMs: Math.round(frames.spanMs),
    motionViolations: motion.violations.length,
    motionPass: motion.violations.length === 0,
    viewportPass: !viewport.overflows,
    deterministic: records[0] === records[1],
  };
}

test('green mock passes every gate', async ({ browser }) => {
  const outcome = await runGates(browser, 'green');
  outcomes.push(outcome);

  expect(outcome.consoleClean, 'console gate').toBe(true);
  expect(
    outcome.frameVerdict,
    `frame gate: p50 ${outcome.framesP50.toFixed(2)}ms, p95 ${outcome.framesP95.toFixed(2)}ms ` +
      `over ${outcome.framesSpanMs}ms. If this reads INSUFFICIENT_DATA the sample was starved; ` +
      'if it reads FAIL the machine cannot animate ten bars smoothly and no verdict on the app is meaningful.',
  ).toBe('PASS');
  expect(outcome.motionPass, 'reduced-motion gate').toBe(true);
  expect(outcome.viewportPass, 'viewport gate').toBe(true);
  expect(outcome.deterministic, 'determinism gate').toBe(true);
});

test('jank mock fails ONLY the frame gate', async ({ browser }) => {
  const outcome = await runGates(browser, 'jank');
  outcomes.push(outcome);

  expect(outcome.frameVerdict, `p95 was ${outcome.framesP95.toFixed(2)}ms; expected > 16.7`).toBe(
    'FAIL',
  );
  expect(outcome.consoleClean).toBe(true);
  expect(outcome.motionPass).toBe(true);
  expect(outcome.viewportPass).toBe(true);
  expect(outcome.deterministic).toBe(true);
});

test('noisy mock fails ONLY the console gate', async ({ browser }) => {
  const outcome = await runGates(browser, 'noisy');
  outcomes.push(outcome);

  expect(outcome.consoleClean, 'a console.warn must fail the console gate').toBe(false);
  expect(outcome.frameVerdict).toBe('PASS');
  expect(outcome.motionPass).toBe(true);
  expect(outcome.viewportPass).toBe(true);
  expect(outcome.deterministic).toBe(true);
});

test('nondeterministic mock fails ONLY the determinism gate', async ({ browser }) => {
  const outcome = await runGates(browser, 'nondet');
  outcomes.push(outcome);

  // The drift is in the ninth decimal of a probability and the visible token
  // sequence is unchanged, so this is exactly the failure a screenshot
  // comparison would wave through.
  expect(outcome.deterministic, 'sub-pixel probability drift must be caught').toBe(false);
  expect(outcome.consoleClean).toBe(true);
  expect(outcome.frameVerdict).toBe('PASS');
  expect(outcome.motionPass).toBe(true);
  expect(outcome.viewportPass).toBe(true);
});

test('motion mock fails ONLY the reduced-motion gate, despite claiming otherwise', async ({
  browser,
}) => {
  const outcome = await runGates(browser, 'motion');
  outcomes.push(outcome);

  // This mock's getEffectiveMotion() reports reduced: true while its stylesheet
  // keeps a 200ms transition. Trusting the self-report would pass it.
  expect(outcome.motionPass, 'computed styles must override the app self-report').toBe(false);
  expect(outcome.consoleClean).toBe(true);
  expect(outcome.frameVerdict).toBe('PASS');
  expect(outcome.viewportPass).toBe(true);
  expect(outcome.deterministic).toBe(true);
});

test('overflow mock fails ONLY the viewport gate', async ({ browser }) => {
  const outcome = await runGates(browser, 'overflow');
  outcomes.push(outcome);

  expect(outcome.viewportPass, 'a 3000px element must fail the viewport gate').toBe(false);
  expect(outcome.consoleClean).toBe(true);
  expect(outcome.frameVerdict).toBe('PASS');
  expect(outcome.motionPass).toBe(true);
  expect(outcome.deterministic).toBe(true);
});
