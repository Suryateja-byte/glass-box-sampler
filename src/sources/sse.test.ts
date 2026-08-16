import { describe, expect, it } from 'vitest';
import { SseParser, type SseEvent } from './sse';

/**
 * The parser's whole job is to be indifferent to where the network split the
 * bytes, so almost every test here feeds one logical stream through many
 * chunkings and demands identical output. A parser that only ever sees whole
 * events looks perfect right up to the first slow proxy.
 *
 * Streams are built by joining lines with an explicit terminator rather than
 * written as template literals: the line endings of this source file must not
 * be able to change what is under test.
 */

function feed(chunks: readonly string[]): SseEvent[] {
  const parser = new SseParser();
  const events: SseEvent[] = [];
  for (const chunk of chunks) events.push(...parser.push(chunk));
  return events;
}

/** Joins SSE lines with `eol`, including the terminator on the final line. */
function stream(lines: readonly string[], eol = '\n'): string {
  return lines.join(eol) + eol;
}

function splitInto(text: string, n: number): string[] {
  const size = Math.max(1, Math.ceil(text.length / n));
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

/** Deterministic PRNG, so a failing random chunking is reproducible by seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomChunks(text: string, seed: number): string[] {
  const rng = mulberry32(seed);
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const size = 1 + Math.floor(rng() * 13);
    chunks.push(text.slice(i, i + size));
    i += size;
  }
  return chunks;
}

/** Every chunking we insist must produce the same events. */
function chunkings(text: string): { label: string; chunks: string[] }[] {
  const all: { label: string; chunks: string[] }[] = [
    { label: 'single chunk', chunks: [text] },
    // split('') is harsher than [...text]: it splits by UTF-16 code unit, so it
    // tears astral characters in half as well as splitting every token.
    { label: 'one code unit per chunk', chunks: text.split('') },
    { label: 'empty chunks interleaved', chunks: text.split('').flatMap((c) => ['', c, '']) },
  ];
  for (const n of [2, 3, 5, 10, 17, 64]) {
    all.push({ label: `${n} even chunks`, chunks: splitInto(text, n) });
  }
  for (let i = 1; i < text.length; i += 1) {
    all.push({ label: `two chunks, split at ${i}`, chunks: [text.slice(0, i), text.slice(i)] });
  }
  for (let seed = 1; seed <= 25; seed += 1) {
    all.push({ label: `random chunking, seed ${seed}`, chunks: randomChunks(text, seed) });
  }
  return all;
}

function expectEveryChunking(text: string, expected: readonly SseEvent[]): void {
  for (const { label, chunks } of chunkings(text)) {
    expect(feed(chunks), label).toEqual(expected);
  }
}

// A die emoji: two UTF-16 code units, so a code-unit-level chunking splits it
// down the middle. Buffering by concatenation is what makes that survive.
const DIE = '\u{1F3B2}';

const CANONICAL_LINES = [
  ': keep-alive from an idle proxy',
  '',
  'event: message',
  'id: 42',
  'data: {"choices":[{"delta":{"content":"Hello"},"logprobs":null}]}',
  '',
  `data:{"choices":[{"delta":{"content":" world ${DIE}"}}]}`,
  '',
  'retry: 3000',
  'data: line one',
  'data: line two',
  '',
  'data: [DONE]',
  '',
];

const CANONICAL_EVENTS: SseEvent[] = [
  { kind: 'data', data: '{"choices":[{"delta":{"content":"Hello"},"logprobs":null}]}' },
  { kind: 'data', data: `{"choices":[{"delta":{"content":" world ${DIE}"}}]}` },
  { kind: 'data', data: 'line one\nline two' },
  { kind: 'done' },
];

describe('SseParser: chunk boundaries', () => {
  it('produces identical events for every chunking of an LF stream', () => {
    expectEveryChunking(stream(CANONICAL_LINES, '\n'), CANONICAL_EVENTS);
  });

  it('produces identical events for every chunking of a CRLF stream', () => {
    expectEveryChunking(stream(CANONICAL_LINES, '\r\n'), CANONICAL_EVENTS);
  });

  it('produces identical events for every chunking of a CR-only stream', () => {
    expectEveryChunking(stream(CANONICAL_LINES, '\r'), CANONICAL_EVENTS);
  });

  it('reassembles one payload split across two chunks', () => {
    expect(feed(['data: {"id":"a","cho', 'ices":[]}\n\n'])).toEqual([
      { kind: 'data', data: '{"id":"a","choices":[]}' },
    ]);
  });

  it('reassembles one payload split across ten chunks', () => {
    const payload = '{"id":"chatcmpl-1","choices":[{"delta":{"content":"x"}}]}';
    const text = `data: ${payload}\n\n`;
    const chunks = splitInto(text, 10);
    expect(chunks.length).toBeGreaterThanOrEqual(10);
    expect(feed(chunks)).toEqual([{ kind: 'data', data: payload }]);
  });

  it('reassembles a payload split between the two halves of a surrogate pair', () => {
    const text = `data: {"c":"${DIE}"}\n\n`;
    const cut = text.indexOf(DIE) + 1;
    expect(feed([text.slice(0, cut), text.slice(cut)])).toEqual([
      { kind: 'data', data: `{"c":"${DIE}"}` },
    ]);
  });

  it('holds a CRLF pair that straddles a chunk boundary', () => {
    // The classic: the CR ends one chunk and the LF opens the next. Treating
    // them as two terminators would fabricate a blank line and dispatch early.
    expect(feed(['data: a\r', '\n\r', '\ndata: b\r\n\r\n'])).toEqual([
      { kind: 'data', data: 'a' },
      { kind: 'data', data: 'b' },
    ]);
  });

  it('does not merge separate events when the blank line straddles a boundary', () => {
    expect(feed(['data: a\n', '\ndata: b\n', '\n'])).toEqual([
      { kind: 'data', data: 'a' },
      { kind: 'data', data: 'b' },
    ]);
  });
});

describe('SseParser: event framing', () => {
  it('emits several complete events delivered in one chunk', () => {
    const text = stream(['data: one', '', 'data: two', '', 'data: three', '']);
    expect(feed([text])).toEqual([
      { kind: 'data', data: 'one' },
      { kind: 'data', data: 'two' },
      { kind: 'data', data: 'three' },
    ]);
  });

  it('joins multiple data lines of one event with a newline', () => {
    const text = stream(['data: a', 'data: b', 'data: c', '']);
    expect(feed([text])).toEqual([{ kind: 'data', data: 'a\nb\nc' }]);
  });

  it('keeps an empty data line as an empty segment', () => {
    const text = stream(['data: a', 'data:', 'data: b', '']);
    expect(feed([text])).toEqual([{ kind: 'data', data: 'a\n\nb' }]);
  });

  it('ignores comment lines, including keep-alive pings', () => {
    const text = stream([': ping', ':', ': data: not really data', 'data: real', '']);
    expect(feed([text])).toEqual([{ kind: 'data', data: 'real' }]);
  });

  it('ignores event, id and retry fields', () => {
    const text = stream(['event: delta', 'id: 7', 'retry: 1500', 'data: payload', '']);
    expect(feed([text])).toEqual([{ kind: 'data', data: 'payload' }]);
  });

  it('dispatches nothing for a blank line with no data field', () => {
    const text = stream([': comment', '', 'event: ping', '', '', '', 'data: x', '']);
    expect(feed([text])).toEqual([{ kind: 'data', data: 'x' }]);
  });

  it('strips exactly one space after the colon', () => {
    const text = stream(['data:  two spaces became one', '', 'data:no space at all', '']);
    expect(feed([text])).toEqual([
      { kind: 'data', data: ' two spaces became one' },
      { kind: 'data', data: 'no space at all' },
    ]);
  });

  it('splits a field on its first colon only', () => {
    // JSON payloads are full of colons; splitting on the last one would shred
    // every event this app cares about.
    const payload = '{"a":{"b":"c:d"}}';
    expect(feed([stream([`data: ${payload}`, ''])])).toEqual([{ kind: 'data', data: payload }]);
  });

  it('treats a bare field name with no colon as an empty value', () => {
    expect(feed([stream(['data', ''])])).toEqual([{ kind: 'data', data: '' }]);
  });

  it('preserves escaped newlines inside a payload', () => {
    // Two characters, backslash and n -- not a line break, and not a separator.
    const payload = '{"content":"a\\n\\nb"}';
    expectEveryChunking(stream([`data: ${payload}`, '']), [{ kind: 'data', data: payload }]);
  });

  it('handles a stream that mixes LF and CRLF separators', () => {
    const text = 'data: a\n\ndata: b\r\n\r\ndata: c\n\n';
    expectEveryChunking(text, [
      { kind: 'data', data: 'a' },
      { kind: 'data', data: 'b' },
      { kind: 'data', data: 'c' },
    ]);
  });
});

describe('SseParser: [DONE]', () => {
  it('reports the sentinel distinctly instead of as data', () => {
    expect(feed([stream(['data: [DONE]', ''])])).toEqual([{ kind: 'done' }]);
  });

  it('reports the sentinel when it is split across chunks', () => {
    expect(feed(['data: [DO', 'NE', ']\n', '\n'])).toEqual([{ kind: 'done' }]);
  });

  it('reports the sentinel after a CRLF-terminated data line', () => {
    expect(feed(['data: [DONE]\r\n\r\n'])).toEqual([{ kind: 'done' }]);
  });

  it('does not treat a payload merely containing [DONE] as the sentinel', () => {
    const payload = '{"content":"[DONE]"}';
    expect(feed([stream([`data: ${payload}`, ''])])).toEqual([{ kind: 'data', data: payload }]);
  });

  it('keeps parsing after the sentinel rather than latching shut', () => {
    // The transport stops reading at [DONE]; the parser stays a pure function
    // of its input so that decision lives in exactly one place.
    const text = stream(['data: [DONE]', '', 'data: after', '']);
    expect(feed([text])).toEqual([{ kind: 'done' }, { kind: 'data', data: 'after' }]);
  });
});

describe('SseParser: incomplete input', () => {
  it('never emits a trailing event that lacks its blank line', () => {
    const text = 'data: {"a":1}\n\ndata: {"b":2}\n';
    expectEveryChunking(text, [{ kind: 'data', data: '{"a":1}' }]);
  });

  it('never emits a trailing event cut off mid-JSON', () => {
    const text = 'data: {"a":1}\n\ndata: {"b":';
    expectEveryChunking(text, [{ kind: 'data', data: '{"a":1}' }]);
  });

  it('reports that an unterminated event is still held back', () => {
    const parser = new SseParser();
    expect(parser.pending).toBe(false);

    expect(parser.push('data: {"a":')).toEqual([]);
    expect(parser.pending).toBe(true);

    expect(parser.push('1}\n')).toEqual([]);
    // The line is complete but the event is not: no blank line has arrived.
    expect(parser.pending).toBe(true);

    expect(parser.push('\n')).toEqual([{ kind: 'data', data: '{"a":1}' }]);
    expect(parser.pending).toBe(false);
  });

  it('emits the held event once the rest of it finally arrives', () => {
    const parser = new SseParser();
    expect(parser.push('data: par')).toEqual([]);
    expect(parser.push('tial')).toEqual([]);
    expect(parser.push('\n\n')).toEqual([{ kind: 'data', data: 'partial' }]);
  });

  it('drops buffered state on reset', () => {
    const parser = new SseParser();
    expect(parser.push('data: abandoned')).toEqual([]);
    parser.reset();
    expect(parser.pending).toBe(false);
    expect(parser.push('data: fresh\n\n')).toEqual([{ kind: 'data', data: 'fresh' }]);
  });
});

describe('SseParser: empty chunks', () => {
  it('returns nothing and changes nothing for an empty chunk', () => {
    const parser = new SseParser();
    expect(parser.push('')).toEqual([]);
    expect(parser.pending).toBe(false);
    expect(parser.push('data: a')).toEqual([]);
    expect(parser.push('')).toEqual([]);
    expect(parser.pending).toBe(true);
    expect(parser.push('\n\n')).toEqual([{ kind: 'data', data: 'a' }]);
  });

  it('survives a stream made entirely of empty chunks', () => {
    expect(feed(['', '', ''])).toEqual([]);
  });

  it('survives empty chunks between every character', () => {
    const text = stream(['data: a', '', 'data: [DONE]', '']);
    const chunks = text.split('').flatMap((c) => ['', c]);
    expect(feed(chunks)).toEqual([{ kind: 'data', data: 'a' }, { kind: 'done' }]);
  });
});

describe('SseParser: realistic OpenAI-shaped stream', () => {
  const chunkObjects = [
    '{"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}',
    '{"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"The"},"logprobs":{"content":[{"token":"The","logprob":-0.31,"top_logprobs":[{"token":"The","logprob":-0.31},{"token":"A","logprob":-1.8}]}]},"finish_reason":null}]}',
    '{"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"logprobs":null,"finish_reason":"stop"}]}',
  ];

  it('recovers every payload byte-for-byte under any chunking', () => {
    const text = stream([
      ...chunkObjects.flatMap((object) => [`data: ${object}`, '']),
      'data: [DONE]',
      '',
    ]);
    const expected: SseEvent[] = [
      ...chunkObjects.map((data): SseEvent => ({ kind: 'data', data })),
      { kind: 'done' },
    ];
    expectEveryChunking(text, expected);
    // The payloads must still parse as JSON after the round trip; that is the
    // only property live.ts actually depends on.
    for (const event of feed([text])) {
      if (event.kind === 'data') expect(() => JSON.parse(event.data) as unknown).not.toThrow();
    }
  });
});
