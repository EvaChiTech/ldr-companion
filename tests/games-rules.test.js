import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SUIT_IDS, ACTION_IDS, HAND_SIZE, DECK_SIZE,
  buildDeck, newGame, canPlay, hasAnyPlay, applyMove, drawCards, reshuffle, other,
} from '../games-rules.js'

// ── helpers ─────────────────────────────────────────────────

/** Put a known card at the top of the discard and set the live suit. */
function setTop(g, card) {
  g.discard.push(card)
  g.suit = card.suit
}
/** Give a player an exact hand, for deterministic scenarios. */
function setHand(g, who, cards) { g.hands[who] = cards }

const num = (suit, value) => ({ suit, value })
const act = (suit, action) => ({ suit, action })

// ── deck ────────────────────────────────────────────────────

test('deck has the documented composition', () => {
  const deck = buildDeck(1)
  assert.equal(deck.length, DECK_SIZE)
  assert.equal(DECK_SIZE, 48)

  for (const s of SUIT_IDS) {
    const numbers = deck.filter(c => c.suit === s && !c.action)
    assert.equal(numbers.length, 9, `${s} should have 9 numbers`)
    assert.deepEqual(numbers.map(c => c.value).sort((a, b) => a - b), [1,2,3,4,5,6,7,8,9])
    for (const a of ACTION_IDS) {
      assert.equal(deck.filter(c => c.suit === s && c.action === a).length, 1)
    }
  }
})

test('same seed builds an identical deck on both clients', () => {
  assert.deepEqual(buildDeck(777), buildDeck(777))
})

test('different seeds build different decks', () => {
  assert.notDeepEqual(buildDeck(1), buildDeck(2))
})

// ── dealing ─────────────────────────────────────────────────

test('newGame deals two full hands and keeps the rest', () => {
  const g = newGame(42, 1)
  assert.equal(g.hands[1].length, HAND_SIZE)
  assert.equal(g.hands[2].length, HAND_SIZE)
  assert.equal(g.discard.length, 1)
  // Every card is accounted for: hands + discard + remaining deck.
  assert.equal(g.deck.length + HAND_SIZE * 2 + 1, DECK_SIZE)
})

test('the opening discard is never a wild or action card', () => {
  // Sweep many seeds: a wild opener would be an unplayable first turn.
  for (let seed = 0; seed < 300; seed++) {
    const g = newGame(seed, 1)
    assert.equal(g.discard[0].action, undefined, `seed ${seed} opened on an action`)
    assert.equal(g.suit, g.discard[0].suit)
  }
})

test('newGame is fully deterministic from (seed, firstPlayer)', () => {
  assert.deepEqual(newGame(9, 1), newGame(9, 1))
})

test('no card is dealt to both players at once', () => {
  const g = newGame(13, 1)
  const key = c => `${c.suit}:${c.value ?? c.action}`
  const all = [...g.hands[1], ...g.hands[2], ...g.discard, ...g.deck].map(key)
  assert.equal(new Set(all).size, all.length, 'a card appears twice')
})

// ── legality ────────────────────────────────────────────────

test('canPlay matches on suit', () => {
  const g = newGame(1, 1)
  setTop(g, num('ember', 5))
  assert.ok(canPlay(num('ember', 2), g))
})

test('canPlay matches on value across suits', () => {
  const g = newGame(1, 1)
  setTop(g, num('ember', 5))
  assert.ok(canPlay(num('tide', 5), g))
})

test('canPlay rejects a mismatch in both suit and value', () => {
  const g = newGame(1, 1)
  setTop(g, num('ember', 5))
  assert.equal(canPlay(num('tide', 4), g), false)
})

test('a tether is always playable', () => {
  const g = newGame(1, 1)
  setTop(g, num('ember', 5))
  assert.ok(canPlay(act('bloom', 'tether'), g))
})

test('an action card can follow the same action in another suit', () => {
  const g = newGame(1, 1)
  setTop(g, act('ember', 'drift'))
  assert.ok(canPlay(act('tide', 'drift'), g))
  // but a number cannot match an action by value
  assert.equal(canPlay(num('tide', 3), g), false)
})

