// ============================================================
// AUTO-ANNIVERSARY SURPRISES — detect milestone days and show
// a Claude-generated surprise card on Home, cached per (room, day-key).
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))

// Returns { days, label } if today is a milestone, else null
function todaysMilestone() {
  const since = state.cfg?.since
  if (!since) return null
  const days = Math.floor((Date.now() - new Date(since + 'T00:00:00').getTime()) / 86400000)
  if (days < 1) return null
  // Day milestones
  const dayHits = [30, 50, 100, 200, 300, 500, 1000, 2000, 5000, 10000]
  if (dayHits.includes(days)) return { days, label: `${days} days together` }
  // Year milestones (within 1-day tolerance to handle leap years)
  const startDate = new Date(since + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const monthMatch = startDate.getMonth() === today.getMonth()
  const dayMatch = startDate.getDate() === today.getDate()
  if (monthMatch && dayMatch) {
    const years = today.getFullYear() - startDate.getFullYear()
    if (years > 0) return { days, label: `${years}-year anniversary` }
  }
  // Monthly anniversary on the day-of-month for the first 12 months
  if (dayMatch && days < 365) {
    const months = Math.round(days / 30)
    if (months >= 1 && months <= 11) return { days, label: `${months}-month anniversary` }
  }
  return null
}

function dayKey(label) {
  return `ldr_anniv_${state.room}_${label.replace(/\s+/g, '_')}`
}

async function fetchSurprise(milestone) {
  // Cache the surprise per (room, milestone) to memory_chapters with a marker title
  const cacheTitle = `ANNIV::${milestone.label}`
  const { data: cached } = await sb.from('memory_chapters')
    .select('*').eq('room_id', state.room).eq('title', cacheTitle).maybeSingle()
  if (cached) return JSON.parse(cached.content)
  // Generate fresh
  const { data: recent } = await sb.from('milestones')
    .select('date,title,note').eq('room_id', state.room).order('date', { ascending: false }).limit(12)
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  const { data, error } = await sb.functions.invoke('anniversary-surprise', {
    body: {
      n1: state.cfg.n1, n2: state.cfg.n2,
      days: milestone.days, since: state.cfg.since,
      milestoneLabel: milestone.label, recent: recent || [],
      apiKey,
    },
  })
  if (error) throw error
  // Cache it
  const today = new Date().toISOString().split('T')[0]
  await sb.from('memory_chapters').insert({
    room_id: state.room, period_start: today, period_end: today,
    title: cacheTitle, content: JSON.stringify(data),
  })
  return data
}

async function showSurpriseIfDue() {
  const card = document.getElementById('anniv-card')
  if (!card) return
  const milestone = todaysMilestone()
  if (!milestone) { card.style.display = 'none'; return }
  if (!configured) { card.style.display = 'none'; return }
  card.style.display = ''
  card.innerHTML = `
    <div class="anniv-pill">${escapeHtml(milestone.label.toUpperCase())}</div>
    <div class="anniv-loading">
      <span class="ldot"></span><span class="ldot"></span><span class="ldot"></span>
      Writing something for you two…
    </div>`
  try {
    const surprise = await fetchSurprise(milestone)
    card.innerHTML = `
      <div class="anniv-pill">${escapeHtml(milestone.label.toUpperCase())}</div>
      <div class="anniv-emoji">${escapeHtml(surprise.emoji || '💕')}</div>
      <div class="anniv-title">${escapeHtml(surprise.title || 'Today')}</div>
      <div class="anniv-message">${escapeHtml(surprise.message || '')}</div>`
  } catch (e) {
    card.innerHTML = `
      <div class="anniv-pill">${escapeHtml(milestone.label.toUpperCase())}</div>
      <div class="anniv-emoji">💕</div>
      <div class="anniv-message">Today is yours. Celebrate however feels right.</div>`
  }
}

let inited = false
export function initAnniversary() {
  if (inited) return
  inited = true
  showSurpriseIfDue()
}
export function teardownAnniversary() { inited = false }
