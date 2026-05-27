// ============================================================
// ANALYTICS — fire-and-forget event tracking to events table.
// Privacy: no PII. Just user_id (if signed in), room_code, event name + props.
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'
import { getUser } from './auth.js'

let queue = []
let flushTimer = null

function flush() {
  if (!queue.length || !configured || !sb) return
  const batch = queue.splice(0, queue.length)
  sb.from('events').insert(batch).then(({ error }) => {
    if (error) console.warn('[analytics]', error.message)
  })
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => { flushTimer = null; flush() }, 1500)
}

export function track(event_name, props = {}) {
  if (!event_name) return
  try {
    queue.push({
      user_id:   getUser?.()?.id || null,
      room_code: state.room || null,
      event_name: String(event_name).slice(0, 80),
      props: props || {},
    })
    if (queue.length >= 5) flush()
    else scheduleFlush()
  } catch (e) { console.warn('[analytics]', e) }
}

// Flush remaining events when the user leaves the page
window.addEventListener('beforeunload', () => { try { flush() } catch {} })
window.addEventListener('pagehide',     () => { try { flush() } catch {} })

export function initAnalytics() {
  // App-load event
  track('app_loaded', { tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
}
