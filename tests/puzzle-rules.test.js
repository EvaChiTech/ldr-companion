import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SIZES, scramble, isSolved, isSlot, placedCount, newBoard, applySwap,
} from '../puzzle-rules.js'

// ── scramble ────────────────────────────────────────────────

test('scramble returns a permutation of every slice', () => {
  for (const n of SIZES) {
    const t = scramble(n, 7)
    assert.equal(t.length, n * n)
    assert.deepEqual([...t].sort((a, b) => a - b),
      Array.from({ length: n * n }, (_, i) => i))
  }
})

test('same seed scrambles identically on both clients', () => {
  assert.deepEqual(scramble(4, 999), scramble(4, 999))
})

test('different seeds scramble differently', () => {
  assert.notDeepEqual(scramble(4, 1), scramble(4, 2))
})

test('scramble actually disturbs the board', () => {
  // A board that starts solved would be a pointless puzzle.
  let solvedCount = 0
  for (let seed = 0; seed < 200; seed++) {
    if (isSolved(scramble(3, seed))) solvedCount++
  }
  assert.equal(solvedCount, 0, 'some seeds produced an already-solved board')
})

test('every scrambled board is solvable by swapping', () => {
  // Swap-only scrambling cannot create an unreachable parity: selection-sort
  // by swaps must always terminate at the solved state.
  for (let seed = 0; seed < 50; seed++) {
    const t = scramble(4, seed)
    let swaps = 0
    for (let i = 0; i < t.length; i++) {
      while (t[i] !== i) {
        const j = t.indexOf(i)
        ;[t[i], t[j]] = [t[j], t[i]]
        if (++swaps > t.length * 2) assert.fail(`seed ${seed} did not converge`)
      }
    }
    assert.ok(isSolved(t))
  }
})

// ── predicates ──────────────────────────────────────────────

test('isSolved only accepts the identity arrangement', () => {
  assert.ok(isSolved([0, 1, 2, 3]))
  assert.equal(isSolved([1, 0, 2, 3]), false)
})

test('isSlot accepts in-range integers only', () => {
  assert.ok(isSlot(0, 9))
  assert.ok(isSlot(8, 9))
  assert.equal(isSlot(9, 9), false, 'upper bound is exclusive')
  assert.equal(isSlot(-1, 9), false)
})

test('isSlot rejects the loose values `in` would have allowed', () => {
  // The original check used `a in array`, which accepts string keys.
  assert.equal(isSlot('0', 9), false)
  assert.equal(isSlot(1.5, 9), false)
  assert.equal(isSlot(NaN, 9), false)
  assert.equal(isSlot(null, 9), false)
  assert.equal(isSlot(undefined, 9), false)
  assert.equal(isSlot(Infinity, 9), false)
})

test('placedCount counts only tiles at home', () => {
  assert.equal(placedCount([0, 1, 2, 3]), 4)
  assert.equal(placedCount([1, 0, 2, 3]), 2)
  assert.equal(placedCount([3, 2, 1, 0]), 0)
})

// ── swaps ───────────────────────────────────────────────────

test('a valid swap exchanges two tiles and advances seq', () => {
  const b = newBoard('u', 3, 1)
  const before = [...b.tiles]
  assert.ok(applySwap(b, 0, 1, 1))
  assert.equal(b.tiles[0], before[1])
  assert.equal(b.tiles[1], before[0])
  assert.equal(b.seq, 1)
})

test('a replayed swap is rejected, so a duplicate broadcast cannot un-swap', () => {
  // This is the bug the seq guard exists to prevent.
  const b = newBoard('u', 3, 1)
  applySwap(b, 0, 1, 1)
  const after = [...b.tiles]
  assert.equal(applySwap(b, 0, 1, 1), false)
  assert.deepEqual(b.tiles, after)
})

test('an out-of-order swap is rejected', () => {
  const b = newBoard('u', 3, 1)
  assert.equal(applySwap(b, 0, 1, 5), false)
  assert.equal(b.seq, 0)
})

test('out-of-bounds and malformed indices are rejected', () => {
  const b = newBoard('u', 3, 1)
  for (const [a, c] of [[0, 99], [-1, 2], ['0', 1], [1.5, 2], [NaN, 0]]) {
    assert.equal(applySwap(b, a, c, 1), false, `accepted ${a},${c}`)
  }
  assert.equal(b.seq, 0)
})

test('swapping a tile with itself is rejected', () => {
  const b = newBoard('u', 3, 1)
  assert.equal(applySwap(b, 2, 2, 1), false)
})

test('completing the board sets solved and freezes further swaps', () => {
  const b = newBoard('u', 3, 1)
  // Sort into place by swaps, mirroring what two players actually do.
  let seq = 1
  for (let i = 0; i < b.tiles.length; i++) {
    while (b.tiles[i] !== i) {
      assert.ok(applySwap(b, i, b.tiles.indexOf(i), seq++))
    }
  }
  assert.ok(b.solved)
  assert.ok(isSolved(b.tiles))
  assert.equal(applySwap(b, 0, 1, seq), false, 'solved board still accepted a swap')
})

test('applySwap tolerates a missing board', () => {
  assert.equal(applySwap(null, 0, 1, 1), false)
})

// ── convergence ─────────────────────────────────────────────

test('two clients applying the same swaps converge', () => {
  const a = newBoard('u', 4, 20250101)
  const b = newBoard('u', 4, 20250101)
  assert.deepEqual(a, b)

  const rnd = (i) => (i * 7 + 3) % a.tiles.length
  for (let seq = 1; seq <= 40; seq++) {
    const i = rnd(seq), j = rnd(seq * 3 + 1)
    const okA = applySwap(a, i, j, seq)
    const okB = applySwap(b, i, j, seq)
    assert.equal(okA, okB)
    assert.deepEqual(a.tiles, b.tiles, `diverged at swap ${seq}`)
  }
})
