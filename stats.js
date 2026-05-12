// ============================================================
// COUPLE STATS DASHBOARD — consolidated view of everything
// you've built together. Numbers update live.
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'

let inited = false

async function gatherStats() {
  if (!configured) return null
  const since = state.cfg?.since
  const sinceISO = since || new Date().toISOString().split('T')[0]
  const sinceFull = sinceISO + 'T00:00:00Z'
  const daysTogether = since ? Math.floor((Date.now() - new Date(since + 'T00:00:00').getTime()) / 86400000) : 0

  const [
    msgCount, photoCount, momentCount, dreamCount, daCount, careCount, capsuleCount, reunionCount, hbCount, letterCount,
    expCount, calCount, visaCount, chapterCount,
  ] = await Promise.all([
    sb.from('messages').select('id', { count: 'exact', head: true }).eq('room_id', state.room),
    sb.from('messages').select('id', { count: 'exact', head: true }).eq('room_id', state.room).not('image_url', 'is', null),
    sb.from('milestones').select('id', { count: 'exact', head: true }).eq('room_id', state.room),
    sb.from('dreams').select('id', { count: 'exact', head: true }).eq('room_id', state.room),
    sb.from('daily_answers').select('id', { count: 'exact', head: true }).eq('room_id', state.room),
    sb.from('care_pings').select('id', { count: 'exact', head: true }).eq('room_id', state.room),
    sb.from('sound_capsules').select('id', { count: 'exact', head: true }).eq('room_id', state.room),
    sb.from('reunion_sessions').select('id', { count: 'exact', head: true }).eq('room_id', state.room),
    sb.from('heartbeat_sessions').select('duration_s', { count: 'exact' }).eq('room_id', state.room),
    sb.from('future_letters').select('id', { count: 'exact', head: true }).eq('room_id', state.room),
    sb.from('expenses').select('id', { count: 'exact', head: true }).eq('room_id', state.room),
    sb.from('calendar_events').select('id', { count: 'exact', head: true }).eq('room_id', state.room),
    sb.from('visa_items').select('id', { count: 'exact', head: true }).eq('room_id', state.room),
    sb.from('memory_chapters').select('id', { count: 'exact', head: true }).eq('room_id', state.room),
  ])

  const hbSeconds = (hbCount.data || []).reduce((s, r) => s + (Number(r.duration_s) || 0), 0)
  return {
    daysTogether,
    messages:      msgCount.count    || 0,
    photos:        photoCount.count  || 0,
    moments:       momentCount.count || 0,
    dreams:        dreamCount.count  || 0,
    answers:       daCount.count     || 0,
    care_pings:    careCount.count   || 0,
    audio_cards:   capsuleCount.count|| 0,
    reunions:      reunionCount.count|| 0,
    heartbeat_min: Math.round(hbSeconds / 60),
    letters:       letterCount.count || 0,
    expenses:      expCount.count    || 0,
    events:        calCount.count    || 0,
    paperwork:     visaCount.count   || 0,
    chapters:      chapterCount.count|| 0,
  }
}

const FIELDS = [
  { key: 'daysTogether',  emoji: '💕', label: 'days together' },
  { key: 'messages',      emoji: '💬', label: 'messages' },
  { key: 'photos',        emoji: '📷', label: 'photos shared' },
  { key: 'answers',       emoji: '💌', label: 'questions answered' },
  { key: 'moments',       emoji: '✨', label: 'moments saved' },
  { key: 'reunions',      emoji: '💫', label: 'reunions' },
  { key: 'heartbeat_min', emoji: '💗', label: 'heartbeat minutes' },
  { key: 'audio_cards',   emoji: '📮', label: 'audio postcards' },
  { key: 'dreams',        emoji: '🌙', label: 'dreams logged' },
  { key: 'letters',       emoji: '✉️', label: 'letters sealed' },
  { key: 'care_pings',    emoji: '🎁', label: 'care pings' },
  { key: 'chapters',      emoji: '📖', label: 'memory chapters' },
]

async function render() {
  const card = document.getElementById('stats-card')
  if (!card) return
  if (!configured) { card.style.display = 'none'; return }
  card.style.display = ''
  card.innerHTML = `<div class="stats-loading">Tallying…</div>`
  const s = await gatherStats()
  if (!s) { card.innerHTML = ''; return }
  card.innerHTML = `
    <div class="stats-pill">YOU TWO · BY THE NUMBERS</div>
    <div class="stats-grid">
      ${FIELDS.map(f => `
        <div class="stat-tile">
          <div class="stat-emoji">${f.emoji}</div>
          <div class="stat-num">${s[f.key].toLocaleString()}</div>
          <div class="stat-lbl">${f.label}</div>
        </div>`).join('')}
    </div>`
}

export function initStats() {
  if (inited) return
  inited = true
  render()
}
export function refreshStats() { if (inited) render() }
export function teardownStats() { inited = false }
