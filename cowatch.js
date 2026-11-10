/**
 * In-app co-watch.
 *
 * Two separate features share this module because they share a channel and a
 * slot in the Watch tab:
 *
 *  1. THEATER MIRROR — reflects the browser extension's session inside the app.
 *     The extension syncs Netflix/Disney+/Max/Hulu/Prime, which a web page
 *     cannot reach into. The app can't play that video, but it can show you
 *     what the two of you are on and whether you're in step.
 *
 *  2. DIRECT SHARE — one partner picks a video file they own (or shares a
 *     screen/tab) and the live track is sent peer-to-peer to the other. This is
 *     the real "one of us loads it, both of us watch": only the host needs the
 *     file, and the viewer needs nothing at all.
 *
 * On what (2) can and cannot carry: it moves whatever the host's browser can
 * actually render. A file on their disk works. A DRM-protected service does
 * not - the protected media path yields black frames to any capture API, by
 * design. That is not a bug to route around; it is the licence boundary doing
 * its job. Share things you own.
 */

import { state } from './state.js'
import { configured, sb } from './supabase.js'
import { createScope } from './lifecycle.js'

// Public STUN only. Without a TURN relay, a minority of network pairs
// (symmetric NAT on both ends, some mobile carriers) will fail to connect -
// the UI reports that rather than hanging.
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

const VIDEO_MIME = /^video\//

// ── module state ────────────────────────────────────────────
const scope = createScope()
let channel     = null
let theaterChannel = null
let pc          = null
let localStream = null
let localFileUrl = null
let role        = null      // 'host' | 'viewer' | null
let peerIce     = []        // candidates arriving before the description
let remoteDesc  = false
let theater     = null      // last extension state seen
let theaterTimer = null
let els         = {}
let booted      = false

const $ = id => document.getElementById(id)

// ============================================================
// INIT / TEARDOWN
// ============================================================
export function initCoWatch() {
  if (booted) return
  booted = true

  els = {
    card:      $('cw-card'),
    status:    $('cw-status'),
    stage:     $('cw-stage'),
    video:     $('cw-video'),
    empty:     $('cw-empty'),
    fileBtn:   $('cw-file-btn'),
    fileInput: $('cw-file'),
    screenBtn: $('cw-screen-btn'),
    stopBtn:   $('cw-stop-btn'),
    joinBtn:   $('cw-join-btn'),
    note:      $('cw-note'),
    theater:   $('cw-theater'),
  }
  if (!els.card) return

  scope.on(els.fileBtn,   'click',  () => els.fileInput?.click())
  scope.on(els.fileInput, 'change', onFilePicked)
  scope.on(els.screenBtn, 'click',  onShareScreen)
  scope.on(els.stopBtn,   'click',  () => { stopSharing(true) })
  scope.on(els.joinBtn,   'click',  onManualPlay)

  renderIdle()
  if (configured && sb && state.room) joinChannel()
}

export function teardownCoWatch() {
  scope.destroy()
  stopSharing(false)
  if (channel && sb)        { try { sb.removeChannel(channel) } catch {} }
  if (theaterChannel && sb) { try { sb.removeChannel(theaterChannel) } catch {} }
  channel = null
  theaterChannel = null
  if (theaterTimer) { clearInterval(theaterTimer); theaterTimer = null }
  theater = null
  booted = false
}

// ============================================================
// SIGNALLING CHANNEL
// ============================================================
function joinChannel() {
  channel = sb.channel(`cowatch:${state.room}`, {
    config: {
      broadcast: { self: false, ack: false },
      presence:  { key: String(state.me) },
    },
  })

  channel
    .on('broadcast', { event: 'cw_offer' },  ({ payload }) => onOffer(payload))
    .on('broadcast', { event: 'cw_answer' }, ({ payload }) => onAnswer(payload))
    .on('broadcast', { event: 'cw_ice' },    ({ payload }) => onIce(payload))
    .on('broadcast', { event: 'cw_stop' },   ({ payload }) => onPeerStopped(payload))
    .on('broadcast', { event: 'cw_want' },   ({ payload }) => onViewerReady(payload))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') channel.track({ seat: state.me, t: Date.now() })
    })

  // The extension publishes to its own namespace; listen in read-only.
  const tc = sb.channel(`theater:${state.room}`, {
    config: { broadcast: { self: false, ack: false } },
  })
  tc.on('broadcast', { event: 'state' }, ({ payload }) => onTheaterState(payload))
    .on('broadcast', { event: 'load' },  ({ payload }) => onTheaterState(payload))
    .subscribe()
  theaterChannel = tc

  theaterTimer = setInterval(renderTheater, 5000)
}

