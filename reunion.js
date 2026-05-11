// ============================================================
// REUNION MODE — when partners are physically together,
// the app transforms: hides distance widgets, surfaces in-person tools.
// ============================================================

import { state } from './state.js'
import { configured, sb } from './supabase.js'

let inited = false
let activeSession = null
let durationTimer = null

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

async function fetchActive() {
  if (!configured) return null
  const { data } = await sb.from('reunion_sessions')
    .select('*').eq('room_id', state.room).is('ended_at', null)
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

async function startReunion() {
  if (!configured) return
  const city = (window.prompt('Where are you two? (city, optional)', '') || '').trim() || null
  const { data, error } = await sb.from('reunion_sessions').insert({
    room_id: state.room, triggered_by: state.me, city,
  }).select().single()
  if (error) { showToast('Could not start: ' + error.message); return }
  activeSession = data
  applyReunionMode(true)
  showToast('💫 Reunion mode on — together at last')
}

async function endReunion() {
  if (!configured || !activeSession) return
  const notes = (window.prompt('Tag this reunion with one memory (optional):', '') || '').trim() || null
  await sb.from('reunion_sessions').update({
    ended_at: new Date().toISOString(), notes,
  }).eq('id', activeSession.id)
  // Save as a milestone too — automatic story addition
  if (notes || activeSession.city) {
    await sb.from('milestones').insert({
      room_id: state.room,
      date: new Date().toISOString().split('T')[0],
      title: `Together in ${activeSession.city || 'the same place'}`,
      note: notes || null,
    })
  }
  activeSession = null
  applyReunionMode(false)
  showToast('Time apart again — but you have new memories 💕')
}

function applyReunionMode(on) {
  const root = document.body
  root.classList.toggle('reunion-mode', !!on)
  renderBanner()
  if (on) {
    if (durationTimer) clearInterval(durationTimer)
    durationTimer = setInterval(updateBannerClock, 1000)
    updateBannerClock()
  } else {
    if (durationTimer) { clearInterval(durationTimer); durationTimer = null }
  }
}

function renderBanner() {
  let banner = document.getElementById('reunion-banner')
  if (!activeSession) { if (banner) banner.remove(); return }
  if (!banner) {
    banner = document.createElement('div')
    banner.id = 'reunion-banner'
    banner.className = 'reunion-banner'
    const main = document.querySelector('.main-content')
    if (main) main.prepend(banner)
  }
  banner.innerHTML = `
    <div class="rb-left">
      <span class="rb-pill">REUNION</span>
      <span class="rb-text">Together${activeSession.city ? ' in ' + escapeHtml(activeSession.city) : ''}
        · <span id="rb-clock">0s</span></span>
    </div>
    <div class="rb-actions">
      <button id="rb-photo"  class="btn btn-ghost btn-sm">📸 Couple-cam</button>
      <button id="rb-decide" class="btn btn-ghost btn-sm">🍴 Restaurant decider</button>
      <button id="rb-end"    class="btn btn-secondary btn-sm">End reunion</button>
    </div>`
  document.getElementById('rb-end')?.addEventListener('click', endReunion)
  document.getElementById('rb-photo')?.addEventListener('click', startCoupleCam)
  document.getElementById('rb-decide')?.addEventListener('click', restaurantDecider)
}

function updateBannerClock() {
  const el = document.getElementById('rb-clock')
  if (!el || !activeSession) return
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(activeSession.started_at).getTime()) / 1000))
  const h = Math.floor(elapsed / 3600), m = Math.floor((elapsed % 3600) / 60), s = elapsed % 60
  el.textContent = h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`
}

// ── In-person tools ───────────────────────────────────────
function startCoupleCam() {
  // Synchronized 5-second countdown overlay so both phones snap at the same moment.
  const overlay = document.createElement('div')
  overlay.className = 'cc-overlay'
  document.body.appendChild(overlay)
  let n = 5
  const render = () => { overlay.textContent = n > 0 ? n : '📸' }
  render()
  const tick = setInterval(() => {
    n--
    if (n < 0) {
      clearInterval(tick)
      setTimeout(() => overlay.remove(), 700)
    } else render()
  }, 1000)
}

function restaurantDecider() {
  const cuisines = ['Italian','Japanese','Korean BBQ','Thai','Mexican','Mediterranean','Vietnamese','Indian','French bistro','Hidden gem','Comfort food','Street food']
  const overlay = document.createElement('div')
  overlay.className = 'cc-overlay decide'
  document.body.appendChild(overlay)
  let i = 0
  const tick = setInterval(() => {
    overlay.textContent = cuisines[i++ % cuisines.length]
    if (i > 20) {
      clearInterval(tick)
      const pick = cuisines[Math.floor(Math.random() * cuisines.length)]
      overlay.textContent = '✨ ' + pick + ' ✨'
      setTimeout(() => overlay.remove(), 2000)
    }
  }, 80)
}

function showToast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(showToast._tm)
  showToast._tm = setTimeout(() => t.style.opacity = '0', 2400)
}

// ── Public API ────────────────────────────────────────────
export async function initReunion() {
  if (inited) return
  inited = true
  // Add a 'Begin reunion' button to the Home tab
  const btn = document.getElementById('reunion-start')
  btn?.addEventListener('click', startReunion)
  activeSession = await fetchActive()
  applyReunionMode(!!activeSession)
}

export async function onRemoteReunionEvent() {
  // Partner started or ended a reunion session
  activeSession = await fetchActive()
  applyReunionMode(!!activeSession)
}

export function teardownReunion() {
  if (durationTimer) { clearInterval(durationTimer); durationTimer = null }
  document.getElementById('reunion-banner')?.remove()
  document.body.classList.remove('reunion-mode')
  activeSession = null
  inited = false
}
