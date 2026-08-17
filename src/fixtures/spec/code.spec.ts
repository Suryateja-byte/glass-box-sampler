/**
 * Code completion: the bimodal fixture.
 *
 * Python has two kinds of token and a model treats them completely differently.
 * The syntax -- `def`, the colon, the newline, the two-space indent -- is nearly
 * forced, around 0.3 bits. The identifiers and the literal values are not: the
 * argument could be `n` or `num` or `x`, the base case could be 1 or 0 or 2, and
 * those steps run near 2.5 bits. Nothing in between. That gap is the whole point
 * of the fixture, and it comes straight out of the two category bands rather
 * than out of any per-step fiddling.
 *
 * Tokenisation follows the same rules as the prose fixtures: `fibonacci` splits
 * as " fib" + "onacci", the newline is its own token, and the indent is a
 * two-space token that repeats for deeper nesting.
 *
 * One consequence of a merging lattice worth knowing about: renaming the
 * argument at the signature step leaves the body still saying `n`, because the
 * body is shared with every other branch. The result is valid Python that would
 * raise at runtime. Fixing it properly means a tree rather than a lattice --
 * one whole copy of the body per identifier -- which is the authoring blow-up
 * the rejoin design exists to avoid.
 */

import { at, br, fin, s, type FixtureSpec } from './types';

const SIG_SYNTAX = ['(', '):', ':', ',', '=', ' ->', '_', '*', '**', '.', ')', ' int'];
const SIG_IDENT = ['n', 'num', 'x', 'k', 'i', 'idx', 'count', 'value', 'index', 'limit', 'a', 'b'];
const SIG_BOUND = ['o', 'ona', 'onaci', 'nacci', 'onacc', 'oacci', 'onachi', 'oni', 'onnacci', 'oc', 'onaccio', 'onacchi'];

const DOC_SYNTAX = ['"""', "'''", '#', '."""', '\n', ':', '.', ',', '"', "'", '!', ' '];
const DOC_IDENT = ['Return', 'Returns', 'Compute', 'Calculate', 'Get', 'Find', 'Yield', 'The', 'Fibonacci', 'number', 'value', 'sequence'];
const DOC_BOUND = [' the', ' n', ' Fibonacci', ' number', ' value', ' sequence', ' term', ' index', ' result', ' first', ' next', ' item'];

const FLOW_SYNTAX = ['if', ':', ' <', ' <=', ' ==', ' >', '\n', '  ', ' or', ' and', ' is', ' not'];
const FLOW_IDENT = [' 2', ' 1', ' 0', ' 3', ' n', ' two', ' one', ' None', ' k', ' i', ' x', ' 10'];
const FLOW_BOUND = [' n', ' num', ' x', ' k', ' i', ' value', ' idx', ' count', ' index', ' limit', ' a', ' b'];

const BODY_SYNTAX = ['return', '  ', '\n', ':', 'raise', 'pass', 'yield', 'print', 'if', 'else', 'while', 'for'];
const BODY_IDENT = [' n', ' 0', ' 1', ' 2', ' None', ' x', ' k', ' num', ' i', ' a', ' b', ' value'];

const REC_SYNTAX = ['(', ')', ' +', ' -', ' *', ',', '\n', 'return', '  ', ':', ' //', ' %'];
const REC_IDENT = [' 1', ' 2', ' 3', ' 0', ' n', ' k', ' i', ' x', ' a', ' b', ' num', ' two'];
const REC_BOUND = ['n', ' n', ' fib', 'onacci', ' num', ' x', ' k', ' i', ' a', ' b', ' value', ' idx'];

