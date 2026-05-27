// ============================================================
// YEARLY WRAPPED — Spotify-style annual recap, Claude-narrated.
// Aggregates everything you've done this year, then opens a fullscreen
// slideshow you tap through.
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))

let inited = false
let modal = null
let currentSlide = 0
let slides = []

async function gatherStats(year) {
  const start = `${year}-01-01`
  const end   = `${year}-12-31`
  const startISO = start + 'T00:00:00Z'
  const endISO   = end + 'T23:59:59Z'

  const [
    msgCount, notes, dreams, daily, milestones, moods, watchMoments, careCount, reunionCount, expCount,
  ] = await Promise.all([
    sb.from('messages').select('id', { count: 'exact', head: true }).eq('room_id', state.room).gte('created_at', startISO).lte('created_at', endISO),
    sb.from('notes').select('date,partner_idx,content').eq('room_id', state.room).gte('date', start).lte('date', end),
    sb.from('dreams').select('id', { count: 'exact', head: true }).eq('room_id', state.room).gte('date', start).lte('date', end),
    sb.from('daily_answers').select('id,question_id,answer', { count: 'exact' }).eq('room_id', state.room).gte('date', start).lte('date', end),
    sb.from('milestones').select('date,title,note').eq('room_id', state.room).gte('date', start).lte('date', end),
    sb.from('moods').select('mood,partner_idx,date').eq('room_id', state.room).gte('date', start).lte('date', end),
    sb.from('milestones').select('id', { count: 'exact', head: true }).eq('room_id', state.room).ilike('title', 'Watching together%').gte('date', start).lte('date', end),
    sb.from('care_pings').select('id', { count: 'exact', head: true }).eq('room_id', state.room).gte('created_at', startISO).lte('created_at', endISO),
    sb.from('reunion_sessions').select('id', { count: 'exact', head: true }).eq('room_id', state.room).gte('started_at', startISO).lte('started_at', endISO),
    sb.from('expenses').select('id', { count: 'exact', head: true }).eq('room_id', state.room).gte('date', start).lte('date', end),
  ])

  // Pick highlights
  const noteList = (notes.data || [])
  const longestNote = noteList.sort((a, b) => (b.content?.length || 0) - (a.content?.length || 0))[0]
  const topNote = longestNote?.content?.slice(0, 140)

  const moodCounts = {}
  ;(moods.data || []).forEach(m => { moodCounts[m.mood] = (moodCounts[m.mood] || 0) + 1 })
  const topMood = Object.entries(moodCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]

  const milestoneList = (milestones.data || []).filter(m => !m.title?.startsWith('Watching together'))
  const topMilestone = milestoneList[0]?.title

  // Pick a "deepest" Q — use the longest combined answer
  let topQuestion = null
  if (daily.data?.length) {
    const byQ = {}
    daily.data.forEach(a => {
      const len = (a.answer || '').length
      byQ[a.question_id] = (byQ[a.question_id] || 0) + len
    })
    const topQid = Object.entries(byQ).sort((a,b)=>b[1]-a[1])[0]?.[0]
    if (topQid) {
      const { data: q } = await sb.from('daily_questions').select('question').eq('id', topQid).single()
      topQuestion = q?.question
    }
  }

  return {
    stats: {
      messages: msgCount.count || 0,
      notes: noteList.length,
      dreams: dreams.count || 0,
      questions_answered: daily.count || 0,
      watch_minutes: (watchMoments.count || 0) * 15,  // rough estimate
      moments: milestoneList.length,
      care_pings: careCount.count || 0,
      reunions: reunionCount.count || 0,
      expenses: expCount.count || 0,
    },
    topNote, topQuestion, topMilestone, topMood,
  }
}

