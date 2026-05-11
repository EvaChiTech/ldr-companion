import { state } from './state.js'
import { configured, sb } from './supabase.js'
import * as db from './db.js'

// ============================================================
// CONSTANTS
// ============================================================
const YT_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([\w-]{11})/
const VIDEO_RE = /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i
const DRIFT_HARD = 1.5      // seconds — seek if off by this much
const DRIFT_SOFT = 0.35     // seconds — playback-rate nudge band
const TICK_MS    = 2000     // periodic position broadcast while playing
const CLOCK_PINGS = 5       // initial clock-offset samples
const REACTION_TTL = 2400   // ms

// ============================================================
// MODULE STATE
// ============================================================
let player = null
let playerType = null        // 'youtube' | 'video'
let currentMediaId = null
let ytReady = false
let pendingLoad = null
let applyingRemote = false
let tickTimer = null
let nudgeTimer = null

let channel = null           // Supabase Realtime broadcast channel
let peerOffsetMs = 0         // estimated (peerNow - myNow) in ms — median of samples
let peerOffsetSamples = []
let peerOnline = false
let peerBuffering = false
let myBuffering = false

// ============================================================
// URL PARSING
// ============================================================
export function parseUrl(url) {
  const m = url.match(YT_RE)
  if (m) return { source: 'youtube', mediaId: m[1] }
  if (VIDEO_RE.test(url)) return { source: 'video', mediaId: url }
  return null
}

// ============================================================
// YT IFRAME API LOADER
// ============================================================
function loadYTApi() {
  if (window.YT?.Player) { ytReady = true; flushPending(); return }
  if (document.getElementById('yt-iframe-api')) return
  const tag = document.createElement('script')
  tag.id = 'yt-iframe-api'
  tag.src = 'https://www.youtube.com/iframe_api'
  document.head.appendChild(tag)
  window.onYouTubeIframeAPIReady = () => { ytReady = true; flushPending() }
}
function flushPending() {
  if (!pendingLoad) return
  const p = pendingLoad; pendingLoad = null
  loadMedia(p.source, p.mediaId)
}

// ============================================================
// PLAYER LIFECYCLE
// ============================================================
function destroyPlayer() {
  stopTick(); stopNudge()
  if (!player) return
  try {
    if (playerType === 'youtube' && typeof player.destroy === 'function') player.destroy()
  } catch {}
  player = null; playerType = null
}

function makeYTPlayer(videoId) {
  destroyPlayer()
  const container = document.getElementById('watch-player')
  container.innerHTML = '<div id="yt-player"></div>'
  try {
    // eslint-disable-next-line no-undef
    player = new YT.Player('yt-player', {
      width: '100%', height: '100%',
      videoId,
      playerVars: { autoplay: 0, modestbranding: 1, rel: 0, playsinline: 1, enablejsapi: 1 },
      events: {
        onReady:       () => { try { applyRemoteState() } catch (err) { console.error('[watch] onReady', err) } },
        onStateChange: handleYTStateChange,
        onError:       handleYTError,
      },
    })
    playerType = 'youtube'
  } catch (err) {
    console.error('[watch] YT.Player ctor failed:', err)
    container.innerHTML = '<div class="watch-empty">Couldn\'t initialize player. Try a different URL.</div>'
    player = null; playerType = null
    showToast('Player failed to start: ' + (err?.message || 'unknown'))
  }
}

function handleYTError(e) {
  const codes = {
    2:   'Invalid video URL',
    5:   'HTML5 player issue — try a different browser or video',
    100: 'Video not found or removed',
    101: 'This video can\'t be embedded — try another',
    150: 'This video can\'t be embedded — try another',
  }
  const msg = codes[e?.data] || `Player error (code ${e?.data})`
  console.error('[watch] YT onError', e?.data, msg)
  const container = document.getElementById('watch-player')
  if (container) {
    container.innerHTML = `<div class="watch-empty">⚠ ${msg}<br><span class="watch-empty-sub">Pick another video and hit Load.</span></div>`
  }
  showToast(msg)
}

