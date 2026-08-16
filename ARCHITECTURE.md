# Architecture

## What this is

A single-page visualiser of LLM token sampling. It streams a completion token by
token and, for every token, shows the top-10 candidate distribution it was drawn
from — reshaped live by temperature and top-p, annotated with entropy and
surprisal, and forkable at any step.

## The one idea everything else follows from

**The sliders are generative, not decorative.**

A visualiser whose temperature slider only redrew bars would teach that
temperature is a display setting. It isn't: it changes what the model writes. So
in replay mode the engine genuinely re-samples from the reshaped distribution,
and the completion changes as you drag.

That forces two consequences which shape the whole codebase:

1. **Fixtures must be a lattice, not a recording.** If temperature changes which
   token is drawn, playback leaves any single recorded line immediately. So
   every node carries all ten candidates *with a real continuation each*
   (`FixtureNode.c = [text, logprob, nextNodeId][]`). Off-spine candidates run
   through short bridges that rejoin the spine at the next clause boundary, so
   authoring stays finite while every click lands on coherent text.

2. **Randomness must be keyed, not sequential.** The draw at a step is
   `rand01(seed, branchId, step)` — a pure hash of position in the branch tree.
   Nothing depends on how many draws came before, so exploring a fork cannot
   shift the tokens on any other path, and two runs with the same settings are
   byte-identical. A sequential PRNG would make determinism depend on traversal
   order, which forking destroys.

Fork then costs almost nothing: it is the ordinary commit path with the choice
overridden (`origin: 'forced'`), and the source restarts from the prefix.

## Layering

```
core/  <-  engine/  <-  sources/ , ui/  <-  main.ts
```

- **`core/`** imports *nothing*. Pure float64 mathematics: temperature softmax,
  top-p truncation and renormalisation, entropy, inverse-CDF sampling, the keyed
  RNG. This is what lets the sampling-math gate test it with no DOM in scope.
- **`engine/`** owns all mutable state and is its only writer.
- **`sources/`** push steps in. **`ui/`** subscribes to events out. Neither
  writes state directly.
- Nothing imports `ui/` except `main.ts`.

## Ownership

| Area | Owner | Note |
|---|---|---|
| `core/` | pure math | No imports, no allocation in hot functions |
| `engine/engine.ts` | the coupled cluster | Streaming, forking, sampling: one sequential owner |
| `sources/replay.ts` | lattice walker | Decides nothing; the engine chooses, it follows edges |
| `sources/live.ts`, `sse.ts` | live adapter | Records what the model chose; never invents |
| `ui/raf.ts` | the only DOM writer for hot elements | |
| `ui/bars.ts` | the frame-time gate | Where 16.7ms is won or lost |
| `harness/` | evidence | Gates the app; the app never grades itself |

Streaming state, bar animation and fork logic are **one coupled cluster** with a
single owner. They were never split across parallel work, because each depends
on the others' ordering.

## The render path

Nothing writes to hot DOM except the frame scheduler.

```
input event / engine event
      |  (synchronous: set a dirty flag, return)
      v
FrameScheduler.mark(Dirty.Bars | ...)
      |  (one requestAnimationFrame, coalesced)
      v
one write pass per frame
```

A rAF requested during input dispatch runs in that same frame, before style and
paint. There is no store, no batching layer, no debounce between the two — which
is why "the bars move in the frame the pointer moved" is a property of the
structure rather than a hope. This is also why the stack is vanilla TypeScript:
every framework worth considering puts a scheduler on this path that then has to
be bypassed.

Supporting rules:

- Only `transform` and `opacity` are animated, so the compositor does the work.
- Bar rows have fixed geometry built once, so a bar update cannot cause layout.
- No layout reads (`offsetWidth`, `getBoundingClientRect`) anywhere in `ui/` hot
  paths.
- Every per-frame numeric readout is a fixed-size `contain: content` element
  using tabular figures, so changing text cannot reflow its neighbours.
- Rows never reorder: temperature is monotonic on logits and top-p truncates a
  sorted prefix, so no slider can change the ranking. Sorting happens once per
  step, and no FLIP bookkeeping is needed.
- During a slider drag a `.is-dragging` class removes the bar transition, so the
  fills track the pointer 1:1 instead of chasing it a beat behind.

## Shared vocabulary

Defined in `src/engine/types.ts`.

- **Candidate** — one of the k tokens the source reported, with its logprob.
- **Step / StepDistribution** — the candidate set at one generation position.
- **Display distribution** — candidates after temperature and top-p. Recomputed
  every frame into preallocated buffers, never stored: it is a function of the
  current settings, not a fact about the generation.
- **TokenRecord** — a committed token. Its statistics are **frozen at sample
  time** and never recomputed, so moving a slider later cannot rewrite history.
  The transcript records what the sampler faced; the bar panel is the live view.
- **Branch** — a line of generation, storing only its own suffix. `root/12.3`
  means: diverged at step 12, took candidate 3.
- **Origin** — `sampled` (we drew it), `observed` (the model did), `forced` (the
  user clicked it).
- **Tail mass** — probability outside the top k. Never zero, always shown.

## Honest asymmetry between the two sources

Replay is the exact mode: move a slider and the token in front of you is
redrawn. Live cannot be — a completion already streaming cannot be retroactively
resampled, and the tokens are the model's, drawn under the settings the request
carried. In live mode the sliders reshape the display and apply to the next
request, and the UI says so rather than implying otherwise.

## Test surface

`harness/hooks.d.ts` defines `window.__glassbox`, fixed before any app code
existed. Two things are deliberately true of it:

- **There is no frame-timing hook.** The harness injects its own probe, because
  a page reporting its own smoothness is not evidence of smoothness.
- **The mutating hooks are for the determinism schedule only**, where two runs
  must receive identical values and a pixel drag cannot promise that. Every
  other gate drives the real controls with real input events.

URL flags: `?deterministic=1&seed=42&fixture=factual&cadence=80`. Cadence is
presentation only — because the RNG is keyed by step rather than drawn from a
stream, the same run at 40ms and 280ms produces identical text.

## Testids the harness depends on

`prompt-input`, `fixture-select`, `run`, `reset`, `temperature`, `top-p`,
`bars`, `bar-row` (with `data-rank`), `fork-button`, `stream`, `trail`,
`trail-chip`, `stats`, `entropy`, `chosen-prob`, `nucleus-size`, `tail-mass`,
`tail-caption`, `controls`, `error`, `source-replay`, `source-live`,
`base-url`, `model`, `api-key`.

## Security

The live API key lives in one module-private variable in `sources/live.ts`. It
is never written to localStorage, sessionStorage, cookies, IndexedDB or a URL,
and a `pagehide` listener clears it. `vite.config.ts` defines the dev-only
environment key **only when `command === 'serve'`**; the production define is
always the empty string, so a key cannot be baked into a build.
