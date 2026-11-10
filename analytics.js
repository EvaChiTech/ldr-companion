// ============================================================
// ANALYTICS — batched, append-only event tracking.
//
// Privacy: no PII, ever. No message bodies, no names, no free text. An event
// is a name, a room code, an optional user id, and a small bag of
// non-identifying dimensions.
//
// This file previously wrote to an `events` table that was never created, and
// logged the resulting failure at console.warn — so the product ran with zero
// telemetry and nothing surfaced it. Two changes guard against a repeat:
// the table is now defined in schema.sql, and a sustained failure is reported
// loudly instead of being whispered once per batch.
// ============================================================

import { state } from './state.js'
import { configured, sb } from './supabase.js'
import { getUser } from './auth.js'

const SESSION_KEY    = 'ldr_session_id'
const FIRST_SEEN_KEY = 'ldr_first_seen'
const SEEN_DAYS_KEY  = 'ldr_seen_days'     // distinct active days, for retention
const ONCE_KEY       = 'ldr_tracked_once'

const FLUSH_MS   = 1500
const BATCH_MAX  = 5
const FAIL_LOUD  = 3        // consecutive failed batches before shouting

let queue = []
let flushTimer = null
let failures = 0
let sessionStart = Date.now()
let lastActivity = Date.now()

// ── identity-free session + cohort dimensions ───────────────

function sessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2))
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch { return 'nostorage' }
}

const dayStamp = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** First time we ever saw this browser. Underpins every retention cohort. */
function firstSeen() {
  try {
    let v = localStorage.getItem(FIRST_SEEN_KEY)
    if (!v) { v = dayStamp(); localStorage.setItem(FIRST_SEEN_KEY, v) }
    return v
  } catch { return dayStamp() }
}

/** Whole days since first visit — the D1 / D7 / D30 bucket for this session. */
function dayN() {
  const first = new Date(firstSeen() + 'T00:00:00')
  const now = new Date(dayStamp() + 'T00:00:00')
  const n = Math.round((now - first) / 86400000)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * Record today as an active day and return the running total.
 * Distinct active days is the honest engagement number — far more meaningful
 * for a relationship app than raw session counts.
 */
function noteActiveDay() {
  try {
    const days = JSON.parse(localStorage.getItem(SEEN_DAYS_KEY) || '[]')
    const today = dayStamp()
    if (!days.includes(today)) {
      days.push(today)
      // 90 days is plenty to characterise a cohort; keep storage bounded.
      while (days.length > 90) days.shift()
      localStorage.setItem(SEEN_DAYS_KEY, JSON.stringify(days))
    }
    return days.length
  } catch { return 1 }
}

// ── transport ───────────────────────────────────────────────

function flush() {
  if (!queue.length || !configured || !sb) return
  const batch = queue.splice(0, queue.length)
  sb.from('events').insert(batch).then(({ error }) => {
    if (!error) { failures = 0; return }
    failures++
    if (failures === FAIL_LOUD) {
      // Loud, once. A silent warn is how this went unnoticed before.
      console.error(
        `[analytics] ${FAIL_LOUD} consecutive batches failed: ${error.message}\n` +
        'Telemetry is NOT being recorded. Check that the `events` table and its ' +
        'insert policy exist (see schema.sql).'
      )
    }
  })
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => { flushTimer = null; flush() }, FLUSH_MS)
}

/**
 * Record an event.
 * @param {string} event_name
 * @param {object} [props] non-identifying dimensions only
 */
export function track(event_name, props = {}) {
  if (!event_name) return
  // Demo sessions are simulated; counting them would poison every metric.
  if (state.demo) return
  try {
    lastActivity = Date.now()
    queue.push({
      user_id:    getUser?.()?.id || null,
      room_code:  state.room || null,
      session_id: sessionId(),
      event_name: String(event_name).slice(0, 80),
      props: { ...props, day_n: dayN(), seat: state.me || null },
    })
    if (queue.length >= BATCH_MAX) flush()
    else scheduleFlush()
  } catch (e) { console.warn('[analytics]', e) }
}

/**
 * Record an event at most once per browser — for activation milestones where
 * the first occurrence is the whole signal (first message, first room).
 */
export function trackOnce(event_name, props = {}) {
  try {
    const seen = JSON.parse(localStorage.getItem(ONCE_KEY) || '{}')
    if (seen[event_name]) return
    seen[event_name] = dayStamp()
    localStorage.setItem(ONCE_KEY, JSON.stringify(seen))
  } catch { /* fall through and track anyway */ }
  track(event_name, props)
}

// ── session lifecycle ───────────────────────────────────────

function endSession() {
  try {
    const secs = Math.round((lastActivity - sessionStart) / 1000)
    // Only report sessions with real engagement; a bounce is already captured
    // by session_start, and counting 0s sessions would flatter the average.
    if (secs >= 3) track('session_end', { duration_s: secs })
    flush()
  } catch {}
}

export function initAnalytics() {
  sessionStart = Date.now()
  lastActivity = sessionStart

  const n = dayN()
  track('session_start', {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    day_n: n,
    returning: n > 0,
    active_days: noteActiveDay(),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  })

  // Flush on the way out. pagehide is the reliable one on mobile Safari;
  // visibilitychange covers tab-switching, which is where most "exits" are.
  window.addEventListener('pagehide', endSession)
  window.addEventListener('beforeunload', () => { try { flush() } catch {} })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { try { flush() } catch {} }
  })
}