function safePlay() {
  if (!player) return
  try {
    if (playerType === 'youtube') player.playVideo?.()
    else {
      const r = player.play?.()
      if (r && typeof r.catch === 'function') r.catch(err => {
        console.warn('[watch] play() rejected (autoplay policy?)', err?.message)
        showToast('Tap the player to start — browser blocked autoplay')
      })
    }
  } catch (err) { console.error('[watch] safePlay', err) }
}
function safePause() {
  if (!player) return
  try {
    if (playerType === 'youtube') player.pauseVideo?.()
    else player.pause?.()
  } catch (err) { console.error('[watch] safePause', err) }
}

function makeVideoPlayer(url) {
  destroyPlayer()
  const container = document.getElementById('watch-player')
  container.innerHTML = ''
  const v = document.createElement('video')
  v.controls = true
  v.src = url
  v.style.cssText = 'width:100%;height:100%;display:block;background:#000;'
  v.addEventListener('play',     () => onLocalPlay())
  v.addEventListener('pause',    () => onLocalPause())
  v.addEventListener('seeked',   () => onLocalSeek())
  v.addEventListener('waiting',  () => setMyBuffering(true))
  v.addEventListener('canplay',  () => setMyBuffering(false))
  v.addEventListener('playing',  () => setMyBuffering(false))
  v.addEventListener('ended',    () => onMediaEnded())
  container.appendChild(v)
  player = v; playerType = 'video'
  applyRemoteState()
}

function loadMedia(source, mediaId) {
  if (!source || source === 'none' || !mediaId) {
    destroyPlayer()
    const c = document.getElementById('watch-player')
    if (c) c.innerHTML = '<div class="watch-empty">Paste a YouTube link or .mp4 URL above and hit Load.</div>'
    currentMediaId = null
    return
  }
  if (source === 'youtube') {
    if (!ytReady) { pendingLoad = { source, mediaId }; loadYTApi(); return }
    makeYTPlayer(mediaId)
  } else if (source === 'video') {
    makeVideoPlayer(mediaId)
  }
  currentMediaId = mediaId
}

// ============================================================
// LOCAL PLAYER EVENT HANDLERS
// ============================================================
function handleYTStateChange(e) {
  if (applyingRemote) return
  // 1=playing 2=paused 0=ended 3=buffering 5=cued
  if (e.data === 1)      onLocalPlay()
  else if (e.data === 2) onLocalPause()
  else if (e.data === 0) onMediaEnded()
  else if (e.data === 3) setMyBuffering(true)
  if (e.data === 1)      setMyBuffering(false)
}

function onLocalPlay()  { broadcastState({ is_playing: true }); startTick(); startPersist() }
function onLocalPause() { broadcastState({ is_playing: false }); stopTick(); stopPersist(); persistNow() }
function onLocalSeek()  { broadcastState({ is_playing: !player.paused }); persistNow() }

function onMediaEnded() {
  // Auto-advance through queue (only initiator advances; broadcast new state)
  const q = state.watch?.queue || []
  if (!q.length) return
  const next = q[0]
  state.watch.queue = q.slice(1)
  loadFromUrl(next.url, { advanceQueue: false, persistedQueue: state.watch.queue })
}

// ============================================================
// CLOCK SYNC (peer-to-peer NTP-style)
// ============================================================
function nowPeer() { return Date.now() + peerOffsetMs }

function recordOffsetSample(sample) {
  peerOffsetSamples.push(sample)
  if (peerOffsetSamples.length > 10) peerOffsetSamples.shift()
  const sorted = [...peerOffsetSamples].sort((a, b) => a - b)
  peerOffsetMs = sorted[Math.floor(sorted.length / 2)]
}

function sendClockPing() {
  if (!channel) return
  const t = Date.now()
  channel.send({ type: 'broadcast', event: 'clock_ping', payload: { from: state.me, t_sent: t } })
}

function handleClockPing(p) {
  if (!channel || p.from === state.me) return
  channel.send({ type: 'broadcast', event: 'clock_pong', payload: {
    from: state.me, original: p.t_sent, t_replied: Date.now(),
  } })
}

function handleClockPong(p) {
  if (p.from === state.me) return
  const rtt = Date.now() - p.original
  // Estimate peer's clock relative to ours: peer time when reply was sent ≈ p.t_replied + rtt/2 backflow
  // Offset such that peer's "now" equals our "now + offset":
  const offset = p.t_replied - (p.original + rtt / 2)
  recordOffsetSample(offset)
}

