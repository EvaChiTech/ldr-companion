// ============================================================
// DAY IN THE LIFE — an hourly nudge to film six seconds of whatever you're
// doing. At the end of the day the clips play back-to-back as one reel, so you
// each get the ordinary hours of the other's day rather than the highlights.
//
// Private by construction: clips are ordinary vlog rows, so they inherit the
// room's existing RLS and live only between the two of you. Nothing is shared
// outward and there is no feed.
//
// ZERO SCHEMA: reuses the `vlogs` table, tagging each clip's caption with a
// marker prefix. Tagging in caption rather than adding a column keeps this
// additive — the vlog tab simply shows them as clips, which they are.
//
// On "stitching": the clips are played in sequence rather than re-encoded into
// a single file. True concatenation in the browser means decoding and
// re-encoding every clip (clips recorded hours apart often differ in codec,
// resolution and frame rate, so a naive byte-join produces a broken file).
// Sequential playback gives the same experience without that cost or risk.
// ============================================================

import { state } from './state.js'
import { configured } from './supabase.js'
import * as db from './db.js'
import { notify } from './notify.js'
import { createScope } from './lifecycle.js'

// Same guard the album, glance and puzzle use: a `vlogs` row could carry any
// URL, so never hand one to a <video> without checking it came from us.
const SUPABASE_ORIGIN = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL).origin } catch { return '' }
})()
function isSafeMediaUrl(url) {
  try {
    const u = new URL(String(url))
    return u.protocol === 'https:' && !!SUPABASE_ORIGIN && u.origin === SUPABASE_ORIGIN
  } catch { return false }
}

const TAG = '[day]'              // caption marker identifying a day clip
const CLIP_MS = 6000             // how long a clip records before auto-stopping
const PING_KEY = 'ldr_dayinlife_on'
const LAST_PING_KEY = 'ldr_dayinlife_last'

const scope = createScope()
let inited = false
let els = {}
let stream = null
let recorder = null
let chunks = []
let stopTimer = null
let tickTimer = null
let clips = []
let reel = null                  // { list, i } while a reel is playing

const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const pingsOn = () => localStorage.getItem(PING_KEY) === '1'

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const hourLabel = iso =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

// ============================================================
// HOURLY PING
// ============================================================
/**
 * Checked on a one-minute timer rather than scheduled an hour ahead: a
 * setTimeout that long dies with the tab, and this way a reopened tab catches
 * up immediately. Fires at most once per clock hour.
 */
function startPingLoop() {
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = setInterval(maybePing, 60000)
  maybePing()
}

function maybePing() {
  if (!pingsOn()) return
  const now = new Date()
  const stamp = `${todayKey(now)}T${now.getHours()}`
  if (localStorage.getItem(LAST_PING_KEY) === stamp) return

  // Don't wake anyone in the small hours.
  const h = now.getHours()
  if (h < 8 || h > 22) return

  localStorage.setItem(LAST_PING_KEY, stamp)
  notify('What are you up to?', 'Six seconds of right now — for them.', { tag: 'dayinlife' })
  els.hint?.classList.remove('hidden')
}

function togglePings() {
  const on = !pingsOn()
  localStorage.setItem(PING_KEY, on ? '1' : '0')
  renderPingState()
  if (on) startPingLoop()
}

function renderPingState() {
  if (!els.pingBtn) return
  const on = pingsOn()
  els.pingBtn.textContent = on ? 'Hourly nudges on' : 'Nudge me hourly'
  els.pingBtn.classList.toggle('is-on', on)
}

// ============================================================
// RECORDING
// ============================================================
async function startClip() {
  if (recorder) return
  els.err.textContent = ''

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 720 } },
      audio: true,
    })
  } catch {
    els.err.textContent = 'Camera access was blocked.'
    return
  }

  els.preview.srcObject = stream
  els.preview.muted = true
  els.previewWrap.classList.remove('hidden')
  try { await els.preview.play() } catch {}

  chunks = []
  const mime = pickMime()
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  } catch {
    els.err.textContent = 'This browser cannot record video.'
    releaseStream()
    return
  }

  recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data) }
  recorder.onstop = onRecorderStop
  recorder.start()

  els.recBtn.classList.add('is-rec')
  els.recBtn.textContent = 'Recording…'
  startCountdown()
  stopTimer = setTimeout(stopClip, CLIP_MS)
}

/** Prefer a codec Safari can also play back. */
function pickMime() {
  const want = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm']
  return want.find(m => MediaRecorder.isTypeSupported?.(m)) || ''
}

function stopClip() {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null }
  if (recorder && recorder.state !== 'inactive') { try { recorder.stop() } catch {} }
}

async function onRecorderStop() {
  const type = recorder?.mimeType || 'video/webm'
  recorder = null
  releaseStream()
  els.recBtn.classList.remove('is-rec')
  els.recBtn.textContent = 'Film six seconds'
  els.previewWrap.classList.add('hidden')
  stopCountdown()

  const blob = new Blob(chunks, { type })
  chunks = []
  if (!blob.size) return
  if (!configured) { els.err.textContent = 'Connection needed to save that.'; return }

  els.status.textContent = 'Saving…'
  try {
    const ext = type.includes('mp4') ? 'mp4' : 'webm'
    const url = await db.uploadVlog(blob, { partnerIdx: state.me, ext })
    await db.insertVlog({
      video_url: url,
      caption: `${TAG} ${new Date().toLocaleTimeString(undefined, { hour: 'numeric' })}`,
      duration_s: Math.round(CLIP_MS / 1000),
      recorded_tz: state.myTz?.() || null,
      orientation: 'portrait',
    })
    els.status.textContent = 'Added to today ✓'
    els.hint?.classList.add('hidden')
    await loadClips()
  } catch (err) {
    els.status.textContent = ''
    els.err.textContent = err?.message || 'Could not save that clip.'
  }
}

