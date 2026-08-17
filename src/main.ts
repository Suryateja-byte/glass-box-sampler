import './design-tokens.css';
import './styles.css';
import type { FixtureFile } from './engine/types';
import { createApp } from './ui/app';
import { COPY } from './ui/copy';

/**
 * Bootstrap.
 *
 * URL flags exist so the harness can pin the app to a reproducible state:
 *
 *   ?deterministic=1  the run is being recorded as evidence
 *   &seed=42          which keyed RNG stream to draw from
 *   &fixture=factual  which lattice to replay
 *   &cadence=80       ms between tokens; presentation only, never content
 *
 * Cadence cannot change what gets generated. The randomness is keyed by step
 * index rather than drawn from a stream, so a run at 40ms and the same run at
 * 280ms produce identical text.
 */

/**
 * Only ids, labels and prompts live in the bundle. The lattices themselves are
 * fetched on demand: they are the largest thing in the project and loading all
 * three to show a three-item dropdown would be paid for on every first render.
 */
const CATALOG = [
  {
    id: 'factual',
    label: 'Factual — peaked distributions',
    prompt: 'The Eiffel Tower is located in',
  },
  {
    id: 'creative',
    label: 'Creative — flat distributions',
    prompt: 'The lighthouse keeper wrote in her journal:',
  },
  { id: 'code', label: 'Code — bimodal distributions', prompt: 'def fibonacci(n):' },
] as const;

const LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  factual: () => import('./fixtures/factual.json'),
  creative: () => import('./fixtures/creative.json'),
  code: () => import('./fixtures/code.json'),
};

/**
 * Checks the shape before trusting it.
 *
 * An imported JSON module arrives structurally typed -- `version` widens to
 * `number`, the candidate tuples widen to arrays -- so it cannot satisfy
 * FixtureFile without an assertion. Rather than assert blindly, verify the
 * parts the walker actually depends on, so a malformed lattice fails here with
 * a message instead of somewhere deep in the traversal.
 */
function asFixture(value: unknown): FixtureFile {
  const fixture = value as FixtureFile;
  const entry = fixture?.nodes?.[fixture.entry];
  if (fixture?.version !== 1 || !fixture.id || !entry) {
    throw new Error('Fixture is malformed: expected version 1 and a resolvable entry node.');
  }
  return fixture;
}

async function loadFixture(id: string): Promise<FixtureFile> {
  const loader = LOADERS[id] ?? LOADERS['factual']!;
  const module = await loader();
  return asFixture(module.default);
}

function readNumber(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;

  const params = new URLSearchParams(location.search);
  const requested = params.get('fixture') ?? 'factual';
  const fixtureId = requested in LOADERS ? requested : 'factual';

  try {
    const initialFixture = await loadFixture(fixtureId);
    root.replaceChildren();
    createApp({
      root,
      catalog: CATALOG,
      initialFixture,
      loadFixture,
      seed: readNumber(params, 'seed', 42),
      cadenceMs: Math.max(0, readNumber(params, 'cadence', 280)),
      deterministic: params.get('deterministic') === '1',
    });
  } catch (error) {
    // Nothing in this app writes to console; a failure to boot is shown.
    const message = document.createElement('p');
    message.className = 'error-banner';
    message.setAttribute('role', 'alert');
    message.textContent = COPY.errors.unknown(
      error instanceof Error ? error.message : String(error),
    );
    root.replaceChildren(message);
  }
}

void boot();
