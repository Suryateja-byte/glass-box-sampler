# Progress

Live status of the build. Open `progress.html` for the same thing in a browser.

## Where things stand

| Phase | State |
|---|---|
| A — Harness, self-verified | **Done** |
| B — Core pieces + coupled cluster | **Done** |
| C — Walking skeleton + wave-0 evidence | **Done** |
| D — Gauntlet waves (max 5) | 4 of 5 used; wave-3 verdict pending |
| E — Cold-start acceptance | **Passed** once; re-running against the final build |

## Gate status

All measured by `npm run harness`. The figures below are from
`evidence/wave-4/`, the most recent bundle, on a clean tree. Nothing here is a
claim without a bundle behind it.

| Gate | Status | Measured |
|---|---|---|
| Sampling math within 1e-6 | **PASS** | 157 tests; worst disagreement 2.2e-16 |
| Harness self-test | **PASS** | 5 defect mocks, each tripping only its own gate |
| Zero console errors/warnings | **PASS** | 0 violations across every page the harness opened |
| p95 frame time ≤ 16.7ms | **PASS** | median p95 **6.20ms**, spread 0.00ms, 0 long frames |
| Lighthouse performance ≥ 90 | **PASS** | **100** (median of 3, simulated throttling) |
| Lighthouse accessibility ≥ 90 | **PASS** | **100** (median of 3) |
| Replay determinism (byte-identical) | **PASS** | 73,571 bytes identical; rendered text also identical |
| Usable at 375px and 1440px | **PASS** | 6 states each, no horizontal overflow |
| prefers-reduced-motion honoured | **PASS** | self-report, computed styles and animation timeline all clean |

The frame number deserves a caveat: the display here runs at ~164Hz (observed
interval 6.1ms), so 6.20ms is essentially "every frame on time" rather than
"comfortably inside a 16.7ms budget". It is measured headed against real vsync
with a real mouse drag during streaming, and it is recorded honestly rather than
presented as more headroom than it is.

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

## Phase C — walking skeleton, done

Every capability wired end to end in replay mode, then measured. All gates pass
on the skeleton, which means the waves that follow are about the quality bar
rather than about correctness.

### Defects found by driving the real interface

None of these were visible from reading the code; all three came from operating
the app with real input events and reading back the DOM.

- **Percentage labels went stale.** The write cache keyed on the probability
  rounded to three decimals — coarser than the text it guarded. Two different
  probabilities that round alike (0.0003 and 0.00001 both round to zero) skipped
  the write, leaving the previous step's figure on screen next to a correct bar.
  Caught by dumping all ten rows at three temperatures and noticing the
  percentages were not monotonically decreasing. Now caches the rendered string.
- **First paint depended on requestAnimationFrame.** A browser that is not
  compositing never runs one, so the app rendered nothing at all in a hidden
  pane while the engine streamed happily underneath. The initial render now
  flushes synchronously; everything after still batches through the scheduler.
- **Ten unnamed buttons in the accessibility tree** before anything was sampled.
  Empty rows are now hidden from it.

### Harness defects found the same way

- `determinism.spec.ts` wrote into a directory it never created.
- A harness run overlapping another agent's file writes produced a spurious
  `samplingMath` failure. The manifest's dirty-tree flag catches uncommitted
  changes but not concurrent ones — worth remembering before trusting any bundle
  produced while something else is writing.

## Phase B — done

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

## Wave 1 — the candidates panel did not reconcile

**Verdict on wave 0: FAIL.** A fresh critic, given only the goal, the bar and the
evidence, found that the panel's numbers contradicted each other and got worse
under the controls the panel exists to explain. Reproduced before changing
anything, on one paused step of the factual fixture:

| settings | leader bar | ten bars sum | CHOSEN P | tail line |
|---|---|---|---|---|
| T=0.8, p=1.00 | 95.8% | 99.96% | 95.8% | 2.5% outside → 102.5% total |
| T=2.0, p=1.00 | 55.5% | 100.02% | **95.8%** | 2.5% |
| T=2.0, p=0.35 | 100.0% | **144.52%** | **95.8%** | 2.5% |

