import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { ConsoleGuard, evidenceDir, writeJson } from '../lib/gates';

/**
 * The determinism gate.
 *
 * Two runs of replay mode following an identical schedule must serialise to
 * byte-identical JSON. The oracle is a byte comparison rather than a screenshot
 * diff, because screenshots need a pixel tolerance to survive font
 * anti-aliasing -- and any tolerance is exactly the gap real nondeterminism
 * hides in. The self-test proves this: its nondeterministic mock drifts in the
 * ninth decimal of a probability while every visible pixel stays put.
 *
 * The schedule deliberately includes mid-run parameter changes and a fork, so
 * the gate covers the paths where nondeterminism would actually creep in: a
 * sequential RNG whose draws shift with exploration order, or state that
 * depends on wall-clock time.
 */

const APP = '/?deterministic=1&seed=42&fixture=factual&cadence=40';

/** Value-exact parameters are required here, which a pixel drag cannot promise.
 *  Every other gate drives the real controls; see hooks.d.ts. */
async function runSchedule(page: import('@playwright/test').Page): Promise<string> {
  await page.goto(APP);
  await page.waitForFunction(() => window.__glassbox !== undefined);
  await page.evaluate(() => window.__glassbox!.ready);

  await page.evaluate(async () => {
    const gb = window.__glassbox!;
    await gb.advanceToStep(5);
    gb.setParams({ temperature: 2 });
    await gb.advanceToStep(12);
    gb.setParams({ temperature: 0.7, topP: 0.9 });
    await gb.advanceToStep(18);
    await gb.fork(12, 2);
    await gb.runToEnd();
  });

  const record = await page.evaluate(() => window.__glassbox!.serializeRun());
  return `${JSON.stringify(record, null, 2)}\n`;
}

test('two replay runs produce byte-identical output', async ({ browser }) => {
  const evidence = evidenceDir();
  const guard = new ConsoleGuard('determinism');
  const records: string[] = [];
  const domTexts: string[] = [];

  for (let run = 0; run < 2; run += 1) {
    // Fresh contexts: separate storage, cache and cookies, so nothing carries
    // over from the first run to make the second one agree.
    const context = await browser.newContext();
    const page = await context.newPage();
    guard.attach(page);

    records.push(await runSchedule(page));

    // The app's own serializer is not trusted on its own. Reading the rendered
    // transcript independently means a serializer that quietly stabilises its
    // output while the UI diverges would still be caught.
    domTexts.push(
      await page.evaluate(
        () => document.querySelector('[data-testid="stream"]')?.textContent ?? '',
      ),
    );

    await context.close();
  }

  writeFileSync(join(evidence, 'determinism', 'run-a.json'), records[0]!, 'utf8');
  writeFileSync(join(evidence, 'determinism', 'run-b.json'), records[1]!, 'utf8');

  const identical = Buffer.compare(Buffer.from(records[0]!), Buffer.from(records[1]!)) === 0;
  const domMatches = domTexts[0] === domTexts[1];

  if (!identical) {
    // Point at the first divergence rather than just reporting red.
    const a = records[0]!.split('\n');
    const b = records[1]!.split('\n');
    const at = a.findIndex((line, index) => line !== b[index]);
    writeFileSync(
      join(evidence, 'determinism', 'diff.txt'),
      [
        `First divergence at line ${at + 1}:`,
        ...a.slice(Math.max(0, at - 4), at).map((l) => `  ${l}`),
        `A: ${a[at]}`,
        `B: ${b[at]}`,
        ...a.slice(at + 1, at + 5).map((l) => `  ${l}`),
      ].join('\n'),
      'utf8',
    );
  }

  writeJson(join(evidence, 'determinism', 'verdict.json'), {
    verdict: identical && domMatches ? 'PASS' : 'FAIL',
    recordsIdentical: identical,
    renderedTextIdentical: domMatches,
    bytes: records[0]!.length,
  });
  guard.writeFragment(evidence);

  expect(identical, 'serialised run records must match byte for byte').toBe(true);
  expect(domMatches, 'the rendered transcript must match as well').toBe(true);
  expect(guard.clean, JSON.stringify(guard.entries, null, 2)).toBe(true);
});
