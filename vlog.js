// ============================================================
// VLOGS — short video diaries with dual-timezone watermark
//
// Record via MediaRecorder (portrait or landscape, native res), upload
// the raw video to Supabase Storage, and let either partner export a
// watermarked + branded MP4/WebM purely client-side via a canvas
// re-recorder. No server compute, no third-party API.
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'
import * as db from './db.js'
import { tzTime, cityLabel, daysBetween, normalizeTz } from './clocks.js'
import { playPing } from './sound.js'
import { pushToPartner, notify } from './notify.js'

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
))

// Only ever load media from our own Supabase storage origin. A row in an
// open-RLS table could carry an arbitrary video_url; refuse anything else.
const SUPABASE_ORIGIN = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL).origin } catch { return '' }
})()
function isSafeMediaUrl(url) {
  try {
    const u = new URL(String(url))
    return u.protocol === 'https:' && !!SUPABASE_ORIGIN && u.origin === SUPABASE_ORIGIN
  } catch { return false }
}

const DURATION_OPTIONS = [
  { val: 30,  label: '30s' },
  { val: 60,  label: '1m'  },
  { val: 180, label: '3m'  },
  { val: 600, label: '10m' },
]
const WATERMARK_STYLES  = ['classic', 'minimal', 'none']
const DUET_LAYOUTS      = ['auto', 'stacked', 'side', 'pip', 'stitch']
const SETTINGS_KEY      = 'ldr_vlog_settings_v1'
const SETTINGS_DEFAULTS = { duration: 60, watermark: 'classic', endcard: 'on', layout: 'auto' }

function loadSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return { ...SETTINGS_DEFAULTS, ...v }
  } catch { return { ...SETTINGS_DEFAULTS } }
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch {} }

let settings = loadSettings()

let inited = false
let recState = null     // active recording session: { stream, recorder, chunks, startedAt, timer, orientation, mime }
let lastBlob = null     // most-recent recorded Blob
let lastMeta = null     // { orientation, width, height, durationMs } — paired with lastBlob
let replyContext = null // when set: { id, partner_idx, recorded_at, ... } — recorder is in reply mode

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function toast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(toast._tm)
  toast._tm = setTimeout(() => t.style.opacity = '0', 2400)
}

function pickRecorderMime() {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const c of candidates) if (window.MediaRecorder?.isTypeSupported?.(c)) return c
  return ''
}

function extFromMime(m) {
  if (!m) return 'webm'
  if (m.startsWith('video/mp4')) return 'mp4'
  return 'webm'
}

function detectOrientation() {
  return window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'
}

function fmtElapsed(ms) {
  const totalS = Math.floor(ms / 1000)
  const m = Math.floor(totalS / 60)
  const s = totalS % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─────────────────────────────────────────────────────────────
// RECORDING — full-screen capture overlay
// ─────────────────────────────────────────────────────────────
async function openRecorder(opts = {}) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('Camera recording not supported on this browser.')
    return
  }
  const overlay = document.getElementById('vlog-recorder')
  if (!overlay) return
  replyContext = opts.replyTo || null
  overlay.style.display = 'flex'
  overlay.dataset.phase = 'idle'
  overlay.dataset.mode = replyContext ? 'reply' : 'new'
  const hint = document.getElementById('vlog-rec-hint-text')
  if (hint) {
    hint.textContent = replyContext
      ? `Reacting to ${replyContext.partner_idx === state.me ? 'your' : (state.theirName?.() + '’s')} vlog — tap to record`
      : 'Tap to record · up to 60 seconds · auto-stamped with both your times'
  }
  lastBlob = null; lastMeta = null
  await initCameraStream('user')
}

function closeRecorder() {
  stopStream()
  const overlay = document.getElementById('vlog-recorder')
  if (overlay) {
    overlay.style.display = 'none'
    overlay.dataset.phase = 'idle'
    overlay.dataset.mode = 'new'
  }
  const preview = document.getElementById('vlog-preview-video')
  if (preview) { preview.srcObject = null; preview.removeAttribute('src') }
  const review = document.getElementById('vlog-review-video')
  if (review) { try { URL.revokeObjectURL(review.src) } catch {} ; review.removeAttribute('src') }
  document.getElementById('vlog-caption').value = ''
  lastBlob = null; lastMeta = null
  replyContext = null
}

function stopStream() {
  if (recState?.recorder?.state === 'recording') {
    try { recState.recorder.stop() } catch {}
  }
  recState?.stream?.getTracks().forEach(t => t.stop())
  if (recState?.timer) clearInterval(recState.timer)
  recState = null
}

async function initCameraStream(facingMode = 'user') {
  stopStream()
  const orientation = detectOrientation()
  const ideal = orientation === 'portrait'
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode,
        width:  { ideal: ideal.width },
        height: { ideal: ideal.height },
        frameRate: { ideal: 30, max: 60 },
      },
    })
    recState = { stream, recorder: null, chunks: [], startedAt: 0, timer: null, orientation, mime: '' }
    const preview = document.getElementById('vlog-preview-video')
    preview.srcObject = stream
    preview.muted = true
    preview.playsInline = true
    await preview.play().catch(() => {})
    document.getElementById('vlog-recorder').dataset.orient = orientation
    updateLiveWatermark()
  } catch (e) {
    console.error('[vlog] getUserMedia failed', e)
    toast(e?.name === 'NotAllowedError' ? 'Camera permission denied.' : 'Could not start camera.')
    closeRecorder()
  }
}

function startRecording() {
  if (!recState?.stream) return
  const mime = pickRecorderMime()
  try {
    recState.recorder = mime
      ? new MediaRecorder(recState.stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 })
      : new MediaRecorder(recState.stream)
  } catch (e) {
    console.error('[vlog] MediaRecorder failed', e)
    toast('Recorder unsupported on this browser.')
    return
  }
  recState.mime = recState.recorder.mimeType || mime
  recState.chunks = []
  recState.recorder.ondataavailable = e => { if (e.data?.size) recState.chunks.push(e.data) }
  recState.recorder.onstop = () => finalizeRecording()
  recState.startedAt = Date.now()
  recState.maxMs = (settings.duration || 60) * 1000
  recState.recorder.start(250)
  document.getElementById('vlog-recorder').dataset.phase = 'recording'
  recState.timer = setInterval(() => {
    const elapsed = Date.now() - recState.startedAt
    document.getElementById('vlog-rec-timer').textContent = fmtElapsed(elapsed)
    const pct = Math.min(100, (elapsed / recState.maxMs) * 100)
    document.getElementById('vlog-rec-progress').style.width = pct + '%'
    if (elapsed >= recState.maxMs) stopRecording()
  }, 100)
}