// ============================================================
// PRESENCE & BUFFERING
// ============================================================
function setMyBuffering(b) {
  if (myBuffering === b) return
  myBuffering = b
  channel?.send({ type: 'broadcast', event: 'buffer', payload: { from: state.me, buffering: b } })
  updatePresenceUI()
  // If I just started buffering and was playing, the partner should pause to wait for me
  if (b && playerIsPlaying()) {
    // Don't write to DB; just nudge partner via broadcast
  }
}

function handlePeerBuffer(p) {
  if (p.from === state.me) return
  peerBuffering = !!p.buffering
  updatePresenceUI()
  // If peer started buffering while we're playing, soft-pause
  if (peerBuffering && playerIsPlaying()) {
    applyingRemote = true
    try { safePause() } finally { setTimeout(() => { applyingRemote = false }, 200) }
  }
  if (!peerBuffering && state.watch?.is_playing && !playerIsPlaying() && !myBuffering) {
    applyingRemote = true
    try { safePlay() } finally { setTimeout(() => { applyingRemote = false }, 200) }
  }
}

function updatePresenceUI() {
  const pill = document.getElementById('watch-presence')
  if (!pill) return
  const them = state.theirName?.() || 'Partner'
  if (!peerOnline) {
    pill.className = 'presence-pill away'
    pill.textContent = `${them} is away`
    return
  }
  if (peerBuffering) {
    pill.className = 'presence-pill buffering'
    pill.textContent = `${them} is buffering…`
    return
  }
  pill.className = 'presence-pill live'
  pill.textContent = `${them} is here`
}

// ============================================================
// BROADCAST CHANNEL
// ============================================================
function joinWatchChannel() {
  if (!configured || !sb || channel) return
  channel = sb.channel(`watch:${state.room}`, {
    config: {
      broadcast: { self: false, ack: false },
      presence:  { key: String(state.me) },
    },
  })

  channel
    .on('broadcast', { event: 'state' },      ({ payload }) => handleRemoteState(payload))
    .on('broadcast', { event: 'tick' },       ({ payload }) => handleRemoteTick(payload))
    .on('broadcast', { event: 'load' },       ({ payload }) => handleRemoteLoad(payload))
    .on('broadcast', { event: 'buffer' },     ({ payload }) => handlePeerBuffer(payload))
    .on('broadcast', { event: 'reaction' },   ({ payload }) => spawnReaction(payload))
    .on('broadcast', { event: 'moment' },     ({ payload }) => handleRemoteMoment(payload))
    .on('broadcast', { event: 'queue' },      ({ payload }) => handleRemoteQueue(payload))
    .on('broadcast', { event: 'cursor' },     ({ payload }) => handlePeerCursor(payload))
    .on('broadcast', { event: 'typing' },     ({ payload }) => handlePeerTyping(payload))
    .on('broadcast', { event: 'clock_ping' }, ({ payload }) => handleClockPing(payload))
    .on('broadcast', { event: 'clock_pong' }, ({ payload }) => handleClockPong(payload))
    .on('presence',  { event: 'sync' },       () => {
      const st = channel.presenceState()
      // Are there any keys other than mine?
      peerOnline = Object.keys(st).some(k => k !== String(state.me))
      updatePresenceUI()
    })
    .subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return
      await channel.track({ partner_idx: state.me, t: Date.now() })
      // Initial clock sync
      for (let i = 0; i < CLOCK_PINGS; i++) setTimeout(sendClockPing, 100 + i * 200)
      // Periodic resync every 30s
      setInterval(() => { if (peerOnline) sendClockPing() }, 30000)
    })
}

function leaveChannel() {
  if (channel && sb) {
    try { sb.removeChannel(channel) } catch {}
    channel = null
  }
  peerOnline = false; peerBuffering = false; myBuffering = false
  peerOffsetMs = 0; peerOffsetSamples = []
}

