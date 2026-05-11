// ============================================================
// "ON THIS DAY IN OUR HISTORY" — daily nostalgia card on Home.
// Pulls notes/milestones/dreams/moods/Q&A from past years on this M/D.
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
const whoFor = idx => idx === 1 ? state.cfg?.n1 : (idx === 2 ? state.cfg?.n2 : '')

function yearsAgo(date) {
  const d = new Date(date + 'T00:00:00')
  const today = new Date(); today.setHours(0,0,0,0)
  const years = today.getFullYear() - d.getFullYear()
  if (years <= 0) return 'earlier this year'
  return years === 1 ? '1 year ago today' : `${years} years ago today`
}

const KIND_META = {
  note:      { emoji: '📝', label: 'NOTE',     header: 'wrote'  },
  milestone: { emoji: '✨', label: 'MILESTONE',header: 'marked' },
  dream:     { emoji: '🌙', label: 'DREAM',    header: 'dreamed'},
  mood:      { emoji: '🌤', label: 'MOOD',     header: 'felt'   },
  qa:        { emoji: '💌', label: 'ANSWER',   header: 'answered' },
}

async function fetchOnThisDay() {
  if (!configured) return []
  const today = new Date()
  const m = today.getMonth() + 1, d = today.getDate()
  const { data, error } = await sb.rpc('get_on_this_day', {
    p_room: state.room, p_month: m, p_day: d,
  })
  if (error) { console.warn('[history] rpc', error); return [] }
  return data || []
}

function renderItem(item) {
  const meta = KIND_META[item.kind] || { emoji: '·', label: item.kind, header: '' }
  const who = whoFor(item.partner_idx) || (item.kind === 'milestone' ? 'You two' : '')
  const ago = yearsAgo(item.occurred_on)
  const extra = item.extra || {}
  let body = item.content || ''
  let prefix = ''
  if (item.kind === 'qa' && extra.question) {
    prefix = `<div class="hist-question">"${escapeHtml(extra.question)}"</div>`
  }
  if (item.kind === 'milestone' && extra.note) {
    body = `${item.content} — <em>${escapeHtml(extra.note)}</em>`
  }
  return `
    <article class="hist-item">
      <div class="hist-meta">
        <span class="hist-emoji">${meta.emoji}</span>
        <span class="hist-when">${ago}</span>
        <span class="hist-sep">·</span>
        <span class="hist-who">${escapeHtml(who)} ${meta.header}</span>
      </div>
      ${prefix}
      <div class="hist-body">${escapeHtml(body)}</div>
    </article>`
}

async function render() {
  const card = document.getElementById('hist-card')
  if (!card) return
  if (!configured) { card.style.display = 'none'; return }
  const items = await fetchOnThisDay()
  if (!items.length) { card.style.display = 'none'; return }
  card.style.display = ''
  // Group by year-bucket; render newest first (already DESC from RPC)
  card.innerHTML = `
    <div class="hist-pill">ON THIS DAY</div>
    <div class="hist-feed">${items.slice(0, 6).map(renderItem).join('')}</div>
  `
}

let inited = false
export function initHistory() {
  if (inited) return
  inited = true
  render()
}
export function teardownHistory() { inited = false }
