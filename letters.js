// ============================================================
// FUTURE LETTERS — write now, sealed until a future date
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'
import { playPing } from './sound.js'

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
const fmtDate = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const todayISO = () => new Date().toISOString().split('T')[0]

let inited = false

async function fetchLetters() {
  if (!configured) return []
  const { data } = await sb.from('future_letters')
    .select('*').eq('room_id', state.room).order('unlock_at', { ascending: true })
  return data || []
}

async function saveLetter() {
  if (!configured) { showToast('Connection needed first'); return }
  const title = document.getElementById('lt-title').value.trim()
  const body  = document.getElementById('lt-body').value.trim()
  const recip = document.getElementById('lt-recipient').value
  const unlockDate = document.getElementById('lt-unlock').value
  if (!body) { showToast('Letter body required'); return }
  if (!unlockDate) { showToast('Pick a future unlock date'); return }
  const unlock_at = new Date(unlockDate + 'T00:00:00').toISOString()
  if (new Date(unlock_at) <= new Date()) { showToast('Unlock date must be in the future'); return }

  const btn = document.getElementById('lt-save')
  btn.disabled = true
  try {
    await sb.from('future_letters').insert({
      room_id: state.room, written_by: state.me, recipient: recip,
      title: title || null, body, unlock_at,
    })
    document.getElementById('lt-title').value = ''
    document.getElementById('lt-body').value = ''
    document.getElementById('lt-unlock').value = ''
    showToast('Letter sealed 💌')
    playPing()
    await renderList()
  } catch (e) {
    showToast('Could not save: ' + e.message)
  } finally { btn.disabled = false }
}

async function openLetter(id) {
  if (!configured) return
  await sb.from('future_letters').update({ opened_at: new Date().toISOString() }).eq('id', id)
  await renderList()
}

function isUnlocked(letter) {
  return new Date(letter.unlock_at) <= new Date()
}

function whoCan(letter) {
  // 'us' = both, 'partner' = only the OTHER partner, 'self' = only the writer
  if (letter.recipient === 'us')      return true
  if (letter.recipient === 'partner') return state.me !== letter.written_by
  if (letter.recipient === 'self')    return state.me === letter.written_by
  return true
}

async function renderList() {
  const list = document.getElementById('lt-list')
  if (!list) return
  const letters = await fetchLetters()
  if (!letters.length) { list.innerHTML = '<div class="empty-state">No letters sealed yet. Write the first one above.</div>'; return }
  const visible = letters.filter(whoCan)
  const buckets = { upcoming: [], ready: [], opened: [] }
  visible.forEach(l => {
    if (l.opened_at)         buckets.opened.push(l)
    else if (isUnlocked(l))  buckets.ready.push(l)
    else                     buckets.upcoming.push(l)
  })
  const renderLetter = l => {
    const writer = l.written_by === 1 ? state.cfg?.n1 : state.cfg?.n2
    const recipLabel = l.recipient === 'us' ? 'to us' : (l.recipient === 'partner' ? `to ${l.written_by === state.me ? state.theirName?.() : 'you'}` : 'to themselves')
    const unlocked = isUnlocked(l)
    const opened = !!l.opened_at
    return `
      <article class="letter-card ${opened ? 'opened' : unlocked ? 'ready' : 'sealed'}">
        <div class="letter-meta">
          ${unlocked ? '🔓' : '🔒'} ${escapeHtml(writer || '')} → ${escapeHtml(recipLabel)} · unlocks ${fmtDate(l.unlock_at)}
        </div>
        ${l.title ? `<div class="letter-title">${escapeHtml(l.title)}</div>` : ''}
        ${opened || (!unlocked) ?
          (opened ? `<div class="letter-body">${escapeHtml(l.body)}</div>` : `<div class="letter-locked">Sealed until ${fmtDate(l.unlock_at)} 🔒</div>`)
          :
          `<div class="letter-locked-actions">
            <button class="btn btn-primary btn-sm letter-open-btn" data-id="${l.id}">Open this letter ✨</button>
          </div>`
        }
      </article>`
  }
  list.innerHTML = `
    ${buckets.ready.length ? `<div class="letter-section-label">Ready to open</div>${buckets.ready.map(renderLetter).join('')}` : ''}
    ${buckets.opened.length ? `<div class="letter-section-label">Opened</div>${buckets.opened.map(renderLetter).join('')}` : ''}
    ${buckets.upcoming.length ? `<div class="letter-section-label">Sealed for the future</div>${buckets.upcoming.map(renderLetter).join('')}` : ''}
  `
  list.querySelectorAll('.letter-open-btn').forEach(b => {
    b.addEventListener('click', () => openLetter(parseInt(b.dataset.id, 10)))
  })
}

function showToast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(showToast._tm)
  showToast._tm = setTimeout(() => t.style.opacity = '0', 2200)
}

export function initLetters() {
  if (inited) return
  inited = true
  document.getElementById('lt-save')?.addEventListener('click', saveLetter)
  // Default unlock: 1 year from today
  const next = new Date(); next.setFullYear(next.getFullYear() + 1)
  const inp = document.getElementById('lt-unlock')
  if (inp) { inp.min = todayISO(); inp.value = next.toISOString().split('T')[0] }
  renderList()
}

export function onRemoteLetter() { if (inited) renderList() }
export function teardownLetters() { inited = false }
