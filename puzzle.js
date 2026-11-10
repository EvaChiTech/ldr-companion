// ============================================================
// PUZZLE — solve a jigsaw of your own photos, together, live.
//
// Picture source is deliberately your shared album rather than a stock
// library: the photos you two have already sent each other are the ones worth
// rebuilding, and they are already in storage where you can both reach them.
// (To use a new one, send it in Chat first — it appears here straight away.)
//
// SYNC: one side picks the photo and grid, broadcasts {url, size, seed}. Both
// clients scramble identically from the seed, so no board state travels — only
// swaps, each with a sequence number. Tap one tile then another to swap them;
// chosen over drag because a tap pair survives a laggy connection intact,
// where a half-delivered drag does not.
// ============================================================

import { state } from './state.js'
import { configured, sb } from './supabase.js'
import * as db from './db.js'
import { SIZES, newBoard, applySwap, placedCount } from './puzzle-rules.js'

// Same guard the album uses: only ever render media from our own storage.
const SUPABASE_ORIGIN = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL).origin } catch { return '' }
})()
function isSafeMediaUrl(url) {
  try {
    const u = new URL(String(url))
    return u.protocol === 'https:' && !!SUPABASE_ORIGIN && u.origin === SUPABASE_ORIGIN
  } catch { return false }
}

let channel = null
let inited  = false
let els     = {}
let board   = null   // { url, size, tiles:number[], seq, solved }
let picked  = null   // index of first tapped tile
let photos  = []

const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))


// ============================================================
// TRANSPORT
// ============================================================
function joinChannel() {
  if (!configured || !sb || channel) return
  channel = sb.channel(`puzzle:${state.room}`, {
    config: { broadcast: { self: false, ack: false } },
  })
  channel
    .on('broadcast', { event: 'p_new' },  ({ payload }) => {
      if (payload.from === state.me) return
      if (!isSafeMediaUrl(payload.url)) return
      startBoard(payload.url, payload.size, payload.seed, false)
      toast(`${state.theirName?.() || 'Partner'} started a puzzle`)
    })
    .on('broadcast', { event: 'p_swap' }, ({ payload }) => {
      if (payload.from === state.me || !board) return
      applySwap(board, payload.a, payload.b, payload.seq)
      render()
    })
    .subscribe()
}

function send(event, payload) {
  if (!channel) return
  try { channel.send({ type: 'broadcast', event, payload: { ...payload, from: state.me } }) } catch {}
}

// ============================================================
// BOARD
// ============================================================
function startBoard(url, size, seed, broadcast) {
  board = newBoard(url, size, seed)
  picked = null
  if (broadcast) send('p_new', { url, size, seed })
  render()
}

function tapTile(idx) {
  if (!board || board.solved) return
  if (picked === null) { picked = idx; render(); return }
  if (picked === idx)  { picked = null; render(); return }

  const a = picked, b = idx
  picked = null
  if (applySwap(board, a, b, board.seq + 1)) {
    send('p_swap', { a, b, seq: board.seq })
    render()
  }
}

// ============================================================
// RENDER
// ============================================================
function render() {
  if (!els.stage) return

  if (!board) {
    els.stage.classList.add('hidden')
    els.status.textContent = ''
    return
  }
  els.stage.classList.remove('hidden')

  const n = board.size
  els.stage.style.setProperty('--pz-n', String(n))
  els.stage.innerHTML = board.tiles.map((tile, pos) => {
    // `tile` is which slice of the photo sits at grid position `pos`.
    const r = Math.floor(tile / n), c = tile % n
    // With N columns, background-size is N*100%; step is 100/(N-1) per cell.
    const step = n > 1 ? 100 / (n - 1) : 0
    const sel = picked === pos ? ' is-picked' : ''
    const done = board.solved ? ' is-done' : ''
    return `<button class="pz-tile${sel}${done}" data-pos="${pos}"
              aria-label="tile ${tile + 1}"
              style="background-image:url('${esc(board.url)}');
                     background-size:${n * 100}% ${n * 100}%;
                     background-position:${c * step}% ${r * step}%"></button>`
  }).join('')

  if (!board.solved) {
    els.stage.querySelectorAll('[data-pos]').forEach(b =>
      b.addEventListener('click', () => tapTile(Number(b.dataset.pos))))
  }

  const placed = placedCount(board.tiles)
  els.status.textContent = board.solved
    ? 'Done — you two put it back together 💞'
    : `${placed} of ${n * n} in place`
  els.status.className = 'pz-status' + (board.solved ? ' is-done' : '')
}

function renderPicker() {
  if (!els.picker) return
  if (!photos.length) {
    els.picker.innerHTML = '<div class="pz-none">No photos yet — send one in Chat and it shows up here.</div>'
    return
  }
  els.picker.innerHTML = photos.slice(0, 12).map(p =>
    `<button class="pz-thumb" data-url="${esc(p.image_url)}">
       <img src="${esc(p.image_url)}" alt="" loading="lazy">
     </button>`).join('')
  els.picker.querySelectorAll('[data-url]').forEach(b =>
    b.addEventListener('click', () => {
      const size = Number(els.size.value) || 3
      const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0
      startBoard(b.dataset.url, size, seed, true)
    }))
}

function toast(msg) {
  if (!els.toast) return
  els.toast.textContent = msg
  els.toast.classList.add('show')
  setTimeout(() => els.toast.classList.remove('show'), 2600)
}

// ============================================================
// LIFECYCLE
// ============================================================
export async function initPuzzle() {
  if (inited) return
  els = {
    card:   $('pz-card'),
    picker: $('pz-picker'),
    size:   $('pz-size'),
    stage:  $('pz-stage'),
    status: $('pz-status'),
    toast:  $('pz-toast'),
  }
  if (!els.card) return
  inited = true

  els.size.innerHTML = SIZES.map(n =>
    `<option value="${n}">${n} × ${n}</option>`).join('')

  joinChannel()
  render()

  if (configured) {
    try {
      photos = (await db.fetchChatImages()).filter(p => isSafeMediaUrl(p.image_url))
    } catch { photos = [] }
  }
  renderPicker()
}

/** A new photo arrived over realtime — offer it as a puzzle source. */
export async function onPuzzlePhotos() {
  if (!inited || !configured) return
  try {
    photos = (await db.fetchChatImages()).filter(p => isSafeMediaUrl(p.image_url))
    renderPicker()
  } catch {}
}

export function teardownPuzzle() {
  if (channel && sb) { try { sb.removeChannel(channel) } catch {} }
  channel = null
  board = null
  picked = null
  photos = []
  inited = false
}
