// ============================================================
// DREAM JOURNAL — both log dreams; AI surfaces shared themes.
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'
import { playPing } from './sound.js'

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const todayISO = () => new Date().toISOString().split('T')[0]
const whoFor = idx => idx === 1 ? (state.cfg?.n1 || 'P1') : (state.cfg?.n2 || 'P2')

let inited = false

async function fetchDreams(limit = 30) {
  if (!configured) return []
  const { data } = await sb.from('dreams')
    .select('*').eq('room_id', state.room).order('date', { ascending: false }).limit(limit)
  return data || []
}

async function saveDream() {
  if (!configured) { showToast('Connection needed first'); return }
  const inp = document.getElementById('dr-content')
  const text = inp.value.trim()
  if (!text) return
  const btn = document.getElementById('dr-save')
  btn.disabled = true
  try {
    await sb.from('dreams').insert({
      room_id: state.room, partner_idx: state.me, date: todayISO(), content: text,
    })
    inp.value = ''
    showToast('Dream logged 🌙')
    playPing()
    await renderList()
  } catch (e) { showToast('Could not save: ' + e.message) }
  finally { btn.disabled = false }
}

async function findThemes() {
  if (!configured) return
  const out = document.getElementById('dr-themes')
  const lo  = document.getElementById('dr-themes-loading')
  if (!out) return
  out.innerHTML = ''; lo.style.display = 'flex'
  try {
    const dreams = (await fetchDreams(30)).map(d => ({ date: d.date, who: whoFor(d.partner_idx), content: d.content }))
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
    const { data, error } = await sb.functions.invoke('dream-themes', {
      body: { n1: state.cfg.n1, n2: state.cfg.n2, dreams, apiKey },
    })
    lo.style.display = 'none'
    if (error) throw error
    const shared = data?.shared_themes || []
    const o1 = data?.only_n1 || []
    const o2 = data?.only_n2 || []
    out.innerHTML = `
      ${shared.length ? `<div class="dr-section-label">Themes you both share</div>
        ${shared.map(t => `<div class="dr-theme-card shared">
          <div class="dr-theme-name">${escapeHtml(t.theme || '')}</div>
          <div class="dr-theme-text">${escapeHtml(t.reflection || '')}</div>
        </div>`).join('')}` : ''}
      ${(o1.length || o2.length) ? `<div class="dr-section-label">Just yours</div>
        <div class="dr-only-grid">
          ${o1.length ? `<div><div class="dr-only-name">${escapeHtml(state.cfg.n1)}</div>${o1.map(t => `<span class="dr-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
          ${o2.length ? `<div><div class="dr-only-name">${escapeHtml(state.cfg.n2)}</div>${o2.map(t => `<span class="dr-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        </div>` : ''}
      ${(!shared.length && !o1.length && !o2.length) ? '<div class="empty-state">Log a few more dreams first.</div>' : ''}
    `
  } catch (e) {
    lo.style.display = 'none'
    out.innerHTML = `<div class="empty-state">Couldn't read themes: ${escapeHtml(e.message || String(e))}</div>`
  }
}

async function renderList() {
  const list = document.getElementById('dr-list')
  if (!list) return
  const dreams = await fetchDreams(30)
  if (!dreams.length) { list.innerHTML = '<div class="empty-state">No dreams logged yet. Last night?</div>'; return }
  list.innerHTML = dreams.map(d => `
    <div class="dr-card ${d.partner_idx === state.me ? 'mine' : 'theirs'}">
      <div class="dr-meta"><span class="dr-who">${escapeHtml(whoFor(d.partner_idx))}</span> · ${fmtDate(d.date)}</div>
      <div class="dr-content">${escapeHtml(d.content)}</div>
    </div>`).join('')
}

function showToast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(showToast._tm)
  showToast._tm = setTimeout(() => t.style.opacity = '0', 2200)
}

export function initDreams() {
  if (inited) return
  inited = true
  document.getElementById('dr-save')?.addEventListener('click', saveDream)
  document.getElementById('dr-themes-btn')?.addEventListener('click', findThemes)
  renderList()
}
export function onRemoteDream() { if (inited) renderList() }
export function teardownDreams() { inited = false }
