import { state, persistSession, clearSession, loadSession, loadRoomsList, upsertRoomMembership, setActiveRoomCode, getActiveRoomCode, sortedRooms } from './state.js'
import { initRoomsList, showRoomsList, hideRoomsList, refreshRoomsList } from './rooms-list.js'
import { subscribeRoom, unsubscribeRoom } from './realtime.js'
import { generateDateIdeas, streamDateIdeas } from './ai.js'
import { configured } from './supabase.js'
import { tzTime, tzDate, tzDiff, daysBetween, cityLabel } from './clocks.js'
import * as db from './db.js'
import { initWatchTab, onRemoteWatchChange, teardownWatch, onChatMessage as watchOnChat } from './watch.js'
import { initTogetherTab, teardownTogether } from './together.js'
import { initRitualsTab, teardownRituals, onRemoteRitualEvent } from './rituals.js'
import { initMemoryBook, teardownMemory } from './memory.js'
import { playOnlineChime, playOfflineChime, initSoundToggle } from './sound.js'
import { initHeartbeat, teardownHeartbeat } from './heartbeat.js'
import { initSoundCapsules, teardownSoundCapsules, onRemoteCapsule } from './sounds.js'
import { initHarmony, teardownHarmony } from './harmony.js'
import { initReunion, teardownReunion, onRemoteReunionEvent } from './reunion.js'
import { initLetters, teardownLetters, onRemoteLetter } from './letters.js'
import { initDreams, teardownDreams, onRemoteDream } from './dreams.js'
import { initLife, teardownLife, onRemoteLifeEvent } from './life.js'
import { initAnniversary, teardownAnniversary } from './anniversary.js'
import { initCoach, teardownCoach } from './coach.js'
import { initTone, teardownTone } from './tone.js'
import { initMiniGame, teardownMiniGame } from './minigame.js'
import { initHistory, teardownHistory } from './history.js'
import { initWrapped, teardownWrapped } from './wrapped.js'
import { initMoodViz, teardownMoodViz } from './mood-viz.js'
import { initLocalCare, teardownLocalCare, setPartnerMood } from './localcare.js'
import { initAuth, initAccountButton, pushRoomLink, deleteRoomLink, isSignedIn, onAuthChange } from './auth.js'
import { initNotifications, notify, enableNotifications, disableNotifications, notifPref, pushToPartner } from './notify.js'
import { initPolish } from './polish.js'
import { initAnalytics, track } from './analytics.js'
import { initI18n, t } from './i18n.js'
import { maybeShowWelcome, showWelcomeForce } from './welcome.js'
import { initErrorMonitor } from './errors.js'
import { initAlbum, teardownAlbum, onRemoteAlbumUpdate } from './album.js'
import { initVlog, teardownVlog, onRemoteVlog } from './vlog.js'
import { initLegal, requireConsent } from './legal.js'
import { initDarkToggle, exportThisRoom, shareRoom } from './preferences.js'
import { initStats, refreshStats, teardownStats } from './stats.js'
import { inject as injectVercelAnalytics } from '@vercel/analytics'
import '@fontsource/dm-sans/300.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/300-italic.css'
import '@fontsource/cormorant-garamond/400.css'
import '@fontsource/cormorant-garamond/500.css'
import '@fontsource/cormorant-garamond/400-italic.css'
import '@fontsource/cormorant-garamond/500-italic.css'
injectVercelAnalytics()

// Refuse to render any media URL that isn't from our own Supabase origin —
// a row in a (previously open-RLS) table could have carried an attacker URL.
const SUPABASE_ORIGIN = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL).origin } catch { return '' }
})()
function isSafeMediaUrl(url) {
  try {
    const u = new URL(String(url))
    return u.protocol === 'https:' && !!SUPABASE_ORIGIN && u.origin === SUPABASE_ORIGIN
  } catch { return false }
}


// ============================================================
// TIMEZONE DATA — defaults to Seoul + Helsinki (Emeka & Aino)
// ============================================================
const TZ = [
  ["Seoul, South Korea",   "Asia/Seoul"],
  ["Busan, South Korea",   "Asia/Seoul"],
  ["Helsinki, Finland",    "Europe/Helsinki"],
  ["Lagos, Nigeria",       "Africa/Lagos"],
  ["Tokyo, Japan",         "Asia/Tokyo"],
  ["London, UK",           "Europe/London"],
  ["New York, USA",        "America/New_York"],
  ["Los Angeles, USA",     "America/Los_Angeles"],
  ["Chicago, USA",         "America/Chicago"],
  ["Toronto, Canada",      "America/Toronto"],
  ["São Paulo, Brazil",    "America/Sao_Paulo"],
  ["Paris, France",        "Europe/Paris"],
  ["Berlin, Germany",      "Europe/Berlin"],
  ["Amsterdam",            "Europe/Amsterdam"],
  ["Stockholm, Sweden",    "Europe/Stockholm"],
  ["Copenhagen, Denmark",  "Europe/Copenhagen"],
  ["Oslo, Norway",         "Europe/Oslo"],
  ["Moscow, Russia",       "Europe/Moscow"],
  ["Dubai, UAE",           "Asia/Dubai"],
  ["Mumbai/Kolkata, India","Asia/Kolkata"],
  ["Bangkok, Thailand",    "Asia/Bangkok"],
  ["Singapore",            "Asia/Singapore"],
  ["Hong Kong",            "Asia/Hong_Kong"],
  ["Beijing / Shanghai",   "Asia/Shanghai"],
  ["Sydney, Australia",    "Australia/Sydney"],
  ["Auckland, NZ",         "Pacific/Auckland"],
  ["Honolulu, Hawaii",     "Pacific/Honolulu"],
  ["Nairobi, Kenya",       "Africa/Nairobi"],
  ["Cairo, Egypt",         "Africa/Cairo"],
  ["Johannesburg, SA",     "Africa/Johannesburg"],
  ["Accra, Ghana",         "Africa/Accra"],
  ["Buenos Aires",         "America/Argentina/Buenos_Aires"],
]

