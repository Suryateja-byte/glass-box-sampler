# Cold-start transcript — Glass-Box Sampler

A developer who has never seen this repository, using **only `README.md`**, tries to get it
running and complete a fork interaction. No API key. No source files under `src/` or
`harness/` were read to work out how to run or drive the app; everything below was derived
from the README plus what the running page exposes (accessible names, roles, rendered DOM).

- Repo under test: `C:\Users\surya\AppData\Local\Temp\claude\coldstart2\glass-box LLM sampler`
- Date: 2026-08-16
- Host: Windows 11 Pro 26300, Node v22.14.0, npm 10.8.1
- Browser: Chromium 1234 from the repo's own `node_modules` (`playwright-core`), launched
  isolated — see "Browser note" below.

---

## 1. Commands run, and what happened

### `node --version` / `npm --version`
```
v22.14.0
10.8.1
```
README requires Node 22.12+ and npm 10+. Satisfied.

### `npm install`
```
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: 'lighthouse@13.4.1',
npm warn EBADENGINE   required: { node: '>=22.19' },
npm warn EBADENGINE   current: { node: 'v22.14.0', npm: '10.8.1' }
npm warn EBADENGINE }

added 167 packages, and audited 168 packages in 7s
found 0 vulnerabilities
```
Exactly the one warning the README predicts, with the same package and the same reason.
No prompts, no other errors. **PASS.**

### `npm test`
```
 ✓ src/core/entropy.test.ts    (18 tests)
 ✓ src/core/transform.test.ts  (31 tests)
 ✓ src/sources/sse.test.ts     (33 tests)
 ✓ src/core/sample.test.ts     (12 tests)
 ✓ src/engine/engine.test.ts   (14 tests)
 ✓ src/fixtures/replay.test.ts (49 tests)

 Test Files  6 passed (6)
      Tests  157 passed (157)
   Duration  1.06s
```
README says "157 tests in about a second". Exact. **PASS.**

### `npm run dev`
```
  VITE v8.2.1  ready in 521 ms
  ➜  Local:   http://localhost:5173/
```
Used the printed URL, as the README instructs. **PASS.**

### `npm run harness:selftest`
6 passed in 32.7 s, exit code 0, no port complaint. Full output in section 6. **PASS.**

