// ============================================================
// Web Audio chimes — synthesized, no asset files
// ============================================================

const KEY = 'ldr_sound_enabled'
let ctx = null
let enabled = (() => {
  const v = localStorage.getItem(KEY)
  return v === null ? true : v === '1'
})()

function ensureCtx() {
  if (ctx) return ctx
  try { ctx = new (window.AudioContext || window.webkitAudioContext)() }
  catch { ctx = null }
  return ctx
}

function playTones(notes, { vol = 0.18, decay = 0.6, type = 'sine', stagger = 0.08 } = {}) {
  if (!enabled) return
  const c = ensureCtx(); if (!c) return
  // Browsers gate AudioContext until user gesture; resume if needed
  if (c.state === 'suspended') c.resume().catch(() => {})
  const now = c.currentTime
  notes.forEach((freq, i) => {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = type
    osc.frequency.value = freq
    const t0 = now + i * stagger
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + decay)
    osc.connect(gain).connect(c.destination)
    osc.start(t0)
    osc.stop(t0 + decay + 0.05)
  })
}

// Two-note bell (G5, C6) — partner came online
export function playOnlineChime() {
  playTones([783.99, 1046.50], { vol: 0.16, decay: 0.7, stagger: 0.09 })
}

// Soft single ping — incoming message / minor event
export function playPing() {
  playTones([1046.50], { vol: 0.10, decay: 0.35 })
}

// Descending pair — partner went offline
export function playOfflineChime() {
  playTones([880, 659.25], { vol: 0.10, decay: 0.5, stagger: 0.08 })
}

// Heart-burst chime — kiss synced
export function playKissChime() {
  playTones([659.25, 880, 1174.66], { vol: 0.18, decay: 0.5, stagger: 0.06 })
}

// ── Mute toggle API ──
export function isSoundEnabled() { return enabled }
export function setSoundEnabled(on) {
  enabled = !!on
  localStorage.setItem(KEY, enabled ? '1' : '0')
  // Wake the audio context on the user's toggle gesture so future plays work
  if (enabled) ensureCtx()?.resume?.().catch(() => {})
  updateToggleUI()
}
export function toggleSound() { setSoundEnabled(!enabled); return enabled }

function updateToggleUI() {
  const el = document.getElementById('sound-toggle')
  if (!el) return
  el.textContent = enabled ? '🔔' : '🔕'
  el.title = enabled ? 'Sounds on (click to mute)' : 'Sounds muted (click to unmute)'
  el.classList.toggle('muted', !enabled)
}

export function initSoundToggle() {
  const el = document.getElementById('sound-toggle')
  if (!el || el.dataset.bound) return
  el.dataset.bound = '1'
  el.addEventListener('click', () => toggleSound())
  updateToggleUI()
}