const MOODS = ["Happy 😊", "Missing you 💭", "Peaceful 🌿", "Lonely 🌧", "Grateful 🙏", "Excited ✨"]

// ── DOM shortcuts ──────────────────────────────────────────
const $ = id => document.getElementById(id)

// Escape user/DB-sourced strings before they touch innerHTML.
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
))

// ── Toast ──────────────────────────────────────────────────
let toastTimer = null
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.style.opacity = '1'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.style.opacity = '0', 2800)
}

// ============================================================
// ONBOARDING
// ============================================================
function obShow(id) {
  ['ob-land','ob-create','ob-join','ob-pick'].forEach(s => {
    const e = $(s); if (e) e.style.display = 'none'
  })
  $(id).style.display = 'block'
}

function initSelects() {
  ;['c-tz1','c-tz2'].forEach((id, i) => {
    const s = $(id)
    TZ.forEach(([label, val]) => {
      const o = document.createElement('option')
      o.value = val; o.textContent = label
      if (val === (i === 0 ? 'Asia/Seoul' : 'Europe/Helsinki')) o.selected = true
      s.appendChild(o)
    })
  })
}

function genCode() {
  // RLS now gates access by room_members, not by code, so the code only
  // needs to be unguessable enough to resist remote enumeration of a single
  // room (an attacker still has to be added as a member via join_room).
  // 8 chars over a 32-symbol unambiguous alphabet ≈ 1.1 trillion combos.
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint32Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => c[b % c.length]).join('')
}

async function createRoom() {
  const n1 = $('c-n1').value.trim(), n2 = $('c-n2').value.trim()
  const since = $('c-since').value
  const err = $('c-err')

  if (!n1 || !n2) { err.textContent = 'Please enter both names.'; err.style.display = 'block'; return }
  if (!since)     { err.textContent = 'Please enter your start date.'; err.style.display = 'block'; return }
  err.style.display = 'none'

  const customRaw = ($('c-code')?.value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '')
  let code = customRaw || genCode()
  if (customRaw && customRaw.length < 4) {
    err.textContent = 'Custom code must be at least 4 characters (A–Z, 0–9, _ or -).'
    err.style.display = 'block'; return
  }

  const cfg = {
    id:        code,
    room_code: code,
    n1, n2,
    tz1:       $('c-tz1').value,
    tz2:       $('c-tz2').value,
    since,
    visit:     $('c-visit').value || null,
    interests: $('c-interests').value.trim(),
    kind:      $('c-kind')?.value  || 'couple',
    theme:     $('c-theme')?.value || 'warm',
    alias:     ($('c-alias')?.value || '').trim() || null,
  }

  if (configured) {
    try {
      // create_room RPC inserts the room and records us as partner 1.
      // It raises if the custom code is taken — no separate existence check.
      const room = await db.createRoom(cfg)
      state.cfg = room || cfg
    } catch (e) {
      err.textContent = /already exists/i.test(e.message || '')
        ? 'That code is taken — try another, or leave it blank for an auto-generated one.'
        : 'Could not create room: ' + (e.message || 'unknown error')
      err.style.display = 'block'; return
    }
  } else {
    state.cfg = cfg
  }

  state.room = code; state.me = 1
  upsertRoomMembership({ code, me: 1, alias: cfg.alias, kind: cfg.kind, theme: cfg.theme })
  setActiveRoomCode(code)
  if (isSignedIn()) pushRoomLink({ code, me: 1, alias: cfg.alias, kind: cfg.kind, theme: cfg.theme }).catch(console.error)
  track('room_created', { kind: cfg.kind, theme: cfg.theme, custom_code: !!customRaw })
  startApp()
  toast('Room created! Code: ' + code + ' — share it with the other person')
  setTimeout(() => maybeShowWelcome(), 600)
}

async function joinRoom() {
  // Normalize the partner's input the same way createRoom normalizes its
  // custom-code input (uppercase + strip everything outside A-Z 0-9 _ -),
  // otherwise a code containing characters the keyboard auto-inserted
  // (curly quotes, em-dashes, accidental spaces) becomes unjoinable. The
  // minimum length must also match createRoom's, otherwise short custom
  // codes like "AEIOU" can be created but never joined.
  const code = ($('j-code').value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '')
  const err = $('j-err')
  if (code.length < 4) { err.textContent = 'Please enter a valid room code (4+ characters).'; err.style.display = 'block'; return }
  if (!configured)     { err.textContent = 'Connection not configured — add your project keys to .env first.'; err.style.display = 'block'; return }

  try {
    // preview_room RPC: shows names/cities without joining yet.
    const data = await db.previewRoom(code)
    state.cfg = data; state.room = code
    $('pk-n1').textContent = data.n1; $('pk-tz1').textContent = cityLabel(data.tz1)
    $('pk-n2').textContent = data.n2; $('pk-tz2').textContent = cityLabel(data.tz2)
    obShow('ob-pick')
  } catch {
    err.textContent = 'Room not found. Check the code and try again.'
    err.style.display = 'block'
  }
}

