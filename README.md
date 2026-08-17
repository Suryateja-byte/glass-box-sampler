# Glass-Box Sampler

An interactive view of LLM token sampling. It streams a completion token by
token and, for each one, shows the top-10 candidate distribution it was drawn
from — reshaped live by temperature and top-p, annotated with entropy and
surprisal, and forkable at any step.

**[Try it →](https://suryateja-byte.github.io/glass-box-sampler/)** — nothing to
install. Press **Run**, or **D** for a scripted tour.

**It runs entirely offline by default.** No API key, no network request, no
account. The default source replays bundled fixtures, so the hosted page above
is the whole application rather than a front end for a service.

---

## Requirements

- **Node 22.12 or newer** and npm 10+ (`node --version`)
- A Chromium browser, for the optional evidence harness only. If Playwright
  reports a missing browser, run `npx playwright install chromium`.

Tested on Windows 11 with Node 22.14.

> On Node below 22.19 `npm install` prints one `EBADENGINE` warning for
> `lighthouse`, which is a devDependency used only by `npm run harness`. The
> install succeeds and Lighthouse runs; the warning is expected.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the URL it prints (normally <http://localhost:5173>; if that port is busy
Vite picks the next one, so use the URL from the terminal rather than assuming).
Replay mode is on from the start.

> **Path note:** if you clone into a directory whose name contains spaces, quote
> it: `git clone <url> "glass-box LLM sampler"`. The tooling handles spaced paths
> — it never passes a path through a shell — but your own `cd` still needs the
> quotes.

## Try this first (about a minute)

1. Press **Run**. Tokens stream into the completion, and the bars redraw for
   each one.
2. Drag **Temperature** toward 2. The distribution flattens as you drag. Drag it
   toward 0 and it collapses onto the leading candidate.
3. Drag **Top-p** down. Watch the `Σp` column: top-p keeps the
   shortest run of candidates whose running total reaches p, and the hairline
   is drawn exactly where that happens. Dropped candidates lose their solid bar
   and read `—` in the `after` column, but keep a faint ghost bar at their
   pre-cut length so you can see what was discarded. The survivors grow past
   their ghosts — that overhang is the renormalisation.
   On the peaked *Factual* fixture the leading candidate often exceeds p on its
   own, so the nucleus collapses straight to `1 of 10`; try values near 0.98, or
   switch to the *Creative* fixture, to watch the cut move through the list.
4. **Fork.** Select a token in the completion, then choose one of the candidate
   bars: the run branches at that step, taking *that candidate* instead.
   - With a mouse: click the token, then click the bar.
   - From the keyboard: Tab to the completion, move with the arrow keys, press
     **Enter** to select — focus jumps to the candidate list — then Tab to the
     candidate you want and press **Enter** again.

   The branch trail above the completion lists every line you have opened, and
   clicking any chip switches back to it.
5. Press **D** for a scripted ~30 second demo of all of the above.

The run button changes with the state: **Run**, then **Pause** while streaming,
then **Resume** if you stop partway. Once a completion has finished it is
disabled — press **Reset** to start another.

Temperature and top-p are not display filters. In replay mode the whole
completion is re-derived whenever you move a slider, so the text in front of you
is rewritten, not just relabelled — set temperature to 0 and it collapses to the
greedy path. Same seed and same settings always reproduce the same completion.

## Modes

**Replay** (default) walks a bundled lattice of recorded-shape distributions.
Every candidate carries a real continuation, which is what lets any of them be
forked into. Nothing leaves the page.

**Live** streams from an OpenAI-compatible endpoint using
`stream + logprobs + top_logprobs`. The key is read from a session-only password
field (or `OPENAI_API_KEY` in dev) and is held in memory for the tab only — it
is never written to localStorage, sessionStorage, a cookie, or a URL, and it is
cleared when the page is hidden. A production build can never contain a key: the
build-time define is hard-wired to empty.

> **Live mode ships untested against a real endpoint.** No API key was available
> in the environment where this was built, so it has never been run against
> `api.openai.com`. Its stream parser is unit-tested hard (33 tests, including
> every chunk-boundary split of each test stream), and its request shape follows
> the documented API — but the end-to-end path is unverified. Replay is the
> default for that reason.
>
> Two further honest limits of live mode: the endpoint does the sampling, so
> moving a slider mid-completion cannot change tokens already streamed (it
> applies to the next request), and browser-direct calls need an endpoint that
> sends CORS headers. `api.openai.com`, OpenRouter, Groq and local
> llama.cpp/vLLM do; many enterprise gateways do not.

## Verify it

The unit suite: 157 tests in about a second. The sampling maths — softmax with
temperature, top-p truncation and renormalisation, entropy — is checked against
reference values computed independently in Python at 40 digits; the rest covers
the streaming parser, the engine's determinism and forking, and the replay
fixtures.

```bash
npm test
```

The full evidence harness. Builds, serves, and measures every gate (console
cleanliness, frame time, determinism, responsiveness, reduced motion,
Lighthouse), writing screenshots, a demo video, metrics and a verdict table to
`evidence/wave-N/`:

```bash
npm run harness
```

It briefly opens a visible browser window: frame timing is measured headed,
against real vsync, because headless timings are smoother than what a person
would actually see.

Prove the harness can fail, by running every gate against mock pages built to
break exactly one of them:

```bash
npm run harness:selftest
```

If Playwright reports a missing browser:

```bash
npx playwright install chromium
```

## Layout

```
src/core/       pure sampling maths; imports nothing, tested without a DOM
src/engine/     the single owner of generation state
src/sources/    replay lattice walker; live OpenAI-compatible adapter
src/ui/         renderers; one frame scheduler is the only hot-DOM writer
src/fixtures/   the lattices, and the generator that builds them
harness/        gates, mocks, and the evidence orchestrator
evidence/       harness output, one directory per wave
```

`ARCHITECTURE.md` explains why the fixtures are a lattice rather than a
recording, and why the randomness is keyed rather than sequential. `PROGRESS.md`
tracks gate status and records approaches that failed.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build on :4173 |
| `npm test` | Unit tests: sampling maths, engine, stream parser, fixtures |
| `npm run harness` | Full evidence bundle |
| `npm run harness:selftest` | Prove the gates can fail |
| `npm run fixtures` | Regenerate the replay lattices |
| `npm run typecheck` | `tsc --noEmit` |

## Troubleshooting

**Port 4173 is in use.** The harness uses `--strictPort` deliberately and will
fail rather than audit whatever else is on that port — a stale server would mean
grading a build that no longer exists. Stop the other process, or run just the
gate self-test, which needs no fixed port:

```bash
npm run harness:selftest
```

**`npm run harness` says the served build does not match `dist/`.** Another
server is holding the port. The harness refuses to grade a page it did not just
build.

**Frame gate reports `INSUFFICIENT_DATA`.** The sample was too thin to rule on,
usually because the window lost focus mid-run. Re-run and leave it in front.

**Frame gate reports `UNSTABLE`.** The three runs disagreed by more than 4ms, so
the machine rather than the app was deciding the number. Close other work and
re-run.
