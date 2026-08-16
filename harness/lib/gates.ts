import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';

/**
 * The gate measurements, factored out of the specs so that harness/specs/
 * selftest.spec.ts can run the very same code against deliberately broken mock
 * pages. A harness that has never been shown to fail is not evidence that
 * anything passed.
 */

declare global {
  interface Window {
    __frameProbe: {
      start(): void;
      stop(): FrameStats;
    };
  }
}

export interface FrameStats {
  count: number;
  discardedWarmup: number;
  spanMs: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  longFrames: { duration: number; blockingDuration: number }[];
  longFrameCount: number;
  deltas: number[];
}

/** The frame-time budget for 60Hz, and the gate's threshold. */
export const FRAME_BUDGET_MS = 16.7;

export type FrameVerdict = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA';

/**
 * Judges a frame sample, refusing to rule on one that is too thin to mean
 * anything.
 *
 * A page whose compositor goes idle delivers frames in short bursts, and the
 * percentiles of such a burst look excellent no matter how the app behaves.
 * Requiring the sample to span real wall-clock time makes that failure mode
 * report INSUFFICIENT_DATA rather than a green tick.
 */
export function judgeFrames(stats: FrameStats, minimumSpanMs = 1200): FrameVerdict {
  if (!Number.isFinite(stats.p95) || stats.spanMs < minimumSpanMs) return 'INSUFFICIENT_DATA';
  return stats.p95 <= FRAME_BUDGET_MS ? 'PASS' : 'FAIL';
}

export interface ConsoleEntry {
  gate: string;
  type: 'error' | 'warning' | 'pageerror' | 'requestfailed' | 'httperror';
  text: string;
  location?: string;
}

/**
 * Entries matching an allowlist pattern are recorded but do not fail the gate.
 *
 * This starts empty and is meant to stay that way: the harness only ever
 * measures the production preview build, which has no dev-server chatter to
 * excuse. Every addition needs a written justification and shows up as a diff,
 * so an allowlist quietly growing to hide real problems is visible.
 */
export const CONSOLE_ALLOWLIST: { pattern: RegExp; justification: string }[] = [];

export class ConsoleGuard {
  readonly entries: ConsoleEntry[] = [];
  readonly allowed: ConsoleEntry[] = [];

  constructor(private readonly gate: string) {}

  /**
   * Collects at the browser-protocol layer rather than by patching console in
   * the page, so the app cannot filter its own output.
   */
  attach(page: Page): this {
    page.on('console', (message) => {
      const type = message.type();
      if (type !== 'error' && type !== 'warning') return;
      const location = message.location();
      this.record({
        gate: this.gate,
        type,
        text: message.text(),
        location: `${location.url}:${location.lineNumber}:${location.columnNumber}`,
      });
    });

    page.on('pageerror', (error) => {
      this.record({
        gate: this.gate,
        type: 'pageerror',
        text: `${error.name}: ${error.message}`,
        location: error.stack?.split('\n')[1]?.trim() ?? '',
      });
    });

    page.on('requestfailed', (request) => {
      // A missing fixture or stylesheet is a real defect that never reaches
      // console.error, so it is caught here instead.
      this.record({
        gate: this.gate,
        type: 'requestfailed',
        text: `${request.method()} ${request.url()} -- ${request.failure()?.errorText ?? 'failed'}`,
      });
    });

    page.on('response', (response) => {
      if (response.status() >= 400) {
        this.record({
          gate: this.gate,
          type: 'httperror',
          text: `HTTP ${response.status()} ${response.url()}`,
        });
      }
    });

    return this;
  }

  private record(entry: ConsoleEntry): void {
    const excuse = CONSOLE_ALLOWLIST.find((rule) => rule.pattern.test(entry.text));
    if (excuse) this.allowed.push(entry);
    else this.entries.push(entry);
  }

  get clean(): boolean {
    return this.entries.length === 0;
  }