function buildModal() {
  if (modal) return modal
  modal = document.createElement('div')
  modal.id = 'wrap-modal'
  modal.className = 'wrap-modal hidden'
  modal.innerHTML = `
    <div class="wrap-stage">
      <button class="wrap-close" type="button">×</button>
      <div class="wrap-loading">
        <span class="ldot"></span><span class="ldot"></span><span class="ldot"></span>
        <div class="wrap-loading-text">Building your year together…</div>
      </div>
      <div class="wrap-deck" style="display:none;">
        <div class="wrap-progress"></div>
        <div class="wrap-slide"></div>
        <div class="wrap-controls">
          <button class="wrap-prev" type="button">← Back</button>
          <button class="wrap-next" type="button">Next →</button>
        </div>
      </div>
    </div>`
  document.body.appendChild(modal)
  modal.querySelector('.wrap-close').onclick = closeWrap
  modal.querySelector('.wrap-prev').onclick = () => moveSlide(-1)
  modal.querySelector('.wrap-next').onclick = () => moveSlide(+1)
  // Tap right side advances; tap left side goes back
  modal.querySelector('.wrap-slide').addEventListener('click', e => {
    const r = e.currentTarget.getBoundingClientRect()
    moveSlide(e.clientX - r.left < r.width / 3 ? -1 : +1)
  })
  return modal
}

function openWrap() { buildModal(); modal.classList.remove('hidden') }
function closeWrap() { modal?.classList.add('hidden'); slides = []; currentSlide = 0 }

function moveSlide(delta) {
  currentSlide = Math.max(0, Math.min(slides.length - 1, currentSlide + delta))
  renderSlide()
}

function renderSlide() {
  if (!modal) return
  const slideEl = modal.querySelector('.wrap-slide')
  const prog = modal.querySelector('.wrap-progress')
  const s = slides[currentSlide]
  if (!s) return
  slideEl.innerHTML = `
    <div class="wrap-emoji">${escapeHtml(s.emoji || '')}</div>
    <div class="wrap-label">${escapeHtml(s.label || '')}</div>
    <div class="wrap-big">${escapeHtml(s.big || '')}</div>
    <div class="wrap-caption">${escapeHtml(s.caption || '')}</div>`
  prog.innerHTML = slides.map((_, i) => `<span class="${i === currentSlide ? 'on' : ''} ${i < currentSlide ? 'done' : ''}"></span>`).join('')
  // Trigger anim
  slideEl.classList.remove('in')
  void slideEl.offsetWidth
  slideEl.classList.add('in')
}

async function generateAndShow() {
  if (!configured) { showToast('Connection needed first'); return }
  openWrap()
  modal.querySelector('.wrap-loading').style.display = ''
  modal.querySelector('.wrap-deck').style.display = 'none'
  const year = new Date().getFullYear()
  try {
    const { stats, topNote, topQuestion, topMilestone, topMood } = await gatherStats(year)
    const { data, error } = await sb.functions.invoke('yearly-wrapped', {
      body: { n1: state.cfg.n1, n2: state.cfg.n2, year, stats, topNote, topQuestion, topMilestone, topMood },
    })
    if (error) throw error
    slides = []
    if (data?.title) slides.push({ emoji: '✨', label: `${state.cfg.n1} & ${state.cfg.n2} · ${year}`, big: data.title, caption: 'Your year, in six moments.' })
    slides = slides.concat(data?.slides || [])
    if (data?.closing) slides.push({ emoji: '💞', label: 'Here\'s to the next chapter', big: '', caption: data.closing })
    currentSlide = 0
    modal.querySelector('.wrap-loading').style.display = 'none'
    modal.querySelector('.wrap-deck').style.display = ''
    renderSlide()
  } catch (e) {
    modal.querySelector('.wrap-loading').innerHTML = `<div class="wrap-loading-text">Couldn't build it: ${escapeHtml(e.message || String(e))}</div>`
  }
}

function showToast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(showToast._tm)
  showToast._tm = setTimeout(() => t.style.opacity = '0', 2200)
}

export function initWrapped() {
  if (inited) return
  inited = true
  document.getElementById('wrap-btn')?.addEventListener('click', generateAndShow)
}
export function teardownWrapped() {
  modal?.remove(); modal = null
  inited = false
}