async function pickPartner(p) {
  state.me = p
  if (configured) {
    try {
      // join_room RPC records membership, then returns the full room row.
      const room = await db.joinRoom(state.room, p)
      if (room) state.cfg = room
    } catch (e) {
      // Translate raw Postgres errors into user-readable messages.
      // The most common one — duplicate (room_id, user_id) on rejoin —
      // is harmless and means we're already a member; fall through.
      const msg = String(e?.message || '')
      if (/duplicate key.*room_members_pkey/i.test(msg)) {
        // Already a member; treat as success.
      } else if (/duplicate key.*partner_idx/i.test(msg)) {
        toast('That partner slot has been taken on another device. Try the other one.')
        return
      } else if (/room not found/i.test(msg)) {
        toast('Room not found. Double-check the code with your partner.')
        return
      } else {
        toast('Could not join room. Please try again in a moment.')
        console.warn('[main] joinRoom failed:', msg)
        return
      }
    }
  }
  upsertRoomMembership({
    code: state.room, me: p,
    alias: state.cfg?.alias, kind: state.cfg?.kind, theme: state.cfg?.theme,
  })
  setActiveRoomCode(state.room)
  if (isSignedIn()) pushRoomLink({
    code: state.room, me: p,
    alias: state.cfg?.alias, kind: state.cfg?.kind, theme: state.cfg?.theme,
  }).catch(console.error)
  track('room_joined', { partner_idx: p, kind: state.cfg?.kind })
  startApp()
  setTimeout(() => maybeShowWelcome(), 600)
}

// ============================================================
// APP BOOT
// ============================================================
function startApp() {
  const { cfg } = state
  $('onboarding').style.display = 'none'
  hideRoomsList()
  $('main-app').style.display   = 'block'

  // Apply per-room theme
  document.body.dataset.theme = cfg?.theme || 'warm'

  $('hdr-names').textContent      = (cfg.alias && cfg.alias.trim()) || (cfg.n1 + ' & ' + cfg.n2)
  if ($('vi-for-1')) $('vi-for-1').textContent = cfg.n1
  if ($('vi-for-2')) $('vi-for-2').textContent = cfg.n2
  $('room-badge-text').textContent = state.room
  $('h-cname1').textContent        = cfg.n1.toUpperCase()
  $('h-cname2').textContent        = cfg.n2.toUpperCase()
  $('h-city1').textContent         = cityLabel(cfg.tz1)
  $('h-city2').textContent         = cityLabel(cfg.tz2)
  $('h-vi').value                  = cfg.visit || ''
  $('mood-my-lbl').textContent     = 'Your mood'
  $('mood-their-lbl').textContent  = state.theirName() + "'s mood"
  $('note-my-lbl').textContent     = 'YOUR NOTE TODAY'
  $('note-their-lbl').textContent  = state.theirName().toUpperCase() + "'S NOTE"
  $('ms-date').value               = new Date().toISOString().split('T')[0]
  if (cfg.interests) $('ai-inp').value = cfg.interests

  buildMoodPills()
  updateClocks()
  updateCountdown()
  initSoundToggle()
  initNotifToggle()
  initDarkToggle()
  document.getElementById('tour-toggle')?.addEventListener('click', () => showWelcomeForce())
  setInterval(updateClocks, 1000)
  setInterval(updateCountdown, 60000)

  if (configured) {
    subscribeRoom({
      onMessage:        handleIncomingMessage,
      onMood:           () => loadMood(),
      onNote:           () => loadTheirNote(),
      onBucket:         () => loadBucket(),
      onMilestone:      () => loadMilestones(),
      onWatch:          onRemoteWatchChange,
      onDailyAnswer:    () => onRemoteRitualEvent('daily_answer'),
      onSleepEvent:     () => onRemoteRitualEvent('sleep_event'),
      onDailyQuestion:  () => onRemoteRitualEvent('daily_question'),
      onPresenceChange: handlePresenceChange,
      onSoundCapsule:   onRemoteCapsule,
      onReunion:        onRemoteReunionEvent,
      onLetter:         onRemoteLetter,
      onDream:          onRemoteDream,
      onCalendar:       () => onRemoteLifeEvent('calendar'),
      onExpense:        () => onRemoteLifeEvent('expense'),
      onVisa:           () => onRemoteLifeEvent('visa'),
      onCare:           () => onRemoteLifeEvent('care'),
      onVlog:           onRemoteVlog,
    })
    initReunion()
    initHarmony()
    initAnniversary()
    initCoach()
    initTone()
    initHistory()
    initMoodViz()
    initWrapped()
    initLocalCare()
    initStats()
    loadAll()
  } else {
    $('mood-their-val').textContent = 'Connect to sync'
    $('h-theirnote').textContent    = 'Connect to see their note'
    renderMessages()
  }
}

// ============================================================
// CLOCKS
// ============================================================
function updateClocks() {
  const { cfg } = state
  $('h-clock1').textContent = tzTime(cfg.tz1)
  $('h-clock2').textContent = tzTime(cfg.tz2)
  $('h-date1').textContent  = tzDate(cfg.tz1)
  $('h-date2').textContent  = tzDate(cfg.tz2)
  $('h-tdiff').textContent  = tzDiff(cfg.tz1, cfg.tz2)
  $('hdr-days').textContent = daysBetween(cfg.since).toLocaleString() + ' days together'
}

