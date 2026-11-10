import { state } from './state.js'
import { configured, sb } from './supabase.js'
import { playKissChime } from './sound.js'

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
))

// ============================================================
// TOGETHER TAB — thumb kiss, shared canvas, care packages
// All ephemeral coordination over a single broadcast channel.
// ============================================================

const KISS_WINDOW_MS = 700      // both fingers must land within this window
const KISS_RADIUS    = 0.06     // and within this fraction of the canvas (≈40px on 700px)
const STROKE_THROTTLE = 16      // ~60fps

const CARE_PACKAGES = [
  { kind: 'hug',     emoji: '🫂', label: 'Hug',           color: '#F4B0A7' },
  { kind: 'kiss',    emoji: '💋', label: 'Kiss',          color: '#E0617A' },
  { kind: 'flower',  emoji: '🌹', label: 'Flower',        color: '#C4594A' },
  { kind: 'thinking',emoji: '💭', label: 'Thinking of you', color: '#7A9FB3' },
  { kind: 'coffee',  emoji: '☕', label: 'Coffee for two', color: '#8B6F4E' },
  { kind: 'star',    emoji: '⭐', label: 'You shine',      color: '#D4945A' },
]

let channel = null
let canvas = null, ctx = null

// Every segment ever drawn this session, by either partner.
//
// The canvas needs a replayable history for three reasons: assigning
// canvas.width on resize clears the bitmap, a partner who opens the tab late
// would otherwise face a blank board forever, and broadcast carries no
// backlog of its own. Segments are tiny, so keeping them is cheap.
let strokes = []
let sizeObserver = null
const STROKE_CAP = 4000          // ~ the most a session plausibly draws
const SYNC_CHUNK = 400           // segments per sync message (payload limits)
let syncedOnce = false
let drawing = false, lastPoint = null, lastEmit = 0
let myLastTap = null              // {x, y, t}
let theirLastTap = null
let inited = false

// ── URL-style helpers ──
function rect() { return canvas.getBoundingClientRect() }
function toCanvasXY(clientX, clientY) {
  const r = rect()
  return [(clientX - r.left) / r.width, (clientY - r.top) / r.height]
}
function px(x, y) {
  return [x * canvas.width, y * canvas.height]
}

// ── Channel ──
function joinChannel() {
  if (!configured || !sb || channel) return
  channel = sb.channel(`together:${state.room}`, {
    config: { broadcast: { self: false, ack: false }, presence: { key: String(state.me) } },
  })
  channel
    .on('broadcast', { event: 'tap'   }, ({ payload }) => handleTap(payload))
    .on('broadcast', { event: 'draw'  }, ({ payload }) => handleDraw(payload))
    .on('broadcast', { event: 'erase' }, () =>            clearCanvas(false))
    .on('broadcast', { event: 'care'  }, ({ payload }) => playCare(payload))
    // A partner who just opened the tab asks for what is already on the board.
    .on('broadcast', { event: 'sync_req' }, ({ payload }) => sendSync(payload))
    .on('broadcast', { event: 'sync_res' }, ({ payload }) => applySync(payload))
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ partner_idx: state.me, t: Date.now() })
        // Ask once; whoever is already there answers with the board so far.
        if (!syncedOnce) {
          syncedOnce = true
          channel.send({ type: 'broadcast', event: 'sync_req', payload: { from: state.me } })
        }
      }
    })
}

function leaveChannel() {
  if (channel && sb) {
    try { sb.removeChannel(channel) } catch {}
    channel = null
  }
}

// ── Canvas drawing ──
function setCanvasSize() {
  if (!canvas) return
  const r = rect()
  // A hidden panel measures 0x0; sizing to that would blank the canvas and
  // make every later stroke collapse to a point. Wait until it is visible.
  if (r.width < 1 || r.height < 1) return

  const dpr = window.devicePixelRatio || 1
  const w = Math.floor(r.width * dpr)
  const h = Math.floor(r.height * dpr)
  if (canvas.width === w && canvas.height === h) return   // nothing to do

  // Assigning width/height clears the bitmap, so the log is replayed after.
  canvas.width  = w
  canvas.height = h
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  redraw()
}

/** Repaint the whole board from the log. */
function redraw() {
  if (!ctx || !canvas) return
  const r = rect()
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (const s of strokes) paint(s.x0, s.y0, s.x1, s.y1, s.who, r)
}