test('hasAnyPlay reports whether a hand is stuck', () => {
  const g = newGame(1, 1)
  setTop(g, num('ember', 5))
  setHand(g, 1, [num('tide', 4), num('dusk', 7)])
  assert.equal(hasAnyPlay(g, 1), false)
  setHand(g, 1, [num('tide', 5)])
  assert.ok(hasAnyPlay(g, 1))
})

// ── move validation (untrusted input) ───────────────────────

test('a move out of sequence is rejected', () => {
  const g = newGame(1, 1)
  const card = g.hands[1][0]
  assert.equal(applyMove(g, { kind: 'play', who: 1, seq: 5, card }), false)
  assert.equal(g.seq, 0)
})

test('a replayed move is rejected, so a duplicate broadcast is harmless', () => {
  const g = newGame(1, 1)
  setTop(g, num('ember', 5))
  setHand(g, 1, [num('ember', 1), num('ember', 2)])
  g.turn = 1
  const mv = { kind: 'play', who: 1, seq: 1, card: num('ember', 1) }
  assert.ok(applyMove(g, mv))
  assert.equal(applyMove(g, mv), false, 'the same move applied twice')
  assert.equal(g.hands[1].length, 1)
})

test('a move out of turn is rejected', () => {
  const g = newGame(1, 1)
  g.turn = 1
  assert.equal(applyMove(g, { kind: 'play', who: 2, seq: 1, card: g.hands[2][0] }), false)
})

test('playing a card that is not in hand is rejected', () => {
  const g = newGame(1, 1)
  g.turn = 1
  setHand(g, 1, [num('ember', 1)])
  const bogus = { suit: 'tide', value: 9 }
  assert.equal(applyMove(g, { kind: 'play', who: 1, seq: 1, card: bogus }), false)
})

test('playing a held but ILLEGAL card is rejected', () => {
  // Guards against a crafted payload dumping an unplayable card.
  const g = newGame(1, 1)
  g.turn = 1
  setTop(g, num('ember', 5))
  setHand(g, 1, [num('tide', 3)])
  assert.equal(applyMove(g, { kind: 'play', who: 1, seq: 1, card: num('tide', 3) }), false)
  assert.equal(g.hands[1].length, 1)
})

test('an unknown move kind is rejected', () => {
  const g = newGame(1, 1)
  g.turn = 1
  assert.equal(applyMove(g, { kind: 'teleport', who: 1, seq: 1 }), false)
})

test('a malformed move does not throw', () => {
  const g = newGame(1, 1)
  g.turn = 1
  for (const mv of [null, undefined, {}, { kind: 'play', who: 1 }, { seq: 1 }]) {
    assert.equal(applyMove(g, mv), false)
  }
})

// ── turn mechanics ──────────────────────────────────────────

test('a plain play passes the turn', () => {
  const g = newGame(1, 1)
  g.turn = 1
  setTop(g, num('ember', 5))
  setHand(g, 1, [num('ember', 1), num('ember', 2)])
  applyMove(g, { kind: 'play', who: 1, seq: 1, card: num('ember', 1) })
  assert.equal(g.turn, 2)
})

test('drift makes the opponent draw two and lose the turn', () => {
  const g = newGame(1, 1)
  g.turn = 1
  setTop(g, act('ember', 'drift'))
  setHand(g, 1, [act('tide', 'drift'), num('ember', 1)])
  const before = g.hands[2].length
  applyMove(g, { kind: 'play', who: 1, seq: 1, card: act('tide', 'drift') })
  assert.equal(g.hands[2].length, before + 2)
  assert.equal(g.turn, 1, 'player 1 keeps the turn')
})

test('mirror costs the opponent their turn without a draw', () => {
  const g = newGame(1, 1)
  g.turn = 1
  setTop(g, num('ember', 5))
  setHand(g, 1, [act('ember', 'mirror'), num('ember', 1)])
  const before = g.hands[2].length
  applyMove(g, { kind: 'play', who: 1, seq: 1, card: act('ember', 'mirror') })
  assert.equal(g.hands[2].length, before)
  assert.equal(g.turn, 1)
})

test('a tether sets the chosen suit', () => {
  const g = newGame(1, 1)
  g.turn = 1
  setTop(g, num('ember', 5))
  setHand(g, 1, [act('ember', 'tether'), num('dusk', 1)])
  applyMove(g, { kind: 'play', who: 1, seq: 1, card: act('ember', 'tether'), suit: 'bloom' })
  assert.equal(g.suit, 'bloom')
})