// ============================================================
// COUNTDOWN
// ============================================================
function updateCountdown() {
  const { cfg } = state
  const sl = $('h-cdsl'), vl = $('h-cdvl')
  const since = new Date(cfg.since + 'T00:00:00')
  sl.textContent = since.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

  if (!cfg.visit) {
    $('h-cdnum').textContent = '—'
    $('h-cdsub').textContent = 'Add a visit date above'
    $('h-cdbar').style.width = '0%'
    vl.textContent = ''; return
  }

  const visit = new Date(cfg.visit + 'T00:00:00'), now = new Date()
  const left  = Math.ceil((visit - now) / 86400000)
  const total = Math.ceil((visit - since) / 86400000)

  vl.textContent = visit.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  if (left <= 0) {
    $('h-cdnum').textContent = 'Together!'; $('h-cdsub').textContent = 'Cherish every moment'
    $('h-cdbar').style.width = '100%'; return
  }

  $('h-cdnum').textContent = (left === 1)
    ? Math.ceil((visit - now) / 3600000) + ' hrs'
    : left + ' days'
  $('h-cdsub').textContent = 'until ' + visit.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  $('h-cdbar').style.width = total > 0 ? Math.max(0, Math.min(100, Math.round((total - left) / total * 100))) + '%' : '0%'
}

async function updateVisit() {
  const v = $('h-vi').value; if (!v) return
  state.cfg.visit = v
  if (configured) await db.updateRoomVisit(state.room, v)
  updateCountdown()
  toast('Visit date updated')
}

// ============================================================
// MOOD
// ============================================================
function buildMoodPills() {
  const c = $('mood-my-opts'); c.innerHTML = ''
  MOODS.forEach(m => {
    const b = document.createElement('button')
    b.className = 'mood-btn'; b.textContent = m
    b.onclick = () => {
      document.querySelectorAll('.mood-btn').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      if (configured) db.upsertMood(m).catch(console.error)
      track('mood_set', { mood: m })
    }
    c.appendChild(b)
  })
}

async function loadMood() {
  if (!configured) return
  const data = await db.fetchTodayMoods()
  const my    = data.find(d => d.partner_idx === state.me)
  const their = data.find(d => d.partner_idx === state.theirIdx())
  if (my) document.querySelectorAll('.mood-btn').forEach(b => { if (b.textContent === my.mood) b.classList.add('active') })
  $('mood-their-val').textContent = their ? their.mood : 'Not set yet'
  setPartnerMood(their?.mood || null)
  // Always show "Send something" — partner's mood (if set) just refines suggestions
  const btn = $('mood-send-btn')
  if (btn) btn.style.display = ''
}

// ============================================================
// NOTES
// ============================================================
async function saveNote() {
  const content = $('h-mynote').value
  if (configured) {
    try { await db.upsertNote(content) }
    catch { toast('Could not save note'); return }
  }
  $('note-ok').style.display = 'inline'
  setTimeout(() => $('note-ok').style.display = 'none', 2500)
}

async function loadTheirNote() {
  const el = $('h-theirnote')
  if (!configured) { el.textContent = 'Connect to see their note'; return }
  const content = await db.fetchNote(state.theirIdx())
  el.textContent = content || 'No note yet today...'
}

async function loadMyNote() {
  if (!configured) return
  const content = await db.fetchNote(state.me)
  if (content) $('h-mynote').value = content
}

