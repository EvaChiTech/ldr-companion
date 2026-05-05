import { sb, configured } from './supabase.js'
import { state, persistSession, clearSession, loadSession } from './state.js'
import { subscribeRoom, unsubscribeRoom } from './realtime.js'
import { generateDateIdeas } from './ai.js'
import { tzTime, tzDate, tzDiff, daysBetween, cityLabel } from './clocks.js'
import * as db from './db.js'

// ============================================================
// TIMEZONE DATA — defaults to Seoul + Helsinki (Emeka & Aino)
// ============================================================
const TZ = [
  ["Seoul, South Korea",   "Asia/Seoul"],
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
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({length:8}, () => c[Math.floor(Math.random() * c.length)]).join('')
}

async function createRoom() {
  const n1 = $('c-n1').value.trim(), n2 = $('c-n2').value.trim()
  const since = $('c-since').value
  const err = $('c-err')

  if (!n1 || !n2) { err.textContent = 'Please enter both names.'; err.style.display = 'block'; return }
  if (!since)     { err.textContent = 'Please enter your start date.'; err.style.display = 'block'; return }
  err.style.display = 'none'

  const code = genCode()
  const cfg = {
    id:        code,
    room_code: code,
    n1, n2,
    tz1:       $('c-tz1').value,
    tz2:       $('c-tz2').value,
    since,
    visit:     $('c-visit').value || null,
    interests: $('c-interests').value.trim(),
  }

  if (configured) {
    try { await db.createRoomInDB(cfg) }
    catch (e) { err.textContent = 'Database error: ' + e.message; err.style.display = 'block'; return }
  }

  state.room = code; state.cfg = cfg; state.me = 1
  persistSession()
  startApp()
  toast('Room created! Code: ' + code + ' — share it with your partner')
}

async function joinRoom() {
  const code = $('j-code').value.trim().toUpperCase()
  const err = $('j-err')
  if (code.length < 6) { err.textContent = 'Please enter a valid room code.'; err.style.display = 'block'; return }
  if (!configured)     { err.textContent = 'Supabase not configured — add keys to .env first.'; err.style.display = 'block'; return }

  try {
    const data = await db.fetchRoom(code)
    state.cfg = data; state.room = code
    $('pk-n1').textContent = data.n1; $('pk-tz1').textContent = cityLabel(data.tz1)
    $('pk-n2').textContent = data.n2; $('pk-tz2').textContent = cityLabel(data.tz2)
    obShow('ob-pick')
  } catch {
    err.textContent = 'Room not found. Check the code and try again.'
    err.style.display = 'block'
  }
}

function pickPartner(p) {
  state.me = p
  persistSession()
  startApp()
}

// ============================================================
// APP BOOT
// ============================================================
function startApp() {
  const { cfg } = state
  $('onboarding').style.display = 'none'
  $('main-app').style.display   = 'block'

  $('hdr-names').textContent      = cfg.n1 + ' & ' + cfg.n2
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
  setInterval(updateClocks, 1000)
  setInterval(updateCountdown, 60000)

  if (configured) {
    subscribeRoom({
      onMessage:   handleIncomingMessage,
      onMood:      () => loadMood(),
      onNote:      () => loadTheirNote(),
      onBucket:    () => loadBucket(),
      onMilestone: () => loadMilestones(),
    })
    loadAll()
  } else {
    $('mood-their-val').textContent = 'Add Supabase keys to .env to sync'
    $('h-theirnote').textContent    = 'Add Supabase keys to .env to see their note'
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
  if (!configured) { el.textContent = 'Add Supabase keys to .env to see their note'; return }
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
    c.innerHTML = `<div class="chat-empty">No messages yet.<br>Say something to ${state.theirName()}...</div>`
    return
  }
  state.messages.forEach(msg => {
    const mine = msg.partner_idx === state.me
    const wrap = Object.assign(document.createElement('div'), { className: 'msg-wrap ' + (mine ? 'mine' : 'theirs') })
    const meta = Object.assign(document.createElement('div'), { className: 'msg-meta', textContent: (mine ? 'You' : state.theirName()) + ' · ' + fmtTs(msg.created_at) })
    const bub  = Object.assign(document.createElement('div'), { className: 'msg-bubble', textContent: msg.content })
    wrap.append(meta, bub); c.appendChild(wrap)
  })
  c.scrollTop = c.scrollHeight
}

