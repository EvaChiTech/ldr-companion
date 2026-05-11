// ============================================================
// PREFERENCES — system-wide dark mode + room data export + share
// ============================================================
import { state } from './state.js'
import { configured } from './supabase.js'
import * as db from './db.js'

const KEY_DARK = 'ldr_dark_pref'  // 'on' | 'off' | 'auto'

function applyDark() {
  const pref = localStorage.getItem(KEY_DARK) || 'auto'
  let dark = false
  if (pref === 'on')  dark = true
  if (pref === 'off') dark = false
  if (pref === 'auto') dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  document.body.classList.toggle('dark-mode', dark)
  const btn = document.getElementById('dark-toggle')
  if (btn) {
    btn.textContent = pref === 'on' ? '🌙' : pref === 'off' ? '☀️' : '🌗'
    btn.title = `Dark mode: ${pref}`
  }
}

function cycleDarkPref() {
  const order = ['auto', 'on', 'off']
  const cur = localStorage.getItem(KEY_DARK) || 'auto'
  const next = order[(order.indexOf(cur) + 1) % order.length]
  localStorage.setItem(KEY_DARK, next)
  applyDark()
}

export function initDarkToggle() {
  applyDark()
  const btn = document.getElementById('dark-toggle')
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1'
    btn.addEventListener('click', cycleDarkPref)
  }
  // React to system theme changes when in 'auto'
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyDark)
}

// ── Data export: download a full backup of this room as a JSON file ──
export async function exportThisRoom() {
  if (!configured || !state.room) { showToast('Connection needed first'); return }
  showToast('Building export…')
  try {
    const data = await db.exportRoomData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ldr-${state.room}-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    showToast('Downloaded ✓')
  } catch (e) {
    showToast('Export failed: ' + (e.message || ''))
  }
}

// ── Native share: opens phone share sheet with room code, falls back to copy ──
export async function shareRoom() {
  if (!state.room) return
  const text  = `Join our room on LDR Companion. Code: ${state.room}`
  const url   = location.origin + location.pathname
  const title = state.cfg?.alias || `${state.cfg?.n1 || ''} & ${state.cfg?.n2 || ''}`
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return } catch {}
  }
  // Fallback: copy code to clipboard
  try { await navigator.clipboard.writeText(state.room); showToast('Code copied: ' + state.room) }
  catch { showToast('Code: ' + state.room) }
}

function showToast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(showToast._tm)
  showToast._tm = setTimeout(() => t.style.opacity = '0', 2200)
}