// ============================================================
// CHAT
// ============================================================
function fmtTs(ts) {
  const d = new Date(ts), n = new Date()
  const same = d.toDateString() === n.toDateString()
  return same
    ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function renderMessages() {
  const c = $('chat-messages'); c.innerHTML = ''
  if (!state.messages.length) {
    c.innerHTML = `<div class="chat-empty">No messages yet.<br>Say something to ${escapeHtml(state.theirName())}...</div>`
    return
  }
  const theirIdxStr = String(state.theirIdx())
  state.messages.forEach(msg => {
    const mine = msg.partner_idx === state.me
    const wrap = Object.assign(document.createElement('div'), { className: 'msg-wrap ' + (mine ? 'mine' : 'theirs') })
    const readByThem = mine && msg.read_by?.[theirIdxStr]
    const metaText = (mine ? 'You' : state.theirName()) + ' · ' + fmtTs(msg.created_at) + (readByThem ? ' · ✓✓ read' : (mine ? ' · ✓ sent' : ''))
    const meta = Object.assign(document.createElement('div'), { className: 'msg-meta' + (readByThem ? ' read' : ''), textContent: metaText })
    const bub  = document.createElement('div'); bub.className = 'msg-bubble'
    if (msg.image_url && isSafeMediaUrl(msg.image_url)) {
      const img = document.createElement('img')
      img.className = 'msg-image'
      img.src = msg.image_url
      img.loading = 'lazy'
      img.alt = 'shared photo'
      img.onclick = () => openLightbox(msg.image_url)
      bub.appendChild(img)
      if (msg.content) {
        const cap = document.createElement('div')
        cap.className = 'msg-caption'
        cap.textContent = msg.content
        bub.appendChild(cap)
      }
    } else {
      bub.textContent = msg.content
    }
    wrap.append(meta, bub); c.appendChild(wrap)
  })
  c.scrollTop = c.scrollHeight
}

function openLightbox(url) {
  let lb = document.getElementById('lightbox')
  if (!lb) {
    lb = document.createElement('div')
    lb.id = 'lightbox'
    lb.className = 'lightbox'
    document.body.appendChild(lb)
    lb.addEventListener('click', () => lb.classList.add('hidden'))
  }
  lb.textContent = ''
  const img = document.createElement('img')
  img.src = url
  img.alt = 'photo'
  lb.appendChild(img)
  lb.classList.remove('hidden')
}

// Wire the header bell-toggle for browser notifications
function initNotifToggle() {
  const btn = $('notif-toggle')
  if (!btn || btn.dataset.bound) return
  btn.dataset.bound = '1'
  const refresh = () => {
    const on = notifPref() === 'on' && (typeof Notification !== 'undefined' && Notification.permission === 'granted')
    btn.textContent = on ? '🔔' : '📵'
    btn.title = on ? 'Notifications on (click to mute)' : 'Click to enable browser notifications'
    btn.classList.toggle('signed-in', on)
  }
  refresh()
  btn.addEventListener('click', async () => {
    if (notifPref() === 'on') { disableNotifications(); refresh(); toast('Notifications muted') }
    else {
      const ok = await enableNotifications()
      refresh()
      if (!ok) toast('Browser blocked notifications — check site permissions')
    }
  })
}

// Track partner online/offline transitions for chime + UI dot
let lastPartnerOnline = null
function handlePresenceChange(online) {
  const dot = $('partner-status')
  if (dot) {
    dot.classList.toggle('online',  online)
    dot.classList.toggle('offline', !online)
    dot.title = online ? `${state.theirName?.() || 'Partner'} is online` : `${state.theirName?.() || 'Partner'} is away`
  }
  // Only chime on transitions, not on the initial sync
  if (lastPartnerOnline !== null && online !== lastPartnerOnline) {
    if (online)  {
      playOnlineChime()
      toast(`${state.theirName?.() || 'Partner'} is online ✨`)
      notify(`${state.theirName?.() || 'Partner'} is online ✨`, 'They just opened the app.', { tag: 'presence' })
    } else {
      playOfflineChime()
    }
  }
  lastPartnerOnline = online
}

function handleIncomingMessage(msg) {
  if (state.messages.find(m => m.id === msg.id)) return
  state.messages.push(msg)
  renderMessages()
  watchOnChat(msg)
  if (msg.image_url) onRemoteAlbumUpdate()
  if ($('tab-chat').style.display === 'none') {
    state.unread++
    const b = $('chat-badge'); b.textContent = state.unread; b.style.display = 'inline-flex'
  }
  // Push notification when partner sends a message and tab isn't focused
  if (msg.partner_idx !== state.me) {
    const preview = msg.image_url ? '📷 sent a photo' : (msg.content || '').slice(0, 80)
    notify(`${state.theirName?.() || 'Partner'} · ${state.cfg?.alias || ''}`.trim(), preview, { tag: 'msg' })
  }
}

let pendingImage = null  // { blob, kind, previewUrl }

async function compressImage(file, maxDim = 1600, quality = 0.85) {
  if (!file.type.startsWith('image/')) return file
  // GIFs: don't re-encode
  if (file.type === 'image/gif') return file
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(b => resolve(b || file), 'image/jpeg', quality)
    }
    img.onerror = () => resolve(file)
    img.src = URL.createObjectURL(file)
  })
}

function setPendingImage(file) {
  if (!file) return
  if (file.size > 10 * 1024 * 1024) { toast('Image too large (max 10 MB)'); return }
  if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl)
  pendingImage = { blob: file, kind: 'image', previewUrl: URL.createObjectURL(file) }
  renderPendingImage()
}

function clearPendingImage() {
  if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl)
  pendingImage = null
  renderPendingImage()
}

function renderPendingImage() {
  const wrap = $('chat-pending')
  if (!wrap) return
  if (!pendingImage) { wrap.innerHTML = ''; wrap.style.display = 'none'; return }
  wrap.style.display = ''
  wrap.innerHTML = `
    <img src="${pendingImage.previewUrl}" alt="preview">
    <button type="button" class="chat-pending-x" title="Remove">×</button>`
  wrap.querySelector('.chat-pending-x').onclick = clearPendingImage
}

async function sendMessage() {
  const inp = $('chat-inp')
  const text = inp.value.trim()
  if (!text && !pendingImage) return
  inp.value = ''

  if (!configured) {
    state.messages.push({
      id: Date.now(), partner_idx: state.me,
      content: text, image_url: pendingImage?.previewUrl || null,
      created_at: new Date().toISOString(),
    })
    pendingImage = null  // keep blob URL alive for offline preview
    renderPendingImage()
    renderMessages(); return
  }

  // Capture and clear local pending state immediately so the UI feels snappy
  const imgToSend = pendingImage
  pendingImage = null
  renderPendingImage()
  try {
    let attachment = null
    if (imgToSend) {
      const compressed = await compressImage(imgToSend.blob)
      attachment = await db.uploadChatImage(compressed, imgToSend.kind)
    }
    await db.insertMessage(text, attachment)
    track('message_sent', { has_image: !!attachment, has_text: !!text })
    pushToPartner({
      title: `${state.cfg?.alias || (state.cfg.n1 + ' & ' + state.cfg.n2)}`,
      body: attachment ? '📷 sent a photo' : (text || '').slice(0, 80),
      tag: 'msg',
    })
  } catch (e) {
    toast('Could not send: ' + e.message)
    // Restore pending so user can retry
    if (imgToSend) { pendingImage = imgToSend; renderPendingImage() }
    if (text) inp.value = text
  }
}

