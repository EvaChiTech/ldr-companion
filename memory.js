import { state } from './state.js'
import { configured, sb } from './supabase.js'

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// Compute a period given preset
function periodOf(preset) {
  const end = new Date()
  const start = new Date(end)
  if (preset === 'week')        start.setDate(end.getDate() - 7)
  else if (preset === 'month')  start.setDate(end.getDate() - 30)
  else if (preset === 'year')   start.setDate(end.getDate() - 365)
  else                          start.setDate(end.getDate() - 7)
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
}

async function gatherCorpus(start, end) {
  const [
    notes, moods, milestones, daily, msgCount, watchCount,
  ] = await Promise.all([
    sb.from('notes').select('date,partner_idx,content').eq('room_id', state.room).gte('date', start).lte('date', end).order('date'),
    sb.from('moods').select('date,partner_idx,mood').eq('room_id', state.room).gte('date', start).lte('date', end).order('date'),
    sb.from('milestones').select('date,title,note').eq('room_id', state.room).gte('date', start).lte('date', end).order('date'),
    sb.from('daily_answers').select('date,partner_idx,answer').eq('room_id', state.room).gte('date', start).lte('date', end).order('date'),
    sb.from('messages').select('id', { count: 'exact', head: true }).eq('room_id', state.room).gte('created_at', start + 'T00:00:00Z').lte('created_at', end + 'T23:59:59Z'),
    sb.from('milestones').select('id', { count: 'exact', head: true }).eq('room_id', state.room).ilike('title', 'Watching together%').gte('date', start).lte('date', end),
  ])

  const whoFor = idx => idx === 1 ? state.cfg.n1 : state.cfg.n2

  // Group daily answers by date for the prompt
  const byDate = {}
  ;(daily.data || []).forEach(a => {
    if (!byDate[a.date]) byDate[a.date] = { date: a.date }
    byDate[a.date]['a' + a.partner_idx] = a.answer
  })
  // Fetch the questions for those dates
  const dates = Object.keys(byDate)
  let qMap = {}
  if (dates.length) {
    const { data: qs } = await sb.from('daily_questions')
      .select('date,question').eq('room_id', state.room).in('date', dates)
    qMap = Object.fromEntries((qs || []).map(q => [q.date, q.question]))
  }
  const dailyAnswers = Object.values(byDate).map(d => ({ ...d, question: qMap[d.date] || '' }))

  return {
    notes:      (notes.data || []).map(n => ({ date: n.date, who: whoFor(n.partner_idx), content: n.content })),
    moods:      (moods.data || []).map(m => ({ date: m.date, who: whoFor(m.partner_idx), mood: m.mood })),
    milestones: (milestones.data || []).map(s => ({ date: s.date, title: s.title, note: s.note || '' })),
    daily_answers: dailyAnswers,
    message_count: msgCount.count || 0,
    watch_count:   watchCount.count || 0,
  }
}

async function generateChapter(preset) {
  if (!configured) { showToast('Connection needed first'); return }
  const out = document.getElementById('memory-out')
  const lo  = document.getElementById('memory-loading')
  out.innerHTML = ''
  lo.style.display = 'flex'

  const { start, end } = periodOf(preset)
  try {
    const corpus = await gatherCorpus(start, end)
    const { data, error } = await sb.functions.invoke('memory-chapter', {
      body: {
        n1: state.cfg.n1, n2: state.cfg.n2,
        period_start: start, period_end: end,
        notes: corpus.notes, moods: corpus.moods, milestones: corpus.milestones,
        daily_answers: corpus.daily_answers,
        message_count: corpus.message_count, watch_count: corpus.watch_count,
      },
    })
    lo.style.display = 'none'
    if (error) throw error
    if (!data?.title || !data?.content) throw new Error('No chapter returned')

    // Persist
    const { data: saved, error: insErr } = await sb.from('memory_chapters').insert({
      room_id: state.room, period_start: start, period_end: end,
      title: data.title, content: data.content,
    }).select().single()
    if (insErr) console.warn('[memory] save failed', insErr)

    renderChapter(saved || { title: data.title, content: data.content, period_start: start, period_end: end, created_at: new Date().toISOString() }, /* prepend */ true)
    showToast('Chapter written ✨')
  } catch (e) {
    lo.style.display = 'none'
    showToast('Could not write chapter: ' + (e.message || e))
  }
}

function renderChapter(c, prepend = false) {
  const list = document.getElementById('memory-list')
  if (!list) return
  const empty = document.getElementById('memory-empty')
  if (empty) empty.style.display = 'none'
  const card = document.createElement('article')
  card.className = 'memory-chapter'
  card.innerHTML = `
    <div class="memory-period">${fmtDate(c.period_start)} — ${fmtDate(c.period_end)}</div>
    <h3 class="memory-title">${escapeHtml(c.title)}</h3>
    <div class="memory-content">${(c.content || '').split(/\n\n+/).map(p => `<p>${escapeHtml(p)}</p>`).join('')}</div>
  `
  if (prepend) list.prepend(card); else list.appendChild(card)
}

async function loadAllChapters() {
  if (!configured) return
  const list = document.getElementById('memory-list')
  const empty = document.getElementById('memory-empty')
  list.innerHTML = ''
  const { data } = await sb.from('memory_chapters')
    .select('*').eq('room_id', state.room).order('period_end', { ascending: false })
  if (!data?.length) { empty.style.display = 'block'; return }
  empty.style.display = 'none'
  data.forEach(c => renderChapter(c))
}

function showToast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(showToast._tm)
  showToast._tm = setTimeout(() => t.style.opacity = '0', 2400)
}

let inited = false
export function initMemoryBook() {
  if (inited) return
  inited = true
  document.querySelectorAll('[data-memory-period]').forEach(b => {
    b.addEventListener('click', () => generateChapter(b.dataset.memoryPeriod))
  })
  loadAllChapters()
}
export function teardownMemory() { inited = false }
