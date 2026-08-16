#!/usr/bin/env python3
"""
Reference-value generator for the Glass-Box Sampler sampling-math gate.

WHY THIS EXISTS
---------------
The machine gate requires the sampling math (temperature softmax, top-p
truncation + renormalisation, entropy in bits) to agree with reference values
to within 1e-6, where those references are derived INDEPENDENTLY of the
implementation being tested. Testing an implementation against its own output
proves nothing.

So this script computes every reference with Python's `decimal` module at 40
significant digits. That is a completely different arithmetic stack from the
float64 `Math.exp` / `Math.log` the TypeScript implementation will use: a
different language, a different algorithm, and ~24 more digits of precision.
Agreement between the two is therefore evidence, not tautology.

Every case below is also chosen to be hand-checkable. Cases whose inputs are
[ln 4, ln 2, 0] have exact rational answers (4/7, 2/7, 1/7) you can verify on
paper; the entropy cases use dyadic probabilities with exact bit values.

USAGE
-----
    python tools/gen-reference-values.py > src/core/reference-values.generated.ts

The output is committed. Re-run only when adding cases, and record the run in
PROGRESS.md.

CONVENTIONS THIS FILE PINS DOWN (the implementation must match these)
--------------------------------------------------------------------
1. softmax(l, T)_i = exp(l_i / T) / sum_j exp(l_j / T), with max-subtraction
   for numerical stability. Because softmax is shift-invariant, applying it to
   log-probabilities gives the same result as applying it to the logits they
   came from -- which is what lets the app temperature-scale API logprobs.
2. Temperature T < 0.01 is treated as argmax (one-hot on the highest logit,
   ties resolved to the lowest index). The limit is exact; the cutoff avoids
   dividing by zero.
3. top-p keeps the SMALLEST PREFIX of the descending-sorted distribution whose
   cumulative mass is >= p. The token that crosses the threshold is INCLUDED.
   At least one token is always kept, even at p = 0.
4. Entropy is in bits: H = -sum p_i * log2(p_i), with the standard convention
   0 * log2(0) = 0.
5. Surprisal of a token is -log2(p).
"""

from decimal import Decimal, getcontext

getcontext().prec = 40

LN2 = Decimal(2).ln()
LN4 = Decimal(4).ln()


def softmax(logits, temperature):
    """Temperature softmax with max-subtraction, at 40-digit precision."""
    t = Decimal(temperature)
    if t < Decimal("0.01"):
        # argmax limit: one-hot on the highest logit, ties to the lowest index
        top = max(range(len(logits)), key=lambda i: (logits[i], -i))
        return [Decimal(1) if i == top else Decimal(0) for i in range(len(logits))]
    scaled = [Decimal(x) / t for x in logits]
    m = max(scaled)
    exps = [(s - m).exp() for s in scaled]
    z = sum(exps)
    return [e / z for e in exps]


def top_p(probs, p):
    """Nucleus truncation + renormalisation. Returns the kept prefix only."""
    threshold = Decimal(p)
    cumulative = Decimal(0)
    keep = 0
    for i, q in enumerate(probs):
        cumulative += q
        keep = i + 1
        if cumulative >= threshold:
            break
    kept = probs[:keep]
    z = sum(kept)
    return [q / z for q in kept]


def entropy_bits(probs):
    """H = -sum p log2 p, using 0*log2(0) = 0."""
    total = Decimal(0)
    for q in probs:
        if q > 0:
            total -= q * (q.ln() / LN2)
    return total


def surprisal_bits(p):
    return -(Decimal(p).ln() / LN2)


def fmt(d):
    """Nearest float64, printed with Python's shortest round-tripping repr."""
    return repr(float(d))


def arr(values):
    return "[" + ", ".join(fmt(v) for v in values) + "]"


# --------------------------------------------------------------------------
# Cases
# --------------------------------------------------------------------------