// ============================================================
// AI IDEAS
// ============================================================
async function genIdeas() {

  const el  = $('ai-results')
  const emp = $('ai-empty')
  $('ai-loading').style.display = 'flex'; el.innerHTML = ''; emp.style.display = 'none'

  try {
    const ideas = await generateDateIdeas({
      n1:        state.cfg.n1,
      n2:        state.cfg.n2,
      tz1:       state.cfg.tz1,
      tz2:       state.cfg.tz2,
      since:     state.cfg.since,
      interests: $('ai-inp').value.trim(),
    })

    $('ai-loading').style.display = 'none'
    ideas.forEach((idea, i) => {
      const d = document.createElement('div'); d.className = 'idea-card'
      d.innerHTML = `
        <div class="idea-num">Idea ${i + 1}</div>
        <div class="idea-title">${escapeHtml(idea.title)}</div>
        <div class="idea-desc">${escapeHtml(idea.description)}</div>
      `
      el.appendChild(d)
    })
  } catch (e) {
    $('ai-loading').style.display = 'none'
    emp.textContent = 'Could not generate ideas: ' + e.message; emp.style.display = 'block'
  }
}

async function streamIdeas() {
  const el  = $('ai-results')
  const emp = $('ai-empty')
  $('ai-loading').style.display = 'flex'; el.innerHTML = ''; emp.style.display = 'none'

  const out = document.createElement('div')
  out.className = 'idea-card'
  out.innerHTML = `<div class="idea-num">Streaming...</div><div class="idea-desc"></div>`
  const target = out.querySelector('.idea-desc')

  try {
    let started = false
    await streamDateIdeas({
      n1:        state.cfg.n1,
      n2:        state.cfg.n2,
      tz1:       state.cfg.tz1,
      tz2:       state.cfg.tz2,
      since:     state.cfg.since,
      interests: $('ai-inp').value.trim(),
      onToken: (token) => {
        if (!started) {
          $('ai-loading').style.display = 'none'
          el.appendChild(out)
          started = true
        }
        target.textContent += token
      },
    })
    $('ai-loading').style.display = 'none'
  } catch (e) {
    $('ai-loading').style.display = 'none'
    emp.textContent = 'Could not stream ideas: ' + e.message; emp.style.display = 'block'
  }
}

// ============================================================
// BUCKET LIST
// ============================================================
async function addBucket() {
  const inp = $('bk-inp'), t = inp.value.trim(); if (!t) return
  inp.value = ''
  if (configured) { await db.insertBucketItem(t); await loadBucket() }
  else { state.bucket.unshift({ id: Date.now(), text: t, done: false }); renderBucket() }
}

async function loadBucket() {
  if (!configured) { renderBucket(); return }
  state.bucket = await db.fetchBucket()
  renderBucket()
}

function renderBucket() {
  const list = $('bk-list'), empty = $('bk-empty')
  list.innerHTML = ''
  if (!state.bucket.length) { empty.style.display = 'block'; return }
  empty.style.display = 'none'
  state.bucket.forEach(item => {
    const row = document.createElement('div'); row.className = 'bucket-item'
    const cb  = Object.assign(document.createElement('input'), { type: 'checkbox', checked: item.done })
    cb.style.cssText = 'width:17px;height:17px;flex-shrink:0;cursor:pointer;'
    cb.onchange = async () => {
      if (configured) { await db.toggleBucketItem(item.id, item.done); await loadBucket() }
      else { item.done = !item.done; renderBucket() }
    }
    const lbl = Object.assign(document.createElement('span'), { className: 'bucket-text' + (item.done ? ' done' : ''), textContent: item.text })
    const del = Object.assign(document.createElement('button'), { className: 'bucket-del', textContent: '×' })
    del.onclick = async () => {
      if (configured) { await db.deleteBucketItem(item.id); await loadBucket() }
      else { state.bucket = state.bucket.filter(i => i.id !== item.id); renderBucket() }
    }
    row.append(cb, lbl, del); list.appendChild(row)
  })
}

// ============================================================
// MILESTONES
// ============================================================
async function addMilestone() {
  const date = $('ms-date').value, title = $('ms-title').value.trim()
  if (!date || !title) { toast('Please enter a date and title'); return }
  const note = $('ms-note').value.trim()
  if (configured) { await db.insertMilestone({ date, title, note }); await loadMilestones() }
  else { state.stones.unshift({ id: Date.now(), date, title, note }); renderTimeline() }
  $('ms-title').value = ''; $('ms-note').value = ''
  toast('Milestone added to your story')
}

async function loadMilestones() {
  if (!configured) { renderTimeline(); return }
  state.stones = await db.fetchMilestones()
  renderTimeline()
}

function renderTimeline() {
  const tl = $('ms-timeline'), empty = $('ms-empty')
  tl.innerHTML = ''
  if (!state.stones.length) { empty.style.display = 'block'; return }
  empty.style.display = 'none'
  state.stones.forEach((m, i) => {
    const row  = document.createElement('div'); row.className = 'tl-item'
    const left = document.createElement('div'); left.className = 'tl-left'
    const dot  = document.createElement('div'); dot.className = 'tl-dot'
    const line = document.createElement('div'); line.className = 'tl-line'
    if (i === state.stones.length - 1) line.style.visibility = 'hidden'
    left.append(dot, line)
    const right = document.createElement('div'); right.className = 'tl-content'
    const d = new Date(m.date + 'T00:00:00')
    right.innerHTML = `
      <div class="tl-date">${d.toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'})}</div>
      <div class="tl-title">${escapeHtml(m.title)}</div>
      ${m.note ? `<div class="tl-note">${escapeHtml(m.note)}</div>` : ''}
      <button class="btn btn-ghost btn-sm" style="margin-top:8px;opacity:.55;" data-action="removeMilestone" data-arg="${Number(m.id)}">Remove</button>
    `
    row.append(left, right); tl.appendChild(row)
  })
}