// ============================================================
// BROADCAST PAYLOAD HELPERS
// ============================================================
function broadcastState(extra = {}) {
  if (applyingRemote || !channel || !state.watch?.media_id) return
  const payload = {
    from:        state.me,
    source:      state.watch.source,
    media_id:    state.watch.media_id,
    is_playing:  extra.is_playing ?? playerIsPlaying(),
    position:    currentPosition(),
    sender_t:    Date.now(),
  }
  state.watch = { ...state.watch, ...payload, mediaId: payload.media_id, position_at: new Date().toISOString(), updated_by: state.me }
  channel.send({ type: 'broadcast', event: 'state', payload })
}

// Persist current state to DB (for late-joiner resume on refresh).
// Called on pause + every 30s while playing — NOT on every broadcast.
let persistTimer = null
function persistNow() {
  if (!configured || !state.watch?.media_id) return
  db.upsertWatchSession({
    source:     state.watch.source,
    media_id:   state.watch.media_id,
    is_playing: !!state.watch.is_playing,
    position:   currentPosition(),
  }).catch(console.error)
}
function startPersist() {
  stopPersist()
  persistTimer = setInterval(() => { if (playerIsPlaying()) persistNow() }, 30000)
}
function stopPersist() { if (persistTimer) { clearInterval(persistTimer); persistTimer = null } }

function broadcastLoad(source, mediaId, queue) {
  if (!channel) return
  channel.send({ type: 'broadcast', event: 'load', payload: {
    from: state.me, source, media_id: mediaId, sender_t: Date.now(), queue: queue || [],
  } })
}

function broadcastQueue(queue, added) {
  if (!channel) return
  channel.send({ type: 'broadcast', event: 'queue', payload: { from: state.me, queue, added: added || null } })
}

// ── Heart cursor trail ─────────────────────────────────────
let lastCursorEmit = 0
function setupCursorTrail() {
  const stage = document.querySelector('.watch-stage')
  if (!stage || stage.dataset.cursorBound) return
  stage.dataset.cursorBound = '1'
  stage.addEventListener('mousemove', e => {
    if (!channel) return
    const now = Date.now()
    if (now - lastCursorEmit < 33) return  // ~30fps
    lastCursorEmit = now
    const rect = stage.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top)  / rect.height
    channel.send({ type: 'broadcast', event: 'cursor', payload: { from: state.me, x, y, visible: true } })
  })
  stage.addEventListener('mouseleave', () => {
    channel?.send({ type: 'broadcast', event: 'cursor', payload: { from: state.me, visible: false } })
  })
}
function handlePeerCursor(p) {
  if (p.from === state.me) return
  const stage = document.querySelector('.watch-stage')
  if (!stage) return
  let cur = document.getElementById('peer-cursor')
  if (!p.visible) { if (cur) cur.style.opacity = '0'; return }
  if (!cur) {
    cur = document.createElement('div')
    cur.id = 'peer-cursor'
    cur.className = 'peer-cursor'
    cur.textContent = '♡'
    stage.appendChild(cur)
  }
  cur.style.left = (p.x * 100) + '%'
  cur.style.top  = (p.y * 100) + '%'
  cur.style.opacity = '1'
}

// ── Typing indicator on whisper input ──────────────────────
let typingTimer = null
function emitTyping(isTyping) {
  if (!channel) return
  channel.send({ type: 'broadcast', event: 'typing', payload: { from: state.me, typing: !!isTyping } })
}
function handlePeerTyping(p) {
  if (p.from === state.me) return
  const ind = document.getElementById('typing-indicator')
  if (!ind) return
  if (p.typing) {
    ind.textContent = `${state.theirName?.() || 'Partner'} is typing…`
    ind.style.opacity = '1'
  } else {
    ind.style.opacity = '0'
  }
}

function broadcastReaction(emoji) {
  if (!channel) return
  channel.send({ type: 'broadcast', event: 'reaction', payload: { from: state.me, emoji, t: Date.now() } })
  spawnReaction({ from: state.me, emoji, t: Date.now() })
}

function broadcastMoment(label) {
  if (!channel) return
  channel.send({ type: 'broadcast', event: 'moment', payload: { from: state.me, label, t: Date.now() } })
}

