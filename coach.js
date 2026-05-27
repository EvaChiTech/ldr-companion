// ============================================================
// PATTERN COACH — gentle weekly insight from mood/notes/sleep/messages.
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
const whoFor = idx => idx === 1 ? state.cfg?.n1 : state.cfg?.n2

async function generate() {
  if (!configured) { showToast('Connection needed first'); return }
  const out = document.getElementById('coach-out')
  const lo  = document.getElementById('coach-loading')
  if (!out) return
  out.innerHTML = ''; lo.style.display = 'flex'

  const since = new Date(); since.setDate(since.getDate() - 14)
  const sinceISO = since.toISOString().split('T')[0]
  const sinceFull = since.toISOString()

  try {
    const [{ data: moods }, { data: notes }, { data: messages }, { data: sleeps }] = await Promise.all([
      sb.from('moods').select('date,partner_idx,mood').eq('room_id', state.room).gte('date', sinceISO).order('date', { ascending: false }),
      sb.from('notes').select('date,partner_idx,content').eq('room_id', state.room).gte('date', sinceISO).order('date', { ascending: false }),
      sb.from('messages').select('created_at').eq('room_id', state.room).gte('created_at', sinceFull),
      sb.from('sleep_events').select('date,partner_idx,goodnight_at').eq('room_id', state.room).gte('date', sinceISO),
    ])
    // Aggregate message counts by date
    const dayCounts = {}
    ;(messages || []).forEach(m => {
      const d = m.created_at.split('T')[0]
      dayCounts[d] = (dayCounts[d] || 0) + 1
    })
    const messageDays = Object.entries(dayCounts).map(([date, count]) => ({ date, count }))

    const { data, error } = await sb.functions.invoke('pattern-coach', {
      body: {
        n1: state.cfg.n1, n2: state.cfg.n2,
        moods: (moods || []).map(m => ({ date: m.date, who: whoFor(m.partner_idx), mood: m.mood })),
        notes: (notes || []).map(n => ({ date: n.date, who: whoFor(n.partner_idx), content: n.content })),
        sleepEvents: (sleeps || []).map(s => ({ date: s.date, who: whoFor(s.partner_idx), goodnight_at: s.goodnight_at })),
        messageDays,
      },
    })
    lo.style.display = 'none'
    if (error) throw error
    out.innerHTML = `
      <div class="coach-insight">${escapeHtml(data?.insight || 'Nothing notable yet — keep going.')}</div>
      ${data?.nudge ? `<div class="coach-nudge">💡 ${escapeHtml(data.nudge)}</div>` : ''}`
  } catch (e) {
    lo.style.display = 'none'
    out.innerHTML = `<div class="empty-state">Couldn't generate: ${escapeHtml(e.message || String(e))}</div>`
  }
}

function showToast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(showToast._tm)
  showToast._tm = setTimeout(() => t.style.opacity = '0', 2200)
}

let inited = false
export function initCoach() {
  if (inited) return
  inited = true
  document.getElementById('coach-btn')?.addEventListener('click', generate)
}
export function teardownCoach() { inited = false }