### Browser note
The shared Playwright MCP browser was navigated out from under me mid-session — my tab
ended up on `http://localhost:4173/?seed=42&fixture=factual`, a server owned by another
agent. Per the brief I abandoned the shared browser and launched an isolated Chromium from
this repo's own `node_modules/playwright-core`, driven by a small local script. Everything
from that point on ran in the isolated browser against `http://localhost:5173/`, which I
started myself. I never deliberately bound 4173, and `netstat` showed nothing listening on
it by the time I checked (the other agent's server had already gone). `npm run
harness:selftest` was run against its own mock pages and reported no port conflict; whether
it transiently used 4173 internally is not something the README says, which is defect D6.
Both the dev server and the isolated Chromium were stopped at the end; `netstat` confirms
nothing is listening on 5173 or 4173.

---

## 2. Checklist

| # | Item | Result |
|---|---|---|
| 1 | `npm install` clean | **PASS** |
| 2 | App starts per README and loads | **PASS** |
| 3 | Replay default: tokens stream, no network, no key | **PASS** |
| 4 | Run streams tokens; candidate bars update per token | **PASS** |
| 5 | Temperature reshapes distribution + rewrites text; T=0 → greedy | **PASS** |
| 6 | Top-p excludes candidates; Σp explains the cut | **PASS** |
| 7 | Complete a fork (mouse) — branch trail shows it | **PASS** |
| 8 | Complete a fork with the keyboard only | **PASS (README does not describe the path that works)** |
| 9 | Earlier trail chip switches back; new branch still listed | **PASS** |
| 10 | `npm test` passes | **PASS** |
| 11 | `npm run harness:selftest` passes | **PASS** |

### 1. `npm install` — PASS
One `EBADENGINE` warning for `lighthouse`, exactly as documented. Nothing interactive.

### 2. App starts and loads — PASS
`npm run dev` printed `http://localhost:5173/`. Page title
"Glass-Box Sampler — how a language model picks each token", full UI rendered: Sampling
panel (Prompt, Fixture, Run/Reset, Source, Temperature, Top-p), Candidates panel with a
10-row table (`token / p / Σp / after`), Completion panel with a "Branch trail" nav
containing a `root` chip.

### 3. Replay is the default; no network; no key — PASS
- The `Replay` radio is `checked` on load; `Live` is not.
- Copy under the prompt: "Replay runs offline from local fixtures. No request leaves the page."
- Network requests captured for the whole session: 29, every one of them
  `http://localhost:5173/...` (Vite dev module loads, `src/fixtures/factual.json`,
  `favicon.svg`). Requests recorded across a full Run: **0 new**.
- No API key was entered anywhere, and nothing asked for one.

### 4. Run streams tokens; bars update per token — PASS
Sampled the page every ~130 ms during a run. Token count climbed 0 → 1 → 2 → 3 → … and the
candidate table changed at every step:

| tokens | last token | rank 1 | entropy |
|---|---|---|---|
| 1 | ` Paris` | `·Paris` 96.3% | 0.33 bits |
| 2 | `,` | `,` 98.5% | 0.15 bits |
| 3 | ` France` | `·France` 86.5% | 0.89 bits |
| 5 | ` on` | `·on` 96.6% | 0.28 bits |
| 6 | ` the` | `·the` 96.7% | 0.29 bits |
| 7 | ` Champ` | `·Champ` 88.4% | 0.81 bits |

Final completion (68 tokens, T=0.80, p=1.00): " Paris, France, on the Champ de Mars beside
the Seine. The riveted-iron lattice tower was designed by Gustave Eiffel and completed in
1889 at the World's Fair. …". Zero network requests during the run.

### 5. Temperature — PASS
Real mouse drag on the Temperature slider (mouse down inside the track, move, release).
Distribution reshapes *and* the completion text is rewritten live, mid-drag:

| T | rank 1 | entropy | completion (head) |
|---|---|---|---|
| 0.80 | `.` 97.7% | 0.22 bits | " Paris, France, on the Champ de Mars beside the Seine. The riveted-iron lattice tower was designed by Gustave Eiffel…" |
| 1.32 | `·Earth` 75.7% | 1.46 bits | " downtown Paris. The wrought-iron lattice pylon was created by Gustave centenary. It stands about 276 metres tall…" |
| 2.00 | `·it` 51.6% | 2.50 bits | " western Paris. The iron tower pylon over landmark. This monument reaches about 400 metres overall…" |
| 0.00 | `·188` 100.0% | 0.00 bits | " Paris, France, on the Champ de Mars beside the Seine. The wrought-iron lattice tower was designed by Gustave Eiffel and completed in 188" |

At T=0: `Chosen p 100.0%`, `Nucleus 1 of 10`, `Entropy 0.00 bits`, every non-leading
candidate shows `0%` and `—` — i.e. the greedy path, as the README promises.

Determinism spot-check: dragging back to exactly T=0.80 reproduced the original text
token-for-token over the steps it re-derived.

### 6. Top-p — PASS
Drag to **p = 0.39** on a step whose leading candidate is 95.2%:

```
1  ·Earth      95.2%   95.2%   100.0%     <- is-chosen is-nucleus-edge
2  ·the         2.34%  97.5%   —          <- is-excluded
3  ·earth       1.11%  98.6%   —
…
10 ·feet        0.03%  100.0%  —
```
Nucleus `1 of 10`; the excluded rows keep a ghost bar at their pre-cut length
(`bar-ghost scaleX(0.02338)`) with `bar-fill scaleX(0)`, and their accessible names read
"…excluded by top-p". The survivor's `after` renormalises 95.2% → 100.0%. Completion
rewritten ("riveted-iron" → "wrought-iron", "at the World's Fair" → "for the World's Fair",
"towers about 324" → "stands about 330").

At **p = 0.98** on a step with Σp 97.7 / 98.6 / 99.0, the cut lands between rank 2 and
rank 3 — exactly where the running total first reaches p — and rank 2 carries the
`is-nucleus-edge` marker (the hairline). Nucleus `2 of 10`; survivors renormalise
97.7 → 99.2% and 0.83 → 0.84%. The `Σp` column does explain the cut. **PASS**, with the
caveat in defect D4 below about the value the README tells you to try.

### 7. Fork with the mouse — PASS (the important one)
Exactly the README's step 4:
1. Clicked the token at index 12 in the completion — the `.` after "Seine". Focus moved to
   that option (`". · 98.4% · 0.02 bits surprisal"`), and the Candidates panel switched to
   that step (`1 . 97.7% / 2 , 0.83% / 3 ; 0.40% / …`).
2. Clicked the rank-3 candidate bar, accessible name `"Fork here, taking ;. Rank 3, 0.40%"`.

The run branched there and re-streamed from step 12 taking `;`:

```
before:  … beside the Seine. The riveted-iron lattice tower was designed by Gustave Eiffel …
after:   … beside the Seine; the city spreads beyond. The wrought-iron lattice tower was built by exposition Eiffel. …
```

Branch trail went from `[root*]` to `[root, "; @ 12"*]` (`*` = `aria-current`).

### 8. Fork with the keyboard only — PASS, but not by following the README
Keyboard-only sequence that actually works:
1. `Tab` until focus reaches the completion (`div[role=listbox]`, "Generated completion").
2. `ArrowRight` ×20 — focus walks token to token (`"- · 97.9% · 0.03 bits surprisal"`),
   selection index 20, and the Candidates panel follows to that step.
3. `Enter` — **does nothing**. State before and after is byte-identical.
4. `Shift+Tab` ×4 — back out of the listbox, backwards past both trail chips
   (`"; @ 12"`, `root`), and into the candidate list, landing on
   `"Fork here, taking !. Rank 10, 0.06%"`.
5. `Enter` — fork taken.

Result: trail `[root, "; @ 12", "! @ 20"*]`, completion re-derived from step 20
("The wrought**!**iron lattice tower was designed under Gustave Eiffel and completed in
1889 for the World's Fair. It stands about 330 metres tall…").

The functionality is there and fully reachable by keyboard, so this is a PASS — but see
defect **D1**: the README's only fork instruction is "click one of the candidate bars", and
the direction that works from the completion is *backwards* (`Shift+Tab`), which nothing
tells you. The `Enter` step a reader would naturally try is inert.

### 9. Trail chips — PASS
- Clicked `"; @ 12"`: switched back to that line (55 tokens, "…the Seine; the city spreads
  beyond. The wrought-iron lattice tower was built by exposition Eiffel…"), and all three
  chips stayed listed: `[root, "; @ 12"*, "! @ 20"]`.
- Clicked `root`: restored the original 68-token completion, chips still
  `[root*, "; @ 12", "! @ 20"]`.

Branches created earlier survive the switch in both directions.

### 10. `npm test` — PASS
157/157 in 1.06s.

### 11. `npm run harness:selftest` — PASS
6/6 mock gates fired exactly as intended.

---

## 3. README defects

Blunt list. "Defect" here includes anything that cost me an attempt, a guess, or a
tempted look at the source.

**D1 — The fork instructions have no keyboard path to the candidate bars. (Worst one.)**
Step 4 says: *"Select a token in the completion (click it, or focus the completion and use
the arrow keys), then **click one of the candidate bars**"*. It offers a keyboard route into
the completion and then dead-ends at "click". A keyboard user has to discover that:
- `Enter` on the selected token does nothing at all;
- the candidate list comes *before* the completion in tab order, so the way to it is
  `Shift+Tab`, not `Tab`;
- that path goes backwards through the branch-trail chips first;
- reaching rank 1 rather than rank 10 costs 13 `Shift+Tab` presses.
This took several probes to establish. One sentence in the README ("from the completion,
`Shift+Tab` back into the candidate list and press `Enter`") would remove all of it.

**D2 — Nothing says the Run button is disabled once a completion exists.**
After a run finishes, `Run` stays labelled "Run" but is `disabled`; you must press `Reset`
first. My second `Run` click failed (30 s Playwright timeout on a disabled control) and I
had to work out why. The "Try this first" walkthrough reads as though you can press Run
whenever you like.

**D3 — The Run button's other states are undocumented.** It reads **"Pause"** while a run is
streaming and **"Resume"** after you switch branches via a trail chip. The README only ever
names "Run" and "Reset", so the button you were told to press is frequently not on screen
under that name.

**D4 — The suggested top-p demo is degenerate on the default fixture.** Step 3 says drag
top-p to about 0.4 and watch where the hairline falls, describing "the shortest run of
candidates whose running total reaches p". On the default `Factual — peaked distributions`
fixture the leading candidate is routinely 95–98%, so at p=0.4 the nucleus is **1 of 10**:
there is no interior hairline, nine rows just go to `—`, and the "survivors grow past their
ghosts" effect exists only on the single top bar. You have to reach p≈0.98 (nucleus 2 of 10)
or switch to the `Creative — flat distributions` fixture to see what the paragraph
describes. The README mentions neither.

**D5 — "The whole completion is re-derived" hides a step-count rule.** After a T=2.0 run
that stopped early at 29 tokens, dragging temperature back down re-derived **29 tokens**,
not a fresh full-length completion — so following the README's own step 2 (drag to 2, then
drag to 0) leaves you staring at a greedy completion truncated mid-word:
`"…and completed in 188"`. It looks like a bug until you press Reset and Run again. The
README should say that slider changes re-derive the *same number of steps*, and that a
fresh length needs Reset + Run.

**D6 — No documented way to run the harness on a port other than 4173.** Troubleshooting
says only "Stop the other process." When 4173 belongs to something you do not control
(here: another agent's server, which is exactly the situation the note anticipates), the
README leaves you with no option — no env var, no flag, no alternative documented.
`npm run harness:selftest` turned out not to need 4173, but the README does not say that
either, so I had no way to know it was safe to run.

**D7 — "Try this first" step 4 says "Select a token in the completion (click it…)" but the
selection is invisible in the accessibility tree.** No option ever carries
`aria-selected="true"` until a couple of arrow presses in, and the listbox has no
`aria-activedescendant`. I could only confirm my token click had "selected" anything by
watching the Candidates panel change. Minor, but it made verifying the README's own step
harder than it should be.

**D8 — Requirements say "A Chromium browser for the optional evidence harness" without
saying how to get one.** The install command `npx playwright install chromium` is buried at
the bottom of "Verify it" behind "If Playwright reports a missing browser", not next to the
requirement. Minor ordering complaint.

**Non-defects worth recording (the README got these right):** the Node/npm floor; the
`EBADENGINE` warning prediction, down to the package name; the "use the URL from the
terminal, not an assumed port" advice; the 157-test count and the ~1s runtime; the claim
that replay makes no network request (verified: zero requests during a run); the T=0 greedy
claim; the top-p ghost-bar/`—`/renormalisation description; and the spaced-path note (the
whole repo path contains a space and nothing broke).

---

## 4. Points where I was tempted to read the source

1. **Keyboard fork (D1).** After `Enter` did nothing I wanted to open `src/ui/` to find the
   key handler. I probed the tab order instead and found `Shift+Tab`.
2. **Disabled Run button (D2).** When the click timed out on a `disabled` control with no
   explanation anywhere in the README, opening `src/ui/controls.ts` was the obvious move. I
   guessed Reset first, and that worked.
3. **Truncated completion after the temperature round-trip (D5).** The `…completed in 188`
   output looked like a bug; I wanted `src/engine/` to see whether re-derivation is capped.
   Resolved by experiment (Reset + Run restores full length) rather than by reading.

No file under `src/` or `harness/` was opened. Selectors used to drive the page came from
the rendered accessibility tree and DOM of the running app (`role=listbox`,
`role=option`, `aria-label="Candidate distribution for the selected step"`, and the
`"Fork here, taking …"` button names), which is what a user with devtools sees.

---

## 5. Artifacts

- `evidence/cold-start/fork-taken.png` — full-page screenshot taken immediately after the
  keyboard fork. Shows the branch trail `root · ; @ 12 · ! @ 20` with `! @ 20` current, the
  forked completion ("The wrought**!**iron lattice tower…"), the focus ring still on the
  rank-10 candidate button that was activated with `Enter`, and the Candidates panel for
  the forked step.
- `evidence/cold-start/transcript.md` — this file.

The dev server started for this run (`npm run dev`, pid on :5173) and the isolated Chromium
were both stopped at the end of the session.

---

## 6. Raw selftest output

```
> glass-box-sampler@1.0.0 harness:selftest
> node harness/run.mjs --selftest

=== Harness self-test ===
Proving each gate fires on a page built to fail it.

Running 6 tests using 1 worker

  ok 1 [selftest] › harness\specs\selftest.spec.ts:125:1 › green mock passes every gate (5.1s)
  ok 2 [selftest] › harness\specs\selftest.spec.ts:141:1 › jank mock fails ONLY the frame gate (5.8s)
  ok 3 [selftest] › harness\specs\selftest.spec.ts:154:1 › noisy mock fails ONLY the console gate (4.9s)
  ok 4 [selftest] › harness\specs\selftest.spec.ts:165:1 › nondeterministic mock fails ONLY the determinism gate (4.9s)
  ok 5 [selftest] › harness\specs\selftest.spec.ts:179:1 › motion mock fails ONLY the reduced-motion gate, despite claiming otherwise (4.9s)
  ok 6 [selftest] › harness\specs\selftest.spec.ts:194:1 › overflow mock fails ONLY the viewport gate (4.9s)

  6 passed (32.7s)

SELF-TEST PASSED: every gate fired on its broken mock and stayed quiet otherwise.
```