function handleIncomingMessage(msg) {
  if (state.messages.find(m => m.id === msg.id)) return
  state.messages.push(msg)
  renderMessages()
  if ($('tab-chat').style.display === 'none') {
    state.unread++
    const b = $('chat-badge'); b.textContent = state.unread; b.style.display = 'inline-flex'
  }
}

async function sendMessage() {
  const inp = $('chat-inp'), text = inp.value.trim(); if (!text) return
  inp.value = ''
  if (!configured) {
    state.messages.push({ id: Date.now(), partner_idx: state.me, content: text, created_at: new Date().toISOString() })
    renderMessages(); return
  }
  try { await db.insertMessage(text) }
  catch (e) { toast('Could not send: ' + e.message) }
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
        <div class="idea-title">${idea.title}</div>
        <div class="idea-desc">${idea.description}</div>
      `
      el.appendChild(d)
    })
  } catch (e) {
    $('ai-loading').style.display = 'none'
    emp.textContent = 'Could not generate ideas: ' + e.message; emp.style.display = 'block'
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
      <div class="tl-title">${m.title}</div>
      ${m.note ? `<div class="tl-note">${m.note}</div>` : ''}
      <button class="btn btn-ghost btn-sm" style="margin-top:8px;opacity:.55;" onclick="window.app.removeMilestone(${m.id})">Remove</button>
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
function switchTab(t, btn) {
  ['home','chat','plans','story'].forEach(id => $('tab-' + id).style.display = 'none')
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'))
  $('tab-' + t).style.display = 'block'; btn.classList.add('active')
  if (t === 'chat') {
    state.unread = 0; $('chat-badge').style.display = 'none'
    setTimeout(() => { const c = $('chat-messages'); if (c) c.scrollTop = c.scrollHeight }, 50)
  }
}

function copyCode() {
  navigator.clipboard.writeText(state.room).catch(() => {})
  const b = $('room-badge-text'); b.textContent = 'Copied!'
  setTimeout(() => b.textContent = state.room, 1600)
}

function leaveRoom() {
  if (!confirm('Leave this room? Your partner can re-invite you with the room code.')) return
  unsubscribeRoom()
  clearSession()
  state.room = null; state.cfg = null; state.me = null
  state.messages = []; state.bucket = []; state.stones = []
  $('main-app').style.display = 'none'
  $('onboarding').style.display = 'flex'
  obShow('ob-land')
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
$('bk-inp').addEventListener('keydown',  e => { if (e.key === 'Enter') addBucket() })
$('chat-inp').addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage() })
$('ms-title').addEventListener('keydown', e => { if (e.key === 'Enter') addMilestone() })
$('j-code').addEventListener('input',     e => { e.target.value = e.target.value.toUpperCase() })

// ============================================================
// INIT
// ============================================================
async function init() {
  initSelects()

  if (!configured) $('config-warn').style.display = 'block'

  // Restore session from localStorage
  const session = loadSession()
  if (session && configured) {
    try {
      const data = await db.fetchRoom(session.code)
      state.room = session.code; state.me = session.me; state.cfg = data
      $('loading').style.display = 'none'
      $('onboarding').style.display = 'none'
      startApp(); return
    } catch { clearSession() }
  }

  $('loading').style.display = 'none'
  $('onboarding').style.display = 'flex'
  obShow('ob-land')
}

// ============================================================
// EXPOSE TO HTML onclick handlers
// ============================================================
window.app = {
  obShow, createRoom, joinRoom, pickPartner,
  updateVisit, saveNote, sendMessage,
  genIdeas, addBucket,
  addMilestone, removeMilestone,
  switchTab, copyCode, leaveRoom,
}

init()
