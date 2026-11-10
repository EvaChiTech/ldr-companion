// ============================================================
// GLANCE — a window onto their side.
//
// The widget idea, adapted: the newest photo *they* sent, held large and
// quiet at the top of Home, so opening the app shows you them rather than a
// list of things to do.
//
// Zero schema. Photos already arrive through chat, so this reads the same rows
// the album does and simply keeps the latest one from the other seat. That
// also means nothing new to upload, moderate, or clean up.
// ============================================================

import { state } from './state.js'
import { configured } from './supabase.js'
import * as db from './db.js'
import { createScope } from './lifecycle.js'

// Only ever render media served from our own Supabase storage — the same
// guard the album uses, for the same reason: a row could carry any URL.
const SUPABASE_ORIGIN = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL).origin } catch { return '' }
})()
function isSafeMediaUrl(url) {
  try {
    const u = new URL(String(url))
    return u.protocol === 'https:' && !!SUPABASE_ORIGIN && u.origin === SUPABASE_ORIGIN
  } catch { return false }
}

const scope = createScope()
let inited = false
let els = {}
let currentUrl = null

const $ = id => document.getElementById(id)

/** "4 minutes ago" / "yesterday" — short, human, no library. */
function ago(iso) {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24)  return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 7)   return `${days} days ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

async function render() {
  if (!els.card) return
  if (!configured) { els.card.classList.add('hidden'); return }

  let rows = []
  try { rows = await db.fetchChatImages() } catch { return }

  // Theirs only — this is a window onto them, not a mirror.
  const theirs = rows.find(r => r.partner_idx !== state.me && isSafeMediaUrl(r.image_url))

  if (!theirs) {
    els.card.classList.remove('hidden')
    els.stage.classList.add('hidden')
    els.empty.classList.remove('hidden')
    return
  }

  els.card.classList.remove('hidden')
  els.empty.classList.add('hidden')
  els.stage.classList.remove('hidden')

  if (theirs.image_url !== currentUrl) {
    currentUrl = theirs.image_url
    els.img.src = theirs.image_url
    els.img.alt = `Photo from ${state.theirName?.() || 'partner'}`
  }
  els.who.textContent = state.theirName?.() || 'Partner'
  els.when.textContent = ago(theirs.created_at)
  els.caption.textContent = (theirs.content || '').trim()
  els.caption.style.display = els.caption.textContent ? '' : 'none'
}

export function initGlance() {
  if (inited) return
  els = {
    card:    $('gl-card'),
    stage:   $('gl-stage'),
    empty:   $('gl-empty'),
    img:     $('gl-img'),
    who:     $('gl-who'),
    when:    $('gl-when'),
    caption: $('gl-caption'),
  }
  if (!els.card) return
  inited = true

  // Tapping it opens the album's lightbox if one is already on the page.
  scope.on(els.img, 'click', () => {
    if (!currentUrl) return
    const lb = $('lightbox') || (() => {
      const el = document.createElement('div')
      el.id = 'lightbox'; el.className = 'lightbox'
      document.body.appendChild(el)
      el.addEventListener('click', () => el.classList.add('hidden'))
      return el
    })()
    lb.textContent = ''
    const img = document.createElement('img')
    img.src = currentUrl
    img.alt = 'photo'
    lb.appendChild(img)
    lb.classList.remove('hidden')
  })

  render()
}

/** Called when a new photo lands over realtime. */
export function onGlanceUpdate() { if (inited) render() }

export function teardownGlance() {
  scope.destroy()
  inited = false
  currentUrl = null
}