/** Draw one segment without recording it. */
function paint(x0, y0, x1, y1, who, r) {
  ctx.strokeStyle = who === state.me ? '#C4594A' : '#2A5F7A'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(x0 * r.width, y0 * r.height)
  ctx.lineTo(x1 * r.width, y1 * r.height)
  ctx.stroke()
}

function record(x0, y0, x1, y1, who) {
  strokes.push({ x0, y0, x1, y1, who })
  if (strokes.length > STROKE_CAP) strokes.splice(0, strokes.length - STROKE_CAP)
}

/** Answer a late joiner with the board so far, in payload-sized chunks. */
function sendSync(p) {
  if (!channel || p?.from === state.me || !strokes.length) return
  for (let i = 0; i < strokes.length; i += SYNC_CHUNK) {
    channel.send({
      type: 'broadcast',
      event: 'sync_res',
      payload: { from: state.me, seg: strokes.slice(i, i + SYNC_CHUNK) },
    })
  }
}

function applySync(p) {
  if (p?.from === state.me || !Array.isArray(p?.seg)) return
  // Their log already holds both partners' strokes, so only adopt it when we
  // have nothing of our own — otherwise the two would double up.
  if (strokes.length) return
  for (const s of p.seg) {
    if ([s.x0, s.y0, s.x1, s.y1].every(v => typeof v === 'number' && Number.isFinite(v))) {
      record(s.x0, s.y0, s.x1, s.y1, s.who)
    }
  }
  redraw()
}

function drawSegment(x0, y0, x1, y1, who) {
  if (!ctx) return
  record(x0, y0, x1, y1, who)
  paint(x0, y0, x1, y1, who, rect())
}

function clearCanvas(broadcast = true) {
  if (!ctx || !canvas) return
  strokes = []
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (broadcast) channel?.send({ type: 'broadcast', event: 'erase', payload: { from: state.me } })
}

function onPointerDown(e) {
  e.preventDefault()
  drawing = true
  const [x, y] = toCanvasXY(e.clientX, e.clientY)
  lastPoint = { x, y }
  // Tap detection (single point) — broadcast as a tap event for kiss-detect
  myLastTap = { x, y, t: Date.now() }
  channel?.send({ type: 'broadcast', event: 'tap', payload: { from: state.me, x, y, t: myLastTap.t } })
  evaluateKiss()
}

function onPointerMove(e) {
  if (!drawing || !lastPoint) return
  const now = Date.now()
  if (now - lastEmit < STROKE_THROTTLE) return
  lastEmit = now
  const [x, y] = toCanvasXY(e.clientX, e.clientY)
  drawSegment(lastPoint.x, lastPoint.y, x, y, state.me)
  channel?.send({ type: 'broadcast', event: 'draw', payload: {
    from: state.me, x0: lastPoint.x, y0: lastPoint.y, x1: x, y1: y,
  } })
  lastPoint = { x, y }
}
function onPointerUp() { drawing = false; lastPoint = null }

function handleDraw(p) {
  if (p.from === state.me) return
  const ok = [p.x0, p.y0, p.x1, p.y1]
    .every(v => typeof v === 'number' && Number.isFinite(v))
  if (!ok) return          // a malformed payload would poison the path
  drawSegment(p.x0, p.y0, p.x1, p.y1, p.from)
}

function handleTap(p) {
  if (p.from === state.me) return
  theirLastTap = { x: p.x, y: p.y, t: p.t || Date.now() }
  // Show their tap as a small ripple
  spawnRipple(p.x, p.y, false)
  evaluateKiss()
}

function evaluateKiss() {
  if (!myLastTap || !theirLastTap) return
  const now = Date.now()
  if (now - myLastTap.t > KISS_WINDOW_MS || now - theirLastTap.t > KISS_WINDOW_MS) return
  const dx = myLastTap.x - theirLastTap.x
  const dy = myLastTap.y - theirLastTap.y
  if (Math.hypot(dx, dy) > KISS_RADIUS) return
  // 💋 KISS!
  const cx = (myLastTap.x + theirLastTap.x) / 2
  const cy = (myLastTap.y + theirLastTap.y) / 2
  spawnKissBurst(cx, cy)
  myLastTap = null; theirLastTap = null
  showToast('💖 Kiss synced 💖')
  navigator.vibrate?.([60, 40, 60])
  playKissChime()
}

