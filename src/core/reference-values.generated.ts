/**
 * GENERATED FILE -- DO NOT EDIT BY HAND.
 *
 * Produced by tools/gen-reference-values.py, which computes every value with
 * Python's `decimal` module at 40 significant digits -- an arithmetic stack
 * entirely independent of the float64 Math.exp/Math.log used by the
 * implementation these values are used to test.
 *
 *   python tools/gen-reference-values.py > src/core/reference-values.generated.ts
 *
 * Values are the nearest float64 to the true mathematical result, so the
 * implementation has roughly nine orders of magnitude of headroom against the
 * 1e-6 gate. Cases marked 'exact' are verifiable by hand on paper.
 */

export interface SoftmaxCase {
  readonly name: string;
  readonly logits: readonly number[];
  readonly temperature: number;
  readonly expected: readonly number[];
  readonly note: string;
}

export interface TopPCase {
  readonly name: string;
  readonly probs: readonly number[];
  readonly topP: number;
  readonly expectedKept: number;
  readonly expected: readonly number[];
  readonly note: string;
}

export interface ScalarCase {
  readonly name: string;
  readonly input: readonly number[];
  readonly expected: number;
  readonly note: string;
}

export const SOFTMAX_CASES: readonly SoftmaxCase[] = [
  // textbook softmax at T=1
  { name: 'S1_baseT1', logits: [2.0, 1.0, 0.0], temperature: 1.0,
    expected: [0.6652409557748219, 0.24472847105479764, 0.09003057317038046],
    note: 'textbook softmax at T=1' },
  // T=0.5 sharpens: equivalent to logits [4,2,0] at T=1
  { name: 'S2_sharpT05', logits: [2.0, 1.0, 0.0], temperature: 0.5,
    expected: [0.8668133321973349, 0.11731042782619837, 0.015876239976466765],
    note: 'T=0.5 sharpens: equivalent to logits [4,2,0] at T=1' },
  // T=2 flattens: equivalent to logits [1,0.5,0] at T=1
  { name: 'S3_flatT2', logits: [2.0, 1.0, 0.0], temperature: 2.0,
    expected: [0.506480391055654, 0.3071958857184984, 0.1863237232258476],
    note: 'T=2 flattens: equivalent to logits [1,0.5,0] at T=1' },
  // four candidates; feeds the P5 self-consistency case
  { name: 'S4_fourWay', logits: [2.0, 1.0, 0.0, -1.0], temperature: 1.0,
    expected: [0.6439142598879724, 0.23688281808991013, 0.08714431874203257, 0.03205860328008499],
    note: 'four candidates; feeds the P5 self-consistency case' },
  // shift invariance: must equal S1 exactly
  { name: 'S5_shifted', logits: [102.0, 101.0, 100.0], temperature: 1.0,
    expected: [0.6652409557748219, 0.24472847105479764, 0.09003057317038046],
    note: 'shift invariance: must equal S1 exactly' },
  // exp(800) overflows float64; must equal S1 -- fails without max-subtraction
  { name: 'S6_overflow', logits: [800.0, 799.0, 798.0], temperature: 1.0,
    expected: [0.6652409557748219, 0.24472847105479764, 0.09003057317038046],
    note: 'exp(800) overflows float64; must equal S1 -- fails without max-subtraction' },
  // T below 0.01 collapses to one-hot argmax
  { name: 'S7_argmaxLimit', logits: [2.0, 1.0, 0.0], temperature: 0.001,
    expected: [1.0, 0.0, 0.0],
    note: 'T below 0.01 collapses to one-hot argmax' },
  // logits [ln4, ln2, 0] give exactly [4/7, 2/7, 1/7]
  { name: 'S8_exactRational', logits: [1.3862943611198906, 0.6931471805599453, 0.0], temperature: 1.0,
    expected: [0.5714285714285714, 0.2857142857142857, 0.14285714285714285],
    note: 'logits [ln4, ln2, 0] give exactly [4/7, 2/7, 1/7]' },
  // same logits at T=2 give exactly [2, sqrt2, 1] / (3 + sqrt2)
  { name: 'S9_exactRationalT2', logits: [1.3862943611198906, 0.6931471805599453, 0.0], temperature: 2.0,
    expected: [0.4530818393219728, 0.32037724101704074, 0.2265409196609864],
    note: 'same logits at T=2 give exactly [2, sqrt2, 1] / (3 + sqrt2)' },
  // equal logits give a uniform distribution
  { name: 'S10_uniform', logits: [5.0, 5.0, 5.0, 5.0], temperature: 1.0,
    expected: [0.25, 0.25, 0.25, 0.25],
    note: 'equal logits give a uniform distribution' },
];