  /** Specs write fragments; the orchestrator merges them into console-log.json. */
  writeFragment(evidenceDir: string): void {
    writeJson(join(evidenceDir, 'console', `${this.gate}.json`), {
      gate: this.gate,
      violations: this.entries,
      allowlistedHits: this.allowed,
    });
  }
}

/** Runs `scenario` with the injected probe recording, and returns the stats. */
export async function measureFrames(
  page: Page,
  scenario: () => Promise<void>,
): Promise<FrameStats> {
  await page.evaluate(() => window.__frameProbe.start());
  await scenario();
  return page.evaluate(() => window.__frameProbe.stop());
}

export interface MotionAudit {
  /** Elements still carrying a non-zero transition or animation duration. */
  violations: { selector: string; property: string; duration: string }[];
  /** Web Animations still scheduled with a non-zero duration. */
  runningAnimations: { duration: number }[];
}

/**
 * Checks reduced motion independently of whatever the app claims about itself,
 * by reading computed styles and the live animation timeline.
 */
export async function auditMotion(page: Page): Promise<MotionAudit> {
  return page.evaluate(() => {
    const violations: { selector: string; property: string; duration: string }[] = [];

    const describe = (element: Element): string => {
      const id = element.id ? `#${element.id}` : '';
      const classes = (element.getAttribute('class') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((c) => `.${c}`)
        .join('');
      return `${element.tagName.toLowerCase()}${id}${classes}`;
    };

    const toMs = (value: string): number => {
      const trimmed = value.trim();
      if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed);
      if (trimmed.endsWith('s')) return Number.parseFloat(trimmed) * 1000;
      return Number.parseFloat(trimmed) || 0;
    };

    for (const element of document.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      for (const [property, raw] of [
        ['transition-duration', style.transitionDuration],
        ['animation-duration', style.animationDuration],
      ] as const) {
        for (const part of raw.split(',')) {
          if (toMs(part) > 0) {
            violations.push({ selector: describe(element), property, duration: part.trim() });
          }
        }
      }
    }

    // getTiming().duration is number | 'auto' | CSSNumericValue. Anything not
    // already a number is coerced to 0 rather than dropped, since a duration
    // this check cannot read is not evidence of a duration that exists.
    const runningAnimations = document.getAnimations().map((animation) => {
      const duration = animation.effect?.getTiming().duration;
      return { duration: typeof duration === 'number' ? duration : 0 };
    });

    return { violations, runningAnimations };
  });
}

export interface ViewportAudit {
  scrollWidth: number;
  clientWidth: number;
  innerWidth: number;
  overflows: boolean;
  /** Named so a failure says which element sticks out, not merely that one does. */
  widestElements: { selector: string; right: number }[];
}

/** Horizontal overflow is the failure mode that makes a page unusable narrow. */
export async function auditViewport(page: Page): Promise<ViewportAudit> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const innerWidth = window.innerWidth;

    const widestElements: { selector: string; right: number }[] = [];
    for (const element of document.querySelectorAll('body *')) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.right > innerWidth + 1) {
        const id = element.id ? `#${element.id}` : '';
        const classes = (element.getAttribute('class') ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .map((c) => `.${c}`)
          .join('');
        widestElements.push({
          selector: `${element.tagName.toLowerCase()}${id}${classes}`,
          right: Math.round(rect.right),
        });
      }
    }

    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      innerWidth,
      overflows: root.scrollWidth > innerWidth,
      widestElements: widestElements.slice(0, 10),
    };
  });
}

/** Waits until nothing is animating, so screenshots are not caught mid-tween. */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().length === 0, undefined, {
    timeout: 5000,
  });
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function evidenceDir(): string {
  const dir = process.env.GB_EVIDENCE_DIR;
  if (!dir) throw new Error('GB_EVIDENCE_DIR is not set; run the harness via npm run harness');
  return dir;
}

export function baseUrl(): string {
  return process.env.GB_BASE_URL ?? 'http://localhost:4173';
}
