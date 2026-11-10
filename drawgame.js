// ============================================================
// GUESS THE DRAWING — one of you draws a secret word, the other guesses.
//
// Distinct from the free-draw canvas in together.js: that one is a shared
// surface with no goal, this has a word, a role, and a scoreline. Roles swap
// each round so neither of you is stuck drawing all evening.
//
// SYNC: the drawer broadcasts stroke segments in normalised (0..1) coordinates
// so the two canvases need not be the same pixel size. Guesses travel as text
// and are checked locally by the drawer's client, which is the only side that
// knows the word — the word itself is never broadcast until the round ends.
// ============================================================

import { state } from './state.js'
import { configured, sb } from './supabase.js'
import { createScope } from './lifecycle.js'

// Ordinary, drawable nouns. Deliberately concrete — abstractions are miserable
// to draw and worse to guess.
const WORDS = [
  'anchor', 'balloon', 'bicycle', 'bridge', 'cactus', 'candle', 'castle', 'cloud',
  'compass', 'dolphin', 'doorway', 'dragon', 'envelope', 'feather', 'ferry', 'fireplace',
  'fishbowl', 'guitar', 'hammock', 'harbour', 'hedgehog', 'helmet', 'igloo', 'kettle',
  'kite', 'ladder', 'lantern', 'lighthouse', 'mailbox', 'mittens', 'mountain', 'mushroom',
  'octopus', 'orchard', 'parasol', 'pancake', 'penguin', 'piano', 'pillow', 'pinecone',
  'rainbow', 'raincoat', 'robot', 'rocket', 'sailboat', 'sandcastle', 'scarf', 'seashell',
  'skateboard', 'snowman', 'suitcase', 'sunflower', 'telescope', 'teapot', 'tent',
  'thunderstorm', 'tractor', 'treehouse', 'tulip', 'turtle', 'umbrella', 'violin',
  'waterfall', 'windmill', 'wristwatch',
]

const STROKE = 3
const INK = { 1: '#C4594A', 2: '#3E7C9B' }

const scope = createScope()
let channel = null
let inited  = false
let els     = {}
let canvas = null, ctx = null
let sizeObserver = null

// Replayable history of the current drawing.
//
// Needed for three reasons: assigning canvas.width on resize clears the
// bitmap, a guesser who arrives mid-round would otherwise see nothing, and
// broadcast carries no backlog. Coordinates are normalised 0..1, so a replay
// is correct at any canvas size.
let strokes = []
const STROKE_CAP = 4000
const SYNC_CHUNK = 400
let drawing = false, last = null
let round = null    // { drawer, word|null, over, winner }
let score = { 1: 0, 2: 0 }

const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const amDrawer = () => round && round.drawer === state.me
/** Normalised canvas coordinate from an untrusted payload. */
const isCoord = v => typeof v === 'number' && Number.isFinite(v) && v >= -0.5 && v <= 1.5
const norm = s => String(s).toLowerCase().replace(/[^a-z]/g, '')

// ============================================================
// CANVAS
// ============================================================
function sizeCanvas() {
  if (!canvas) return
  const r = canvas.getBoundingClientRect()
  // The stage starts hidden, so this runs at 0x0 on init. Clamping to 1x1
  // here is what produced a single stretched pixel of flat colour — bail and
  // let the ResizeObserver size it once it is genuinely visible.
  if (r.width < 1 || r.height < 1) return

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = Math.round(r.width * dpr)
  const h = Math.round(r.height * dpr)
  if (canvas.width === w && canvas.height === h) return

  canvas.width = w
  canvas.height = h
  ctx = canvas.getContext('2d')
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  redraw()
}

/** Repaint the drawing from the log. */
function redraw() {
  if (!ctx || !canvas) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (const s of strokes) paint(s.x0, s.y0, s.x1, s.y1, s.who)
}

function record(x0, y0, x1, y1, who) {
  strokes.push({ x0, y0, x1, y1, who })
  if (strokes.length > STROKE_CAP) strokes.splice(0, strokes.length - STROKE_CAP)
}

/** Draw without recording. */
function paint(x0, y0, x1, y1, who) {
  if (!ctx) return
  ctx.strokeStyle = INK[who] || INK[1]
  ctx.lineWidth = STROKE * Math.min(window.devicePixelRatio || 1, 2)
  ctx.beginPath()
  ctx.moveTo(x0 * canvas.width, y0 * canvas.height)
  ctx.lineTo(x1 * canvas.width, y1 * canvas.height)
  ctx.stroke()
}

/** Draw and remember, so a resize or a late guesser can be served. */
function segment(x0, y0, x1, y1, who) {
  record(x0, y0, x1, y1, who)
  paint(x0, y0, x1, y1, who)
}