async function removeMilestone(id) {
  if (configured) { await db.deleteMilestone(id); await loadMilestones() }
  else { state.stones = state.stones.filter(m => m.id !== id); renderTimeline() }
}

// ============================================================
// LOAD ALL
// ============================================================
async function loadAll() {
  const [msgRes] = await Promise.allSettled([
    db.fetchMessages(),
    loadMood(), loadMyNote(), loadTheirNote(), loadBucket(), loadMilestones()
  ])
  if (msgRes.status === 'fulfilled') {
    state.messages = msgRes.value
    renderMessages()
  }
}

// ============================================================
// UI HELPERS
// ============================================================
const tabInited = { watch: false, together: false, rituals: false, story: false, life: false }
function switchTab(tab, btn) {
  ['home','chat','plans','story','watch','together','rituals','life'].forEach(id => {
    const el = $('tab-' + id); if (el) el.style.display = 'none'
  })
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'))
  $('tab-' + tab).style.display = 'block'; btn.classList.add('active')
  track('tab_view', { tab })
  if (tab === 'chat') {
    state.unread = 0; $('chat-badge').style.display = 'none'
    setTimeout(() => { const c = $('chat-messages'); if (c) c.scrollTop = c.scrollHeight }, 50)
    if (configured) db.markRoomMessagesRead().catch(console.error)
  }
  if (tab === 'watch'    && !tabInited.watch)    { initWatchTab();    tabInited.watch    = true }
  if (tab === 'together' && !tabInited.together) {
    initTogetherTab(); initHeartbeat(); initSoundCapsules(); initMiniGame()
    tabInited.together = true
  }
  if (tab === 'rituals'  && !tabInited.rituals)  { initRitualsTab();  initDreams();    tabInited.rituals = true }
  if (tab === 'story'    && !tabInited.story)    { initMemoryBook();  initLetters();   initAlbum();   initVlog();   tabInited.story   = true }
  if (tab === 'life'     && !tabInited.life)     { initLife();        tabInited.life   = true }
}

function copyCode() {
  // Tries native share first; falls back to clipboard copy
  shareRoom()
  const b = $('room-badge-text'); const orig = b.textContent
  b.textContent = 'Sharing…'
  setTimeout(() => b.textContent = orig || state.room, 1600)
}

function tearDownActiveRoom() {
  unsubscribeRoom()
  teardownWatch()
  teardownTogether()
  teardownRituals()
  teardownMemory()
  teardownHeartbeat()
  teardownSoundCapsules()
  teardownHarmony()
  teardownReunion()
  teardownLetters()
  teardownDreams()
  teardownLife()
  teardownAnniversary()
  teardownCoach()
  teardownTone()
  teardownMiniGame()
  teardownHistory()
  teardownMoodViz()
  teardownWrapped()
  teardownLocalCare()
  teardownAlbum()
  teardownVlog()
  teardownStats()
  Object.keys(tabInited).forEach(k => tabInited[k] = false)
  lastPartnerOnline = null
  state.room = null; state.cfg = null; state.me = null
  state.messages = []; state.bucket = []; state.stones = []; state.watch = null
  document.body.dataset.theme = 'warm'
}

// "Leave" now means "step back to your rooms list" — non-destructive.
// Removing a room from this device happens from the rooms list.
function leaveRoom() {
  tearDownActiveRoom()
  setActiveRoomCode(null)
  $('main-app').style.display = 'none'
  showRoomsList()
}

// Switch to a different room from the rooms-list
async function switchToRoom(code) {
  tearDownActiveRoom()
  const membership = state.rooms.find(r => r.code === code)
  if (!membership) { showRoomsList(); return }
  try {
    const data = await db.fetchRoom(code)
    state.cfg = data; state.room = code; state.me = membership.me
    setActiveRoomCode(code)
    upsertRoomMembership({
      code, me: membership.me, alias: data.alias, kind: data.kind, theme: data.theme,
    })
    startApp()
  } catch (e) {
    toast('Could not load room: ' + (e.message || 'unknown'))
    showRoomsList()
  }
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
$('bk-inp').addEventListener('keydown',  e => { if (e.key === 'Enter') addBucket() })
$('chat-inp').addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage() })

