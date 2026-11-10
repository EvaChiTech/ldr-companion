/**
 * Content script entry point.
 *
 * Wires together: room config (chrome.storage) -> Supabase Realtime channel
 * -> SyncEngine -> player adapter -> overlay UI.
 *
 * Runs in all frames, but only the frame that actually owns a <video> element
 * takes over; the others stay inert so we never mount two overlays.
 */

import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_KEY, configured } from './config.js'
import { adapterForPage, siteLabel, NetflixAdapter } from './adapters.js'
import { PageBridge } from './bridge.js'
import { SyncEngine } from './sync.js'
import { Overlay } from './overlay.js'

const STORAGE_KEY = 'ldr_theater_session'
const VIDEO_POLL_MS = 1200

/**
 * Hosts we will follow a partner's link to. A `load` payload arrives over a
 * shared channel, so it is untrusted input: never navigate on it without
 * checking the destination first.
 */
const NAV_ALLOWED = [
  'netflix.com', 'disneyplus.com', 'max.com', 'hbomax.com',
  'hulu.com', 'primevideo.com', 'youtube.com',
]

/** @returns {string|null} the URL if it is safe to navigate to, else null. */
function safeNavUrl(raw) {
  let u
  try { u = new URL(String(raw)) } catch { return null }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()
  const ok = NAV_ALLOWED.some(d => host === d || host.endsWith(`.${d}`))
  return ok ? u.href : null
}

let session  = null   // { room, me, name, partnerName, enabled }
let sb       = null
let channel  = null
let adapter  = null
let bridge   = null
let engine   = null
let overlay  = null
let pollTimer = null
let bufferTimer = null
let healthTimer = null
let urlTimer = null
let started  = false
let lastUrl  = location.href

// ------------------------------------------------------------------
// boot
// ------------------------------------------------------------------
init().catch(err => console.warn('[LDR Theater] init failed:', err))

async function init() {
  if (window.__ldrTheaterLoaded) return
  window.__ldrTheaterLoaded = true

  session = await readSession()
  chrome.storage.onChanged.addListener(onStorageChanged)
  watchUrlChanges()

  if (session?.enabled && session.room) await tryStart()
}

function readSession() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(STORAGE_KEY, obj => resolve(obj?.[STORAGE_KEY] || null))
    } catch { resolve(null) }
  })
}

function onStorageChanged(changes, area) {
  if (area !== 'local' || !changes[STORAGE_KEY]) return
  const next = changes[STORAGE_KEY].newValue || null
  const roomChanged = next?.room !== session?.room || next?.me !== session?.me
  session = next

  if (!session?.enabled || !session.room) { teardown(); return }
  if (roomChanged) { teardown(); tryStart(); return }
  if (!started) tryStart()
}

/**
 * Only the frame holding a real video participates. Poll because streaming
 * SPAs mount their player well after document_idle.
 */
async function tryStart() {
  if (started || !session?.enabled || !session.room) return
  if (!configured) {
    console.warn('[LDR Theater] Supabase credentials missing from this build.')
    return
  }

  bridge  = new PageBridge()
  adapter = adapterForPage(bridge)

  // Only Netflix needs the page bridge; skip injection elsewhere.
  if (adapter instanceof NetflixAdapter) {
    await bridge.init({ probe: 'netflix.probe' }).catch(() => false)
  }

  if (!pollTimer) pollTimer = setInterval(pollForVideo, VIDEO_POLL_MS)
  pollForVideo()
}

function pollForVideo() {
  if (started || !session?.enabled) return
  adapter.refresh()
  if (!adapter.isReady()) return

  clearInterval(pollTimer); pollTimer = null
  startSession()
}

