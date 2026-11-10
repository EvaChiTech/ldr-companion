// ============================================================
// PUZZLE — board logic.
//
// Pure, like games-rules.js: no DOM, no network, no module state, so the
// board's behaviour can be tested directly. The board is a permutation array
// where `tiles[position] = sliceIndex`; solved means every slice sits at its
// own index.
// ============================================================

import { mulberry32 } from './rng.js'

export const SIZES = [3, 4, 5]

/** How many random swaps to apply per tile when scrambling. */
const SWAPS_PER_TILE = 6

/**
 * Scramble by applying random *swaps* rather than shuffling outright.
 *
 * This matters: a free shuffle of a sliding-tile puzzle can land on an
 * unsolvable parity, but this board is solved by swapping any two tiles, so
 * every arrangement reachable by swaps is also solvable by swaps. Starting
 * from solved and only swapping therefore cannot produce a dead board.
 *
 * @param {number} n grid edge length
 * @param {number} seed shared across both clients
 */
export function scramble(n, seed) {
  const tiles = Array.from({ length: n * n }, (_, i) => i)
  const rand = mulberry32(seed)
  for (let k = 0; k < n * n * SWAPS_PER_TILE; k++) {
    const i = Math.floor(rand() * tiles.length)
    const j = Math.floor(rand() * tiles.length)
    ;[tiles[i], tiles[j]] = [tiles[j], tiles[i]]
  }
  return tiles
}

export const isSolved = tiles => tiles.every((v, i) => v === i)

/**
 * Valid board position? `n in array` would accept string keys and ignore
 * bounds, so the check is explicit.
 */
export const isSlot = (v, len) => Number.isInteger(v) && v >= 0 && v < len

/** Count tiles already in their home position. */
export const placedCount = tiles => tiles.reduce((n, v, i) => n + (v === i ? 1 : 0), 0)

/**
 * Create a board. Kept here so tests can build one without the DOM module.
 * @returns {{url: string, size: number, seed: number, tiles: number[], seq: number, solved: boolean}}
 */
export function newBoard(url, size, seed) {
  return { url, size, seed, tiles: scramble(size, seed), seq: 0, solved: false }
}

/**
 * Swap two positions if the move is in order and in bounds.
 *
 * `seq` makes the swap idempotent against a duplicated broadcast and rejects
 * anything arriving out of order — without it a re-delivered message would
 * silently un-swap the pair and the two boards would diverge.
 *
 * @returns {boolean} true if the board changed
 */
export function applySwap(board, a, b, seq) {
  if (!board || board.solved) return false
  if (seq !== board.seq + 1) return false
  const t = board.tiles
  if (!isSlot(a, t.length) || !isSlot(b, t.length) || a === b) return false

  ;[t[a], t[b]] = [t[b], t[a]]
  board.seq = seq
  if (isSolved(t)) board.solved = true
  return true
}
