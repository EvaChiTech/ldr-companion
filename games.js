// ============================================================
// GAMES HUB — a small library of two-player games for the room.
//
// Adapted from the party-console idea, minus its shared-screen assumption:
// you two are never in front of the same TV, so each of you gets a full view
// and the "console" is the room itself.
//
// Headline game is TETHER, an original shedding-and-matching card game. The
// matching mechanic is old as cards; everything here is ours: four suits drawn
// from the app's own vocabulary, three action cards chosen for two players who
// are apart, and one that carries a message across with it.
//
// SYNC MODEL — deterministic, so there is no schema and no server authority:
// the host broadcasts a seed, both clients build a byte-identical deck from it
// with a seeded PRNG, and from then on only *moves* travel. Each client
// replays them in sequence order and arrives at the same state.
//
// Honest caveat: because both clients derive the whole deck, a determined
// player could read the other's hand out of memory. Server-authoritative
// dealing would need an edge function per move; for a two-person room where
// both players want the same thing, this is the right trade.
// ============================================================

import { state } from './state.js'
import { configured, sb } from './supabase.js'
import { createScope } from './lifecycle.js'

import {
  SUITS, ACTIONS,
  newGame, canPlay, hasAnyPlay, applyMove, other,
} from './games-rules.js'

// ── module state ────────────────────────────────────────────
const scope = createScope()
let channel = null
let inited  = false
let g       = null      // live game, or null when idle
let els     = {}
let pendingSuit = null  // tether awaiting a suit choice

const $ = id => document.getElementById(id)
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ============================================================
// TRANSPORT
// ============================================================
function joinChannel() {
  if (!configured || !sb || channel) return
  channel = sb.channel(`games:${state.room}`, {
    config: { broadcast: { self: false, ack: false }, presence: { key: String(state.me) } },
  })
  channel
    .on('broadcast', { event: 'g_new' },  ({ payload }) => onRemoteNew(payload))
    .on('broadcast', { event: 'g_move' }, ({ payload }) => onRemoteMove(payload))
    .on('broadcast', { event: 'g_quit' }, () => { g = null; render() })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') channel.track({ seat: state.me })
    })
}

function send(event, payload) {
  if (!channel) return
  try { channel.send({ type: 'broadcast', event, payload: { ...payload, from: state.me } }) } catch {}
}

function onRemoteNew(p) {
  if (p.from === state.me) return
  g = newGame(p.seed >>> 0, p.first)
  pendingSuit = null
  render()
  toast(`${state.theirName?.() || 'Partner'} dealt a new round`)
}

function onRemoteMove(p) {
  if (p.from === state.me || !g) return
  applyMove(g, p.move)
  render()
  if (p.move.note) toast(`💬 ${esc(p.move.note)}`)
}

// ============================================================
// LOCAL ACTIONS
// ============================================================
function startGame() {
  const seed = (crypto.getRandomValues(new Uint32Array(1))[0]) >>> 0
  // Dealer plays second, which is the usual courtesy.
  const first = other(state.me)
  g = newGame(seed, first)
  pendingSuit = null
  send('g_new', { seed, first })
  render()
}

function quitGame() {
  g = null
  send('g_quit', {})
  render()
}

function playCard(idx) {
  if (!g || g.winner || g.turn !== state.me) return
  const card = g.hands[state.me][idx]
  if (!card || !canPlay(card, g)) return

  if (card.action === 'tether') { pendingSuit = idx; render(); return }
  commit({ kind: 'play', who: state.me, seq: g.seq + 1, card })
}

function chooseSuit(suitId) {
  if (pendingSuit == null || !g) return
  const idx = pendingSuit
  const card = g.hands[state.me][idx]
  pendingSuit = null
  const note = (els.note?.value || '').trim().slice(0, 140)
  if (els.note) els.note.value = ''
  commit({ kind: 'play', who: state.me, seq: g.seq + 1, card, suit: suitId, note: note || null })
}

function drawCard() {
  if (!g || g.winner || g.turn !== state.me) return
  commit({ kind: 'draw', who: state.me, seq: g.seq + 1 })
}

function commit(move) {
  if (!applyMove(g, move)) return
  send('g_move', { move })
  render()
}

// ============================================================
// RENDER
// ============================================================
function cardFace(c) {
  const suit = SUITS.find(s => s.id === c.suit)
  if (c.action) {
    const a = ACTIONS[c.action]
    return `<span class="tc-glyph">${a.glyph}</span><span class="tc-label">${esc(a.label)}</span>`
  }
  return `<span class="tc-glyph">${suit.glyph}</span><span class="tc-value">${c.value}</span>`
}

