#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The evidence orchestrator: one command that produces one wave's complete,
 * reproducible evidence bundle.
 *
 * Two structural decisions worth knowing before reading further.
 *
 * First, every child process is launched with an ARGUMENT ARRAY and shell:false.
 * This project lives at a path containing a space, and quoting rules differ
 * between PowerShell, cmd and sh. Never handing a path to a shell removes that
 * entire class of failure by construction rather than by careful escaping.
 *
 * Second, the run is designed so its own mistakes are visible. It refuses to
 * audit a server it did not just build for, caps the verdict when the working
 * tree is dirty, and records a hash of every artifact against a commit.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PREVIEW_PORT = 4173;
const SELFTEST_PORT = 4174;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

const NODE = process.execPath;
const CLI = {
  vitest: join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'),
  vite: join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
  playwright: join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'),
  lighthouse: join(ROOT, 'node_modules', 'lighthouse', 'cli', 'index.js'),
};

const CHROME_PATH =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// ---------------------------------------------------------------- utilities

function log(message) {
  process.stdout.write(`${message}\n`);
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      shell: false,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.inherit === false ? 'pipe' : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: String(error) }));
  });
}

function gitOutput(args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: ROOT }, (error, stdout) => {
      resolve(error ? '' : stdout.trim());
    });
  });
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function hashTree(dir, base = dir, accumulator = {}) {
  if (!existsSync(dir)) return accumulator;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) hashTree(path, base, accumulator);
    else accumulator[path.slice(base.length + 1).replaceAll('\\', '/')] = sha256(readFileSync(path));
  }
  return accumulator;
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.text();
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

/** Windows needs the whole process tree killed, not just the parent. */
function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: false });
  } else {
    child.kill('SIGTERM');
  }
}

// ------------------------------------------------------------------ selftest

async function selftest() {
  log('\n=== Harness self-test ===');
  log('Proving each gate fires on a page built to fail it.\n');

  const { serveDirectory } = await import('./lib/static-server.mjs');
  const server = await serveDirectory(join(ROOT, 'harness', 'selftest'), SELFTEST_PORT);
  const evidence = join(ROOT, 'evidence', 'selftest');
  mkdirSync(evidence, { recursive: true });

  try {
    const result = await runProcess(NODE, [
      CLI.playwright,
      'test',
      '--config',
      join('harness', 'playwright.config.ts'),
      '--project',
      'selftest',
    ], {
      env: {
        GB_EVIDENCE_DIR: evidence,
        GB_SELFTEST_URL: `http://localhost:${SELFTEST_PORT}`,
      },
    });

    if (result.code === 0) {
      log('\nSELF-TEST PASSED: every gate fired on its broken mock and stayed quiet otherwise.');
    } else {
      log('\nSELF-TEST FAILED: the harness cannot be trusted until this passes.');
    }
    return result.code;
  } finally {
    server.close();
  }
}

// ------------------------------------------------------------------ full run

function nextWaveDir(explicit) {
  const evidenceRoot = join(ROOT, 'evidence');
  mkdirSync(evidenceRoot, { recursive: true });
  if (explicit !== undefined) return join(evidenceRoot, `wave-${explicit}`);
  const existing = readdirSync(evidenceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^wave-\d+$/.test(entry.name))
    .map((entry) => Number(entry.name.slice(5)));
  const next = existing.length === 0 ? 0 : Math.max(...existing) + 1;
  return join(evidenceRoot, `wave-${next}`);
}

