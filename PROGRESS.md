# Progress

Live status of the build. Open `progress.html` for the same thing in a browser.

## Where things stand

| Phase | State |
|---|---|
| A — Harness, self-verified | **Done** |
| B — Core pieces + coupled cluster | In flight |
| C — Walking skeleton + wave-0 evidence | Not started |
| D — Gauntlet waves (max 5) | Not started |
| E — Cold-start acceptance | Not started |

## Gate status

Measured by `npm run harness`. Nothing below is a claim until a bundle in
`evidence/` backs it.

| Gate | Status | Evidence |
|---|---|---|
| Sampling math within 1e-6 | **PASS** | 61 tests, `npx vitest run src/core` |
| Harness self-test | **PASS** | `evidence/selftest/selftest.json` |
| Zero console errors/warnings | not yet measured | |
| p95 frame time ≤ 16.7ms | not yet measured | |
| Lighthouse performance ≥ 90 | not yet measured | |
| Lighthouse accessibility ≥ 90 | not yet measured | |
| Replay determinism (byte-identical) | not yet measured | |
| Usable at 375px and 1440px | not yet measured | |
| prefers-reduced-motion honoured | not yet measured | |

## Phase A — done

The harness was built before any application code, on the rule that
non-reproducible evidence makes every later verdict meaningless.

**The harness proves it can fail.** Six mock pages: one correct, five each
carrying exactly one defect (30ms frame burn, `Math.random` drift, a
`console.warn`, a stylesheet ignoring reduced motion, a 3000px element). Each
must trip its own gate and stay silent on the others. `npm run harness:selftest`.

Self-test baseline, recorded 2026-08-16:

| mock | console | frames | motion | viewport | determinism |
|---|---|---|---|---|---|
| green | clean | PASS p50 6.1ms, p95 6.2ms | ok | ok | ok |
| jank | clean | **FAIL p95 36.5ms** | ok | ok | ok |
| noisy | **NOISY** | PASS | ok | ok | ok |
| nondet | clean | PASS | ok | ok | **DRIFT** |
| motion | clean | PASS | **10 violations** | ok | ok |
| overflow | clean | PASS | ok | **OVERFLOW** | ok |

The green mock doubles as the environment baseline: it animates ten bars with
trivial work, so if it cannot hold the budget then the machine, not the app, is
at fault — and every run says so before any verdict is passed on the app.

### Two things found while building the harness

**Frame percentiles cannot be taken from an idle page.** Chromium skips
compositor frames when nothing changes, so `requestAnimationFrame` fires in
starved bursts. Measured directly: an idle page delivered only ~585ms of frames
across a 2000ms window, and the percentiles of that burst looked excellent.
Fixes applied: the probe now reports the wall-clock span it covers, the judge
returns `INSUFFICIENT_DATA` rather than a green tick when the span is too thin,
and every mock animates continuously — as the real app does while streaming.

**The self-test must run frames headed.** It originally measured headless while
the real gate runs headed. Validating a configuration the real run never uses
proves nothing, so the self-test now launches a headed browser for frame timing.

### Reference values for the sampling math

Derived by `tools/gen-reference-values.py` with Python's `decimal` at 40 digits
— a different language and a different algorithm from the float64 `Math.exp` it
checks, so agreement is evidence rather than tautology. Cross-checked against an
independent Node implementation: **max disagreement 2.2e-16**, roughly 4.5e9×
headroom against the 1e-6 gate.

Hand-checkable cases are included on purpose: logits `[ln4, ln2, 0]` give exactly
`[4/7, 2/7, 1/7]`; entropy of uniform-4 is exactly 2 bits; `[0.5,0.25,0.125,0.125]`
is exactly 1.75 bits. Case S6 uses logits `[800,799,798]`, which overflow `exp()`
without max-subtraction. Case P5 is a self-consistency identity: truncating
`softmax([2,1,0,-1])` at p=0.9 and renormalising reproduces `softmax([2,1,0])`
exactly, because dropping a token and renormalising *is* softmax over the
survivors — an error in either function breaks it.

## Phase B — in flight

**Coupled cluster (sequential, single owner):** `engine/types.ts`,
`engine/engine.ts`, `engine/events.ts`, `sources/replay.ts`, `ui/raf.ts`,
`ui/bars.ts`, `ui/stream.ts`, `ui/stats.ts`, `ui/trail.ts`, `ui/sliders.ts`,
`ui/controls.ts`, `ui/demo.ts`, `ui/metrics.ts`, `ui/app.ts`, `main.ts`,
`styles.css`, `index.html`. **Done.**

**Parallel, independent:**

- `core/` math — **done**, 61 tests green on the first run.
- `design-tokens.css` + `ui/copy.ts` — **done**.
- `sources/sse.ts` + `sources/live.ts` — **done**, 33 tests green.
- `fixtures/` generator + three lattices — in flight.

### Notes from the parallel work worth keeping

- The design pass measured every contrast pair rather than estimating, and found
  white-on-accent fails in dark theme (2.64:1) — the dark theme uses dark ink on
  the accent fill instead. Worst text ratio across both themes is 5.27:1.
- Surprisal is a background wash, not a text colour: five legible *text* colours
  across two themes is not solvable at AA. Underline weight carries the same
  signal as a second channel, so it is never colour-only.
- `--dur-bar` is 70ms, shorter than the other durations, because the harness
  streams at `cadence=80`. A bar still moving when the next token lands never
  shows a true length, which would make the chart decorative rather than a
  readout.
- The live adapter's SSE parser implements the WHATWG tokenizer rather than
  splitting on `\n\n`, and is tested by replaying each logical stream through
  every chunking (per-character, random, and every two-chunk split point). A
  CRLF pair straddling a chunk boundary needs a `pendingLf` latch; deleting it
  fails exactly one test.
- Live mode is built but **cannot be smoke-tested**: there is no `OPENAI_API_KEY`
  in this environment. It ships behind the replay default and the README says so.

## Failed approaches (kept so they are not retried)

- **Idle-page frame measurement** — abandoned. Not a tuning problem: an idle
  page does not produce frames to measure. Superseded by continuously animating
  mocks plus a span check.
- **Screenshot diffing as the determinism oracle** — rejected before it was
  built. Any pixel tolerance is exactly where real nondeterminism hides. The
  nondeterminism mock demonstrates the point: it drifts in the ninth decimal of
  a probability while every visible pixel stays identical.

## Next action

Land the fixture lattices, then run the walking skeleton end to end and produce
`evidence/wave-0/`.

## Budget

Waves used: 0 of 5. No piece has been parked.