// ── Visual effects (overlaid above canvas) ──
function spawnRipple(x, y, mine) {
  const layer = document.getElementById('together-fx')
  if (!layer) return
  const r = layer.getBoundingClientRect()
  const ripple = document.createElement('div')
  ripple.className = 'tap-ripple ' + (mine ? 'mine' : 'theirs')
  ripple.style.left = (x * r.width) + 'px'
  ripple.style.top  = (y * r.height) + 'px'
  layer.appendChild(ripple)
  setTimeout(() => ripple.remove(), 800)
}

function spawnKissBurst(x, y) {
  const layer = document.getElementById('together-fx')
  if (!layer) return
  const r = layer.getBoundingClientRect()
  const cx = x * r.width, cy = y * r.height
  for (let i = 0; i < 12; i++) {
    const h = document.createElement('div')
    h.className = 'kiss-heart'
    h.textContent = '❤'
    const angle = (Math.PI * 2 * i) / 12
    const dist = 60 + Math.random() * 40
    h.style.left = cx + 'px'
    h.style.top  = cy + 'px'
    h.style.setProperty('--dx', Math.cos(angle) * dist + 'px')
    h.style.setProperty('--dy', Math.sin(angle) * dist + 'px')
    h.style.setProperty('--rot', (Math.random() * 60 - 30) + 'deg')
    layer.appendChild(h)
    setTimeout(() => h.remove(), 1600)
  }
  // Big center heart
  const big = document.createElement('div')
  big.className = 'kiss-center'
  big.textContent = '💖'
  big.style.left = cx + 'px'
  big.style.top  = cy + 'px'
  layer.appendChild(big)
  setTimeout(() => big.remove(), 1600)
}

// ── Care packages ──
function buildCareButtons() {
  const wrap = document.getElementById('care-row')
  if (!wrap || wrap.dataset.bound) return
  wrap.dataset.bound = '1'
  CARE_PACKAGES.forEach(p => {
    const b = document.createElement('button')
    b.className = 'care-btn'
    b.title = p.label
    b.style.borderColor = p.color
    b.innerHTML = `<span class="care-emoji">${escapeHtml(p.emoji)}</span><span class="care-label">${escapeHtml(p.label)}</span>`
    b.onclick = () => sendCare(p.kind)
    wrap.appendChild(b)
  })
}

function sendCare(kind) {
  const pkg = CARE_PACKAGES.find(p => p.kind === kind)
  if (!pkg) return
  channel?.send({ type: 'broadcast', event: 'care', payload: { from: state.me, kind, t: Date.now() } })
  playCare({ from: state.me, kind, t: Date.now() })  // immediate local feedback
  showToast(`Sent ${pkg.label} ${pkg.emoji}`)
}

function playCare(p) {
  const pkg = CARE_PACKAGES.find(c => c.kind === p.kind)
  if (!pkg) return
  const overlay = document.createElement('div')
  overlay.className = 'care-overlay'
  overlay.innerHTML = `
    <div class="care-burst" style="color:${escapeHtml(pkg.color)}">${escapeHtml(pkg.emoji)}</div>
    <div class="care-from">
      ${p.from === state.me ? 'Sent' : `from ${escapeHtml(state.theirName?.() || 'your partner')}`}
    </div>`
  document.body.appendChild(overlay)
  setTimeout(() => overlay.classList.add('dismiss'), 1100)
  setTimeout(() => overlay.remove(), 1700)
  if (p.from !== state.me) navigator.vibrate?.([30, 20, 30, 20, 60])
}

// ── Toast (shares the global one) ──
function showToast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(showToast._tm)
  showToast._tm = setTimeout(() => t.style.opacity = '0', 2200)
}

// ============================================================
// PUBLIC API
// ============================================================
export function initTogetherTab() {
  if (inited) return
  inited = true

  canvas = document.getElementById('together-canvas')
  if (!canvas) return
  ctx = canvas.getContext('2d')
  setCanvasSize()
  window.addEventListener('resize', setCanvasSize)

  // The panel may still be hidden (0x0) when this runs, and the sub-nav can
  // hide it again later. Observing the element re-sizes and repaints it the
  // moment it has real dimensions, instead of leaving a dead canvas.
  if ('ResizeObserver' in window) {
    sizeObserver = new ResizeObserver(() => setCanvasSize())
    sizeObserver.observe(canvas)
  }

  // Pointer events (works for mouse + touch)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup',   onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerUp)

  document.getElementById('canvas-clear')?.addEventListener('click', () => clearCanvas(true))

  buildCareButtons()
  joinChannel()
}

export function teardownTogether() {
  sizeObserver?.disconnect(); sizeObserver = null
  strokes = []
  syncedOnce = false
  leaveChannel()
  inited = false
}
