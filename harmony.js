// ============================================================
// TIME-ZONE HARMONY — AI-suggested call windows for the next 7 days.
// Reads sleep_events history, asks Claude to find real overlaps.
// ============================================================

import { state } from './state.js'
import { configured, sb } from './supabase.js'

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

async function fetchSleepHistory() {
  if (!configured) return []
  const since = new Date(); since.setDate(since.getDate() - 21)
  const sinceISO = since.toISOString().split('T')[0]
  const { data } = await sb.from('sleep_events')
    .select('partner_idx,date,goodnight_at,wakeup_at')
    .eq('room_id', state.room).gte('date', sinceISO).order('date', { ascending: false })
  return data || []
}

async function generateHarmony() {
  if (!configured) { showToast('Connection needed first'); return }
  const out = document.getElementById('hm-out')
  const lo  = document.getElementById('hm-loading')
  if (!out || !lo) return
  out.innerHTML = ''
  lo.style.display = 'flex'

  try {
    const sleepEvents = await fetchSleepHistory()
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
    const weekStart = new Date().toISOString().split('T')[0]
    const { data, error } = await sb.functions.invoke('harmony', {
      body: {
        n1: state.cfg.n1, n2: state.cfg.n2,
        tz1: state.cfg.tz1, tz2: state.cfg.tz2,
        sleepEvents, weekStart,
        apiKey,
      },
    })
    lo.style.display = 'none'
    if (error) throw error
    const windows = data?.windows || []
    if (!windows.length) { out.innerHTML = '<div class="empty-state">No suggestions returned. Try again.</div>'; return }
    out.innerHTML = windows.map(w => `
      <div class="hm-card">
        <div class="hm-vibe">${escapeHtml(w.vibe || '')}</div>
        <div class="hm-date">${escapeHtml(fmtDate(w.date))}</div>
        <div class="hm-times">
          <div class="hm-time"><span class="hm-who">${escapeHtml(state.cfg.n1)}</span><span class="hm-clock">${escapeHtml(w.time1 || '—')}</span></div>
          <div class="hm-arrow">↔</div>
          <div class="hm-time"><span class="hm-who">${escapeHtml(state.cfg.n2)}</span><span class="hm-clock">${escapeHtml(w.time2 || '—')}</span></div>
        </div>
        <div class="hm-meta">${w.duration_min || ''} min · ${escapeHtml(w.why || '')}</div>
      </div>`).join('')
  } catch (e) {
    lo.style.display = 'none'
    out.innerHTML = `<div class="empty-state">Couldn't suggest: ${escapeHtml(e.message || String(e))}</div>`
  }
}

function showToast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(showToast._tm)
  showToast._tm = setTimeout(() => t.style.opacity = '0', 2200)
}

let inited = false
export function initHarmony() {
  if (inited) return
  inited = true
  document.getElementById('hm-btn')?.addEventListener('click', generateHarmony)
}
export function teardownHarmony() { inited = false }
