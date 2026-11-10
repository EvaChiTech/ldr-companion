// ============================================================
// TRAVEL — change where you are, whenever you are somewhere else.
//
// Location used to be a one-time choice at room creation, which quietly
// assumed neither of you ever moves. This makes it a live setting: you set
// your own, it writes only your own seat's column, and your partner's clocks
// follow within a moment without a reload.
//
// The list is the browser's full IANA timezone set rather than the app's
// 32-city shortlist, because "a different country" means any country. The
// shortlist stays as a fallback for browsers without Intl.supportedValuesOf.
// ============================================================

import { state } from './state.js'
import { configured } from './supabase.js'
import * as db from './db.js'
import { cityLabel, tzTime, normalizeTz } from './clocks.js'
import { broadcastRoomConfig } from './realtime.js'
import { pushToPartner } from './notify.js'
import { createScope } from './lifecycle.js'

const FALLBACK_ZONES = [
  'Africa/Accra', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi',
  'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Chicago', 'America/Denver',
  'America/Lima', 'America/Los_Angeles', 'America/Mexico_City', 'America/New_York',
  'America/Sao_Paulo', 'America/Toronto', 'America/Vancouver',
  'Asia/Bangkok', 'Asia/Dubai', 'Asia/Ho_Chi_Minh', 'Asia/Hong_Kong', 'Asia/Jakarta',
  'Asia/Kathmandu', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Seoul', 'Asia/Shanghai',
  'Asia/Singapore', 'Asia/Tokyo', 'Atlantic/Reykjavik',
  'Australia/Melbourne', 'Australia/Perth', 'Australia/Sydney',
  'Europe/Amsterdam', 'Europe/Athens', 'Europe/Berlin', 'Europe/Dublin', 'Europe/Helsinki',
  'Europe/Istanbul', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Moscow',
  'Europe/Oslo', 'Europe/Paris', 'Europe/Prague', 'Europe/Rome', 'Europe/Stockholm',
  'Europe/Vienna', 'Europe/Warsaw', 'Europe/Zurich',
  'Pacific/Auckland', 'Pacific/Honolulu', 'Pacific/Tahiti',
]

const MAX_ROWS = 60

const scope = createScope()
let inited = false
let els = {}
let zones = []
let onChanged = null
let busy = false

const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function allZones() {
  try {
    const list = Intl.supportedValuesOf?.('timeZone')
    if (Array.isArray(list) && list.length) return list
  } catch {}
  return FALLBACK_ZONES
}

/** Searchable text for a zone: "Tokyo Asia/Tokyo" etc. */
const haystack = z => `${cityLabel(z)} ${z}`.toLowerCase().replace(/_/g, ' ')

// ============================================================
// PANEL
// ============================================================
// Focus management. The sheet is a modal dialog, so keyboard users must not be
// able to Tab out of it into the page behind, and focus has to return to the
// control they opened it from rather than being dumped at the document root.
let lastFocused = null

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Visible, reachable focus targets inside the sheet, in DOM order. */
function focusables() {
  if (!els.panel) return []
  return [...els.panel.querySelectorAll(FOCUSABLE)]
    .filter(el => el.offsetParent !== null || el === document.activeElement)
}