function send(event, payload) {
  if (!channel) return
  try { channel.send({ type: 'broadcast', event, payload: { ...payload, from: state.me } }) } catch {}
}

// ============================================================
// HOST: pick a source
// ============================================================
async function onFilePicked(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''          // allow re-picking the same file
  if (!file) return

  if (!VIDEO_MIME.test(file.type)) {
    setStatus('That file is not a video your browser can play.', 'error')
    return
  }

  stopSharing(false)
  revokeFileUrl()
  localFileUrl = URL.createObjectURL(file)

  els.video.srcObject = null
  els.video.src = localFileUrl
  els.video.muted = false
  els.video.controls = true
  showStage(true)

  try {
    await els.video.play()
  } catch {
    // Autoplay refused - the element has controls, so the host can start it.
  }

  await beginHosting(() => captureFromElement(), file.name)
}

async function onShareScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setStatus('This browser cannot share a screen.', 'error')
    return
  }
  stopSharing(false)

  let stream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true,
    })
  } catch {
    renderIdle()   // user cancelled the picker
    return
  }

  // The user can stop the share from the browser's own bar.
  stream.getVideoTracks()[0]?.addEventListener('ended', () => stopSharing(true))

  els.video.src = ''
  els.video.srcObject = stream
  els.video.muted = true          // never monitor your own audio
  els.video.controls = false
  showStage(true)
  try { await els.video.play() } catch {}

  await beginHosting(() => stream, 'your screen')
}

/** Shared host path for both sources. */
async function beginHosting(getStream, label) {
  role = 'host'
  try {
    localStream = getStream()
  } catch (err) {
    setStatus('Could not capture that source.', 'error')
    role = null
    return
  }
  if (!localStream) { setStatus('Could not capture that source.', 'error'); role = null; return }

  setStatus(`Sharing ${label} — waiting for ${state.theirName() || 'partner'}…`, 'busy')
  els.stopBtn.style.display = ''
  els.fileBtn.disabled = els.screenBtn.disabled = true

  await openPeer()
  await sendOffer()
}

/**
 * Capture the <video> element's own output. Must be called after playback has
 * begun or the resulting tracks carry no data.
 */
function captureFromElement() {
  const v = els.video
  if (v.captureStream)      return v.captureStream()
  if (v.mozCaptureStream)   return v.mozCaptureStream()
  throw new Error('captureStream unsupported')
}

// ============================================================
// PEER CONNECTION
// ============================================================
async function openPeer() {
  closePeer()
  peerIce = []
  remoteDesc = false

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

  pc.onicecandidate = e => {
    if (e.candidate) send('cw_ice', { candidate: e.candidate.toJSON() })
  }

  pc.onconnectionstatechange = () => {
    const s = pc?.connectionState
    if (s === 'connected') {
      setStatus(role === 'host'
        ? `Streaming to ${state.theirName() || 'partner'}`
        : `Watching ${state.theirName() || 'partner'}'s share`, 'live')
    } else if (s === 'failed') {
      setStatus('Could not open a direct connection — your networks may need a relay.', 'error')
    } else if (s === 'disconnected') {
      setStatus('Connection dropped.', 'error')
    }
  }

  if (role === 'host' && localStream) {
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream)
  }

  if (role === 'viewer') {
    pc.ontrack = e => {
      const [stream] = e.streams
      if (!stream) return
      els.video.src = ''
      els.video.srcObject = stream
      els.video.muted = false
      els.video.controls = true
      showStage(true)
      els.video.play().then(() => {
        els.joinBtn.style.display = 'none'
      }).catch(() => {
        // Autoplay with sound is blocked until the viewer interacts.
        els.joinBtn.style.display = ''
        setStatus('Tap “Start watching” to join.', 'busy')
      })
    }
  }
}

function closePeer() {
  if (pc) {
    try { pc.ontrack = null; pc.onicecandidate = null; pc.onconnectionstatechange = null } catch {}
    try { pc.close() } catch {}
  }
  pc = null
}

async function sendOffer() {
  if (!pc) return
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  send('cw_offer', { sdp: pc.localDescription.sdp, type: pc.localDescription.type })
}