test('a tether with a bogus suit falls back to the card suit', () => {
  const g = newGame(1, 1)
  g.turn = 1
  setTop(g, num('ember', 5))
  setHand(g, 1, [act('ember', 'tether'), num('dusk', 1)])
  applyMove(g, { kind: 'play', who: 1, seq: 1, card: act('ember', 'tether'), suit: 'not-a-suit' })
  assert.equal(g.suit, 'ember')
})

test('a tether note is captured and length-capped', () => {
  const g = newGame(1, 1)
  g.turn = 1
  setTop(g, num('ember', 5))
  setHand(g, 1, [act('ember', 'tether'), num('dusk', 1)])
  applyMove(g, {
    kind: 'play', who: 1, seq: 1,
    card: act('ember', 'tether'), suit: 'tide', note: 'x'.repeat(500),
  })
  assert.equal(g.log.length, 1)
  assert.equal(g.log[0].note.length, 140)
  assert.equal(g.log[0].who, 1)
})

test('a draw passes the turn', () => {
  const g = newGame(1, 1)
  g.turn = 1
  const before = g.hands[1].length
  applyMove(g, { kind: 'draw', who: 1, seq: 1 })
  assert.equal(g.hands[1].length, before + 1)
  assert.equal(g.turn, 2)
})

// ── winning ─────────────────────────────────────────────────

test('emptying your hand wins and freezes the game', () => {
  const g = newGame(1, 1)
  g.turn = 1
  setTop(g, num('ember', 5))
  setHand(g, 1, [num('ember', 3)])
  assert.ok(applyMove(g, { kind: 'play', who: 1, seq: 1, card: num('ember', 3) }))
  assert.equal(g.winner, 1)
  // Nothing may be applied afterwards.
  assert.equal(applyMove(g, { kind: 'draw', who: 2, seq: 2 }), false)
})

// ── deck recycling ──────────────────────────────────────────

test('reshuffle recycles the discard and keeps the top card', () => {
  const g = newGame(1, 1)
  g.deck = []
  g.discard = [num('ember', 1), num('tide', 2), num('dusk', 3), num('bloom', 4)]
  const top = g.discard[g.discard.length - 1]
  reshuffle(g)
  assert.equal(g.discard.length, 1)
  assert.deepEqual(g.discard[0], top)
  assert.equal(g.deck.length, 3)
})

test('reshuffle is identical on both clients', () => {
  const mk = () => {
    const g = newGame(5, 1)
    g.deck = []
    g.discard = [num('ember', 1), num('tide', 2), num('dusk', 3), num('bloom', 4)]
    g.seq = 3
    reshuffle(g)
    return g
  }
  assert.deepEqual(mk(), mk())
})

test('drawing from an unrecyclable deck is a no-op, not a crash', () => {
  const g = newGame(1, 1)
  g.deck = []
  g.discard = [num('ember', 1)]       // too small to recycle
  const before = g.hands[1].length
  drawCards(g, 1, 3)
  assert.equal(g.hands[1].length, before)
})

// ── convergence: the property the whole design rests on ─────

test('two independent clients replaying the same moves converge', () => {
  const seed = 31337
  const a = newGame(seed, 1)
  const b = newGame(seed, 1)
  assert.deepEqual(a, b)

  // Drive a real game: whoever is to move plays their first legal card, else draws.
  for (let seq = 1; seq <= 60; seq++) {
    if (a.winner) break
    const who = a.turn
    const idx = a.hands[who].findIndex(c => canPlay(c, a))
    const mv = idx === -1
      ? { kind: 'draw', who, seq }
      : { kind: 'play', who, seq, card: a.hands[who][idx], suit: 'tide' }

    const okA = applyMove(a, mv)
    const okB = applyMove(b, mv)
    assert.equal(okA, okB, `clients disagreed on move ${seq}`)
    assert.deepEqual(a, b, `state diverged after move ${seq}`)
  }
})

test('other() flips the seat', () => {
  assert.equal(other(1), 2)
  assert.equal(other(2), 1)
})
