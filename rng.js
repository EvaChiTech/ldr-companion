// ============================================================
// SEEDED RANDOMNESS
//
// Both synced games (Tether's deck, Puzzle's board) depend on two clients
// deriving an identical arrangement from one shared integer, so the only thing
// that has to travel over the network is the seed. That requires a generator
// whose sequence is a pure function of its seed — Math.random cannot do it.
//
// mulberry32: 32-bit state, one multiply-xorshift round. Fast, passes the
// smaller empirical test batteries, and short enough to audit by eye. It is
// NOT cryptographic and must never be used for secrets — seeds themselves are
// drawn from crypto.getRandomValues at the call site.
//
// No DOM, no imports: kept dependency-free so it is directly unit-testable.
// ============================================================

/**
 * @param {number} seed any integer; coerced to uint32
 * @returns {() => number} generator yielding [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Fisher-Yates, in place, driven by a supplied generator so the caller
 * controls (and can reproduce) the stream.
 * @template T
 * @param {T[]} arr mutated in place
 * @param {() => number} rand
 * @returns {T[]} the same array
 */
export function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