softmax_cases = [
    # name, logits, temperature, note
    ("S1_baseT1", ["2", "1", "0"], "1",
     "textbook softmax at T=1"),
    ("S2_sharpT05", ["2", "1", "0"], "0.5",
     "T=0.5 sharpens: equivalent to logits [4,2,0] at T=1"),
    ("S3_flatT2", ["2", "1", "0"], "2",
     "T=2 flattens: equivalent to logits [1,0.5,0] at T=1"),
    ("S4_fourWay", ["2", "1", "0", "-1"], "1",
     "four candidates; feeds the P5 self-consistency case"),
    ("S5_shifted", ["102", "101", "100"], "1",
     "shift invariance: must equal S1 exactly"),
    ("S6_overflow", ["800", "799", "798"], "1",
     "exp(800) overflows float64; must equal S1 -- fails without max-subtraction"),
    ("S7_argmaxLimit", ["2", "1", "0"], "0.001",
     "T below 0.01 collapses to one-hot argmax"),
    ("S8_exactRational", [str(LN4), str(Decimal(2).ln()), "0"], "1",
     "logits [ln4, ln2, 0] give exactly [4/7, 2/7, 1/7]"),
    ("S9_exactRationalT2", [str(LN4), str(Decimal(2).ln()), "0"], "2",
     "same logits at T=2 give exactly [2, sqrt2, 1] / (3 + sqrt2)"),
    ("S10_uniform", ["5", "5", "5", "5"], "1",
     "equal logits give a uniform distribution"),
]

# probs, p, note
topp_cases = [
    ("P1_interior", ["0.5", "0.3", "0.15", "0.05"], "0.9",
     "cum = .5, .8, .95 -> keep 3, renormalise by .95 -> [10/19, 6/19, 3/19]"),
    ("P2_exactBoundary", ["0.5", "0.4", "0.1"], "0.9",
     "cum hits 0.9 EXACTLY at 2 tokens -> keep 2. A '>' comparison keeps 3 and fails"),
    ("P3_headHeavy", ["0.95", "0.03", "0.02"], "0.9",
     "the head alone clears p -> keep exactly 1"),
    ("P4_identity", ["0.5", "0.3", "0.15", "0.05"], "1",
     "p=1 keeps everything and changes nothing"),
    ("P6_dyadicKeep2", ["0.5", "0.25", "0.125", "0.125"], "0.7",
     "cum = .5, .75 -> keep 2 -> [2/3, 1/3]"),
    ("P7_dyadicBoundary", ["0.5", "0.25", "0.125", "0.125"], "0.75",
     "cum hits 0.75 exactly at 2 tokens -> keep 2, not 3"),
    ("P8_dyadicKeep3", ["0.5", "0.25", "0.125", "0.125"], "0.76",
     "just past the boundary -> keep 3 -> [4/7, 2/7, 1/7]"),
    ("P9_zeroKeepsOne", ["0.5", "0.3", "0.2"], "0",
     "p=0 must still keep one token; an empty nucleus is never valid"),
]

entropy_cases = [
    ("E1_uniform4", ["0.25", "0.25", "0.25", "0.25"], "uniform over 4 = exactly 2 bits"),
    ("E2_coin", ["0.5", "0.5"], "fair coin = exactly 1 bit"),
    ("E3_zeroTerm", ["0.5", "0.5", "0"], "0*log0 = 0 convention; still exactly 1 bit"),
    ("E4_oneHot", ["1", "0", "0"], "a certain outcome carries 0 bits"),
    ("E5_nearOneHot", ["0.999", "0.001"], "near-certain: a small positive value"),
    ("E6_dyadic", ["0.5", "0.25", "0.125", "0.125"], "exactly 1.75 bits"),
]

surprisal_cases = [
    ("U1_half", "0.5", "p=1/2 -> exactly 1 bit"),
    ("U2_quarter", "0.25", "p=1/4 -> exactly 2 bits"),
    ("U3_certain", "1", "p=1 -> exactly 0 bits"),
    ("U4_rare", "0.01", "p=1/100 -> ~6.64 bits"),
]


