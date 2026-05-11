// ============================================================
// HEARTBEAT SYNC
// Two modes: PPG (camera-based pulse detection) + TAP (rhythm sync).
// Both broadcast live BPM to partner via the existing 'together' channel
// pattern; we open a sub-channel "heart:${room}".
// ============================================================

import { state } from './state.js'
import { configured, sb } from './supabase.js'

let channel = null
let mode = 'idle'              // idle | ppg | tap
let camStream = null
let camVideo = null
let camCanvas = null
let camCtx = null
let rafId = null
let samples = []               // recent {t, v} red-channel samples
let peaks = []                 // recent peak timestamps for BPM calc
let myBpm = null
let peerBpm = null
let pulseTimer = null
let tapTimes = []              // ring buffer of recent tap timestamps for BPM
let inited = false
let durationStart = null

const SAMPLE_HZ = 30           // ~30 fps target
const WINDOW_S  = 8            // analyse last 8s for peak detection
const SMOOTH_N  = 6            // moving-average window for the signal

// ── Channel ────────────────────────────────────────────────
function joinChannel() {
  if (!configured || !sb || channel) return
  channel = sb.channel(`heart:${state.room}`, {
    config: { broadcast: { self: false, ack: false } },
  })
  channel
    .on('broadcast', { event: 'bpm' },   ({ payload }) => onPeerBpm(payload))
    .on('broadcast', { event: 'pulse' }, ({ payload }) => onPeerPulse(payload))
    .on('broadcast', { event: 'stop' },  ({ payload }) => onPeerStop(payload))
    .subscribe()
}
function leaveChannel() {
  if (channel && sb) { try { sb.removeChannel(channel) } catch {}; channel = null }
}

function broadcastBpm() {
  if (!channel || myBpm == null) return
  channel.send({ type: 'broadcast', event: 'bpm', payload: { from: state.me, bpm: myBpm } })
}
function broadcastPulse() {
  if (!channel) return
  channel.send({ type: 'broadcast', event: 'pulse', payload: { from: state.me, t: Date.now() } })
}

function onPeerBpm(p) {
  if (p.from === state.me) return
  peerBpm = p.bpm
  renderUI()
  evaluateSync()
}
function onPeerPulse(p) {
  if (p.from === state.me) return
  flashCircle('peer')
}
function onPeerStop() {
  peerBpm = null
  renderUI()
}

// ── Sync detection (when both pulses are within 5 BPM, light up the UI) ──
function evaluateSync() {
  if (myBpm == null || peerBpm == null) return
  const diff = Math.abs(myBpm - peerBpm)
  const wrap = document.getElementById('hb-wrap')
  if (!wrap) return
  if (diff <= 5)      wrap.dataset.sync = 'tight'
  else if (diff <= 12) wrap.dataset.sync = 'close'
  else                wrap.dataset.sync = 'apart'
}

// ── PPG: camera-based pulse detection ──────────────────────
async function startPPG() {
  if (mode !== 'idle') return
  mode = 'ppg'; durationStart = Date.now()
  try {
    // Prefer rear camera with torch on mobile; fall back to default
    const constraints = {
      video: { facingMode: { ideal: 'environment' }, width: 320, height: 240 },
      audio: false,
    }
    camStream = await navigator.mediaDevices.getUserMedia(constraints)
    // Try to enable torch (Android Chrome)
    const track = camStream.getVideoTracks()[0]
    const caps  = track.getCapabilities?.() || {}
    if (caps.torch) {
      try { await track.applyConstraints({ advanced: [{ torch: true }] }) } catch {}
    }
    camVideo = document.createElement('video')
    camVideo.srcObject = camStream
    camVideo.playsInline = true
    camVideo.muted = true
    await camVideo.play()
    camCanvas = document.createElement('canvas')
    camCanvas.width = 64; camCanvas.height = 48
    camCtx = camCanvas.getContext('2d', { willReadFrequently: true })
    samples = []; peaks = []
    showStatus('PPG running — keep your finger over the camera lens')
    loopPPG()
  } catch (e) {
    showStatus('Camera blocked — try Tap mode instead')
    mode = 'idle'
  }
  renderUI()
}

function loopPPG() {
  if (mode !== 'ppg') return
  rafId = requestAnimationFrame(loopPPG)
  const now = Date.now()
  // Sample at ~SAMPLE_HZ
  if (samples.length && now - samples[samples.length - 1].t < 1000 / SAMPLE_HZ) return
  if (!camVideo || camVideo.readyState < 2) return
  camCtx.drawImage(camVideo, 0, 0, camCanvas.width, camCanvas.height)
  const data = camCtx.getImageData(camCanvas.width / 2 - 8, camCanvas.height / 2 - 6, 16, 12).data
  let r = 0, count = 0
  for (let i = 0; i < data.length; i += 4) { r += data[i]; count++ }
  const mean = r / count
  samples.push({ t: now, v: mean })
  // Trim to window
  const cutoff = now - WINDOW_S * 1000
  while (samples.length && samples[0].t < cutoff) samples.shift()
  detectPeaks()
}