// ── inbound signalling ──────────────────────────────────────
async function onOffer(p) {
  if (p.from === state.me) return
  if (role === 'host') return      // both sides tried to host; first one wins

  role = 'viewer'
  setStatus(`${state.theirName() || 'Partner'} is sharing — connecting…`, 'busy')
  els.fileBtn.disabled = els.screenBtn.disabled = true

  await openPeer()
  await pc.setRemoteDescription({ type: p.type, sdp: p.sdp })
  remoteDesc = true
  await flushIce()

  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  send('cw_answer', { sdp: pc.localDescription.sdp, type: pc.localDescription.type })
}

async function onAnswer(p) {
  if (p.from === state.me || role !== 'host' || !pc) return
  if (pc.signalingState === 'stable') return
  await pc.setRemoteDescription({ type: p.type, sdp: p.sdp })
  remoteDesc = true
  await flushIce()
}

async function onIce(p) {
  if (p.from === state.me || !p.candidate) return
  if (!pc || !remoteDesc) { peerIce.push(p.candidate); return }
  try { await pc.addIceCandidate(p.candidate) } catch {}
}

async function flushIce() {
  const queued = peerIce
  peerIce = []
  for (const c of queued) {
    try { await pc.addIceCandidate(c) } catch {}
  }
}

/** A viewer arriving late asks the host to re-offer. */
async function onViewerReady(p) {
  if (p.from === state.me || role !== 'host' || !localStream) return
  await openPeer()
  await sendOffer()
}

function onPeerStopped(p) {
  if (p.from === state.me) return
  closePeer()
  els.video.srcObject = null
  els.video.src = ''
  showStage(false)
  role = null
  els.fileBtn.disabled = els.screenBtn.disabled = false
  els.joinBtn.style.display = 'none'
  setStatus(`${state.theirName() || 'Partner'} stopped sharing.`, 'idle')
}

// ============================================================
// STOP
// ============================================================
function stopSharing(announce) {
  if (announce && role) send('cw_stop', {})

  closePeer()
  if (localStream) {
    for (const t of localStream.getTracks()) { try { t.stop() } catch {} }
  }
  localStream = null
  revokeFileUrl()

  if (els.video) {
    try { els.video.pause() } catch {}
    els.video.srcObject = null
    els.video.src = ''
    els.video.controls = false
  }
  role = null
  if (els.stopBtn) els.stopBtn.style.display = 'none'
  if (els.joinBtn) els.joinBtn.style.display = 'none'
  if (els.fileBtn) els.fileBtn.disabled = false
  if (els.screenBtn) els.screenBtn.disabled = false
  showStage(false)
  renderIdle()
}

function revokeFileUrl() {
  if (localFileUrl) { try { URL.revokeObjectURL(localFileUrl) } catch {} ; localFileUrl = null }
}

async function onManualPlay() {
  try {
    await els.video.play()
    els.joinBtn.style.display = 'none'
    setStatus(`Watching ${state.theirName() || 'partner'}'s share`, 'live')
  } catch {
    setStatus('Your browser blocked playback.', 'error')
  }
}

// ============================================================
// THEATER MIRROR (extension session)
// ============================================================
function onTheaterState(p) {
  theater = { ...p, seenAt: Date.now() }
  renderTheater()
}

function renderTheater() {
  if (!els.theater) return

  // Treat the session as stale if the extension has gone quiet.
  const fresh = theater && (Date.now() - theater.seenAt) < 20000
  if (!fresh) {
    els.theater.style.display = 'none'
    return
  }

  const title = theater.title || 'something'
  const playing = theater.is_playing
  els.theater.style.display = ''
  els.theater.innerHTML = ''

  const dot = document.createElement('span')
  dot.className = `cw-dot ${playing ? 'live' : 'away'}`
  const text = document.createElement('span')
  text.textContent = playing
    ? `Watching “${title}” together on the extension`
    : `Paused on “${title}” in the extension`
  els.theater.append(dot, text)
}

// ============================================================
// UI HELPERS
// ============================================================
function showStage(on) {
  if (!els.stage) return
  els.stage.style.display = on ? '' : 'none'
  if (els.empty) els.empty.style.display = on ? 'none' : ''
}

function setStatus(text, kind = 'idle') {
  if (!els.status) return
  els.status.textContent = text
  els.status.className = `cw-status cw-${kind}`
}

function renderIdle() {
  setStatus('Nobody is sharing yet.', 'idle')
  // Late joiner: if the partner is already hosting, ask them to re-offer.
  send('cw_want', {})
}
