/**
 * The keyed random source.
 *
 * This is deliberately NOT a stream. A sequential generator's nth value depends
 * on how many values were drawn before it, so exploring a fork -- or re-rendering
 * a branch, or drawing one extra token anywhere -- would shift every subsequent
 * number on every other path, and the same seed would stop reproducing the same
 * tree. Instead each draw is a pure hash of WHERE it sits: (seed, branch, step).
 * Nothing about the order of exploration can reach it, so a branch replays
 * identically whether it was visited first, last, or twice.
 *
 * The hash is FNV-1a over the three fields followed by murmur3's finaliser. FNV
 * alone is a poor generator -- its low bits move sluggishly, and consecutive
 * keys stay visibly close, which shows up as correlation between adjacent steps
 * and would bias every token in one direction. The finaliser's shift-multiply
 * avalanche is what turns a near-identical key into an unrelated 32-bit word.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Separates the fields of the key, so that ("root", 7) and ("root7", ...) --
 * or any other pair whose concatenations coincide -- cannot hash alike.
 */
const FIELD_SEPARATOR = 0x1f;

const TWO_POW_32 = 4294967296;

/** One FNV-1a round. Math.imul keeps the product in 32 bits rather than losing the low half to float64 rounding. */
function mixByte(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, FNV_PRIME);
}

/** Mixes a 32-bit word in, low byte first. */
function mixWord(hash: number, word: number): number {
  let h = mixByte(hash, word & 0xff);
  h = mixByte(h, (word >>> 8) & 0xff);
  h = mixByte(h, (word >>> 16) & 0xff);
  h = mixByte(h, (word >>> 24) & 0xff);
  return h;
}

/**
 * The high 32 bits of an integer-valued number. Seeds and steps are integers by
 * contract, but a seed can exceed 2^32, and truncating it would silently collide
 * two runs that differ only above the 32-bit mark.
 */
function highWord(value: number): number {
  return Math.floor(value / TWO_POW_32) | 0;
}

/** murmur3's fmix32: the avalanche step that makes neighbouring keys unrelated. */
function avalanche(hash: number): number {
  let h = hash;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * A uniform draw in [0, 1) keyed by position in the generation tree.
 *
 * Pure: the same (seed, branchId, step) always gives the same number, and no
 * other draw can influence it.
 */
export function rand01(seed: number, branchId: string, step: number): number {
  let h = FNV_OFFSET_BASIS;

  h = mixWord(h, seed | 0);
  h = mixWord(h, highWord(seed));
  h = mixByte(h, FIELD_SEPARATOR);

  // Hashed character by character rather than by building a key string: this is
  // called once per token, and the two halves of each UTF-16 unit both matter
  // for branch ids outside the ASCII range.
  for (let i = 0; i < branchId.length; i += 1) {
    const code = branchId.charCodeAt(i);
    h = mixByte(h, code & 0xff);
    h = mixByte(h, (code >>> 8) & 0xff);
  }

  h = mixByte(h, FIELD_SEPARATOR);
  h = mixWord(h, step | 0);
  h = mixWord(h, highWord(step));

  // avalanche() yields an unsigned 32-bit integer, so the quotient is in [0, 1):
  // it can reach 0 but never 1.
  return avalanche(h) / TWO_POW_32;
}