function detectPeaks() {
  if (samples.length < SMOOTH_N * 3) return
  // Smooth with a moving average
  const smoothed = samples.map((s, i) => {
    let sum = 0, n = 0
    for (let j = Math.max(0, i - SMOOTH_N); j <= Math.min(samples.length - 1, i + SMOOTH_N); j++) {
      sum += samples[j].v; n++
    }
    return { t: s.t, v: sum / n }
  })
  // Detrend by subtracting the rolling mean
  const meanV = smoothed.reduce((a, b) => a + b.v, 0) / smoothed.length
  const detrended = smoothed.map(s => ({ t: s.t, v: s.v - meanV }))
  // Find local maxima with min spacing 350ms (~170bpm cap) above zero
  const newPeaks = []
  for (let i = 2; i < detrended.length - 2; i++) {
    const v = detrended[i].v
    if (v > 0 && v > detrended[i-1].v && v > detrended[i-2].v && v > detrended[i+1].v && v > detrended[i+2].v) {
      const last = newPeaks[newPeaks.length - 1]
      if (!last || detrended[i].t - last >= 350) newPeaks.push(detrended[i].t)
    }
  }
  if (newPeaks.length >= 2) {
    const intervals = []
    for (let i = 1; i < newPeaks.length; i++) intervals.push(newPeaks[i] - newPeaks[i-1])
    const meanInt = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const bpm = Math.round(60000 / meanInt)
    if (bpm >= 40 && bpm <= 180) {
      const prev = myBpm
      myBpm = bpm
      if (prev !== bpm) { broadcastBpm(); flashCircle('me') }
      peaks = newPeaks
      renderUI()
      evaluateSync()
      // Visual pulse animation tied to the latest peak
      schedulePulseAnim(meanInt)
    }
  }
}

function schedulePulseAnim(intervalMs) {
  if (pulseTimer) return
  pulseTimer = setInterval(() => {
    if (mode === 'idle') { clearInterval(pulseTimer); pulseTimer = null; return }
    flashCircle('me')
    broadcastPulse()
  }, Math.max(400, Math.min(1500, intervalMs)))
}

function stopPPG() {
  cancelAnimationFrame(rafId); rafId = null
  if (pulseTimer) { clearInterval(pulseTimer); pulseTimer = null }
  if (camStream) {
    camStream.getTracks().forEach(t => { try { t.stop() } catch {} })
    camStream = null
  }
  camVideo = null; camCanvas = null; camCtx = null
  samples = []; peaks = []
  endSession()
}

// ── TAP MODE: rhythm sync ──────────────────────────────────
function startTap() {
  if (mode !== 'idle') return
  mode = 'tap'; durationStart = Date.now()
  tapTimes = []
  showStatus('Tap to your heartbeat — feel it together')
  renderUI()
}

function tapBeat() {
  if (mode !== 'tap') return
  const now = Date.now()
  tapTimes.push(now)
  while (tapTimes.length > 12) tapTimes.shift()
  flashCircle('me')
  broadcastPulse()
  if (tapTimes.length >= 4) {
    const intervals = []
    for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i-1])
    const meanInt = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const bpm = Math.round(60000 / meanInt)
    if (bpm >= 30 && bpm <= 220) {
      const prev = myBpm
      myBpm = bpm
      if (prev !== bpm) { broadcastBpm(); renderUI(); evaluateSync() }
    }
  }
}

function stopTap() {
  endSession()
}

// ── Session end (logs duration + avg BPM, plays a thank-you UI) ──
async function endSession() {
  const wasMode = mode
  mode = 'idle'
  const dur = durationStart ? Math.round((Date.now() - durationStart) / 1000) : 0
  durationStart = null
  if (channel) channel.send({ type: 'broadcast', event: 'stop', payload: { from: state.me } })
  // Persist if we had readings
  if (configured && myBpm && dur > 5) {
    try {
      await sb.from('heartbeat_sessions').insert({
        room_id: state.room, partner_idx: state.me,
        bpm_avg: myBpm, duration_s: dur,
      })
    } catch (e) { console.warn('[heartbeat] save', e) }
  }
  myBpm = null; peerBpm = null
  showStatus(wasMode === 'idle' ? '' : 'Session ended.')
  renderUI()
}

// ── UI helpers ─────────────────────────────────────────────
function flashCircle(who) {
  const el = document.getElementById(who === 'me' ? 'hb-mine' : 'hb-theirs')
  if (!el) return
  el.classList.remove('beat')
  void el.offsetWidth
  el.classList.add('beat')
}

function renderUI() {
  const myBpmEl = document.getElementById('hb-mine-bpm')
  const peerBpmEl = document.getElementById('hb-theirs-bpm')
  const wrap = document.getElementById('hb-wrap')
  const startPpg = document.getElementById('hb-start-ppg')
  const startTap = document.getElementById('hb-start-tap')
  const stopBtn  = document.getElementById('hb-stop')
  const tapBtn   = document.getElementById('hb-tap')
  if (myBpmEl) myBpmEl.textContent = myBpm ? `${myBpm} BPM` : '— BPM'
  if (peerBpmEl) peerBpmEl.textContent = peerBpm ? `${peerBpm} BPM` : '— BPM'
  if (wrap) wrap.dataset.mode = mode
  if (startPpg) startPpg.style.display = mode === 'idle' ? '' : 'none'
  if (startTap) startTap.style.display = mode === 'idle' ? '' : 'none'
  if (stopBtn)  stopBtn.style.display  = mode === 'idle' ? 'none' : ''
  if (tapBtn)   tapBtn.style.display   = mode === 'tap'  ? '' : 'none'
}

function showStatus(msg) {
  const el = document.getElementById('hb-status')
  if (el) el.textContent = msg || ''
}

// ── Public API ─────────────────────────────────────────────
export function initHeartbeat() {
  if (inited) return
  inited = true
  joinChannel()
  document.getElementById('hb-start-ppg')?.addEventListener('click', startPPG)
  document.getElementById('hb-start-tap')?.addEventListener('click', startTap)
  document.getElementById('hb-tap')?.addEventListener('click', tapBeat)
  document.getElementById('hb-stop')?.addEventListener('click', () => {
    if (mode === 'ppg') stopPPG()
    else if (mode === 'tap') stopTap()
  })
  renderUI()
}

export function teardownHeartbeat() {
  if (mode === 'ppg') stopPPG()
  else endSession()
  leaveChannel()
  inited = false
}