function stopRecording() {
  if (recState?.recorder?.state === 'recording') {
    try { recState.recorder.stop() } catch {}
  }
  if (recState?.timer) { clearInterval(recState.timer); recState.timer = null }
}

function finalizeRecording() {
  const overlay = document.getElementById('vlog-recorder')
  const track = recState?.stream?.getVideoTracks?.()[0]
  const settings = track?.getSettings?.() || {}
  lastBlob = new Blob(recState.chunks, { type: recState.mime || 'video/webm' })
  lastMeta = {
    orientation: recState.orientation,
    width:  settings.width  || null,
    height: settings.height || null,
    durationMs: Date.now() - recState.startedAt,
  }
  console.log('[vlog] recording finalized', { size: lastBlob.size, type: lastBlob.type, meta: lastMeta })
  // Show the review panel
  const url = URL.createObjectURL(lastBlob)
  const reviewVideo = document.getElementById('vlog-review-video')
  reviewVideo.src = url
  reviewVideo.controls = true
  reviewVideo.playsInline = true
  overlay.dataset.phase = 'review'
  // Free the camera once we're in review
  recState?.stream?.getTracks().forEach(t => t.stop())
}

function retake() {
  try { URL.revokeObjectURL(document.getElementById('vlog-review-video').src) } catch {}
  document.getElementById('vlog-review-video').removeAttribute('src')
  lastBlob = null; lastMeta = null
  initCameraStream(recState?.stream?.getVideoTracks()[0]?.getSettings?.()?.facingMode || 'user')
  document.getElementById('vlog-recorder').dataset.phase = 'idle'
}

async function flipCamera() {
  const current = recState?.stream?.getVideoTracks()[0]?.getSettings?.()?.facingMode
  await initCameraStream(current === 'user' ? 'environment' : 'user')
}

function explainError(e) {
  const msg    = String(e?.message || e?.error || e || '').toLowerCase()
  const status = e?.status ?? e?.statusCode ?? e?.error?.statusCode
  // Order matters: most specific patterns first.
  if (msg.includes('video is too large') || msg.includes('max 500 mb'))
    return { code: 'too_big',    user: e.message }
  if (msg.includes('unsupported video format'))
    return { code: 'bad_mime',   user: e.message }
  if (msg.includes('no room selected'))
    return { code: 'no_room',    user: 'Lost track of your room — please reload and try again.' }
  if (status === 401 || msg.includes('jwt') || msg.includes('unauthorized'))
    return { code: 'auth',       user: 'Session expired. Please reload the page and try again.' }
  if (status === 413 || msg.includes('payload too large'))
    return { code: 'too_big',    user: 'Video is too large for the server. Record a shorter clip.' }
  if (msg.includes('row-level security') || msg.includes('rls') || msg.includes('violates row-level'))
    return { code: 'rls',        user: 'You don’t have permission to post here. Try leaving and rejoining the room.' }
  if (msg.includes('bucket') && msg.includes('not found'))
    return { code: 'no_bucket',  user: 'Storage isn’t configured yet. Please contact support.' }
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('networkerror'))
    return { code: 'network',    user: 'Network hiccup. Check your connection and try again.' }
  if (status >= 500)
    return { code: 'server',     user: 'Server error — try again in a minute.' }
  return {
    code: 'unknown',
    // Show a sanitized snippet of the real error so users can describe it.
    user: 'Upload failed. ' + (e?.message ? '(' + String(e.message).slice(0, 120) + ')' : 'See console for details.'),
  }
}

async function savePostedVlog() {
  if (!lastBlob) return
  if (!configured) { toast('Connection needed to save'); return }
  const btn = document.getElementById('vlog-save-btn')
  btn.disabled = true
  btn.textContent = 'Uploading…'
  try {
    const caption = document.getElementById('vlog-caption').value.trim()
    const ext = extFromMime(lastBlob.type)
    console.log('[vlog] uploading video', { size: lastBlob.size, type: lastBlob.type, ext })
    const videoUrl = await db.uploadVlog(lastBlob, { partnerIdx: state.me, ext })
    console.log('[vlog] video uploaded:', videoUrl)
    btn.textContent = 'Saving…'
    const thumbBlob = await generateThumb(lastBlob).catch(e => {
      console.warn('[vlog] thumb generation skipped:', e?.message || e)
      return null
    })
    const thumbUrl = thumbBlob
      ? await db.uploadVlogThumb(thumbBlob, state.me).catch(e => {
          console.warn('[vlog] thumb upload failed:', e?.message || e); return null
        })
      : null
    const inserted = await db.insertVlog({
      caption: caption || null,
      video_url: videoUrl,
      thumb_url: thumbUrl,
      duration_s: Math.round(((lastMeta?.durationMs) || 0) / 1000),
      orientation: (lastMeta?.orientation) || 'portrait',
      width:  lastMeta?.width  || null,
      height: lastMeta?.height || null,
      recorded_at: new Date().toISOString(),
      recorded_tz: state.myTz?.() || null,
      reply_to: replyContext?.id || null,
    })
    playPing()
    const isReply = !!replyContext
    pushToPartner({
      title: isReply ? `${state.myName?.() || 'They'} reacted to your vlog 💬` : `${state.myName?.() || 'They'} posted a new vlog 🎥`,
      body:  caption ? caption.slice(0, 120) : (isReply ? 'Tap to watch their reaction' : 'Tap to watch'),
      tag:   `vlog-${inserted?.id || Date.now()}`,
    }).catch(() => {})
    toast(isReply ? 'Reaction posted ✨' : 'Vlog posted to your room 🎥')
    closeRecorder()
    renderList()
  } catch (e) {
    console.error('[vlog] save failed', e)
    const reason = explainError(e)
    console.error('[vlog] diagnosis:', reason.code)
    toast(reason.user)
  } finally {
    btn.disabled = false
    btn.textContent = 'Post to room ✨'
  }
}