function startSession() {
  started = true

  sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    realtime: { params: { eventsPerSecond: 12 } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  overlay = new Overlay({
    partnerName: session.partnerName || null,
    onSend:  text => sendChat(text),
    onReact: emoji => { send('reaction', { from: session.me, emoji }); overlay.spawnReaction(emoji) },
    onTyping: on => send('typing', { from: session.me, typing: on }),
    onToggleFollow: following => engine?.setFollowing(following),
  })
  overlay.mount()
  overlay.setStatus('Connecting…', 'away')

  engine = new SyncEngine({
    send,
    adapter,
    me: session.me,
    onStatus: renderStatus,
  })

  joinChannel()
  engine.start()
  startBufferWatch()
  startHealthWatch()
}

// ------------------------------------------------------------------
// realtime channel
// ------------------------------------------------------------------
function joinChannel() {
  // Distinct namespace from the web app's in-app player ("watch:<room>") so the
  // two features never cross-talk.
  channel = sb.channel(`theater:${session.room}`, {
    config: {
      broadcast: { self: false, ack: false },
      presence:  { key: String(session.me) },
    },
  })

  channel
    .on('broadcast', { event: 'state' },      ({ payload }) => engine.handleState(payload))
    .on('broadcast', { event: 'tick' },       ({ payload }) => engine.handleTick(payload))
    .on('broadcast', { event: 'clock_ping' }, ({ payload }) => engine.handleClockPing(payload))
    .on('broadcast', { event: 'clock_pong' }, ({ payload }) => engine.handleClockPong(payload))
    .on('broadcast', { event: 'load' },       ({ payload }) => onRemoteLoad(payload))
    .on('broadcast', { event: 'chat' },       ({ payload }) => onRemoteChat(payload))
    .on('broadcast', { event: 'reaction' },   ({ payload }) => onRemoteReaction(payload))
    .on('broadcast', { event: 'typing' },     ({ payload }) => onRemoteTyping(payload))
    .on('broadcast', { event: 'buffer' },     ({ payload }) => onRemoteBuffer(payload))
    .on('presence',  { event: 'sync' },       () => {
      const st = channel.presenceState() || {}
      const peer = Object.keys(st).some(k => k !== String(session.me))
      engine.setPeerPresent(peer)
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') {
        channel.track({ seat: session.me, name: session.name || null, t: Date.now() })
        overlay.setStatus('Waiting for partner…', 'away')
        // Announce where we are so an already-watching peer can line us up.
        setTimeout(() => { announceLoad(); engine.broadcastState() }, 400)
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        overlay.setStatus('Connection lost', 'error')
      }
    })
}

function send(event, payload) {
  if (!channel) return
  try { channel.send({ type: 'broadcast', event, payload }) } catch {}
}

// ------------------------------------------------------------------
// chat / reactions / buffering
// ------------------------------------------------------------------
function sendChat(text) {
  send('chat', { from: session.me, name: session.name || null, text, t: Date.now() })
  overlay.addMessage({ text, who: session.name || 'You', mine: true })
}

// ------------------------------------------------------------------
// "they picked something" -> offer to open the same thing
// ------------------------------------------------------------------

/** Our media key as last announced, so we only broadcast real changes. */
let lastAnnounced = null
let navigating = false
/** Last `load` the partner sent: { media, title, url } with url already vetted. */
let peerLoad = null

/**
 * Single owner of the mismatch bar, so the status renderer and the load handler
 * can't overwrite each other's version of it.
 * @returns {boolean} true if the two sides are on different media.
 */
function refreshMismatch() {
  const mine = adapter?.mediaKey()
  const theirs = peerLoad?.media || engine?.lastPeerState?.media
  if (!mine || !theirs || mine === theirs) { overlay.setMismatch(null); return false }

  const title = peerLoad?.title || engine?.lastPeerState?.title || null
  if (!title) { overlay.setMismatch(null); return true }

  // Offer the one-tap open only when we have a destination we trust.
  if (peerLoad?.url && peerLoad.media === theirs) {
    overlay.setMismatch(title, () => goTo(peerLoad.url, title))
  } else {
    overlay.setMismatch(title)
  }
  return true
}

function announceLoad() {
  if (!adapter?.isReady()) return
  const key = adapter.mediaKey()
  if (!key || key === lastAnnounced) return
  lastAnnounced = key
  send('load', {
    from:  session.me,
    media: key,
    title: adapter.title(),
    url:   location.href,
    t:     Date.now(),
  })
}

function onRemoteLoad(p) {
  if (p.from === session.me || navigating || !p.media) return

  peerLoad = {
    media: p.media,
    title: String(p.title || 'something').slice(0, 120),
    url:   safeNavUrl(p.url),   // null if we can't vouch for the destination
  }

  // Already watching the same thing - nothing to offer.
  const mine = adapter?.mediaKey()
  if (mine && p.media === mine) { overlay.setMismatch(null); return }

  if (peerLoad.url && session.autoFollow) { goTo(peerLoad.url, peerLoad.title); return }

  overlay.addMessage({
    text: `${session.partnerName || 'Partner'} started "${peerLoad.title}"`,
    system: true,
  })
  refreshMismatch()
}

/**
 * Navigate this browser to the partner's title. Their stream is not shared -
 * this just puts us on the same page so our own account loads its own copy.
 */