Three distinct defects, all mine:

1. **Two normalisations in one chart.** Survivors were drawn renormalised while
   discarded candidates kept their pre-cut length. I had chosen that so the
   discarded ones stayed visible; the cost was ten bars summing to 144%.
2. **The tail was counted twice.** Softmax over the top ten already renormalises
   to 1, so the bars sum to 100% — and an "everything else, 2.5%" line beside
   them added the residual a second time.
3. **CHOSEN P was frozen while everything around it was live**, printing 95.8%
   next to a committed-token bar drawn at 55.5%.

**Fixes.** The bars are now two explicit layers: a full-height ghost for the
distribution before the cut, and a vertically inset solid fill for what
survives. Each layer sums to 100% on its own, and the overhang of fill past
ghost is the redistributed mass — renormalisation became something visible
rather than something the caption asserted. The tail is stated once, as
coverage. CHOSEN P tracks the sliders like every other figure in its row; the
value the sampler actually faced stays on the token in the transcript.
Discarded rows read `was 3.25%` rather than a struck-through number, because a
column of ten percentages invites being summed, and a reader who sums them and
gets 144% is right to stop trusting the panel.

**Verified after:** live figures sum to 100.00% at every setting tested, CHOSEN P
tracks the leader bar (95.8% → 55.5% → 100.0%), and no gate regressed — frame
p95 unchanged at 6.20ms despite a second animated layer per row, Lighthouse
still 100/100, determinism still byte-identical (`evidence/wave-1/`).

## Wave 2 — the rule was never drawn, only its result

**Verdict on wave 1: FAIL.** A second fresh critic re-derived the mathematics
independently — temperature rescaling, entropy, nucleus selection,
renormalisation — and found every figure exact. Then it failed the artifact on a
sharper point: **top-p is a rule about a running total, and no running total
appeared anywhere.** The reader got a column of percentages and a 1px hairline,
and had to do the addition mentally to learn why the cut fell where it did.

**Fix.** Three numeric columns on two clearly named bases:

```
token       p       Σp      after
·never    34.4%   34.4%    48.4%
·not      21.8%   56.2%    30.6%
·rarely   14.9%   71.2%    21.0%   <- cut lands here
·seldom    9.33%  80.5%       —
```

`p` and `Σp` both describe the distribution **before** the cut, so Σp is
literally the running sum of the column beside it and can be checked by eye.
`after` is the only post-renormalisation column, and it is what the solid bar
draws. The caption states the rule with its own numbers in it.

A first attempt at this had Σp climbing on the pre-cut basis next to a `p`
column on the post-cut basis — the same quiet mixing of scales wave 1 was failed
for. Splitting `after` into its own column is what fixed it.

**The surprisal tint was measured and found to encode nothing.** Thresholds of
1/2.5/5/8 bits were drawn from the range surprisal *can* span rather than the
range it occupies. A sampled token is usually a likely one:

| fixture | old buckets | new buckets |
|---|---|---|
| factual | **63**/0/1/4/0 | 47/16/0/0/5 |
| creative | 4/29/16/5/0 | 0/0/11/32/11 |
| code | 42/3/1/1/0 | 39/0/4/2/2 |

93% of the default text was in the transparent, zero-underline bucket — the
encoding was absent for the text it was supposedly colouring. Thresholds are now
probability landmarks (0.15/0.5/1.5/3.5 bits = p of 0.90/0.71/0.35/0.09). The
five underline weights were also two pairs of duplicates, collapsing the
non-colour channel to three levels; now distinct.

**Also:** the explanations were set in the smallest size and lightest grey in the
system while the readouts they explain were near-black — hierarchy inverted
against importance. And six columns at 375px squeezed the bar track to ~30px, so
below 720px the track wraps onto its own row: **309px instead of 30px**.

