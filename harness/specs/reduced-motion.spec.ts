import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { ConsoleGuard, auditMotion, evidenceDir, writeJson } from '../lib/gates';

/**
 * The prefers-reduced-motion gate, checked three ways.
 *
 * The app's own report is collected but never sufficient on its own: the
 * self-test's motion mock claims to honour reduced motion while its stylesheet
 * keeps a 200ms transition, and a harness that took the self-report at face
 * value would pass it. The computed-style walk and the live animation timeline
 * are what actually decide.
 */

const APP = '/?deterministic=1&seed=42&fixture=factual&cadence=80';

test('honours prefers-reduced-motion', async ({ browser }) => {
  const evidence = evidenceDir();
  const guard = new ConsoleGuard('reduced-motion');

  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  guard.attach(page);

  await page.goto(APP);
  await page.waitForFunction(() => window.__glassbox !== undefined);
  await page.evaluate(() => window.__glassbox!.ready);

  // 1. What the app says about itself.
  const selfReport = await page.evaluate(() => window.__glassbox!.getEffectiveMotion());

  // Stream a few tokens so any transition that only exists during streaming has
  // been created by the time the timeline is inspected.
  await page.evaluate(() => window.__glassbox!.advanceToStep(6));

  // 2. What the stylesheet actually computes to.
  const motion = await auditMotion(page);

  // 3. Whether the bars land at their final value immediately, with no tween in
  //    flight -- the observable behaviour a reduced-motion user experiences.
  const animating = motion.runningAnimations.filter(
    (animation) => Number(animation.duration) > 0,
  ).length;

  await page.screenshot({ path: join(evidence, 'screens', 'reduced-motion.png'), fullPage: true });

  const verdict =
    selfReport.reduced &&
    selfReport.maxTransitionMs === 0 &&
    selfReport.maxAnimationMs === 0 &&
    motion.violations.length === 0 &&
    animating === 0
      ? 'PASS'
      : 'FAIL';

  writeJson(join(evidence, 'reduced-motion.json'), {
    verdict,
    selfReport,
    computedStyleViolations: motion.violations,
    animationsWithNonZeroDuration: animating,
  });
  guard.writeFragment(evidence);
  await context.close();

  expect(selfReport.reduced, 'app should detect reduced motion').toBe(true);
  expect(
    motion.violations,
    `computed styles still carry motion: ${JSON.stringify(motion.violations.slice(0, 5), null, 2)}`,
  ).toEqual([]);
  expect(animating, 'no animation may have a non-zero duration').toBe(0);
  expect(guard.clean, JSON.stringify(guard.entries, null, 2)).toBe(true);
});