function render() {
  if (!els.wrap) return

  if (!g) {
    els.wrap.classList.add('hidden')
    els.intro.classList.remove('hidden')
    els.startBtn.textContent = 'Deal a round'
    return
  }
  els.intro.classList.add('hidden')
  els.wrap.classList.remove('hidden')

  const me = state.me
  const mine = g.hands[me] || []
  const theirs = g.hands[other(me)] || []
  const top = g.discard[g.discard.length - 1]
  const suit = SUITS.find(s => s.id === g.suit)

  // Opponent: count only, never faces.
  els.oppCount.textContent = `${theirs.length} card${theirs.length === 1 ? '' : 's'}`
  els.oppName.textContent = state.theirName?.() || 'Partner'

  els.pile.innerHTML = `<div class="tcard tc-${top.suit} is-top">${cardFace(top)}</div>`
  els.suitNow.innerHTML = `<span class="tc-dot tc-${g.suit}"></span> ${esc(suit.label)}`
  els.deckCount.textContent = `${g.deck.length} left`

  if (g.winner) {
    els.turn.textContent = g.winner === me ? 'You went out — you win 🎉' : `${state.theirName?.() || 'Partner'} went out`
    els.turn.className = 'tg-turn ' + (g.winner === me ? 'is-win' : 'is-lose')
  } else if (g.turn === me) {
    els.turn.textContent = hasAnyPlay(g, me) ? 'Your turn' : 'Your turn — nothing playable, draw one'
    els.turn.className = 'tg-turn is-mine'
  } else {
    els.turn.textContent = `Waiting on ${state.theirName?.() || 'partner'}…`
    els.turn.className = 'tg-turn'
  }

  // Suit picker for a tether in flight.
  if (pendingSuit != null) {
    els.picker.classList.remove('hidden')
    els.picker.innerHTML =
      `<div class="tg-picker-label">Pick a suit — add a note if you like</div>
       <div class="tg-picker-row">${SUITS.map(s =>
         `<button class="tg-suit tc-${s.id}" data-suit="${s.id}">${s.glyph} ${esc(s.label)}</button>`
       ).join('')}</div>`
    els.picker.querySelectorAll('[data-suit]').forEach(b =>
      b.addEventListener('click', () => chooseSuit(b.dataset.suit)))
    els.noteRow.classList.remove('hidden')
  } else {
    els.picker.classList.add('hidden')
    els.noteRow.classList.add('hidden')
  }

  const playable = !g.winner && g.turn === me && pendingSuit == null
  els.hand.innerHTML = mine.map((c, i) => {
    const ok = playable && canPlay(c, g)
    const hint = c.action ? ` title="${esc(ACTIONS[c.action].hint)}"` : ''
    return `<button class="tcard tc-${c.suit}${ok ? '' : ' is-dim'}" data-idx="${i}"${hint}
              ${ok ? '' : 'disabled'}>${cardFace(c)}</button>`
  }).join('')
  els.hand.querySelectorAll('[data-idx]').forEach(b =>
    b.addEventListener('click', () => playCard(Number(b.dataset.idx))))

  els.drawBtn.disabled = !playable
  els.drawBtn.textContent = g.deck.length ? 'Draw' : 'Reshuffle & draw'

  // Notes that rode along with a tether.
  els.notes.innerHTML = g.log.slice(-3).map(l =>
    `<div class="tg-note"><b>${esc(l.who === me ? 'You' : (state.theirName?.() || 'Partner'))}:</b> ${esc(l.note)}</div>`
  ).join('')
}

function toast(msg) {
  const t = els.toast
  if (!t) return
  t.innerHTML = msg
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 2600)
}

// ============================================================
// LIFECYCLE
// ============================================================
export function initGames() {
  if (inited) return
  els = {
    intro:     $('tg-intro'),
    wrap:      $('tg-wrap'),
    startBtn:  $('tg-start'),
    quitBtn:   $('tg-quit'),
    hand:      $('tg-hand'),
    pile:      $('tg-pile'),
    suitNow:   $('tg-suit'),
    deckCount: $('tg-deck'),
    turn:      $('tg-turn'),
    oppCount:  $('tg-opp-count'),
    oppName:   $('tg-opp-name'),
    drawBtn:   $('tg-draw'),
    picker:    $('tg-picker'),
    noteRow:   $('tg-note-row'),
    note:      $('tg-note'),
    notes:     $('tg-notes'),
    toast:     $('tg-toast'),
  }
  if (!els.intro) return
  inited = true

  scope.on(els.startBtn, 'click', startGame)
  scope.on(els.quitBtn,  'click', quitGame)
  scope.on(els.drawBtn,  'click', drawCard)

  joinChannel()
  render()
}

export function teardownGames() {
  scope.destroy()
  if (channel && sb) { try { sb.removeChannel(channel) } catch {} }
  channel = null
  g = null
  pendingSuit = null
  inited = false
}