async function lighthouseRuns(evidence, runs = 3) {
  const scores = [];
  for (let index = 1; index <= runs; index += 1) {
    const relativeOut = join(
      'evidence',
      evidence.slice(join(ROOT, 'evidence').length + 1),
      'lighthouse',
      `run-${index}.json`,
    );
    mkdirSync(join(evidence, 'lighthouse'), { recursive: true });
    log(`  lighthouse run ${index}/${runs}...`);
    const result = await runProcess(
      NODE,
      [
        CLI.lighthouse,
        PREVIEW_URL,
        '--chrome-flags=--headless=new',
        '--only-categories=performance,accessibility',
        '--output=json',
        `--output-path=${relativeOut}`,
        '--quiet',
      ],
      { env: { CHROME_PATH }, inherit: false },
    );

    const path = join(ROOT, relativeOut);
    if (result.code !== 0 || !existsSync(path)) {
      log(`  lighthouse run ${index} failed: ${result.stderr.slice(-600)}`);
      continue;
    }
    const report = JSON.parse(readFileSync(path, 'utf8'));
    scores.push({
      run: index,
      performance: Math.round((report.categories?.performance?.score ?? 0) * 100),
      accessibility: Math.round((report.categories?.accessibility?.score ?? 0) * 100),
      throttlingMethod: report.configSettings?.throttlingMethod,
      chromeVersion: report.environment?.hostUserAgent,
    });
  }

  const median = (key) => {
    const values = scores.map((s) => s[key]).sort((a, b) => a - b);
    return values.length === 0 ? 0 : values[Math.floor(values.length / 2)];
  };

  const summary = {
    runs: scores,
    medianPerformance: median('performance'),
    medianAccessibility: median('accessibility'),
    // Copied verbatim so any future weakening of throttling is visible in the
    // evidence rather than buried in a config file.
    throttlingMethod: scores[0]?.throttlingMethod ?? 'unknown',
  };
  writeJson(join(evidence, 'lighthouse', 'median.json'), summary);
  return summary;
}

