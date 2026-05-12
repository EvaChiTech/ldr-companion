// ============================================================
// LIFE TAB — Calendar, Expenses, Visa, Care coordination
// All practical utilities in one tab.
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'
import { playPing } from './sound.js'

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
const todayISO = () => new Date().toISOString().split('T')[0]

let inited = false

// ============================================================
// CALENDAR
// ============================================================
async function fetchEvents(daysAhead = 60) {
  if (!configured) return []
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const future = new Date(now); future.setDate(future.getDate() + daysAhead)
  const past = new Date(now); past.setDate(past.getDate() - 7)
  const { data } = await sb.from('calendar_events')
    .select('*').eq('room_id', state.room)
    .gte('starts_at', past.toISOString())
    .lte('starts_at', future.toISOString())
    .order('starts_at', { ascending: true })
  return data || []
}

async function addEvent() {
  if (!configured) { showToast('Connection needed first'); return }
  const title = document.getElementById('cal-title').value.trim()
  const dt    = document.getElementById('cal-when').value
  const dur   = parseInt(document.getElementById('cal-dur').value, 10) || 60
  const kind  = document.getElementById('cal-kind').value
  const recurrence = document.getElementById('cal-recurrence')?.value || null
  if (!title || !dt) { showToast('Title + date required'); return }
  try {
    await sb.from('calendar_events').insert({
      room_id: state.room, title,
      starts_at: new Date(dt).toISOString(),
      duration_min: dur, kind,
      recurrence: (recurrence === 'none' ? null : recurrence) || null,
      created_by: state.me,
    })
    document.getElementById('cal-title').value = ''
    document.getElementById('cal-when').value = ''
    showToast('Event added 📅')
    await renderEvents()
  } catch (e) { showToast('Could not save: ' + e.message) }
}

// Expand a recurring event into virtual occurrences within [now-7d, now+60d]
function expandOccurrences(ev) {
  if (!ev.recurrence) return [ev]
  const out = []
  const start  = new Date(ev.starts_at)
  const lookAhead = new Date(); lookAhead.setDate(lookAhead.getDate() + 60)
  const lookBack  = new Date(); lookBack.setDate(lookBack.getDate() - 7)
  const stepDays = ev.recurrence === 'weekly' ? 7 : ev.recurrence === 'biweekly' ? 14 : ev.recurrence === 'monthly' ? 30 : 365
  let occ = new Date(start)
  // Roll forward to the first occurrence >= lookBack
  while (occ < lookBack) occ.setDate(occ.getDate() + stepDays)
  while (occ <= lookAhead) {
    out.push({ ...ev, starts_at: occ.toISOString(), id: `${ev.id}-${occ.getTime()}`, _virtual: occ.getTime() !== start.getTime() })
    occ = new Date(occ); occ.setDate(occ.getDate() + stepDays)
  }
  return out
}

async function deleteEvent(id) {
  await sb.from('calendar_events').delete().eq('id', id)
  await renderEvents()
}