// ============================================================
// REMOTE EVENT HANDLERS
// ============================================================
function handleRemoteLoad(p) {
  if (p.from === state.me) return
  state.watch = {
    source:      p.source,
    media_id:    p.media_id,
    mediaId:     p.media_id,
    is_playing:  false,
    position:    0,
    position_at: new Date().toISOString(),
    updated_by:  p.from,
    queue:       Array.isArray(p.queue) ? p.queue : (state.watch?.queue || []),
  }
  loadMedia(p.source, p.media_id)
  renderQueue()
  showToast(`Now playing — ${labelFor(p.source, p.media_id)}`)
}

function handleRemoteState(p) {
  if (p.from === state.me) return
  state.watch = {
    ...state.watch,
    source:      p.source,
    media_id:    p.media_id,
    mediaId:     p.media_id,
    is_playing:  p.is_playing,
    position:    p.position,
    position_at: new Date().toISOString(),
    sender_t:    p.sender_t,
    updated_by:  p.from,
  }
  // If this is a different media than what we have loaded, switch to it
  if (p.media_id !== currentMediaId) {
    loadMedia(p.source, p.media_id)
    return // applyRemoteState fires onReady
  }
  applyRemoteState()
}

function handleRemoteTick(p) {
  if (p.from === state.me || !player) return
  // Drift correction
  const senderClockNow = nowPeer()
  const elapsed = Math.max(0, (senderClockNow - p.sender_t) / 1000)
  const target = (Number(p.position) || 0) + elapsed
  const cur = currentPosition()
  const drift = cur - target
  if (Math.abs(drift) > DRIFT_HARD) {
    applyingRemote = true
    try {
      if (playerType === 'youtube') player.seekTo?.(target, true)
      else player.currentTime = target
    } finally { setTimeout(() => { applyingRemote = false }, 150) }
    stopNudge()
  } else if (Math.abs(drift) > DRIFT_SOFT && playerType === 'video') {
    // Soft nudge with playbackRate (only available on <video>)
    nudgePlaybackRate(drift)
  }
}

function nudgePlaybackRate(drift) {
  // Slow down if we're ahead (drift>0), speed up if behind (drift<0). Bounded.
  const target = drift > 0 ? 0.95 : 1.05
  player.playbackRate = target
  stopNudge()
  nudgeTimer = setTimeout(() => { try { player.playbackRate = 1 } catch {} }, 1500)
}
function stopNudge() {
  if (nudgeTimer) { clearTimeout(nudgeTimer); nudgeTimer = null }
  if (player && playerType === 'video') { try { player.playbackRate = 1 } catch {} }
}

function handleRemoteMoment(p) {
  if (p.from === state.me) return
  showToast(`${state.theirName?.() || 'Partner'} saved a moment 💫`)
}

function handleRemoteQueue(p) {
  if (p.from === state.me) return
  state.watch = { ...state.watch, queue: Array.isArray(p.queue) ? p.queue : [] }
  renderQueue()
  if (p.added?.label) showToast(`${state.theirName?.() || 'Partner'} added: ${p.added.label} 📺`)
}

// ============================================================
// APPLY REMOTE STATE TO LOCAL PLAYER
// ============================================================
function applyRemoteState() {
  const ws = state.watch
  if (!player || !ws?.media_id) return
  let target = Number(ws.position) || 0
  if (ws.is_playing) {
    const senderT = ws.sender_t || (ws.position_at ? new Date(ws.position_at).getTime() - peerOffsetMs : null)
    if (senderT) target += Math.max(0, (nowPeer() - senderT) / 1000)
  }
  applyingRemote = true
  try {
    if (playerType === 'youtube') {
      const cur = player.getCurrentTime?.() || 0
      if (Math.abs(cur - target) > DRIFT_HARD) player.seekTo?.(target, true)
      if (ws.is_playing) safePlay()
      else                safePause()
    } else {
      const cur = player.currentTime || 0
      if (Math.abs(cur - target) > DRIFT_HARD) player.currentTime = target
      if (ws.is_playing) safePlay()
      else                safePause()
    }
  } finally {
    setTimeout(() => { applyingRemote = false }, 250)
  }
  if (ws.is_playing) { startTick(); startPersist() } else { stopTick(); stopPersist() }
}