No gate regressed: frame p95 unchanged at 6.20ms across all three waves,
Lighthouse 100/100, determinism byte-identical (`evidence/wave-2/`).

## Wave 3 — the sliders did not do what the app said they did

**Verdict on wave 2: FAIL.** A third fresh critic confirmed the arithmetic was
now exact everywhere it looked, then found something worse: **moving a slider
never re-sampled the committed tokens, while the interface asserted in writing
that it did.** At step 14 of the factual fixture with top-p = 0.50 the committed
token sat at rank 5 carrying *both* `is-chosen` — the accent bar the caption
calls "the token that was committed" — and `is-excluded` with `after = —`,
beside a stat strip reading `Entropy 0.00 bits` and `Chosen p 0.9%`. Setting
temperature to 0, documented in-app as "always takes the argmax", changed
nothing.

**Fix: make the claim true rather than soften it.** Replay sources expose
`walk()`, and the engine re-derives every committed token whenever settings
change. This is affordable *because* the randomness is keyed by position —
nothing has to be replayed to reach the right random state — so the whole path
is a few hundred exponentials inside the input handler. Measured on 20 tokens:

| settings | completion |
|---|---|
| T = 0.80 | "Paris, France, on the Champ de Mars beside the Seine. The **riveted**-iron lattice" |
| T = 2.00 | "western Paris. The iron tower pylon over landmark. This monument reaches about" |
| T = 0.00 | "…The **wrought**-iron lattice" — every token rank 0 |

Returning to T = 0.80 restores the original text exactly, so determinism holds.
A committed token can no longer be excluded by top-p, because the completion is
re-derived from the nucleus being drawn.

**Cost: none measurable.** Re-sampling the entire completion on every drag frame
left p95 at 6.20ms with zero long frames — the same figure as waves 0–2.

A real bug surfaced while verifying it: the stream reconciler removed only the
span that diverged while truncating its bookkeeping array, orphaning every later
span in the DOM. A re-sampled completion showed its new first token followed by
the tail of the old one, which made the text look unchanged when it had been
redrawn.

## Cold start — passed, and earned three fixes

A fresh agent installed and drove the app from the README alone, no API key, no
source reading. **All nine checklist items passed, including the fork on the
first attempt with no guessing.** It also found real defects:

- **Selecting a token was mouse-only.** Completion tokens were bare spans with
  no role, tabindex or accessible name, so the first half of the headline
  interaction was unreachable by keyboard or screen reader — while the candidate
  bars beside them were proper buttons. The completion is now a listbox with a
  roving tabindex. Verified from the keyboard end to end: six arrow presses,
  Enter, then Enter on a candidate produces branch `root/6.2`.
- **A branch became unreachable as soon as you left it.** The trail listed only
  the active line's ancestors, so returning to root erased the chip for the
  branch just created — contradicting copy promising "every line you have
  opened". Every branch now gets a chip.
- **The completion panel said "Click any candidate to fork from it" from a cold
  load**, while all ten candidate buttons were disabled until a run produced
  tokens. Obey the screen instead of the README and you click ten dead buttons.

Plus README corrections: the stated Node floor did not match Lighthouse's
requirement, so the expected `EBADENGINE` warning is now documented; the top-p
section described a struck-through percentage that no longer exists; `npm test`
was described as sampling-math only when it is 157 tests across six files.

## Failed approaches (kept so they are not retried)

- **Idle-page frame measurement** — abandoned. Not a tuning problem: an idle
  page does not produce frames to measure. Superseded by continuously animating
  mocks plus a span check.
- **Screenshot diffing as the determinism oracle** — rejected before it was
  built. Any pixel tolerance is exactly where real nondeterminism hides. The
  nondeterminism mock demonstrates the point: it drifts in the ninth decimal of
  a probability while every visible pixel stays identical.

## Next action

Read the wave-3 critic's verdict and the final cold-start result; act on
whichever gap is larger.

## Budget

Waves used: 4 of 5. No piece has been parked — every gap a critic named has been
measured, fixed, and re-measured rather than deferred.