/** Keep Tab cycling inside the sheet. */
function trapTab(e) {
  if (e.key !== 'Tab' || !isOpen()) return
  const items = focusables()
  if (!items.length) { e.preventDefault(); return }
  const first = items[0]
  const last  = items[items.length - 1]
  const active = document.activeElement

  if (e.shiftKey && (active === first || !els.panel.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

function isOpen() { return Boolean(els.panel) && !els.panel.classList.contains('hidden') }

function open() {
  if (!els.panel || isOpen()) return
  lastFocused = document.activeElement
  els.panel.classList.remove('hidden')
  els.search.value = ''
  els.err.textContent = ''
  renderList('')
  els.search.focus()
}

function close() {
  if (!els.panel) return
  const wasOpen = isOpen()
  els.panel.classList.add('hidden')
  // Hand focus back to whatever opened the sheet, so keyboard and screen-reader
  // users resume where they were instead of at the top of the document.
  if (wasOpen) {
    const target = lastFocused && document.contains(lastFocused) ? lastFocused : els.openBtn
    target?.focus?.()
  }
  lastFocused = null
}

function renderList(q) {
  const needle = String(q || '').toLowerCase().replace(/_/g, ' ').trim()
  const mine = state.myTz?.()

  const matched = needle
    ? zones.filter(z => haystack(z).includes(needle))
    : zones

  if (!matched.length) {
    els.list.innerHTML = '<div class="tv-none">No places match that.</div>'
    return
  }

  els.list.innerHTML = matched.slice(0, MAX_ROWS).map(z => `
    <button class="tv-row${z === mine ? ' is-current' : ''}" data-tz="${esc(z)}">
      <span class="tv-city">${esc(cityLabel(z))}</span>
      <span class="tv-zone">${esc(z.replace(/_/g, ' '))}</span>
      <span class="tv-time">${esc(tzTime(z))}</span>
    </button>`).join('') +
    (matched.length > MAX_ROWS
      ? `<div class="tv-none">…and ${matched.length - MAX_ROWS} more — keep typing.</div>`
      : '')

  els.list.querySelectorAll('[data-tz]').forEach(b =>
    b.addEventListener('click', () => choose(b.dataset.tz)))
}

// ============================================================
// SAVE
// ============================================================
async function choose(tzRaw) {
  if (busy) return
  const tz = normalizeTz(tzRaw)
  if (!tz) { els.err.textContent = 'That place is not recognised.'; return }
  if (tz === state.myTz?.()) { close(); return }
  if (!configured) { els.err.textContent = 'Connection needed to save that.'; return }

  busy = true
  els.err.textContent = ''
  const prev = state.myTz?.()

  try {
    await db.updateMyTz(tz)

    // Local state first so the UI is correct even if the broadcast is dropped.
    if (state.cfg) {
      if (state.me === 1) state.cfg.tz1 = tz
      else                state.cfg.tz2 = tz
    }

    onChanged?.()
    close()

    broadcastRoomConfig({ tz, seat: state.me, city: cityLabel(tz) })
    pushToPartner({
      title: `${state.myName?.() || 'Your partner'} is in ${cityLabel(tz)}`,
      body: `It's ${tzTime(tz)} there now.`,
      tag: 'moved',
    }).catch(() => {})
  } catch (err) {
    // Put the old value back so the two sides can't silently disagree.
    if (state.cfg && prev) {
      if (state.me === 1) state.cfg.tz1 = prev
      else                state.cfg.tz2 = prev
    }
    els.err.textContent = err?.message || 'Could not save that.'
  } finally {
    busy = false
  }
}

// ============================================================
// LIFECYCLE
// ============================================================
/**
 * @param {object} opts
 * @param {() => void} opts.onChanged called after our own location changes,
 *        so the host app can repaint anything that reads a timezone.
 */
export function initTravel(opts = {}) {
  onChanged = opts.onChanged || null
  if (inited) { renderCurrent(); return }

  els = {
    panel:  $('tv-panel'),
    search: $('tv-search'),
    list:   $('tv-list'),
    err:    $('tv-err'),
    closeBtn: $('tv-close'),
    openBtn:  $('tv-open'),
  }
  if (!els.panel) return
  inited = true

  zones = allZones()

  scope.on(els.openBtn,  'click', open)
  scope.on(els.closeBtn, 'click', close)
  scope.on(els.search,   'input', () => renderList(els.search.value))
  scope.on(els.panel,    'click', e => { if (e.target === els.panel) close() })
  scope.on(document,     'keydown', e => {
    if (e.key === 'Escape' && isOpen()) { close(); return }
    trapTab(e)
  })

  renderCurrent()
}

/** Keep the trigger button's label in step with where we are. */
export function renderCurrent() {
  if (!els.openBtn) return
  const tz = state.myTz?.()
  els.openBtn.textContent = tz ? `📍 ${cityLabel(tz)}` : '📍 Set your location'
}

export function teardownTravel() {
  scope.destroy()
  close()
  onChanged = null
  inited = false
}
