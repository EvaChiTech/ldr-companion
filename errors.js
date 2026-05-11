// ============================================================
// GLOBAL ERROR MONITORING
// Catches uncaught errors + unhandled promise rejections, dedupes,
// and pipes them to the events table as 'error' events.
// ============================================================
import { track } from './analytics.js'

const seen = new Map()  // signature → timestamp; suppress duplicates within 5min
const COOLDOWN = 5 * 60 * 1000

function signature(payload) {
  return [payload.message, payload.filename, payload.lineno, payload.colno].join('|')
}

function logError(payload) {
  const sig = signature(payload)
  const now = Date.now()
  if (seen.has(sig) && now - seen.get(sig) < COOLDOWN) return
  seen.set(sig, now)
  // Trim seen map periodically
  if (seen.size > 50) {
    const cutoff = now - COOLDOWN
    for (const [k, v] of seen) if (v < cutoff) seen.delete(k)
  }
  // Console first (always useful)
  console.error('[ldr-error]', payload)
  // Pipe to analytics — small, no PII
  try {
    track('error', {
      message:  String(payload.message || '').slice(0, 200),
      filename: String(payload.filename || '').slice(0, 200),
      lineno:   payload.lineno,
      colno:    payload.colno,
      stack:    String(payload.stack || '').slice(0, 800),
      url:      location.pathname,
    })
  } catch {}
}

export function initErrorMonitor() {
  window.addEventListener('error', e => {
    logError({
      message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno,
      stack: e.error?.stack,
    })
  })
  window.addEventListener('unhandledrejection', e => {
    const reason = e.reason
    logError({
      message: reason?.message || String(reason || 'unhandled rejection'),
      stack: reason?.stack,
    })
  })
}
