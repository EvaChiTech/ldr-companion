// ============================================================
// MOOD PATTERN VISUALIZER — inline SVG line chart of both partners' moods.
// Range toggle: 30 / 90 / 365 days. Detects basic patterns.
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'

const MOOD_SCORES = {
  'Excited ✨':       9,
  'Happy 😊':         8,
  'Grateful 🙏':      7,
  'Peaceful 🌿':      6,
  'Missing you 💭':   4,
  'Lonely 🌧':        2,
}

const PREF_RANGE = 'ldr_mood_range'
const getRange = () => parseInt(localStorage.getItem(PREF_RANGE) || '30', 10)
const setRange = r => localStorage.setItem(PREF_RANGE, String(r))

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))

let inited = false

async function fetchMoods(days) {
  if (!configured) return []
  const since = new Date(); since.setDate(since.getDate() - days)
  const sinceISO = since.toISOString().split('T')[0]
  const { data } = await sb.from('moods')
    .select('date,partner_idx,mood')
    .eq('room_id', state.room)
    .gte('date', sinceISO)
    .order('date', { ascending: true })
  return data || []
}

function bucketByDate(moods, partner) {
  // For each date, last mood wins (in case of multiple)
  const map = {}
  moods.filter(m => m.partner_idx === partner).forEach(m => {
    map[m.date] = MOOD_SCORES[m.mood] ?? 5
  })
  return map
}

function dateRange(days) {
  const out = []
  const today = new Date(); today.setHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i)
    out.push(d.toISOString().split('T')[0])
  }
  return out
}

function detectPattern(moods, days) {
  // Simple: per weekday, average. Find lowest weekday.
  const byDow = [[],[],[],[],[],[],[]]
  moods.forEach(m => {
    const score = MOOD_SCORES[m.mood] ?? 5
    const dow = new Date(m.date + 'T00:00:00').getDay()
    byDow[dow].push(score)
  })
  const avgs = byDow.map(arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null)
  const filled = avgs.map((a, i) => ({ a, i })).filter(x => x.a != null)
  if (filled.length < 4) return null
  const overall = filled.reduce((s, x) => s + x.a, 0) / filled.length
  const lowest = filled.sort((a,b)=>a.a-b.a)[0]
  if (overall - lowest.a < 0.8) return null  // not a meaningful dip
  const DOW = ['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays']
  return `${DOW[lowest.i]} run a bit heavier — worth a planned call?`
}

function renderChart(days) {
  return fetchMoods(days).then(moods => {
    const dates = dateRange(days)
    const m1 = bucketByDate(moods, 1)
    const m2 = bucketByDate(moods, 2)
    const w = 600, h = 180, padL = 28, padR = 12, padT = 14, padB = 22
    const innerW = w - padL - padR, innerH = h - padT - padB
    const xFor = i => padL + (innerW * i) / Math.max(1, dates.length - 1)
    const yFor = v => padT + innerH * (1 - (v - 1) / 8)  // scale 1-9 to chart

    function lineFor(map, color) {
      const pts = []
      dates.forEach((d, i) => {
        if (map[d] != null) pts.push({ x: xFor(i), y: yFor(map[d]) })
      })
      if (!pts.length) return ''
      const path = pts.map((p, i) => (i === 0 ? `M${p.x.toFixed(1)},${p.y.toFixed(1)}` : `L${p.x.toFixed(1)},${p.y.toFixed(1)}`)).join(' ')
      const dots = pts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${color}"/>`).join('')
      return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>${dots}`
    }

    const grid = [2, 4, 6, 8].map(v =>
      `<line x1="${padL}" x2="${w-padR}" y1="${yFor(v)}" y2="${yFor(v)}" stroke="rgba(35,21,16,0.06)" stroke-dasharray="2 4"/>` +
      `<text x="${padL-4}" y="${(yFor(v)+3).toFixed(1)}" font-size="9" fill="#B8A49E" text-anchor="end">${v}</text>`
    ).join('')

    // X labels — only first, middle, last
    const xLabels = [0, Math.floor(dates.length/2), dates.length-1].map(i => {
      const d = new Date(dates[i] + 'T00:00:00')
      const lbl = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return `<text x="${xFor(i)}" y="${h-6}" font-size="10" fill="#B8A49E" text-anchor="middle">${lbl}</text>`
    }).join('')

    const svg = `<svg viewBox="0 0 ${w} ${h}" class="mood-svg">
      ${grid}
      ${lineFor(m1, '#C4594A')}
      ${lineFor(m2, '#2A5F7A')}
      ${xLabels}
    </svg>`

    const out = document.getElementById('mood-svg-wrap')
    if (out) out.innerHTML = svg

    // Pattern note
    const pattern = detectPattern(moods, days)
    const noteEl = document.getElementById('mood-pattern')
    if (noteEl) noteEl.textContent = pattern || ''

    // Legend
    const legend = document.getElementById('mood-legend')
    if (legend) legend.innerHTML = `
      <span class="mood-legend-key"><span class="dot p1"></span>${escapeHtml(state.cfg?.n1 || 'Partner 1')}</span>
      <span class="mood-legend-key"><span class="dot p2"></span>${escapeHtml(state.cfg?.n2 || 'Partner 2')}</span>`
  })
}

function buildRangeButtons() {
  const wrap = document.getElementById('mood-range')
  if (!wrap || wrap.dataset.bound) return
  wrap.dataset.bound = '1'
  const cur = getRange()
  ;[30, 90, 365].forEach(r => {
    const b = wrap.querySelector(`[data-range="${r}"]`)
    if (!b) return
    if (r === cur) b.classList.add('active')
    b.onclick = () => {
      setRange(r)
      wrap.querySelectorAll('button').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      renderChart(r)
    }
  })
}

export function initMoodViz() {
  if (inited) return
  inited = true
  buildRangeButtons()
  renderChart(getRange())
}
export function teardownMoodViz() { inited = false }