export const CODE_SPEC: FixtureSpec = {
  id: 'code',
  label: 'Code completion',
  description:
    'A recursive Fibonacci function in Python. Bimodal distributions: syntax is nearly ' +
    'forced at ~0.3 bits, identifiers and literals stay open at ~2.5.',
  prompt: '# Write a function that returns the nth Fibonacci number.\n',
  seed: 0xf1b0,
  text:
    'def fibonacci(n):\n' +
    '  """Return the nth Fibonacci number."""\n' +
    '  if n < 2:\n' +
    '    return n\n' +
    '  return fibonacci(n - 1) + fibonacci(n - 2)\n',
  band: [0.15, 2.9],
  classifier: 'code',
  headBands: { syntax: [0.9, 0.97], ident: [0.2, 0.55], bound: [0.86, 0.96] },
  entropyOffsets: { syntax: -1.13, ident: 1.05, bound: -0.9 },
  wiggle: 0.1,
  regions: [
    {
      label: 'signature',
      from: 0,
      target: 1.45,
      escape: ['):', '\n'],
      pools: { syntax: SIG_SYNTAX, ident: SIG_IDENT, bound: SIG_BOUND },
    },
    {
      label: 'docstring',
      from: 7,
      target: 1.42,
      escape: ['."""', '\n'],
      pools: { syntax: DOC_SYNTAX, ident: DOC_IDENT, bound: DOC_BOUND },
    },
    {
      label: 'guard',
      from: 17,
      target: 1.48,
      escape: [':', '\n'],
      pools: { syntax: FLOW_SYNTAX, ident: FLOW_IDENT, bound: FLOW_BOUND },
    },
    {
      label: 'base case',
      from: 24,
      target: 1.44,
      escape: ['\n'],
      pools: { syntax: BODY_SYNTAX, ident: BODY_IDENT, bound: FLOW_BOUND },
    },
    {
      label: 'recursion',
      from: 29,
      target: 1.46,
      escape: [')', '\n'],
      pools: { syntax: REC_SYNTAX, ident: REC_IDENT, bound: REC_BOUND },
    },
  ],
  steps: [
    // ------------------------------------------------------- def fibonacci(n):
    s('def', 'syntax', [
      br('class', ' Fib', ':', '\n'),
      'async',
      'import',
      'from',
      '@',
      '#',
      'print',
      'x',
      'if',
    ]),
    // Whole-name rivals rejoin at the bracket: " fibonacci" as one token is a
    // different tokenisation of the same string, which is exactly the sort of
    // thing a real top-10 list is full of.
    s(' fib', 'ident', [
      at(2, ' fibonacci'),
      at(2, ' fibo'),
      at(2, ' compute'),
      at(2, ' get'),
      at(2, ' calc'),
      at(2, ' f'),
      at(2, ' nth'),
      at(2, ' fibs'),
      at(2, ' memo'),
    ]),
    s('onacci', 'bound', ['o', 'onaci', 'nacci', 'onacc', 'ona', 'oacci', 'onachi', 'oni', 'onnacci']),
    s('(', 'syntax', ['_', '2', 's', ' (', '(*', ':', '.', ',', '-']),
    s('n', 'ident', ['num', 'x', 'k', 'i', 'index', 'count', 'value', 'limit', 'a']),
    s('):', 'syntax', [
      at(1, ')', ':'),
      at(1, ',', ' m', '):'),
      ' =',
      ' ->',
      ':',
      '=',
      ' int',
      ' str',
      '*args',
    ]),
    s('\n', 'syntax', ['\n\n', ' ', '\r\n', ':', '#', '    ', '  ', '\t', ';']),

    // ------------------------------------------------- """Return the nth ..."""
    s('  ', 'syntax', ['    ', '\t', ' ', '   ', 'return', 'if', '\n', 'pass', 'x'], {
      clause: true,
    }),
    s('"""', 'syntax', ["'''", '#', 'r"""', '"', 'if', 'return', 'x', '\n', 'pass']),
    s('Return', 'ident', [
      'Returns',
      'Compute',
      'Calculate',
      'Get',
      'Find',
      'Yield',
      'The',
      'Computes',
      'Fibonacci',
    ]),
    s(' the', 'bound', [' a', ' this', ' its', ' one', ' any', ' each', at(3, ' nth'), at(3, ' N'), at(3, ' F')]),
    s(' n', 'ident', [' N', ' k', ' i', ' x', ' m', ' first', ' second', ' j', ' t']),
    s('th', 'bound', ['-th', 'st', 'nd', 'rd', 'thi', 'the', 'ths', 'tth', 'h']),
    s(' Fibonacci', 'bound', [
      ' fibonacci',
      ' Fib',
      ' fib',
      ' FIBONACCI',
      ' Fibbonacci',
      ' Lucas',
      ' triangular',
      ' prime',
      ' Catalan',
    ]),
    s(' number', 'bound', [
      ' term',
      ' value',
      ' element',
      ' entry',
      ' item',
      ' integer',
      ' sequence',
      ' num',
      ' index',
    ]),
    s('."""', 'syntax', [at(1, '.', '"""'), '"""', ' in', ' as', ',', "'''", ' .', ' of', ' sequence."""']),
    s('\n', 'syntax', ['\n\n', ' ', '\r\n', '  ', '    ', '\t', ';', '#', ':']),

    // --------------------------------------------------------- if n < 2:
    s('  ', 'syntax', ['    ', '\t', ' ', '   ', 'if', 'return', 'a', '\n', 'x'], { clause: true }),
    s('if', 'syntax', [
      br('while', ' n', ' >', ' 1', ':', '\n'),
      'assert',
      'return',
      'a',
      'for',
      'try',
      'elif',
      'raise',
      'print',
    ]),
    s(' n', 'bound', [' num', ' x', ' k', ' i', ' self', ' a', ' value', ' index', ' m']),
    s(' <', 'syntax', [' <=', ' ==', ' >', ' >=', ' !=', ' is', ' in', ' <<', ' =']),
    s(' 2', 'ident', [' 1', br(' 0', ':', '\n'), ' 3', ' two', ' n', ' 10', ' 5', ' 4', ' 6']),
    s(':', 'syntax', [' :', ';', ' or', ' and', ' else', ')', ',', '.', ' :=']),
    s('\n', 'syntax', ['\n\n', ' ', '\r\n', '    ', '  ', '\t', ';', ':', '#']),

    // ------------------------------------------------------- return n
    s('  ', 'syntax', ['    ', '\t', ' ', '   ', 'return', 'raise', '\n', 'pass', 'x'], {
      clause: true,
    }),
    s('  ', 'syntax', ['    ', '\t', ' ', '   ', 'return', 'raise', 'pass', '\n', 'x']),
    s('return', 'syntax', [
      br('raise', ' ValueError', '(', ')', '\n'),
      'yield',
      'print',
      'pass',
      'break',
      'continue',
      'assert',
      'del',
      'exit',
    ]),
    s(' n', 'bound', [' num', ' x', ' k', ' i', ' 1', ' 0', ' self', ' a', ' m']),
    s('\n', 'syntax', ['\n\n', ' ', '\r\n', '  ', '    ', '\t', ';', '#', ':']),

    // --------------------------- return fibonacci(n - 1) + fibonacci(n - 2)
    s('  ', 'syntax', ['    ', '\t', ' ', '   ', 'return', 'else', '\n', 'pass', 'x'], {
      clause: true,
    }),
    s('return', 'syntax', [
      fin('total', ' =', ' 0', '\n'),
      'yield',
      'raise',
      'print',
      'a',
      'else',
      'result',
      'assert',
      'pass',
    ]),
    s(' fib', 'bound', [
      at(2, ' fibonacci'),
      at(2, ' fibo'),
      at(2, ' Fib'),
      at(2, ' self'),
      at(2, ' memo'),
      at(2, ' F'),
      at(2, ' _fib'),
      at(2, ' fibonnaci'),
      at(2, ' fibonacci2'),
    ]),
    s('onacci', 'bound', ['o', 'onaci', 'nacci', 'onacc', 'ona', 'oacci', 'onachi', 'oni', 'onnacci']),
    s('(', 'syntax', ['_', '(*', ' (', '2', '.', '[', ',', ':', '-']),
    s('n', 'bound', ['num', 'x', 'k', 'i', 'self', 'a', 'm', 'value', 'idx']),
    s(' -', 'syntax', [br(' +', ' 1', ')', '\n'), ' *', ' //', ' %', ' -=', ',', ')', ' ==', ' >>']),
    s(' 1', 'ident', [' 2', ' 0', ' 3', ' one', ' n', ' 4', ' 5', ' i', ' k']),
    s(')', 'syntax', [',', ' )', '))', ')]', ':', '.', ']', '}', ' ']),
    s(' +', 'syntax', [br(' *', ' 2', '\n'), ' -', ' +=', ',', ' or', ' if', '\n', ' and', ' %']),
    s(' fib', 'bound', [
      at(2, ' fibonacci'),
      at(2, ' fibo'),
      at(2, ' Fib'),
      at(2, ' self'),
      at(2, ' memo'),
      at(2, ' F'),
      at(2, ' _fib'),
      at(2, ' fibonnaci'),
      at(2, ' fibonacci2'),
    ]),
    s('onacci', 'bound', ['o', 'onaci', 'nacci', 'onacc', 'ona', 'oacci', 'onachi', 'oni', 'onnacci']),
    s('(', 'syntax', ['_', '(*', ' (', '2', '.', '[', ',', ':', '-']),
    s('n', 'bound', ['num', 'x', 'k', 'i', 'self', 'a', 'm', 'value', 'idx']),
    s(' -', 'syntax', [' +', ' *', ' //', ' %', ' -=', ',', ')', ' ==', ' >>']),
    s(' 2', 'ident', [' 1', ' 3', ' 0', ' two', ' n', ' 4', ' 5', ' i', ' k']),
    s(')', 'syntax', [',', ' )', '))', ')]', ':', '.', ']', '}', ' ']),
    s('\n', 'syntax', ['\n\n', ' ', '\r\n', '  ', '\t', ';', '#', ':', ' if']),
  ],
};
