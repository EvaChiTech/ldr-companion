// ============================================================
// SOUND CAPSULES — short audio postcards from your environment
// ============================================================

import { state } from './state.js'
import { configured, sb } from './supabase.js'
import { startRecording, stopRecording, isRecording, cancelRecording } from './recorder.js'
import { playPing } from './sound.js'

let inited = false
let recTimer = null

const fmtTime = ts => {
  const d = new Date(ts), now = new Date()
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

async function listCapsules() {
  if (!configured) return []
  const { data } = await sb.from('sound_capsules')
    .select('*').eq('room_id', state.room).order('created_at', { ascending: false }).limit(40)
  return data || []
}

async function uploadCapsule(blob, label) {
  const ext = (blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm')
  const path = `${state.room}/${Date.now()}-p${state.me}.${ext}`
  const { error: upErr } = await sb.storage.from('sound-capsules').upload(path, blob, {
    contentType: blob.type, upsert: true,
  })
  if (upErr) throw upErr
  const { data } = sb.storage.from('sound-capsules').getPublicUrl(path)
  const audio_url = data.publicUrl
  const { error } = await sb.from('sound_capsules').insert({
    room_id: state.room, partner_idx: state.me, audio_url,
    label: label || null,
  })
  if (error) throw error
}

function whoLabel(partner_idx) {
  return partner_idx === state.me ? 'You' : (state.theirName?.() || 'Partner')
}

async function renderList() {
  const list = document.getElementById('sc-list')
  if (!list) return
  const items = await listCapsules()
  if (!items.length) {
    list.innerHTML = '<div class="empty-state center">No audio postcards yet — send the first one.</div>'
    return
  }
  list.innerHTML = items.map(it => `
    <div class="sc-card ${it.partner_idx === state.me ? 'mine' : 'theirs'}">
      <div class="sc-meta">
        <span class="sc-who">${escapeHtml(whoLabel(it.partner_idx))}</span>
        <span class="sc-time">${fmtTime(it.created_at)}</span>
      </div>
      ${it.label ? `<div class="sc-label">${escapeHtml(it.label)}</div>` : ''}
      <audio controls preload="none" src="${it.audio_url}" class="sc-audio"></audio>
    </div>`).join('')
}

async function startRec() {
  try {
    await startRecording()
    let secs = 0
    const timer = document.getElementById('sc-timer')
    const startBtn = document.getElementById('sc-start')
    const stopBtn  = document.getElementById('sc-stop')
    if (timer)    { timer.style.display = ''; timer.textContent = '00:00' }
    if (startBtn) startBtn.style.display = 'none'
    if (stopBtn)  stopBtn.style.display  = ''
    recTimer = setInterval(() => {
      secs++
      if (timer) timer.textContent = `${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`
      if (secs >= 30) stopRec()  // hard cap 30s
    }, 1000)
  } catch (e) {
    showToast('Mic blocked: ' + (e.message || ''))
  }
}

async function stopRec() {
  if (recTimer) { clearInterval(recTimer); recTimer = null }
  if (!isRecording()) return
  const stopBtn = document.getElementById('sc-stop')
  const startBtn = document.getElementById('sc-start')
  const timer = document.getElementById('sc-timer')
  try {
    const blob = await stopRecording()
    showToast('Sending postcard…')
    const label = document.getElementById('sc-label')?.value.trim() || null
    await uploadCapsule(blob, label)
    if (document.getElementById('sc-label')) document.getElementById('sc-label').value = ''
    showToast('Audio postcard sent 📮')
    playPing()
    await renderList()
  } catch (e) {
    showToast('Could not send: ' + (e.message || ''))
  } finally {
    if (timer)   { timer.style.display = 'none'; timer.textContent = '00:00' }
    if (startBtn) startBtn.style.display = ''
    if (stopBtn)  stopBtn.style.display  = 'none'
  }
}

function showToast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(showToast._tm)
  showToast._tm = setTimeout(() => t.style.opacity = '0', 2200)
}

export function initSoundCapsules() {
  if (inited) return
  inited = true
  document.getElementById('sc-start')?.addEventListener('click', startRec)
  document.getElementById('sc-stop')?.addEventListener('click', stopRec)
  renderList()
}

export function onRemoteCapsule() {
  if (!inited) return
  renderList()
  playPing()
}

export function teardownSoundCapsules() {
  if (recTimer) { clearInterval(recTimer); recTimer = null }
  cancelRecording()
  inited = false
}