async function fullRun(options) {
  const evidence = nextWaveDir(options.wave);
  const waveName = evidence.slice(join(ROOT, 'evidence').length + 1);
  mkdirSync(evidence, { recursive: true });
  log(`\n=== Harness run -> evidence/${waveName} ===\n`);

  const gates = {};
  const commit = await gitOutput(['rev-parse', 'HEAD']);
  const dirty = (await gitOutput(['status', '--porcelain'])) !== '';

  // --- gate 1: sampling math ------------------------------------------------
  log('[1/7] sampling-math unit tests');
  const unit = await runProcess(NODE, [
    CLI.vitest,
    'run',
    '--reporter=json',
    `--outputFile=${join('evidence', waveName, 'unit-tests.json')}`,
  ]);
  gates.samplingMath = unit.code === 0 ? 'PASS' : 'FAIL';

  // --- build ----------------------------------------------------------------
  log('\n[2/7] production build');
  const build = await runProcess(NODE, [CLI.vite, 'build']);
  if (build.code !== 0) {
    writeJson(join(evidence, 'summary.json'), {
      wave: waveName,
      overall: 'FAIL',
      gates: { ...gates, build: 'FAIL' },
    });
    log('\nBuild failed; no further gates can be measured.');
    return 1;
  }

  const builtIndex = readFileSync(join(ROOT, 'dist', 'index.html'));

  // --- serve ----------------------------------------------------------------
  log('\n[3/7] preview server');
  const preview = spawn(
    NODE,
    [CLI.vite, 'preview', '--port', String(PREVIEW_PORT), '--strictPort'],
    { cwd: ROOT, shell: false, stdio: 'ignore' },
  );

  let exitCode = 1;
  try {
    const served = await waitForServer(PREVIEW_URL);

    // Refuse to audit a server that is not serving the build just produced.
    // Without this, a stale process left on the port yields a full green run
    // describing code that no longer exists.
    if (sha256(Buffer.from(served)) !== sha256(builtIndex)) {
      throw new Error(
        'The page served on :4173 does not match the build just produced. ' +
          'Another server is probably holding the port.',
      );
    }
    log('  served build matches dist/ (hash verified)');

    // --- gates 2,5,6,7: browser specs --------------------------------------
    log('\n[4/7] browser gates (console, determinism, responsive, reduced motion, captures)');
    const headless = await runProcess(
      NODE,
      [
        CLI.playwright,
        'test',
        '--config',
        join('harness', 'playwright.config.ts'),
        '--project',
        'headless',
      ],
      { env: { GB_EVIDENCE_DIR: evidence, GB_BASE_URL: PREVIEW_URL } },
    );
    gates.browserSpecs = headless.code === 0 ? 'PASS' : 'FAIL';

    // --- gate 3: frame time (headed) ---------------------------------------
    log('\n[5/7] frame-time gate (headed, real vsync)');
    const headed = await runProcess(
      NODE,
      [
        CLI.playwright,
        'test',
        '--config',
        join('harness', 'playwright.config.ts'),
        '--project',
        'headed',
      ],
      { env: { GB_EVIDENCE_DIR: evidence, GB_BASE_URL: PREVIEW_URL } },
    );
    gates.frameTime = headed.code === 0 ? 'PASS' : 'FAIL';

    // --- gate 4: lighthouse -------------------------------------------------
    log('\n[6/7] lighthouse (3 runs, median)');
    const lighthouse = await lighthouseRuns(evidence);
    gates.lighthousePerformance = lighthouse.medianPerformance >= 90 ? 'PASS' : 'FAIL';
    gates.lighthouseAccessibility = lighthouse.medianAccessibility >= 90 ? 'PASS' : 'FAIL';

    // --- merge console fragments -------------------------------------------
    const consoleDir = join(evidence, 'console');
    const violations = [];
    const allowlisted = [];
    if (existsSync(consoleDir)) {
      for (const file of readdirSync(consoleDir)) {
        const fragment = JSON.parse(readFileSync(join(consoleDir, file), 'utf8'));
        violations.push(...fragment.violations);
        allowlisted.push(...fragment.allowlistedHits);
      }
    }
    writeJson(join(evidence, 'console-log.json'), {
      violations,
      allowlistedHits: allowlisted,
      verdict: violations.length === 0 ? 'PASS' : 'FAIL',
    });
    gates.console = violations.length === 0 ? 'PASS' : 'FAIL';

    // --- summary ------------------------------------------------------------
    log('\n[7/7] summary');
    const readGate = (file, key, fallback) => {
      const path = join(evidence, file);
      if (!existsSync(path)) return fallback;
      const value = JSON.parse(readFileSync(path, 'utf8'));
      return key.split('.').reduce((acc, part) => acc?.[part], value) ?? fallback;
    };

    const detail = {
      frames: existsSync(join(evidence, 'fps-metrics.json'))
        ? JSON.parse(readFileSync(join(evidence, 'fps-metrics.json'), 'utf8'))
        : null,
      lighthouse,
      determinismVerdict: readGate('determinism/verdict.json', 'verdict', 'NOT_RUN'),
      consoleViolations: violations.length,
    };

    const failing = Object.entries(gates).filter(([, value]) => value !== 'PASS');
    let overall = failing.length === 0 ? 'PASS' : 'FAIL';
    if (overall === 'PASS' && dirty) overall = 'TAINTED';
    if (detail.frames?.verdict === 'UNSTABLE' || detail.frames?.verdict === 'INVALID_ENVIRONMENT') {
      overall = detail.frames.verdict;
    }

    writeJson(join(evidence, 'summary.json'), {
      wave: waveName,
      overall,
      gates,
      detail,
      note:
        dirty && overall === 'TAINTED'
          ? 'All gates passed, but the working tree had uncommitted changes, so this bundle does not describe any single commit.'
          : undefined,
    });

    writeJson(join(evidence, 'manifest.json'), {
      commit,
      dirty,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      playwright: JSON.parse(
        readFileSync(join(ROOT, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8'),
      ).version,
      chromePath: CHROME_PATH,
      distHashes: hashTree(join(ROOT, 'dist')),
      fixtureHashes: hashTree(join(ROOT, 'src', 'fixtures')),
      artifactHashes: hashTree(evidence),
    });

    log('\n---------------- GATE SUMMARY ----------------');
    for (const [name, value] of Object.entries(gates)) {
      log(`  ${value === 'PASS' ? 'PASS' : 'FAIL'}  ${name}`);
    }
    log(`  OVERALL: ${overall}`);
    log('----------------------------------------------');
    log(`Evidence: evidence/${waveName}\n`);

    exitCode = overall === 'PASS' ? 0 : 1;
  } catch (error) {
    log(`\nHarness aborted: ${error.message}`);
    writeJson(join(evidence, 'summary.json'), {
      wave: waveName,
      overall: 'ERROR',
      error: error.message,
      gates,
    });
  } finally {
    killTree(preview);
  }

  return exitCode;
}

// ---------------------------------------------------------------------- main

const argv = process.argv.slice(2);
const waveFlag = argv.indexOf('--wave');
const options = {
  selftest: argv.includes('--selftest'),
  wave: waveFlag === -1 ? undefined : Number(argv[waveFlag + 1]),
};

process.exit(options.selftest ? await selftest() : await fullRun(options));