function goTo(url, title) {
  navigating = true
  overlay.setOpening(title)
  // Let the notice paint before we tear the page down.
  setTimeout(() => { location.assign(url) }, 120)
}

function onRemoteChat(p) {
  if (p.from === session.me) return
  overlay.addMessage({
    text: String(p.text || '').slice(0, 500),
    who:  p.name || session.partnerName || 'Partner',
    mine: false,
  })
  overlay.setPeerTyping(false)
}

function onRemoteReaction(p) {
  if (p.from === session.me) return
  overlay.spawnReaction(String(p.emoji || '❤️').slice(0, 8))
}

function onRemoteTyping(p) {
  if (p.from === session.me) return
  overlay.setPeerTyping(Boolean(p.typing), p.name || session.partnerName)
}

let peerBuffering = false
function onRemoteBuffer(p) {
  if (p.from === session.me) return
  peerBuffering = Boolean(p.buffering)
  // Courtesy pause: don't let one person watch ahead through the other's stall.
  if (peerBuffering && adapter.isPlaying() && !engine.paused) {
    engine.applyingRemote = true
    try { adapter.pause() } finally { setTimeout(() => { engine.applyingRemote = false }, 250) }
  }
  // Fall back to live engine state so a buffer event arriving before the first
  // status update doesn't momentarily report the peer as absent.
  renderStatus(engine.lastStatus || { peerPresent: engine.peerPresent, following: !engine.paused })
}

/**
 * These sites can tear down and rebuild the <video> element without changing
 * the URL (next episode, ad break, quality switch). Re-resolve periodically so
 * sync recovers instead of silently driving a detached element.
 */
function startHealthWatch() {
  if (healthTimer) clearInterval(healthTimer)
  healthTimer = setInterval(() => {
    if (!started || !adapter) return
    const stale = !adapter.video || !adapter.video.isConnected
    if (stale && adapter.refresh() && adapter.isReady()) {
      myBuffering = false
      setTimeout(() => { announceLoad(); engine?.broadcastState() }, 400)
    }
  }, 1500)
}

let myBuffering = false
function startBufferWatch() {
  if (bufferTimer) clearInterval(bufferTimer)
  bufferTimer = setInterval(() => {
    if (!adapter) return
    const b = adapter.isBuffering()
    if (b !== myBuffering) {
      myBuffering = b
      send('buffer', { from: session.me, buffering: b })
    }
  }, 700)
}

// ------------------------------------------------------------------
// status rendering
// ------------------------------------------------------------------
function renderStatus(s) {
  if (!overlay) return
  engine.lastStatus = s

  if (!s.peerPresent) {
    overlay.setStatus(`Waiting on ${session.partnerName || 'partner'}…`, 'away')
    overlay.setMismatch(null)
    return
  }
  if (!s.following) { overlay.setStatus('Sync paused', 'away'); return }
  if (peerBuffering) { overlay.setStatus('Partner buffering…', 'away'); return }
  if (myBuffering)   { overlay.setStatus('Buffering…', 'away'); return }

  // Flag a genuine media mismatch (both sides identified, and different).
  if (refreshMismatch()) {
    overlay.setStatus('Different episode', 'error')
    return
  }

  const drift = typeof s.drift === 'number' ? Math.abs(s.drift) : 0
  overlay.setStatus(
    drift > 0.4 ? `In sync · ${drift.toFixed(1)}s` : `In sync · ${siteLabel()}`,
    'live',
  )
}

// ------------------------------------------------------------------
// SPA navigation
// ------------------------------------------------------------------
function watchUrlChanges() {
  if (urlTimer) clearInterval(urlTimer)
  urlTimer = setInterval(() => {
    if (location.href === lastUrl) return
    lastUrl = location.href
    if (!started || !adapter) return
    // New episode/title in the same tab: re-resolve the element and resync.
    if (adapter.refresh()) {
      myBuffering = false
      setTimeout(() => { announceLoad(); engine?.broadcastState() }, 600)
    }
  }, 900)
}

// ------------------------------------------------------------------
// teardown
// ------------------------------------------------------------------
function teardown() {
  for (const t of [pollTimer, bufferTimer, healthTimer]) if (t) clearInterval(t)
  pollTimer = bufferTimer = healthTimer = null
  engine?.stop()
  overlay?.unmount()
  bridge?.destroy()
  if (channel && sb) { try { sb.removeChannel(channel) } catch {} }
  channel = null; sb = null; engine = null; overlay = null; adapter = null; bridge = null
  started = false
  peerBuffering = false; myBuffering = false
}

window.addEventListener('pagehide', teardown)
