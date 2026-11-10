// ============================================================
// TETHER — rules engine.
//
// Split out from games.js on purpose: everything here is a pure function of
// its arguments, with no DOM, no network and no module state. That makes the
// game's correctness testable in isolation, and keeps the question "is the
// rule right?" separate from "is the wiring right?".
//
// The determinism requirement runs through all of it. Both clients build the
// deck from one shared seed and then replay the same ordered list of moves, so
// every function here must be a function of its inputs alone — no clocks, no
// Math.random, no iteration over objects whose key order could differ.
// ============================================================

import { mulberry32, shuffleInPlace } from './rng.js'

export const SUITS = [
  { id: 'ember', label: 'Ember', glyph: '✦' },
  { id: 'tide',  label: 'Tide',  glyph: '≈' },
  { id: 'dusk',  label: 'Dusk',  glyph: '☾' },
  { id: 'bloom', label: 'Bloom', glyph: '❋' },
]
export const SUIT_IDS = SUITS.map(s => s.id)

/** Action cards, one of each per suit. */
export const ACTIONS = {
  drift:  { label: 'Drift',  glyph: '⇢', hint: 'They draw two' },
  mirror: { label: 'Mirror', glyph: '⊘', hint: 'They lose a turn' },
  tether: { label: 'Tether', glyph: '∞', hint: 'Wild — pick a suit, send a note' },
}
// Frozen literal rather than Object.keys(ACTIONS): deck composition must not
// depend on property enumeration order.
export const ACTION_IDS = ['drift', 'mirror', 'tether']

export const HAND_SIZE = 7
export const NUMBERS_PER_SUIT = 9
export const DECK_SIZE = SUIT_IDS.length * (NUMBERS_PER_SUIT + ACTION_IDS.length)

export const other = w => (w === 1 ? 2 : 1)

/** 36 numbers + 12 actions, shuffled from `seed`. */
export function buildDeck(seed) {
  const deck = []
  for (const s of SUIT_IDS) {
    for (let v = 1; v <= NUMBERS_PER_SUIT; v++) deck.push({ suit: s, value: v })
    for (const a of ACTION_IDS) deck.push({ suit: s, action: a })
  }
  return shuffleInPlace(deck, mulberry32(seed))
}

/**
 * Deal a fresh game. The opening discard is forced to a plain number card so
 * the first turn is never facing a wild.
 */
export function newGame(seed, firstPlayer) {
  const deck = buildDeck(seed)
  const hands = { 1: [], 2: [] }
  for (let i = 0; i < HAND_SIZE; i++) {
    hands[1].push(deck.pop())
    hands[2].push(deck.pop())
  }
  let start
  do { start = deck.pop() } while (start && start.action)

  return {
    seed, deck, hands,
    discard: [start],
    suit: start.suit,
    turn: firstPlayer,
    skip: false,
    seq: 0,
    winner: null,
    log: [],
  }
}

/** Is `card` legal on the current discard? */
export function canPlay(card, g) {
  if (card.action === 'tether') return true
  if (card.suit === g.suit) return true
  const top = g.discard[g.discard.length - 1]
  if (card.action && top.action) return card.action === top.action
  if (!card.action && !top.action) return card.value === top.value
  return false
}

export function hasAnyPlay(g, who) {
  return g.hands[who].some(c => canPlay(c, g))
}

export function drawCards(g, who, n) {
  for (let i = 0; i < n; i++) {
    if (!g.deck.length) reshuffle(g)
    if (!g.deck.length) return      // discard too small to recycle
    g.hands[who].push(g.deck.pop())
  }
}

/**
 * Deck exhausted: fold the discard pile back under, keeping the top card.
 * Seeded from (seed, seq, size) so both clients recycle identically.
 */
export function reshuffle(g) {
  if (g.discard.length <= 1) return
  const top = g.discard.pop()
  const rest = g.discard.splice(0, g.discard.length)
  g.deck = shuffleInPlace(rest, mulberry32(g.seed + g.seq + rest.length))
  g.discard = [top]
}

/**
 * Apply one move. Called both by the local player and by the remote replay,
 * so identical inputs must produce identical state on both sides.
 *
 * Rejects anything out of order, out of turn, or not actually in hand — the
 * move arrives over a shared channel and is not trusted.
 *
 * @returns {boolean} true if the move was accepted
 */
export function applyMove(g, mv) {
  if (!g || g.winner) return false
  if (!mv || typeof mv.seq !== 'number') return false
  if (mv.seq !== g.seq + 1) return false
  if (mv.who !== g.turn) return false

  if (mv.kind === 'play') {
    if (!mv.card) return false
    const hand = g.hands[mv.who]
    if (!hand) return false
    const idx = hand.findIndex(c =>
      c.suit === mv.card.suit && c.value === mv.card.value && c.action === mv.card.action)
    if (idx === -1) return false
    if (!canPlay(hand[idx], g)) return false      // illegal play, not just absent

    const [card] = hand.splice(idx, 1)
    g.discard.push(card)
    g.suit = card.action === 'tether'
      ? (SUIT_IDS.includes(mv.suit) ? mv.suit : card.suit)
      : card.suit

    if (card.action === 'drift')  { drawCards(g, other(mv.who), 2); g.skip = true }
    if (card.action === 'mirror') { g.skip = true }
    if (card.action === 'tether' && mv.note) {
      g.log.push({ who: mv.who, note: String(mv.note).slice(0, 140) })
    }

    if (!hand.length) { g.winner = mv.who; g.seq = mv.seq; return true }
  } else if (mv.kind === 'draw') {
    drawCards(g, mv.who, 1)
    // A draw ends the turn whether or not the card was playable.
  } else {
    return false
  }

  g.seq = mv.seq
  if (g.skip) g.skip = false        // the opponent's turn is consumed
  else g.turn = other(g.turn)
  return true
}