// ─────────────────────────────────────────────────────────────
// THUMBNAIL — first-frame poster
// ─────────────────────────────────────────────────────────────
async function generateThumb(videoBlob) {
  const url = URL.createObjectURL(videoBlob)
  try {
    const v = document.createElement('video')
    v.src = url; v.muted = true; v.playsInline = true; v.preload = 'auto'
    await new Promise((res, rej) => {
      v.onloadedmetadata = res
      v.onerror = () => rej(new Error('thumb load failed'))
      setTimeout(() => rej(new Error('thumb metadata timeout')), 4000)
    })
    // MediaRecorder webm blobs commonly have no duration metadata (Chrome bug).
    // Treat anything not finite as "seek to 0 and grab whatever is there".
    const dur = Number.isFinite(v.duration) ? v.duration : 0
    const seekTo = dur > 0 ? Math.min(0.3, dur / 2) : 0
    await new Promise((res, rej) => {
      const done = () => res()
      v.onseeked = done
      // Some browsers don't fire onseeked when seekTo === currentTime — bail after a beat.
      setTimeout(done, 2500)
      try { v.currentTime = seekTo } catch (e) { rej(e) }
    })
    const c = document.createElement('canvas')
    c.width  = v.videoWidth  || 720
    c.height = v.videoHeight || 1280
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
    return await new Promise((res, rej) => {
      const tm = setTimeout(() => rej(new Error('toBlob timeout')), 3000)
      c.toBlob(b => { clearTimeout(tm); res(b) }, 'image/jpeg', 0.82)
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ─────────────────────────────────────────────────────────────
// WATERMARK — drawn live during recording preview and during export
// ─────────────────────────────────────────────────────────────
function watermarkLines(forVlog, style = 'classic') {
  if (style === 'none') return []
  const cfg = state.cfg
  if (!cfg) return []
  const v = forVlog || {}
  const recordedAt = v.recorded_at ? new Date(v.recorded_at) : new Date()
  const partner    = v.partner_idx || state.me
  const myTz       = partner === 1 ? cfg.tz1 : cfg.tz2
  const theirTz    = partner === 1 ? cfg.tz2 : cfg.tz1
  const myName     = partner === 1 ? cfg.n1  : cfg.n2
  const theirName  = partner === 1 ? cfg.n2  : cfg.n1
  const fmt = tz => new Intl.DateTimeFormat('en-US', {
    timeZone: normalizeTz(tz), hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(recordedAt)
  const days = cfg.since ? daysBetween(cfg.since, recordedAt) : null
  if (style === 'minimal') {
    return [`${cityLabel(myTz)} ${fmt(myTz)}  ·  ${cityLabel(theirTz)} ${fmt(theirTz)}`]
  }
  // classic
  const out = [
    `${cityLabel(myTz)}  ${fmt(myTz)}`,
    `${cityLabel(theirTz)}  ${fmt(theirTz)}`,
  ]
  if (days != null && Number.isFinite(days)) out.push(`Day ${days}  ·  ${myName} → ${theirName}`)
  return out
}

function updateLiveWatermark() {
  const el = document.getElementById('vlog-live-watermark')
  if (!el) return
  // Live preview always uses classic so the user sees what'll be shown by default
  const lines = watermarkLines(null, 'classic')
  el.innerHTML = lines.map((l, i) =>
    `<div class="vlog-wm-line ${i === 0 ? 'pri' : i === 1 ? 'sec' : 'meta'}">${escapeHtml(l)}</div>`
  ).join('')
}

// ─────────────────────────────────────────────────────────────
// EXPORT — bake the watermark + end card into a downloadable file
// ─────────────────────────────────────────────────────────────
async function exportVlog(vlog, opts = {}) {
  if (!window.MediaRecorder) { toast('Export not supported here.'); return null }
  if (!isSafeMediaUrl(vlog.video_url)) throw new Error('Unrecognized video source')
  const watermarkStyle = opts.watermark || settings.watermark || 'classic'
  const showEndCard    = (opts.endcard ?? settings.endcard) !== 'off'

  // Source video
  const v = document.createElement('video')
  v.src = vlog.video_url
  v.crossOrigin = 'anonymous'
  v.playsInline = true
  v.preload = 'auto'
  v.muted = false
  await new Promise((res, rej) => {
    v.onloadedmetadata = res
    v.onerror = () => rej(new Error('Could not load video for export'))
    setTimeout(() => rej(new Error('Export load timeout')), 15000)
  })

  const W = v.videoWidth  || (vlog.orientation === 'landscape' ? 1920 : 1080)
  const H = v.videoHeight || (vlog.orientation === 'landscape' ? 1080 : 1920)
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')

  // Compose video (canvas) + audio (from <video> via AudioContext)
  const canvasStream = canvas.captureStream(30)
  let audioCtx = null
  try {
    const Audio = window.AudioContext || window.webkitAudioContext
    if (Audio) {
      audioCtx = new Audio()
      const src  = audioCtx.createMediaElementSource(v)
      const dest = audioCtx.createMediaStreamDestination()
      src.connect(dest)
      dest.stream.getAudioTracks().forEach(t => canvasStream.addTrack(t))
    }
  } catch (e) {
    console.warn('[vlog] audio mux skipped', e)
  }

  const mime = pickExportMime()
  let recorder
  try {
    recorder = new MediaRecorder(canvasStream, {
      mimeType: mime || undefined,
      videoBitsPerSecond: 6_000_000,
    })
  } catch (e) {
    audioCtx?.close().catch(() => {})
    throw new Error('Export recorder unsupported')
  }

  const out = []
  recorder.ondataavailable = e => { if (e.data?.size) out.push(e.data) }
  const done = new Promise(res => recorder.onstop = res)
  recorder.start()

  const lines = watermarkLines(vlog, watermarkStyle)
  const END_CARD_MS = 1800

  let phase = 'video'
  let endCardStart = 0

  v.onended = () => {
    if (showEndCard) { phase = 'endcard'; endCardStart = performance.now() }
    else { try { recorder.stop() } catch {} ; phase = 'done' }
  }

  await v.play().catch(() => {})

  const tick = () => {
    if (phase === 'video') {
      if (v.readyState >= 2) ctx.drawImage(v, 0, 0, W, H)
      drawWatermarkPill(ctx, W, H, lines, watermarkStyle)
      requestAnimationFrame(tick)
    } else if (phase === 'endcard') {
      const t = performance.now() - endCardStart
      drawEndCard(ctx, W, H, t / END_CARD_MS, vlog)
      if (t >= END_CARD_MS) {
        try { recorder.stop() } catch {}
        phase = 'done'
      } else {
        requestAnimationFrame(tick)
      }
    }
  }
  requestAnimationFrame(tick)

  await done
  audioCtx?.close().catch(() => {})
  return new Blob(out, { type: mime || 'video/webm' })
}

function pickExportMime() {
  const c = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const x of c) if (window.MediaRecorder?.isTypeSupported?.(x)) return x
  return ''
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function drawWatermarkPill(ctx, W, H, lines) {
  if (!lines.length) return
  const scale = Math.min(W, H) / 1080
  const fs = Math.max(22, Math.round(34 * scale))
  const pad = Math.max(14, Math.round(20 * scale))
  ctx.save()
  ctx.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`
  const widths = lines.map(L => ctx.measureText(L).width)
  const boxW = Math.max(...widths) + pad * 2
  const lineH = fs * 1.28
  const boxH = lineH * lines.length + pad * 1.2
  const x = Math.round(40 * scale)
  const y = H - boxH - Math.round(56 * scale)
  // pill background
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = Math.round(24 * scale)
  ctx.shadowOffsetY = Math.round(2 * scale)
  ctx.fillStyle = 'rgba(20, 14, 12, 0.66)'
  roundRectPath(ctx, x, y, boxW, boxH, Math.round(18 * scale))
  ctx.fill()
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
  // text
  ctx.textBaseline = 'top'
  let cy = y + pad * 0.6
  lines.forEach((L, i) => {
    ctx.globalAlpha = i === 0 ? 1 : (i === 1 ? 0.92 : 0.8)
    ctx.fillStyle = i === 2 ? '#F5C794' : '#FAF6EE'
    ctx.fillText(L, x + pad, cy)
    cy += lineH
  })
  ctx.globalAlpha = 1
  ctx.restore()
}

function drawEndCard(ctx, W, H, progress, vlog) {
  const cfg = state.cfg || {}
  const scale = Math.min(W, H) / 1080
  // background
  ctx.fillStyle = '#1A0F0C'
  ctx.fillRect(0, 0, W, H)
  // soft warm gradient
  const g = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W, H) * 0.6)
  g.addColorStop(0, 'rgba(196, 89, 74, 0.22)')
  g.addColorStop(1, 'rgba(26, 15, 12, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  const fadeIn = Math.min(1, progress * 2.4)
  ctx.globalAlpha = fadeIn

  const recordedAt = vlog.recorded_at ? new Date(vlog.recorded_at) : new Date()
  const days = cfg.since ? daysBetween(cfg.since, recordedAt) : null

  ctx.textAlign = 'center'
  // title — couple names in serif
  ctx.fillStyle = '#FAF6EE'
  ctx.font = `400 ${Math.round(96 * scale)}px Georgia, "Times New Roman", serif`
  ctx.fillText(`${cfg.n1 || ''} & ${cfg.n2 || ''}`, W/2, H/2 - 40 * scale)

  // tagline — days apart
  if (days != null) {
    ctx.font = `500 ${Math.round(40 * scale)}px -apple-system, "Segoe UI", system-ui, sans-serif`
    ctx.fillStyle = '#D4945A'
    ctx.fillText(`Day ${days} apart`, W/2, H/2 + 38 * scale)
  }

  // outro credit
  ctx.font = `400 ${Math.round(22 * scale)}px -apple-system, "Segoe UI", system-ui, sans-serif`
  ctx.fillStyle = 'rgba(250, 246, 238, 0.62)'
  ctx.fillText('made together · ldr companion', W/2, H - Math.round(72 * scale))

  // little heart
  ctx.font = `400 ${Math.round(46 * scale)}px serif`
  ctx.fillStyle = '#C4594A'
  ctx.fillText('♡', W/2, H/2 - 130 * scale)

  ctx.globalAlpha = 1
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 8000)
}

async function handleExport(vlog) {
  toast('Rendering watermarked video…')
  try {
    const blob = await exportVlog(vlog)
    if (!blob) return
    const safeNames = `${state.cfg?.n1 || 'us'}-${state.cfg?.n2 || 'two'}`.replace(/[^A-Za-z0-9_-]/g, '_').toLowerCase()
    const ext = blob.type.startsWith('video/mp4') ? 'mp4' : 'webm'
    const stamp = new Date(vlog.recorded_at).toISOString().slice(0, 10)
    triggerDownload(blob, `${safeNames}-vlog-${stamp}.${ext}`)
    toast('Downloaded — ready to share 💛')
  } catch (e) {
    console.error('[vlog] export failed', e)
    toast('Export failed — downloading the original instead.')
    try {
      const r = await fetch(vlog.video_url)
      const b = await r.blob()
      const ext = (b.type.split('/')[1] || 'webm').split(';')[0]
      triggerDownload(b, `vlog-${new Date(vlog.recorded_at).getTime()}.${ext}`)
    } catch (e2) {
      console.error('[vlog] fallback download failed', e2)
    }
  }
}

// ─────────────────────────────────────────────────────────────
// DUET EXPORT — supports 5 layouts: auto / stacked / side / pip / stitch
// ─────────────────────────────────────────────────────────────
function resolveDuetLayout(layout, originalOrientation) {
  if (layout === 'auto') return originalOrientation === 'landscape' ? 'side' : 'stacked'
  return layout
}

function duetCanvasSize(layout, originalOrientation) {
  // Layout-aware output canvas. Pip and stitch follow the original's aspect.
  if (layout === 'side')    return { W: 1920, H: 1080 }
  if (layout === 'stacked') return { W: 1080, H: 1920 }
  // pip & stitch inherit original orientation
  return originalOrientation === 'landscape' ? { W: 1920, H: 1080 } : { W: 1080, H: 1920 }
}

async function exportDuet(originalVlog, replyVlog, opts = {}) {
  if (!window.MediaRecorder) { toast('Export not supported here.'); return null }
  if (!isSafeMediaUrl(originalVlog.video_url) || !isSafeMediaUrl(replyVlog.video_url)) {
    throw new Error('Unrecognized video source')
  }
  const watermarkStyle = opts.watermark || settings.watermark || 'classic'
  const showEndCard    = (opts.endcard ?? settings.endcard) !== 'off'
  const layoutChoice   = opts.layout || settings.layout || 'auto'
  const layout         = resolveDuetLayout(layoutChoice, originalVlog.orientation || 'portrait')

  const v1 = document.createElement('video')
  const v2 = document.createElement('video')
  for (const v of [v1, v2]) {
    v.crossOrigin = 'anonymous'
    v.playsInline = true
    v.preload = 'auto'
    v.muted = false
  }
  v1.src = originalVlog.video_url
  v2.src = replyVlog.video_url

  await Promise.all([
    new Promise((res, rej) => {
      v1.onloadedmetadata = res
      v1.onerror = () => rej(new Error('original failed to load'))
      setTimeout(() => rej(new Error('original load timeout')), 15000)
    }),
    new Promise((res, rej) => {
      v2.onloadedmetadata = res
      v2.onerror = () => rej(new Error('reply failed to load'))
      setTimeout(() => rej(new Error('reply load timeout')), 15000)
    }),
  ])

  const { W, H } = duetCanvasSize(layout, originalVlog.orientation || 'portrait')

  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')

  // Audio graph — gain nodes let us mute one source during stitch
  const Audio = window.AudioContext || window.webkitAudioContext
  const audioCtx = Audio ? new Audio() : null
  const audioDest = audioCtx?.createMediaStreamDestination()
  let g1 = null, g2 = null
  try {
    if (audioCtx && audioDest) {
      const s1 = audioCtx.createMediaElementSource(v1)
      const s2 = audioCtx.createMediaElementSource(v2)
      g1 = audioCtx.createGain(); g1.gain.value = layout === 'stitch' ? 1.0 : 0.9
      g2 = audioCtx.createGain(); g2.gain.value = layout === 'stitch' ? 0.0 : 0.9
      s1.connect(g1).connect(audioDest)
      s2.connect(g2).connect(audioDest)
    }
  } catch (e) {
    console.warn('[vlog] duet audio mix skipped', e)
  }

  const canvasStream = canvas.captureStream(30)
  audioDest?.stream.getAudioTracks().forEach(t => canvasStream.addTrack(t))

  const mime = pickExportMime()
  let recorder
  try {
    recorder = new MediaRecorder(canvasStream, {
      mimeType: mime || undefined,
      videoBitsPerSecond: 8_000_000,
    })
  } catch (e) {
    audioCtx?.close().catch(() => {})
    throw new Error('Duet recorder unsupported')
  }

  const out = []
  recorder.ondataavailable = e => { if (e.data?.size) out.push(e.data) }
  const done = new Promise(res => recorder.onstop = res)
  recorder.start()

  const wm1 = watermarkLines(originalVlog, watermarkStyle)
  const wm2 = watermarkLines(replyVlog,    watermarkStyle)

  function drawFitted(video, rect, fit = 'contain') {
    if (!video.videoWidth) return
    const vAR = video.videoWidth / video.videoHeight
    const pAR = rect.w / rect.h
    let dw, dh
    if (fit === 'cover') {
      if (vAR > pAR) { dh = rect.h; dw = rect.h * vAR }
      else           { dw = rect.w; dh = rect.w / vAR }
    } else {
      if (vAR > pAR) { dw = rect.w; dh = rect.w / vAR }
      else           { dh = rect.h; dw = rect.h * vAR }
    }
    const dx = rect.x + (rect.w - dw) / 2
    const dy = rect.y + (rect.h - dh) / 2
    ctx.save()
    ctx.beginPath()
    ctx.rect(rect.x, rect.y, rect.w, rect.h)
    ctx.clip()
    ctx.fillStyle = '#000'
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
    ctx.drawImage(video, dx, dy, dw, dh)
    ctx.restore()
  }

  function drawPaneWatermark(lines, rect, scaleHint = 1.0) {
    if (!lines.length) return
    const refDim = Math.min(rect.w, rect.h)
    const scale = (refDim / 600) * scaleHint
    const fs = Math.max(14, Math.round(22 * scale))
    const pad = Math.max(8, Math.round(12 * scale))
    ctx.save()
    ctx.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`
    const widths = lines.map(L => ctx.measureText(L).width)
    const boxW = Math.max(...widths) + pad * 2
    const lineH = fs * 1.28
    const boxH = lineH * lines.length + pad * 1.0
    const x = rect.x + Math.round(14 * scale)
    const y = rect.y + rect.h - boxH - Math.round(18 * scale)
    ctx.fillStyle = 'rgba(20, 14, 12, 0.62)'
    roundRectPath(ctx, x, y, boxW, boxH, Math.round(12 * scale))
    ctx.fill()
    ctx.textBaseline = 'top'
    let cy = y + pad * 0.55
    lines.forEach((L, i) => {
      ctx.globalAlpha = i === 0 ? 1 : (i === 1 ? 0.92 : 0.8)
      ctx.fillStyle = i === 2 ? '#F5C794' : '#FAF6EE'
      ctx.fillText(L, x + pad, cy)
      cy += lineH
    })
    ctx.globalAlpha = 1
    ctx.restore()
  }

  // ── Parallel layouts (stacked / side / pip): both videos play simultaneously
  if (layout === 'stacked' || layout === 'side' || layout === 'pip') {
    const rects = (() => {
      if (layout === 'side')    return [{ x: 0, y: 0, w: W/2, h: H }, { x: W/2, y: 0, w: W/2, h: H }]
      if (layout === 'stacked') return [{ x: 0, y: 0, w: W, h: H/2 }, { x: 0, y: H/2, w: W, h: H/2 }]
      // pip — original full-frame, reply as rounded corner inset
      const insetW = Math.round(W * 0.32)
      const insetH = Math.round(insetW * (originalVlog.orientation === 'landscape' ? 0.5625 : 1.778))
      const margin = Math.round(Math.min(W, H) * 0.04)
      return [
        { x: 0, y: 0, w: W, h: H }, // original fills
        { x: W - insetW - margin, y: margin, w: insetW, h: Math.min(insetH, H * 0.45) }, // top-right inset
      ]
    })()

    const END_CARD_MS = showEndCard ? 1800 : 0
    let phase = 'video', endCardStart = 0, ended1 = false, ended2 = false
    const onBothEnded = () => {
      if (showEndCard) { phase = 'endcard'; endCardStart = performance.now() }
      else { try { recorder.stop() } catch {} ; phase = 'done' }
    }
    v1.onended = () => { ended1 = true; if (ended1 && ended2) onBothEnded() }
    v2.onended = () => { ended2 = true; if (ended1 && ended2) onBothEnded() }

    await Promise.all([v1.play().catch(() => {}), v2.play().catch(() => {})])

    const tick = () => {
      if (phase === 'video') {
        if (layout === 'pip') {
          drawFitted(v1, rects[0], 'cover')
          // rounded inset for reply
          const r = rects[1]
          const radius = Math.round(Math.min(r.w, r.h) * 0.10)
          ctx.save()
          // soft drop shadow behind inset
          ctx.shadowColor = 'rgba(0,0,0,0.45)'
          ctx.shadowBlur = Math.round(20 * (W / 1080))
          ctx.shadowOffsetY = Math.round(4 * (W / 1080))
          ctx.fillStyle = '#000'
          roundRectPath(ctx, r.x, r.y, r.w, r.h, radius); ctx.fill()
          ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
          // clip to rounded rect and draw video (cover)
          ctx.beginPath()
          roundRectPath(ctx, r.x, r.y, r.w, r.h, radius); ctx.clip()
          drawFitted(v2, r, 'cover')
          ctx.restore()
          // hairline border
          ctx.save()
          ctx.strokeStyle = 'rgba(250, 246, 238, 0.85)'
          ctx.lineWidth = Math.max(2, Math.round(W / 540))
          roundRectPath(ctx, r.x, r.y, r.w, r.h, radius); ctx.stroke()
          ctx.restore()
          // single big watermark on original
          drawWatermarkPill(ctx, W, H, wm1, watermarkStyle)
        } else {
          drawFitted(v1, rects[0])
          drawFitted(v2, rects[1])
          // divider
          ctx.save(); ctx.fillStyle = '#0A0604'
          if (layout === 'side') ctx.fillRect(W/2 - 2, 0, 4, H)
          else                    ctx.fillRect(0, H/2 - 2, W, 4)
          ctx.restore()
          drawPaneWatermark(wm1, rects[0], 1.1)
          drawPaneWatermark(wm2, rects[1], 1.1)
        }
        requestAnimationFrame(tick)
      } else if (phase === 'endcard') {
        const t = performance.now() - endCardStart
        drawEndCard(ctx, W, H, t / END_CARD_MS, originalVlog)
        if (t >= END_CARD_MS) { try { recorder.stop() } catch {} ; phase = 'done' }
        else requestAnimationFrame(tick)
      }
    }
    requestAnimationFrame(tick)
  } else {
    // ── Stitch (sequential): play v1 fully, then v2 fully, then end card.
    const END_CARD_MS = showEndCard ? 1800 : 0
    const FADE_MS = 280
    let phase = 'v1'
    let endCardStart = 0
    let v2StartedAt = 0
    let v1EndedAt = 0

    v1.onended = () => { v1EndedAt = performance.now(); phase = 'transition' }
    v2.onended = () => {
      if (showEndCard) { phase = 'endcard'; endCardStart = performance.now() }
      else { try { recorder.stop() } catch {} ; phase = 'done' }
    }

    await v1.play().catch(() => {})

    const fullRect = { x: 0, y: 0, w: W, h: H }
    const tick = async () => {
      if (phase === 'v1') {
        drawFitted(v1, fullRect, 'contain')
        drawWatermarkPill(ctx, W, H, wm1, watermarkStyle)
        requestAnimationFrame(tick)
      } else if (phase === 'transition') {
        const t = performance.now() - v1EndedAt
        // fade-to-black on v1, then start v2 and fade in
        drawFitted(v1, fullRect, 'contain')
        drawWatermarkPill(ctx, W, H, wm1, watermarkStyle)
        ctx.save()
        ctx.fillStyle = `rgba(0,0,0,${Math.min(1, t / FADE_MS)})`
        ctx.fillRect(0, 0, W, H)
        ctx.restore()
        if (t >= FADE_MS) {
          // swap audio routing: mute v1, unmute v2
          if (g1) g1.gain.value = 0
          if (g2) g2.gain.value = 1.0
          try { await v2.play() } catch {}
          v2StartedAt = performance.now()
          phase = 'v2'
        }
        requestAnimationFrame(tick)
      } else if (phase === 'v2') {
        drawFitted(v2, fullRect, 'contain')
        drawWatermarkPill(ctx, W, H, wm2, watermarkStyle)
        const elapsed = performance.now() - v2StartedAt
        if (elapsed < FADE_MS) {
          // fade in from black
          ctx.save()
          ctx.fillStyle = `rgba(0,0,0,${Math.max(0, 1 - elapsed / FADE_MS)})`
          ctx.fillRect(0, 0, W, H)
          ctx.restore()
        }
        requestAnimationFrame(tick)
      } else if (phase === 'endcard') {
        const t = performance.now() - endCardStart
        drawEndCard(ctx, W, H, t / END_CARD_MS, originalVlog)
        if (t >= END_CARD_MS) { try { recorder.stop() } catch {} ; phase = 'done' }
        else requestAnimationFrame(tick)
      }
    }
    requestAnimationFrame(tick)
  }

  await done
  audioCtx?.close().catch(() => {})
  return new Blob(out, { type: mime || 'video/webm' })
}

async function handleDuetExport(originalVlog, replyVlog, opts = {}) {
  const layout = opts.layout || settings.layout || 'auto'
  toast(`Rendering ${layout === 'stitch' ? 'stitch' : 'duet'}…`)
  try {
    const blob = await exportDuet(originalVlog, replyVlog, opts)
    if (!blob) return
    const safeNames = `${state.cfg?.n1 || 'us'}-${state.cfg?.n2 || 'two'}`.replace(/[^A-Za-z0-9_-]/g, '_').toLowerCase()
    const ext = blob.type.startsWith('video/mp4') ? 'mp4' : 'webm'
    const stamp = new Date(originalVlog.recorded_at).toISOString().slice(0, 10)
    const tag = layout === 'stitch' ? 'stitch' : 'duet'
    triggerDownload(blob, `${safeNames}-${tag}-${stamp}.${ext}`)
    toast('Downloaded — ready to share 💛')
  } catch (e) {
    console.error('[vlog] duet export failed', e)
    toast('Export failed.')
  }
}

// ─────────────────────────────────────────────────────────────
// PLAYER MODAL — fullscreen viewer with watermark overlay
// ─────────────────────────────────────────────────────────────
async function openPlayer(vlog) {
  const modal = document.getElementById('vlog-player')
  if (!modal) return
  if (!isSafeMediaUrl(vlog.video_url)) {
    toast('This vlog has an unrecognized video source and was not loaded.')
    console.warn('[vlog] blocked non-Supabase video_url', vlog.video_url)
    return
  }
  modal.style.display = 'flex'
  modal.dataset.orient = vlog.orientation || 'portrait'
  const v = document.getElementById('vlog-player-video')
  v.src = vlog.video_url
  v.controls = true
  v.playsInline = true
  v.autoplay = true
  v.play?.().catch(() => {})

  const cap = document.getElementById('vlog-player-caption')
  const who = vlog.partner_idx === state.me ? 'You' : (state.theirName?.() || 'Partner')
  cap.textContent = vlog.caption ? `${who} · ${vlog.caption}` : who

  const wm = document.getElementById('vlog-player-watermark')
  wm.innerHTML = watermarkLines(vlog).map((l, i) =>
    `<div class="vlog-wm-line ${i === 0 ? 'pri' : i === 1 ? 'sec' : 'meta'}">${escapeHtml(l)}</div>`
  ).join('')

  document.getElementById('vlog-export-btn').onclick = () => handleExport(vlog, {
    watermark: settings.watermark, endcard: settings.endcard,
  })
  document.getElementById('vlog-delete-btn').style.display =
    vlog.partner_idx === state.me ? 'inline-flex' : 'none'
  document.getElementById('vlog-delete-btn').onclick = async () => {
    if (!confirm('Delete this vlog for both of you?')) return
    try { await db.deleteVlog(vlog.id); toast('Vlog deleted'); closePlayer(); renderList() }
    catch (e) { toast('Could not delete: ' + (e?.message || 'unknown')) }
  }

  // Refresh chips to current settings (in case user changed them on a previous vlog)
  syncOptionChips()

  // Hide duet-layout row by default; we'll surface it when a reply exists
  const duetRow = document.getElementById('vlog-option-duet-row')
  if (duetRow) duetRow.style.display = 'none'

  // Reply controls — only available on a top-level vlog (not on a reply itself)
  const replyBtn = document.getElementById('vlog-reply-btn')
  const duetBtn  = document.getElementById('vlog-duet-btn')
  if (replyBtn) replyBtn.style.display = vlog.reply_to ? 'none' : 'inline-flex'
  if (duetBtn)  duetBtn.style.display  = 'none'

  if (replyBtn && !vlog.reply_to) {
    replyBtn.onclick = () => {
      closePlayer()
      openRecorder({ replyTo: vlog })
    }
  }

  // If a reply exists, surface it: enable the duet export button + small "see reaction" jump
  const replyMeta = document.getElementById('vlog-player-reply-meta')
  if (replyMeta) replyMeta.innerHTML = ''
  if (!vlog.reply_to && configured) {
    try {
      const reply = await db.fetchVlogReply(vlog.id)
      if (reply) {
        if (replyBtn) replyBtn.style.display = 'none'
        if (duetBtn) {
          duetBtn.style.display = 'inline-flex'
          duetBtn.onclick = () => handleDuetExport(vlog, reply, {
            layout: settings.layout, watermark: settings.watermark, endcard: settings.endcard,
          })
        }
        if (duetRow) duetRow.style.display = ''
        if (replyMeta) {
          const replyWho = reply.partner_idx === state.me ? 'You' : (state.theirName?.() || 'Partner')
          replyMeta.innerHTML = `<button class="vlog-reply-jump" data-id="${reply.id}">↪ ${escapeHtml(replyWho)} reacted to this · watch</button>`
          replyMeta.querySelector('.vlog-reply-jump')?.addEventListener('click', () => {
            closePlayer()
            setTimeout(() => openPlayer(reply), 120)
          })
        }
      }
    } catch (e) { console.warn('[vlog] reply check failed', e) }
  }

  // Mark watched (if it was the partner's)
  if (configured && vlog.partner_idx !== state.me) {
    db.markVlogWatched(vlog.id).catch(() => {})
  }
}

function closePlayer() {
  const modal = document.getElementById('vlog-player')
  if (!modal) return
  modal.style.display = 'none'
  const v = document.getElementById('vlog-player-video')
  try { v.pause() } catch {}
  v.removeAttribute('src'); v.load?.()
}

// ─────────────────────────────────────────────────────────────
// PREFLIGHT — run once at init to detect missing migration state
// ─────────────────────────────────────────────────────────────
let preflightDone = false
async function preflight() {
  if (preflightDone || !configured) return
  preflightDone = true
  try {
    // Probe the table — head:true means "just check it exists, return no rows"
    const { error: tblErr } = await sb.from('vlogs').select('id', { head: true, count: 'exact' }).limit(0)
    if (tblErr) {
      console.error('[vlog] preflight: table check failed', tblErr)
      const reason = explainError(tblErr)
      toast(reason.user)
      return
    }
    // Probe the bucket — list returns [] on a working bucket, error on missing/blocked
    const { error: bucketErr } = await sb.storage.from('vlogs').list('', { limit: 1 })
    if (bucketErr) {
      console.error('[vlog] preflight: bucket check failed', bucketErr)
      const reason = explainError(bucketErr)
      toast(reason.user)
      return
    }
    console.log('[vlog] preflight OK — table and bucket reachable')
  } catch (e) {
    console.error('[vlog] preflight error', e)
  }
}

// ─────────────────────────────────────────────────────────────
// LIST RENDER
// ─────────────────────────────────────────────────────────────
async function renderList({ verbose = false } = {}) {
  const grid = document.getElementById('vlog-grid')
  if (!grid) return
  if (!configured) { grid.innerHTML = '<div class="empty-state">Connection needed.</div>'; return }
  let vlogs = []
  try {
    vlogs = await db.fetchVlogs()
    if (verbose) toast(vlogs.length ? `Refreshed (${vlogs.length})` : 'Refreshed — no vlogs yet')
  } catch (e) {
    console.error('[vlog] fetchVlogs failed', e)
    const reason = explainError(e)
    grid.innerHTML = `<div class="empty-state center">${escapeHtml(reason.user)}</div>`
    if (verbose) toast(reason.user)
    return
  }
  if (!vlogs.length) {
    grid.innerHTML = '<div class="empty-state center">No vlogs yet — tap "Record" to send your first one.</div>'
    return
  }
  // Build a set of vlog ids that have at least one reply, so we can badge them on the grid.
  const replyTargets = new Set(vlogs.filter(v => v.reply_to).map(v => v.reply_to))

  // Hide replies from the top-level grid — they show up via the parent vlog's player.
  const topLevel = vlogs.filter(v => !v.reply_to)

  grid.innerHTML = topLevel.map(v => {
    const who = v.partner_idx === state.me ? 'You' : (state.theirName?.() || 'Partner')
    const seen = v.partner_idx === state.me || v.watched_by?.[String(state.me)]
    const orient = v.orientation || 'portrait'
    const dur = v.duration_s ? `${Math.max(1, Math.round(v.duration_s))}s` : ''
    const hasReply = replyTargets.has(v.id)
    return `
      <figure class="vlog-cell vlog-cell-${orient} ${seen ? '' : 'unseen'}" data-id="${v.id}">
        <div class="vlog-thumb-wrap">
          ${v.thumb_url
            ? `<img class="vlog-thumb" src="${escapeHtml(v.thumb_url)}" alt="vlog poster" loading="lazy">`
            : `<div class="vlog-thumb vlog-thumb-fallback">🎥</div>`}
          <span class="vlog-play-glyph">▶</span>
          ${dur ? `<span class="vlog-dur">${dur}</span>` : ''}
          ${hasReply ? `<span class="vlog-reply-badge" title="Has a reaction">↪</span>` : ''}
          ${!seen ? `<span class="vlog-new-dot" title="New"></span>` : ''}
        </div>
        <figcaption class="vlog-cap">
          <span class="vlog-who">${escapeHtml(who)}</span>
          <span class="vlog-date">${escapeHtml(fmtDate(v.recorded_at))}</span>
        </figcaption>
        ${v.caption ? `<div class="vlog-caption-line">${escapeHtml(v.caption)}</div>` : ''}
      </figure>`
  }).join('')

  grid.querySelectorAll('.vlog-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const id = Number(cell.dataset.id)
      const vlog = vlogs.find(x => x.id === id)
      if (vlog) openPlayer(vlog)
    })
  })
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────
function syncOptionChips() {
  // Activate the chip that matches the saved setting in each group
  document.querySelectorAll('.vlog-chip-group').forEach(group => {
    const key = group.dataset.group           // duration | watermark | endcard | layout
    const val = String(settings[key])
    group.querySelectorAll('.vlog-chip').forEach(c => {
      c.classList.toggle('active', String(c.dataset.val) === val)
    })
  })
}

function bindChipGroups() {
  document.querySelectorAll('.vlog-chip-group').forEach(group => {
    group.addEventListener('click', e => {
      const chip = e.target.closest('.vlog-chip')
      if (!chip) return
      const key = group.dataset.group
      const raw = chip.dataset.val
      const val = key === 'duration' ? Number(raw) : raw
      settings[key] = val
      saveSettings()
      group.querySelectorAll('.vlog-chip').forEach(c => c.classList.remove('active'))
      chip.classList.add('active')
    })
  })
}

export function initVlog() {
  if (inited) return
  inited = true

  document.getElementById('vlog-open-btn')?.addEventListener('click', () => openRecorder())
  document.getElementById('vlog-refresh-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    if (btn) { btn.disabled = true; btn.textContent = '⟳ Refreshing…' }
    try { await renderList({ verbose: true }) }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Refresh' } }
  })

  // Recorder controls
  document.getElementById('vlog-rec-start')?.addEventListener('click', startRecording)
  document.getElementById('vlog-rec-stop')?.addEventListener('click', stopRecording)
  document.getElementById('vlog-rec-flip')?.addEventListener('click', flipCamera)
  document.getElementById('vlog-rec-close')?.addEventListener('click', closeRecorder)
  document.getElementById('vlog-retake-btn')?.addEventListener('click', retake)
  document.getElementById('vlog-save-btn')?.addEventListener('click', savePostedVlog)

  // Player controls
  document.getElementById('vlog-player-close')?.addEventListener('click', closePlayer)
  document.getElementById('vlog-player-backdrop')?.addEventListener('click', closePlayer)

  // Option chips (duration / watermark / endcard / layout)
  bindChipGroups()
  syncOptionChips()

  // Live watermark refresh — keeps the preview accurate to the minute
  if (!initVlog._tick) {
    initVlog._tick = setInterval(() => {
      const o = document.getElementById('vlog-recorder')
      if (o && o.style.display !== 'none') updateLiveWatermark()
    }, 30_000)
  }

  preflight().finally(() => renderList())
}

export function onRemoteVlog(payload) {
  if (!inited) return
  renderList()
  const row = payload?.new
  if (row && row.partner_idx !== state.me && payload?.eventType === 'INSERT') {
    toast(`${state.theirName?.() || 'Partner'} just posted a vlog 🎥`)
    try { playPing() } catch {}
  }
}

export function teardownVlog() {
  inited = false
  preflightDone = false
  if (initVlog._tick) { clearInterval(initVlog._tick); initVlog._tick = null }
  closeRecorder()
  closePlayer()
}