function clearCanvas() {
  strokes = []
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height)
}

function pointFrom(ev) {
  const r = canvas.getBoundingClientRect()
  const t = ev.touches?.[0]
  const cx = t ? t.clientX : ev.clientX
  const cy = t ? t.clientY : ev.clientY
  return { x: (cx - r.left) / r.width, y: (cy - r.top) / r.height }
}

function onDown(ev) {
  if (!amDrawer() || round.over) return
  ev.preventDefault()
  drawing = true
  last = pointFrom(ev)
}

function onMove(ev) {
  if (!drawing || !amDrawer()) return
  ev.preventDefault()
  const p = pointFrom(ev)
  segment(last.x, last.y, p.x, p.y, state.me)
  send('d_stroke', { x0: last.x, y0: last.y, x1: p.x, y1: p.y })
  last = p
}

function onUp() { drawing = false; last = null }

// ============================================================
// TRANSPORT
// ============================================================
function joinChannel() {
  if (!configured || !sb || channel) return
  channel = sb.channel(`draw:${state.room}`, {
    config: { broadcast: { self: false, ack: false } },
  })
  channel
    .on('broadcast', { event: 'd_round' }, ({ payload }) => {
      if (payload.from === state.me) return
      // The word stays with the drawer; we only learn who draws.
      round = { drawer: payload.drawer, word: null, over: false, winner: null }
      clearCanvas()
      render()
    })
    .on('broadcast', { event: 'd_stroke' }, ({ payload }) => {
      if (payload.from === state.me) return
      const { x0, y0, x1, y1 } = payload
      // NaN would silently poison the canvas path; drop the segment instead.
      if (![x0, y0, x1, y1].every(isCoord)) return
      segment(x0, y0, x1, y1, payload.from)
    })
    .on('broadcast', { event: 'd_clear' }, ({ payload }) => {
      if (payload.from === state.me) return
      clearCanvas()
    })
    .on('broadcast', { event: 'd_guess' }, ({ payload }) => {
      if (payload.from === state.me) return
      onGuessArrived(payload.text)
    })
    .on('broadcast', { event: 'd_end' }, ({ payload }) => {
      if (payload.from === state.me) return
      finishRound(payload.word, payload.winner, false)
    })
    // A partner opening the tab mid-round asks for the drawing so far.
    .on('broadcast', { event: 'd_sync_req' }, ({ payload }) => sendSync(payload))
    .on('broadcast', { event: 'd_sync_res' }, ({ payload }) => applySync(payload))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') {
        channel.send({ type: 'broadcast', event: 'd_sync_req', payload: { from: state.me } })
      }
    })
}

function send(event, payload) {
  if (!channel) return
  try { channel.send({ type: 'broadcast', event, payload: { ...payload, from: state.me } }) } catch {}
}

/** Answer a mid-round joiner with the drawing so far, in payload-sized chunks. */
function sendSync(p) {
  if (!channel || p?.from === state.me || !strokes.length) return
  for (let i = 0; i < strokes.length; i += SYNC_CHUNK) {
    channel.send({
      type: 'broadcast',
      event: 'd_sync_res',
      payload: { from: state.me, seg: strokes.slice(i, i + SYNC_CHUNK) },
    })
  }
}

function applySync(p) {
  if (p?.from === state.me || !Array.isArray(p?.seg)) return
  if (strokes.length) return          // we already have a drawing; don't double up
  for (const s of p.seg) {
    if ([s.x0, s.y0, s.x1, s.y1].every(isCoord)) record(s.x0, s.y0, s.x1, s.y1, s.who)
  }
  redraw()
}

// ============================================================
// ROUND FLOW
// ============================================================
function newRound() {
  strokes = []
  const word = WORDS[Math.floor(Math.random() * WORDS.length)]
  round = { drawer: state.me, word, over: false, winner: null }
  score = score || { 1: 0, 2: 0 }
  clearCanvas()
  send('d_round', { drawer: state.me })
  render()
}

/** Only the drawer's client holds the word, so only it can judge a guess. */
function onGuessArrived(text) {
  addGuess(text, false)
  if (!amDrawer() || !round || round.over) return
  if (norm(text) === norm(round.word)) {
    finishRound(round.word, other(state.me), true)
  }
}

function submitGuess() {
  const text = (els.guessInput.value || '').trim()
  if (!text || !round || round.over || amDrawer()) return
  els.guessInput.value = ''
  addGuess(text, true)
  send('d_guess', { text: text.slice(0, 60) })
}

function giveUp() {
  if (!amDrawer() || !round || round.over) return
  finishRound(round.word, null, true)
}