// ============================================================
// LOCAL POSITION HELPERS
// ============================================================
function currentPosition() {
  if (!player) return 0
  return playerType === 'youtube'
    ? (player.getCurrentTime?.() || 0)
    : (player.currentTime || 0)
}
function playerIsPlaying() {
  if (!player) return false
  return playerType === 'youtube'
    ? player.getPlayerState?.() === 1
    : !player.paused
}

// ============================================================
// PERIODIC TICKER
// ============================================================
function startTick() {
  stopTick()
  tickTimer = setInterval(() => {
    if (!playerIsPlaying() || !channel) return
    channel.send({ type: 'broadcast', event: 'tick', payload: {
      from: state.me, position: currentPosition(), sender_t: Date.now(),
    } })
  }, TICK_MS)
}
function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null } }

// ============================================================
// REACTIONS
// ============================================================
function spawnReaction({ emoji, from }) {
  const layer = document.getElementById('watch-reactions')
  if (!layer) return
  const el = document.createElement('div')
  el.className = 'reaction-burst'
  el.textContent = emoji
  // Stagger horizontally so partners' reactions don't collide
  el.style.left = (from === state.me ? 12 : 70) + Math.random() * 18 + '%'
  el.style.bottom = '8%'
  layer.appendChild(el)
  setTimeout(() => el.remove(), REACTION_TTL)
}