function releaseStream() {
  if (stream) { for (const t of stream.getTracks()) { try { t.stop() } catch {} } }
  stream = null
  if (els.preview) els.preview.srcObject = null
}

let countFrom = 0
let countTimer = null
function startCountdown() {
  countFrom = Math.round(CLIP_MS / 1000)
  els.count.textContent = String(countFrom)
  els.count.classList.remove('hidden')
  countTimer = setInterval(() => {
    countFrom -= 1
    els.count.textContent = String(Math.max(0, countFrom))
  }, 1000)
}
function stopCountdown() {
  if (countTimer) { clearInterval(countTimer); countTimer = null }
  els.count?.classList.add('hidden')
}

// ============================================================
// TODAY'S CLIPS + REEL
// ============================================================
async function loadClips() {
  if (!configured) return
  let rows = []
  try { rows = await db.fetchVlogs() } catch { return }

  const key = todayKey()
  clips = rows
    .filter(r => String(r.caption || '').startsWith(TAG))
    .filter(r => isSafeMediaUrl(r.video_url))
    .filter(r => todayKey(new Date(r.recorded_at || r.created_at)) === key)
    .sort((a, b) => new Date(a.recorded_at || a.created_at) - new Date(b.recorded_at || b.created_at))

  renderClips()
}

function renderClips() {
  if (!els.list) return
  if (!clips.length) {
    els.list.innerHTML = '<div class="dl-none">No clips yet today. Film the first one.</div>'
    els.playBtn.classList.add('hidden')
    return
  }
  const mine = clips.filter(c => c.partner_idx === state.me).length
  els.list.innerHTML = clips.map(c => {
    const who = c.partner_idx === state.me ? 'You' : (state.theirName?.() || 'Partner')
    return `<div class="dl-chip" title="${esc(who)}">
              <b>${esc(hourLabel(c.recorded_at || c.created_at))}</b>
              <span>${esc(who)}</span>
            </div>`
  }).join('')
  els.playBtn.classList.remove('hidden')
  els.playBtn.textContent = `Play the day (${clips.length})`
  els.status.textContent = `${clips.length} clip${clips.length === 1 ? '' : 's'} today · ${mine} from you`
}

/** Play every clip of the day back-to-back. */
function playReel() {
  if (!clips.length) return
  reel = { list: [...clips], i: 0 }
  els.reelWrap.classList.remove('hidden')
  els.reelVideo.onended = nextInReel
  els.reelVideo.onerror = nextInReel
  playCurrent()
}

function playCurrent() {
  if (!reel || reel.i >= reel.list.length) { endReel(); return }
  const c = reel.list[reel.i]
  // Defensive: the list is filtered on load, but never trust it twice.
  if (!isSafeMediaUrl(c.video_url)) { nextInReel(); return }
  els.reelLabel.textContent =
    `${hourLabel(c.recorded_at || c.created_at)} · ${c.partner_idx === state.me ? 'you' : (state.theirName?.() || 'them')}`
  els.reelVideo.src = c.video_url
  els.reelVideo.play().catch(() => { /* leave controls for a manual start */ })
}

function nextInReel() {
  if (!reel) return
  reel.i += 1
  playCurrent()
}

function endReel() {
  reel = null
  els.reelVideo.onended = null
  els.reelVideo.onerror = null
  try { els.reelVideo.pause() } catch {}
  els.reelVideo.removeAttribute('src')
  els.reelWrap.classList.add('hidden')
}

// ============================================================
// LIFECYCLE
// ============================================================
export async function initDayInLife() {
  if (inited) return
  els = {
    card:       $('dl-card'),
    recBtn:     $('dl-rec'),
    pingBtn:    $('dl-ping'),
    playBtn:    $('dl-play'),
    list:       $('dl-list'),
    status:     $('dl-status'),
    err:        $('dl-err'),
    hint:       $('dl-hint'),
    previewWrap:$('dl-preview-wrap'),
    preview:    $('dl-preview'),
    count:      $('dl-count'),
    reelWrap:   $('dl-reel-wrap'),
    reelVideo:  $('dl-reel'),
    reelLabel:  $('dl-reel-label'),
    reelClose:  $('dl-reel-close'),
  }
  if (!els.card) return
  inited = true

  scope.on(els.recBtn,    'click', () => (recorder ? stopClip() : startClip()))
  scope.on(els.pingBtn,   'click', togglePings)
  scope.on(els.playBtn,   'click', playReel)
  scope.on(els.reelClose, 'click', endReel)

  renderPingState()
  if (pingsOn()) startPingLoop()
  await loadClips()
}

/** A new vlog row arrived over realtime — it may be today's clip from them. */
export function onDayInLifeUpdate() { if (inited) loadClips() }

export function teardownDayInLife() {
  scope.destroy()
  stopClip()
  releaseStream()
  stopCountdown()
  endReel()
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
  clips = []
  inited = false
}