function finishRound(word, winner, broadcast) {
  if (!round) return
  round.over = true
  round.word = word
  round.winner = winner
  if (winner) score[winner] = (score[winner] || 0) + 1
  if (broadcast) send('d_end', { word, winner })
  render()
}

const other = w => (w === 1 ? 2 : 1)

function addGuess(text, mine) {
  if (!els.guesses) return
  const row = document.createElement('div')
  row.className = 'dg-guess' + (mine ? ' is-mine' : '')
  row.textContent = text
  els.guesses.append(row)
  while (els.guesses.childElementCount > 20) els.guesses.firstElementChild.remove()
  els.guesses.scrollTop = els.guesses.scrollHeight
}

// ============================================================
// RENDER
// ============================================================
function render() {
  if (!els.card) return

  els.score.textContent = `${state.myName?.() || 'You'} ${score[state.me] || 0} · ${score[other(state.me)] || 0} ${state.theirName?.() || 'Partner'}`

  if (!round) {
    els.role.textContent = ''
    els.word.classList.add('hidden')
    els.stage.classList.add('hidden')
    els.guessRow.classList.add('hidden')
    els.clearBtn.classList.add('hidden')
    els.giveUpBtn.classList.add('hidden')
    els.newBtn.textContent = 'Start a round'
    return
  }

  els.stage.classList.remove('hidden')
  // Size now that the stage is visible; sizeCanvas() no-ops if unchanged.
  sizeCanvas()

  if (round.over) {
    els.role.textContent = round.winner
      ? (round.winner === state.me ? 'You got it 🎉' : `${state.theirName?.() || 'Partner'} got it`)
      : 'Round over'
    els.word.textContent = `It was “${round.word}”`
    els.word.classList.remove('hidden')
    els.guessRow.classList.add('hidden')
    els.clearBtn.classList.add('hidden')
    els.giveUpBtn.classList.add('hidden')
    els.newBtn.textContent = 'Next round'
    return
  }

  els.newBtn.textContent = 'New round'
  if (amDrawer()) {
    els.role.textContent = 'You draw — no letters or numbers!'
    els.word.textContent = round.word
    els.word.classList.remove('hidden')
    els.guessRow.classList.add('hidden')
    els.clearBtn.classList.remove('hidden')
    els.giveUpBtn.classList.remove('hidden')
  } else {
    els.role.textContent = `${state.theirName?.() || 'Partner'} is drawing — guess!`
    els.word.classList.add('hidden')
    els.guessRow.classList.remove('hidden')
    els.clearBtn.classList.add('hidden')
    els.giveUpBtn.classList.add('hidden')
  }
}

// ============================================================
// LIFECYCLE
// ============================================================
export function initDrawGame() {
  if (inited) return
  els = {
    card:       $('dg-card'),
    stage:      $('dg-stage'),
    role:       $('dg-role'),
    word:       $('dg-word'),
    score:      $('dg-score'),
    newBtn:     $('dg-new'),
    clearBtn:   $('dg-clear'),
    giveUpBtn:  $('dg-giveup'),
    guessRow:   $('dg-guess-row'),
    guessInput: $('dg-guess'),
    guessBtn:   $('dg-guess-btn'),
    guesses:    $('dg-guesses'),
  }
  if (!els.card) return
  inited = true

  canvas = $('dg-canvas')
  ctx = canvas.getContext('2d')
  sizeCanvas()
  scope.on(window, 'resize', sizeCanvas)

  // The stage is hidden until a round starts, so the canvas has no size at
  // init. Observing it means the first real layout triggers a correct resize.
  if ('ResizeObserver' in window) {
    sizeObserver = new ResizeObserver(() => sizeCanvas())
    sizeObserver.observe(canvas)
  }

  scope.on(canvas, 'mousedown', onDown)
  scope.on(canvas, 'mousemove', onMove)
  scope.on(window, 'mouseup', onUp)
  scope.on(canvas, 'touchstart', onDown, { passive: false })
  scope.on(canvas, 'touchmove', onMove, { passive: false })
  scope.on(window, 'touchend', onUp)

  scope.on(els.newBtn,    'click', newRound)
  scope.on(els.clearBtn,  'click', () => { clearCanvas(); send('d_clear', {}) })
  scope.on(els.giveUpBtn, 'click', giveUp)
  scope.on(els.guessBtn,  'click', submitGuess)
  scope.on(els.guessInput,'keydown', e => { if (e.key === 'Enter') submitGuess() })

  joinChannel()
  render()
}

export function teardownDrawGame() {
  if (channel && sb) { try { sb.removeChannel(channel) } catch {} }
  scope.destroy()
  sizeObserver?.disconnect(); sizeObserver = null
  strokes = []
  channel = null
  round = null
  score = { 1: 0, 2: 0 }
  inited = false
}