async function renderEvents() {
  const list = document.getElementById('cal-list')
  if (!list) return
  const events = await fetchEvents()
  // Expand recurring events into virtual occurrences
  const expanded = events.flatMap(expandOccurrences).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
  if (!expanded.length) { list.innerHTML = '<div class="empty-state">No events yet. Plan your next call, visit, or shared moment.</div>'; return }
  const tz1 = state.cfg?.tz1, tz2 = state.cfg?.tz2
  const fmt = (iso, tz) => new Date(iso).toLocaleString('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })
  list.innerHTML = expanded.map(e => {
    const realId = String(e.id).split('-')[0]  // virtual ids are "id-timestamp"
    const recurBadge = e.recurrence ? `<span class="cal-recur">↻ ${e.recurrence}</span>` : ''
    return `
    <div class="cal-card kind-${e.kind || 'other'}${e._virtual ? ' virtual' : ''}">
      <div class="cal-title-row">
        <div class="cal-title">${escapeHtml(e.title)} ${recurBadge}</div>
        ${e._virtual ? '' : `<button class="cal-del" data-id="${realId}" title="Remove">×</button>`}
      </div>
      <div class="cal-times">
        <div><span class="cal-tz-label">${escapeHtml(state.cfg.n1)}</span> ${fmt(e.starts_at, tz1)}</div>
        <div><span class="cal-tz-label">${escapeHtml(state.cfg.n2)}</span> ${fmt(e.starts_at, tz2)}</div>
      </div>
      <div class="cal-meta">${e.duration_min || 60} min · ${escapeHtml(e.kind || 'event')}</div>
    </div>`}).join('')
  list.querySelectorAll('.cal-del').forEach(b => b.addEventListener('click', () => deleteEvent(parseInt(b.dataset.id, 10))))
}

// ============================================================
// EXPENSES
// ============================================================
async function fetchExpenses() {
  if (!configured) return []
  const { data } = await sb.from('expenses')
    .select('*').eq('room_id', state.room).order('date', { ascending: false }).limit(50)
  return data || []
}

async function addExpense() {
  if (!configured) { showToast('Connection needed first'); return }
  const note   = document.getElementById('exp-note').value.trim()
  const amount = parseFloat(document.getElementById('exp-amount').value)
  const cur    = document.getElementById('exp-cur').value || 'USD'
  const cat    = document.getElementById('exp-cat').value
  if (!note || !amount || isNaN(amount)) { showToast('Note + amount required'); return }
  try {
    await sb.from('expenses').insert({
      room_id: state.room, paid_by: state.me, amount, currency: cur,
      category: cat, note, split_type: 'even',
    })
    document.getElementById('exp-note').value = ''
    document.getElementById('exp-amount').value = ''
    showToast('Expense logged 💸')
    await renderExpenses()
  } catch (e) { showToast('Could not save: ' + e.message) }
}

async function settleAll() {
  if (!confirm('Mark all unsettled expenses as settled?')) return
  await sb.from('expenses').update({ settled: true, settled_at: new Date().toISOString() })
    .eq('room_id', state.room).eq('settled', false)
  await renderExpenses()
  showToast('All settled ✓')
}

async function renderExpenses() {
  const list = document.getElementById('exp-list')
  const balance = document.getElementById('exp-balance')
  if (!list) return
  const items = await fetchExpenses()
  // Compute balance per currency
  const byCur = {}
  items.filter(e => !e.settled).forEach(e => {
    const half = e.amount / 2
    const owedToMe = e.paid_by === state.me ? half : -half
    if (!byCur[e.currency]) byCur[e.currency] = 0
    byCur[e.currency] += owedToMe
  })
  if (balance) {
    const them = state.theirName?.() || 'partner'
    const lines = Object.entries(byCur).map(([cur, amt]) => {
      if (Math.abs(amt) < 0.01) return `Settled in ${cur}`
      return amt > 0
        ? `${them} owes you <strong>${amt.toFixed(2)} ${cur}</strong>`
        : `You owe ${them} <strong>${(-amt).toFixed(2)} ${cur}</strong>`
    })
    balance.innerHTML = lines.length ? lines.join(' · ') : 'No unsettled expenses'
  }
  if (!items.length) { list.innerHTML = '<div class="empty-state">No expenses yet.</div>'; return }
  list.innerHTML = items.map(e => `
    <div class="exp-row ${e.settled ? 'settled' : ''}">
      <div class="exp-left">
        <div class="exp-note">${escapeHtml(e.note || '')}</div>
        <div class="exp-meta">${e.date} · ${escapeHtml(e.category || 'misc')} · paid by ${escapeHtml(e.paid_by === 1 ? state.cfg.n1 : state.cfg.n2)}${e.settled ? ' · ✓ settled' : ''}</div>
      </div>
      <div class="exp-amt">${e.amount.toFixed(2)} ${e.currency}</div>
    </div>`).join('')
}

// ============================================================
// VISA / PAPERWORK
// ============================================================
const STATUS_LABELS = { todo: 'To do', in_progress: 'In progress', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', done: 'Done' }

async function fetchVisaItems() {
  if (!configured) return []
  const { data } = await sb.from('visa_items')
    .select('*').eq('room_id', state.room).order('due_at', { ascending: true, nullsFirst: false })
  return data || []
}

async function addVisaItem() {
  if (!configured) { showToast('Connection needed first'); return }
  const title  = document.getElementById('vi-title').value.trim()
  const kind   = document.getElementById('vi-kind').value
  const due    = document.getElementById('vi-due').value
  const country= document.getElementById('vi-country').value.trim()
  const forP   = parseInt(document.getElementById('vi-for').value, 10)
  if (!title) { showToast('Title required'); return }
  try {
    await sb.from('visa_items').insert({
      room_id: state.room, title, kind: kind || null,
      due_at: due || null, country: country || null,
      for_partner: forP || null,
    })
    document.getElementById('vi-title').value = ''
    document.getElementById('vi-due').value = ''
    document.getElementById('vi-country').value = ''
    showToast('Item added 📋')
    await renderVisaItems()
  } catch (e) { showToast('Could not save: ' + e.message) }
}

async function updateVisaStatus(id, status) {
  await sb.from('visa_items').update({ status }).eq('id', id)
  await renderVisaItems()
}

async function deleteVisaItem(id) {
  await sb.from('visa_items').delete().eq('id', id)
  await renderVisaItems()
}

async function renderVisaItems() {
  const list = document.getElementById('vi-list')
  if (!list) return
  const items = await fetchVisaItems()
  if (!items.length) { list.innerHTML = '<div class="empty-state">No paperwork tracked yet.</div>'; return }
  const fmtDue = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  list.innerHTML = items.map(it => {
    const overdue = it.due_at && new Date(it.due_at) < new Date() && !['approved','done'].includes(it.status)
    const forName = it.for_partner === 1 ? state.cfg.n1 : it.for_partner === 2 ? state.cfg.n2 : 'us'
    return `
      <div class="vi-row status-${it.status} ${overdue ? 'overdue' : ''}">
        <div class="vi-left">
          <div class="vi-title">${escapeHtml(it.title)}</div>
          <div class="vi-meta">${escapeHtml(it.kind || 'paperwork')} · for ${escapeHtml(forName)}${it.country ? ' · ' + escapeHtml(it.country) : ''} · due ${fmtDue(it.due_at)}</div>
        </div>
        <div class="vi-actions">
          <select class="vi-status" data-id="${it.id}">
            ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${k === it.status ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
          <button class="vi-del" data-id="${it.id}" title="Remove">×</button>
        </div>
      </div>`
  }).join('')
  list.querySelectorAll('.vi-status').forEach(s => s.addEventListener('change', () => updateVisaStatus(parseInt(s.dataset.id, 10), s.value)))
  list.querySelectorAll('.vi-del').forEach(b => b.addEventListener('click', () => deleteVisaItem(parseInt(b.dataset.id, 10))))
}

// ============================================================
// CARE PINGS — "I need a hand from afar"
// ============================================================
const CARE_KINDS = [
  { kind: 'sick',      label: 'I\'m sick',      emoji: '🤒' },
  { kind: 'overwhelm', label: 'Overwhelmed',    emoji: '🌧️' },
  { kind: 'lonely',    label: 'Feeling lonely', emoji: '🌙' },
  { kind: 'celebrate', label: 'Celebrate me!',  emoji: '🎉' },
  { kind: 'errand',    label: 'Errand favor',   emoji: '🛒' },
]

async function sendCarePing(kind) {
  const c = CARE_KINDS.find(k => k.kind === kind)
  if (!c) return
  const message = (window.prompt(`Add a quick note about "${c.label}" (optional):`, '') || '').trim() || null
  await sb.from('care_pings').insert({
    room_id: state.room, for_partner: state.me === 1 ? 2 : 1, kind, message,
  })
  showToast(`Sent: ${c.label} ${c.emoji}`)
  await renderCare()
}

async function resolveCare(id) {
  await sb.from('care_pings').update({ resolved: true }).eq('id', id)
  await renderCare()
}

async function renderCare() {
  const list = document.getElementById('care-list')
  const buttons = document.getElementById('care-buttons')
  if (!list || !buttons) return
  if (!buttons.dataset.bound) {
    buttons.dataset.bound = '1'
    CARE_KINDS.forEach(c => {
      const b = document.createElement('button')
      b.className = 'care-ping-btn'
      b.innerHTML = `<span class="care-ping-emoji">${c.emoji}</span><span>${c.label}</span>`
      b.onclick = () => sendCarePing(c.kind)
      buttons.appendChild(b)
    })
  }
  if (!configured) { list.innerHTML = ''; return }
  const { data } = await sb.from('care_pings')
    .select('*').eq('room_id', state.room).order('created_at', { ascending: false }).limit(10)
  const items = data || []
  if (!items.length) { list.innerHTML = ''; return }
  list.innerHTML = items.map(p => {
    const c = CARE_KINDS.find(k => k.kind === p.kind) || { emoji: '💌', label: p.kind }
    const fromMe = p.for_partner !== state.me  // I sent it (it's "for them")
    return `
      <div class="care-ping ${p.resolved ? 'resolved' : ''} ${fromMe ? 'mine' : 'theirs'}">
        <span class="care-ping-emoji">${c.emoji}</span>
        <div class="care-ping-content">
          <div class="care-ping-label">${fromMe ? 'You sent' : `${state.theirName?.() || 'They'} need`}: ${escapeHtml(c.label)}${p.resolved ? ' ✓' : ''}</div>
          ${p.message ? `<div class="care-ping-msg">${escapeHtml(p.message)}</div>` : ''}
        </div>
        ${!p.resolved && !fromMe ? `<button class="btn btn-secondary btn-sm care-resolve" data-id="${p.id}">I'm on it</button>` : ''}
      </div>`
  }).join('')
  list.querySelectorAll('.care-resolve').forEach(b => b.addEventListener('click', () => resolveCare(parseInt(b.dataset.id, 10))))
}

function showToast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(showToast._tm)
  showToast._tm = setTimeout(() => t.style.opacity = '0', 2200)
}

// ============================================================
// PUBLIC API
// ============================================================
export function initLife() {
  if (inited) return
  inited = true
  document.getElementById('cal-add')?.addEventListener('click', addEvent)
  document.getElementById('exp-add')?.addEventListener('click', addExpense)
  document.getElementById('exp-settle')?.addEventListener('click', settleAll)
  document.getElementById('vi-add')?.addEventListener('click', addVisaItem)
  renderEvents()
  renderExpenses()
  renderVisaItems()
  renderCare()
}

export function onRemoteLifeEvent(kind) {
  if (!inited) return
  if (kind === 'calendar') renderEvents()
  else if (kind === 'expense') renderExpenses()
  else if (kind === 'visa') renderVisaItems()
  else if (kind === 'care') { renderCare(); playPing() }
}

export function teardownLife() { inited = false }