// ============================================================
// CHAT OVERLAY (uses existing messages — main.js calls onChatMessage)
// ============================================================
export function onChatMessage(msg) {
  // Render a fading bubble on the player overlay if the watch tab is visible
  const tab = document.getElementById('tab-watch')
  if (!tab || tab.style.display === 'none') return
  const layer = document.getElementById('watch-chatlayer')
  if (!layer) return
  const mine = msg.partner_idx === state.me
  const bubble = document.createElement('div')
  bubble.className = 'chat-overlay-msg ' + (mine ? 'mine' : 'theirs')
  const who = mine ? 'You' : (state.theirName?.() || 'Partner')
  bubble.innerHTML = `<span class="cou-who">${who}</span> ${escapeHtml(msg.content)}`
  layer.appendChild(bubble)
  // Trim to last 5
  while (layer.children.length > 5) layer.firstChild?.remove()
  setTimeout(() => bubble.classList.add('fading'), 4500)
  setTimeout(() => bubble.remove(), 6500)
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

// ============================================================
// MOMENTS — save current frame timestamp to Story
// ============================================================
async function saveMoment() {
  if (!player || !state.watch?.media_id) {
    showToast('Load something first')
    return
  }
  const t = Math.floor(currentPosition())
  const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0')
  const note = window.prompt(`Save this moment to your Story? (optional note)`, '')
  if (note === null) return
  // Pause both
  applyingRemote = true
  try { safePause() } finally { setTimeout(() => { applyingRemote = false }, 200) }
  broadcastState({ is_playing: false })
  persistNow()

  const label = labelFor(state.watch.source, state.watch.media_id)
  const title = `Watching together — ${label} @ ${mm}:${ss}`
  if (configured) {
    try {
      await db.insertMilestone({
        date: new Date().toISOString().split('T')[0],
        title,
        note: note || `A moment we shared.`,
      })
      broadcastMoment(title)
      showToast('Saved to your Story 💫')
    } catch (e) {
      console.error(e); showToast('Could not save: ' + e.message)
    }
  } else {
    showToast('Connection needed to save moments')
  }
}

// ============================================================
// QUEUE MANAGEMENT
// ============================================================
function ensureQueue() {
  if (!state.watch) state.watch = { queue: [] }
  if (!Array.isArray(state.watch.queue)) state.watch.queue = []
  return state.watch.queue
}

function addToQueue(url) {
  const parsed = parseUrl(url)
  if (!parsed) { showToast('Unsupported URL'); return false }
  const q = ensureQueue()
  const item = { url, source: parsed.source, mediaId: parsed.mediaId, label: labelFor(parsed.source, parsed.mediaId) }
  q.push(item)
  if (configured) db.updateWatchQueue(q).catch(console.error)
  broadcastQueue(q, item)
  renderQueue()
  return true
}

function removeFromQueue(idx) {
  const q = ensureQueue()
  q.splice(idx, 1)
  if (configured) db.updateWatchQueue(q).catch(console.error)
  broadcastQueue(q)
  renderQueue()
}

function renderQueue() {
  const list = document.getElementById('watch-queue')
  if (!list) return
  const q = state.watch?.queue || []
  list.innerHTML = ''
  if (!q.length) {
    list.innerHTML = '<div class="queue-empty">Queue empty — add another to line up next.</div>'
    return
  }
  q.forEach((item, i) => {
    const row = document.createElement('div')
    row.className = 'queue-row'
    row.innerHTML = `
      <span class="q-num">${i + 1}.</span>
      <span class="q-label">${escapeHtml(item.label || item.url)}</span>
      <button class="q-play"   title="Play now">▶</button>
      <button class="q-remove" title="Remove">×</button>`
    row.querySelector('.q-play').onclick = () => {
      const next = q[i]; const newQ = q.slice(0, i).concat(q.slice(i + 1))
      state.watch.queue = newQ
      loadFromUrl(next.url, { advanceQueue: false, persistedQueue: newQ })
    }
    row.querySelector('.q-remove').onclick = () => removeFromQueue(i)
    list.appendChild(row)
  })
}

// ============================================================
// AI WATCH-NIGHT PICKER
// ============================================================
async function genSuggestions() {
  const out = document.getElementById('watch-suggestions')
  const lo  = document.getElementById('watch-sugg-loading')
  if (!out || !lo) return
  out.innerHTML = ''
  lo.style.display = 'flex'
  try {
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
    const { data, error } = await sb.functions.invoke('suggest-watch-night', {
      body: {
        n1: state.cfg.n1, n2: state.cfg.n2,
        interests: state.cfg.interests || '',
        mood: '',
        apiKey,
      },
    })
    lo.style.display = 'none'
    if (error) throw error
    const items = data?.suggestions || []
    items.forEach(s => {
      const card = document.createElement('div')
      card.className = 'sugg-card'
      card.innerHTML = `
        <div class="sugg-kind">${s.kind || ''}</div>
        <div class="sugg-title">${escapeHtml(s.title)}</div>
        <div class="sugg-why">${escapeHtml(s.why || '')}</div>
        <div class="sugg-actions">
          <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener"
             href="https://www.youtube.com/results?search_query=${encodeURIComponent(s.search || s.title)}">Find on YouTube ↗</a>
        </div>`
      out.appendChild(card)
    })
    if (!items.length) out.innerHTML = '<div class="empty-state">No suggestions returned. Try again.</div>'
  } catch (e) {
    lo.style.display = 'none'
    out.innerHTML = `<div class="empty-state">Couldn't suggest: ${escapeHtml(e.message || String(e))}</div>`
  }
}

// ============================================================
// TOAST + LABEL HELPERS
// ============================================================
function showToast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(showToast._tm)
  showToast._tm = setTimeout(() => t.style.opacity = '0', 2400)
}

function labelFor(source, id) {
  if (source === 'youtube') return `YouTube · ${id}`
  if (source === 'video')   return id.split('/').pop() || 'Video'
  return id || ''
}

// ============================================================
// PUBLIC API
// ============================================================
export function loadFromUrl(url, opts = {}) {
  const parsed = parseUrl(url)
  if (!parsed) return { ok: false, error: 'Unsupported URL — use YouTube or a direct .mp4/.webm link.' }
  const queue = opts.persistedQueue ?? (state.watch?.queue || [])
  state.watch = {
    source:      parsed.source,
    media_id:    parsed.mediaId,
    mediaId:     parsed.mediaId,
    is_playing:  false,
    position:    0,
    position_at: new Date().toISOString(),
    updated_by:  state.me,
    queue,
  }
  loadMedia(parsed.source, parsed.mediaId)
  renderQueue()
  if (configured) {
    db.upsertWatchSession({
      source: parsed.source, media_id: parsed.mediaId,
      is_playing: false, position: 0,
    }).catch(console.error)
    db.updateWatchQueue(queue).catch(console.error)
  }
  broadcastLoad(parsed.source, parsed.mediaId, queue)
  return { ok: true }
}