export const TOP_P_CASES: readonly TopPCase[] = [
  // cum = .5, .8, .95 -> keep 3, renormalise by .95 -> [10/19, 6/19, 3/19]
  { name: 'P1_interior', probs: [0.5, 0.3, 0.15, 0.05], topP: 0.9,
    expectedKept: 3, expected: [0.5263157894736842, 0.3157894736842105, 0.15789473684210525],
    note: 'cum = .5, .8, .95 -> keep 3, renormalise by .95 -> [10/19, 6/19, 3/19]' },
  // cum hits 0.9 EXACTLY at 2 tokens -> keep 2. A '>' comparison keeps 3 and fails
  { name: 'P2_exactBoundary', probs: [0.5, 0.4, 0.1], topP: 0.9,
    expectedKept: 2, expected: [0.5555555555555556, 0.4444444444444444],
    note: "cum hits 0.9 EXACTLY at 2 tokens -> keep 2. A '>' comparison keeps 3 and fails" },
  // the head alone clears p -> keep exactly 1
  { name: 'P3_headHeavy', probs: [0.95, 0.03, 0.02], topP: 0.9,
    expectedKept: 1, expected: [1.0],
    note: 'the head alone clears p -> keep exactly 1' },
  // p=1 keeps everything and changes nothing
  { name: 'P4_identity', probs: [0.5, 0.3, 0.15, 0.05], topP: 1.0,
    expectedKept: 4, expected: [0.5, 0.3, 0.15, 0.05],
    note: 'p=1 keeps everything and changes nothing' },
  // cum = .5, .75 -> keep 2 -> [2/3, 1/3]
  { name: 'P6_dyadicKeep2', probs: [0.5, 0.25, 0.125, 0.125], topP: 0.7,
    expectedKept: 2, expected: [0.6666666666666666, 0.3333333333333333],
    note: 'cum = .5, .75 -> keep 2 -> [2/3, 1/3]' },
  // cum hits 0.75 exactly at 2 tokens -> keep 2, not 3
  { name: 'P7_dyadicBoundary', probs: [0.5, 0.25, 0.125, 0.125], topP: 0.75,
    expectedKept: 2, expected: [0.6666666666666666, 0.3333333333333333],
    note: 'cum hits 0.75 exactly at 2 tokens -> keep 2, not 3' },
  // just past the boundary -> keep 3 -> [4/7, 2/7, 1/7]
  { name: 'P8_dyadicKeep3', probs: [0.5, 0.25, 0.125, 0.125], topP: 0.76,
    expectedKept: 3, expected: [0.5714285714285714, 0.2857142857142857, 0.14285714285714285],
    note: 'just past the boundary -> keep 3 -> [4/7, 2/7, 1/7]' },
  // p=0 must still keep one token; an empty nucleus is never valid
  { name: 'P9_zeroKeepsOne', probs: [0.5, 0.3, 0.2], topP: 0.0,
    expectedKept: 1, expected: [1.0],
    note: 'p=0 must still keep one token; an empty nucleus is never valid' },
];

export const ENTROPY_CASES: readonly ScalarCase[] = [
  // uniform over 4 = exactly 2 bits
  { name: 'E1_uniform4', input: [0.25, 0.25, 0.25, 0.25], expected: 2.0,
    note: 'uniform over 4 = exactly 2 bits' },
  // fair coin = exactly 1 bit
  { name: 'E2_coin', input: [0.5, 0.5], expected: 1.0,
    note: 'fair coin = exactly 1 bit' },
  // 0*log0 = 0 convention; still exactly 1 bit
  { name: 'E3_zeroTerm', input: [0.5, 0.5, 0.0], expected: 1.0,
    note: '0*log0 = 0 convention; still exactly 1 bit' },
  // a certain outcome carries 0 bits
  { name: 'E4_oneHot', input: [1.0, 0.0, 0.0], expected: 0.0,
    note: 'a certain outcome carries 0 bits' },
  // near-certain: a small positive value
  { name: 'E5_nearOneHot', input: [0.999, 0.001], expected: 0.011407757737461137,
    note: 'near-certain: a small positive value' },
  // exactly 1.75 bits
  { name: 'E6_dyadic', input: [0.5, 0.25, 0.125, 0.125], expected: 1.75,
    note: 'exactly 1.75 bits' },
];

export const SURPRISAL_CASES: readonly ScalarCase[] = [
  // p=1/2 -> exactly 1 bit
  { name: 'U1_half', input: [0.5], expected: 1.0,
    note: 'p=1/2 -> exactly 1 bit' },
  // p=1/4 -> exactly 2 bits
  { name: 'U2_quarter', input: [0.25], expected: 2.0,
    note: 'p=1/4 -> exactly 2 bits' },
  // p=1 -> exactly 0 bits
  { name: 'U3_certain', input: [1.0], expected: 0.0,
    note: 'p=1 -> exactly 0 bits' },
  // p=1/100 -> ~6.64 bits
  { name: 'U4_rare', input: [0.01], expected: 6.643856189774724,
    note: 'p=1/100 -> ~6.64 bits' },
];

/**
 * Self-consistency: truncating softmax([2,1,0,-1]) at p=0.9 drops the last
 * candidate, and renormalising the remaining three reproduces
 * softmax([2,1,0]) exactly -- because dropping a token and renormalising IS
 * softmax over the surviving logits. Any error in either function breaks this.
 * Verified in decimal: max |diff| = 3.000e-40
 */
export const P5_SELF_CONSISTENCY = {
  logits: [2, 1, 0, -1],
  topP: 0.9,
  expectedKept: 3,
  expected: [0.6652409557748219, 0.24472847105479764, 0.09003057317038046],
} as const;