// Typing indicator over the existing room channel
let chatTypingTimer = null
let chatTypingChannel = null
function chatTypingChan() {
  if (chatTypingChannel || !configured || !sb || !state.room) return chatTypingChannel
  chatTypingChannel = sb.channel(`chat-typing:${state.room}`, { config: { broadcast: { self: false } } })
  chatTypingChannel.on('broadcast', { event: 'typing' }, ({ payload }) => {
    if (payload.from === state.me) return
    const el = $('chat-typing'); if (!el) return
    if (payload.typing) {
      el.textContent = `${state.theirName?.() || 'Partner'} is typing…`
      el.style.display = ''
      clearTimeout(chatTypingTimer)
      chatTypingTimer = setTimeout(() => { el.style.display = 'none' }, 3500)
    } else {
      el.style.display = 'none'
    }
  }).subscribe()
  return chatTypingChannel
}
let chatTypingDeadman = null
$('chat-inp').addEventListener('input', () => {
  const ch = chatTypingChan(); if (!ch) return
  ch.send({ type: 'broadcast', event: 'typing', payload: { from: state.me, typing: true } })
  clearTimeout(chatTypingDeadman)
  chatTypingDeadman = setTimeout(() => {
    ch.send({ type: 'broadcast', event: 'typing', payload: { from: state.me, typing: false } })
  }, 1500)
})
// Image attach: click + paste + drag-drop
const chatPicker = document.getElementById('chat-pick')
const chatFile   = document.getElementById('chat-file')
const chatBox    = document.getElementById('chat-messages')
chatPicker?.addEventListener('click', () => chatFile?.click())
chatFile?.addEventListener('change', e => { if (e.target.files?.[0]) setPendingImage(e.target.files[0]) })
$('chat-inp')?.addEventListener('paste', e => {
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))
  if (item) { e.preventDefault(); setPendingImage(item.getAsFile()) }
})
chatBox?.addEventListener('dragover', e => { e.preventDefault(); chatBox.classList.add('drag-active') })
chatBox?.addEventListener('dragleave', () => chatBox.classList.remove('drag-active'))
chatBox?.addEventListener('drop', e => {
  e.preventDefault(); chatBox.classList.remove('drag-active')
  const f = e.dataTransfer?.files?.[0]
  if (f && f.type.startsWith('image/')) setPendingImage(f)
})
$('ms-title').addEventListener('keydown', e => { if (e.key === 'Enter') addMilestone() })
$('j-code').addEventListener('input',     e => { e.target.value = e.target.value.toUpperCase() })

// ============================================================
// INIT
// ============================================================
async function init() {
  initErrorMonitor()  // catch errors from boot onward
  initSelects()

  if (!configured) $('config-warn').style.display = 'block'

  // Wire header back-to-rooms button
  const backBtn = document.getElementById('hdr-back')
  if (backBtn) backBtn.addEventListener('click', () => {
    tearDownActiveRoom()
    setActiveRoomCode(null)
    $('main-app').style.display = 'none'
    showRoomsList()
  })

  // Initialize auth (picks up existing session, mirrors rooms list to/from server)
  if (configured) await initAuth()
  initAccountButton()
  initNotifications()  // service worker + push subscription if enabled
  initPolish()         // a11y, ESC handlers, focus management
  initI18n()           // locale detection + DOM translation
  initAnalytics()      // events tracking
  initLegal()          // privacy policy modal + consent wiring

  // Whenever auth state flips (sign-in, sign-out), refresh the rooms list view
  onAuthChange(async () => {
    try { await refreshRoomsList() } catch {}
  })

  // Load rooms membership + initialize the rooms-list screen
  loadRoomsList()
  // Re-affirm room_members for every room we think we're in. Anonymous
  // sessions can rotate auth.uid() across devices/cookie clears, and rooms
  // created pre-cutover have no room_members rows at all. join_room is
  // idempotent so this is cheap on every boot. Await it because the
  // active-room restore below relies on rooms RLS, which checks membership.
  if (configured) await db.ensureMembership(state.rooms)
  if (configured) await initRoomsList(switchToRoom)

  // Decide what to show first
  $('loading').style.display = 'none'

  // First-run consent + age gate — blocks until the user agrees.
  await requireConsent()

  const activeCode = getActiveRoomCode()
  if (activeCode && configured) {
    // Try to restore the active room directly
    const membership = state.rooms.find(r => r.code === activeCode)
    if (membership) {
      try {
        const data = await db.fetchRoom(activeCode)
        state.room = activeCode; state.me = membership.me; state.cfg = data
        $('onboarding').style.display = 'none'
        hideRoomsList()
        startApp()
        return
      } catch { setActiveRoomCode(null) }
    }
  }

  // Show rooms list if user has rooms; otherwise show onboarding
  if (state.rooms.length && configured) {
    showRoomsList()
  } else {
    $('onboarding').style.display = 'flex'
    obShow('ob-land')
  }
}

// ============================================================
// EXPOSE TO HTML onclick handlers
// ============================================================
window.app = {
  obShow, createRoom, joinRoom, pickPartner,
  updateVisit, saveNote, sendMessage,
  genIdeas, streamIdeas, addBucket,

  addMilestone, removeMilestone,
  switchTab, copyCode, leaveRoom,
  exportRoom: exportThisRoom,
  shareRoom,
}

// Delegated click handler so we can drop 'unsafe-inline' from the CSP.
// HTML uses data-action="methodName" (+ optional data-arg) instead of onclick.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]')
  if (!el) return
  const action = el.dataset.action
  const fn = window.app[action]
  if (typeof fn !== 'function') return
  e.preventDefault()
  const rawArg = el.dataset.arg
  let arg
  if (rawArg !== undefined) {
    arg = /^-?\d+(\.\d+)?$/.test(rawArg) ? Number(rawArg) : rawArg
  }
  if (action === 'switchTab') fn(el.dataset.tab || arg, el)
  else if (arg !== undefined) fn(arg)
  else fn()
})

// Prevent blank screen: if init throws, hide loading and surface error
init().catch((e) => {
  console.error('[LDR] init() failed:', e)
  const loading = document.getElementById('loading')
  if (loading) loading.style.display = 'none'

  const toastEl = document.getElementById('toast')
  if (toastEl) {
  }
})