export function initWatchTab() {
  loadYTApi()
  joinWatchChannel()

  const inp     = document.getElementById('watch-inp')
  const btnLoad = document.getElementById('watch-load')
  const btnQ    = document.getElementById('watch-queue-btn')
  const btnMom  = document.getElementById('watch-moment')
  const btnSugg = document.getElementById('watch-sugg-btn')

  btnLoad?.addEventListener('click', () => {
    const url = inp.value.trim(); if (!url) return
    const r = loadFromUrl(url)
    if (r.ok) inp.value = ''
    else alert(r.error)
  })
  btnQ?.addEventListener('click', () => {
    const url = inp.value.trim(); if (!url) return
    if (addToQueue(url)) inp.value = ''
  })
  inp?.addEventListener('keydown', e => { if (e.key === 'Enter') btnLoad.click() })
  btnMom?.addEventListener('click', saveMoment)
  btnSugg?.addEventListener('click', genSuggestions)

  // Reaction buttons
  document.querySelectorAll('[data-reaction]').forEach(b => {
    b.addEventListener('click', () => broadcastReaction(b.dataset.reaction))
  })

  // Theater toggle
  document.getElementById('watch-theater')?.addEventListener('click', () => {
    const root = document.getElementById('tab-watch')
    root?.classList.toggle('theater')
  })

  // Mini chat input on the player
  const miniInp = document.getElementById('watch-chatmini')
  miniInp?.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return
    const text = miniInp.value.trim(); if (!text) return
    miniInp.value = ''
    emitTyping(false)
    if (configured) {
      try { await db.insertMessage(text) } catch (err) { showToast('Send failed') }
    } else {
      onChatMessage({ partner_idx: state.me, content: text, id: Date.now(), created_at: new Date().toISOString() })
    }
  })
  miniInp?.addEventListener('input', () => {
    emitTyping(true)
    clearTimeout(typingTimer)
    typingTimer = setTimeout(() => emitTyping(false), 1200)
  })

  // Heart-trail cursor over the player
  setupCursorTrail()

  // Auto-pause when this tab is backgrounded mid-playback
  document.addEventListener('visibilitychange', onVisibilityChange)

  if (configured) resumeSession()
  else loadMedia('none', null)
}

function onVisibilityChange() {
  if (!document.hidden) return
  if (!playerIsPlaying()) return
  // Tab backgrounded while playing — pause both sides so nobody watches alone
  applyingRemote = true
  try { safePause() } finally { setTimeout(() => { applyingRemote = false }, 200) }
  broadcastState({ is_playing: false })
  persistNow()
  showToast('Paused — partner notified you stepped away')
}

async function resumeSession() {
  try {
    const ws = await db.fetchWatchSession()
    if (ws && ws.media_id) {
      state.watch = { ...ws, mediaId: ws.media_id, queue: Array.isArray(ws.queue) ? ws.queue : [] }
      loadMedia(ws.source, ws.media_id)
      renderQueue()
    } else {
      state.watch = { queue: [] }
      loadMedia('none', null)
      renderQueue()
    }
  } catch (e) {
    console.error('[watch] resume failed', e)
    loadMedia('none', null)
  }
}

// Kept for compatibility with main.js — the postgres_changes pipe still
// nudges us if a row update arrives outside of the broadcast channel
// (e.g., a partner changed media before joining the channel).
export function onRemoteWatchChange(row) {
  if (!row) return
  if (row.updated_by === state.me) return
  // Only act if this is a media change we haven't seen via broadcast yet
  if (row.media_id && row.media_id !== currentMediaId) {
    state.watch = {
      ...state.watch,
      source:      row.source,
      media_id:    row.media_id,
      mediaId:     row.media_id,
      is_playing:  row.is_playing,
      position:    row.position,
      position_at: row.position_at,
      updated_by:  row.updated_by,
      queue:       Array.isArray(row.queue) ? row.queue : (state.watch?.queue || []),
    }
    loadMedia(row.source, row.media_id)
    renderQueue()
  }
}

export function teardownWatch() {
  destroyPlayer()
  stopPersist()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  leaveChannel()
  currentMediaId = null
  pendingLoad = null
}