def main():
    out = []
    w = out.append

    w("/**")
    w(" * GENERATED FILE -- DO NOT EDIT BY HAND.")
    w(" *")
    w(" * Produced by tools/gen-reference-values.py, which computes every value with")
    w(" * Python's `decimal` module at 40 significant digits -- an arithmetic stack")
    w(" * entirely independent of the float64 Math.exp/Math.log used by the")
    w(" * implementation these values are used to test.")
    w(" *")
    w(" *   python tools/gen-reference-values.py > src/core/reference-values.generated.ts")
    w(" *")
    w(" * Values are the nearest float64 to the true mathematical result, so the")
    w(" * implementation has roughly nine orders of magnitude of headroom against the")
    w(" * 1e-6 gate. Cases marked 'exact' are verifiable by hand on paper.")
    w(" */")
    w("")
    w("export interface SoftmaxCase {")
    w("  readonly name: string;")
    w("  readonly logits: readonly number[];")
    w("  readonly temperature: number;")
    w("  readonly expected: readonly number[];")
    w("  readonly note: string;")
    w("}")
    w("")
    w("export interface TopPCase {")
    w("  readonly name: string;")
    w("  readonly probs: readonly number[];")
    w("  readonly topP: number;")
    w("  readonly expectedKept: number;")
    w("  readonly expected: readonly number[];")
    w("  readonly note: string;")
    w("}")
    w("")
    w("export interface ScalarCase {")
    w("  readonly name: string;")
    w("  readonly input: readonly number[];")
    w("  readonly expected: number;")
    w("  readonly note: string;")
    w("}")
    w("")

    w("export const SOFTMAX_CASES: readonly SoftmaxCase[] = [")
    for name, logits, temp, note in softmax_cases:
        expected = softmax([Decimal(x) for x in logits], temp)
        logit_literals = "[" + ", ".join(fmt(Decimal(x)) for x in logits) + "]"
        w(f"  // {note}")
        w(f"  {{ name: {name!r}, logits: {logit_literals}, temperature: {fmt(Decimal(temp))},")
        w(f"    expected: {arr(expected)},")
        w(f"    note: {note!r} }},")
    w("];")
    w("")

    w("export const TOP_P_CASES: readonly TopPCase[] = [")
    for name, probs, p, note in topp_cases:
        dprobs = [Decimal(x) for x in probs]
        expected = top_p(dprobs, p)
        prob_literals = "[" + ", ".join(fmt(x) for x in dprobs) + "]"
        w(f"  // {note}")
        w(f"  {{ name: {name!r}, probs: {prob_literals}, topP: {fmt(Decimal(p))},")
        w(f"    expectedKept: {len(expected)}, expected: {arr(expected)},")
        w(f"    note: {note!r} }},")
    w("];")
    w("")

    w("export const ENTROPY_CASES: readonly ScalarCase[] = [")
    for name, probs, note in entropy_cases:
        dprobs = [Decimal(x) for x in probs]
        expected = entropy_bits(dprobs)
        prob_literals = "[" + ", ".join(fmt(x) for x in dprobs) + "]"
        w(f"  // {note}")
        w(f"  {{ name: {name!r}, input: {prob_literals}, expected: {fmt(expected)},")
        w(f"    note: {note!r} }},")
    w("];")
    w("")

    w("export const SURPRISAL_CASES: readonly ScalarCase[] = [")
    for name, p, note in surprisal_cases:
        expected = surprisal_bits(Decimal(p))
        w(f"  // {note}")
        w(f"  {{ name: {name!r}, input: [{fmt(Decimal(p))}], expected: {fmt(expected)},")
        w(f"    note: {note!r} }},")
    w("];")
    w("")

    # The P5 self-consistency case is emitted separately because its expectation
    # is another case's output rather than a literal.
    s4 = softmax([Decimal(x) for x in ["2", "1", "0", "-1"]], "1")
    p5 = top_p(s4, "0.9")
    s1 = softmax([Decimal(x) for x in ["2", "1", "0"]], "1")
    w("/**")
    w(" * Self-consistency: truncating softmax([2,1,0,-1]) at p=0.9 drops the last")
    w(" * candidate, and renormalising the remaining three reproduces")
    w(" * softmax([2,1,0]) exactly -- because dropping a token and renormalising IS")
    w(" * softmax over the surviving logits. Any error in either function breaks this.")
    w(f" * Verified in decimal: max |diff| = {max(abs(a - b) for a, b in zip(p5, s1)):.3e}")
    w(" */")
    w(f"export const P5_SELF_CONSISTENCY = {{")
    w(f"  logits: [2, 1, 0, -1],")
    w(f"  topP: 0.9,")
    w(f"  expectedKept: {len(p5)},")
    w(f"  expected: {arr(p5)},")
    w("} as const;")
    w("")

    print("\n".join(out))


if __name__ == "__main__":
    main()
