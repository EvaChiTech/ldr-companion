// ============================================================
// ROOMS LIST — chat-room style screen showing all rooms this device
// has joined. Grouped by category (Lover, Family, Friend, etc.),
// themed by per-room theme. Tap a card to enter, "+" to add a new one.
// ============================================================
import { state, loadRoomsList, sortedRooms, removeRoomMembership } from './state.js'
import { configured, sb } from './supabase.js'
import { isSignedIn, deleteRoomLink, pullServerRooms } from './auth.js'

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))

const KIND_META = {
  couple:        { label: 'Lover',         emoji: '💕', order: 1 },
  family:        { label: 'Family',        emoji: '🏡', order: 2 },
  parent_child:  { label: 'Parent · Child',emoji: '👨‍👧', order: 3 },
  siblings:      { label: 'Siblings',      emoji: '🧑‍🤝‍🧑', order: 4 },
  chosen_family: { label: 'Chosen Family', emoji: '🌿', order: 5 },
  friend:        { label: 'Friend',        emoji: '🤝', order: 6 },
  other:         { label: 'Other',         emoji: '✨', order: 7 },
}

const THEME_SWATCH = {
  warm:     ['#C4594A', '#FCEFE6'],
  ocean:    ['#2A5F7A', '#E8F2F7'],
  forest:   ['#4F8A4A', '#E8F2EA'],
  sunset:   ['#E0617A', '#FFE8E0'],
  lavender: ['#8E6FB3', '#EFE6F7'],
  mono:     ['#3A3A3A', '#EAEAEA'],
  noir:     ['#1A1A1A', '#2A2A2A'],
}

let inited = false
let onSelectCallback = null

// Hydrate each room's membership entry with its DB row (names, theme, kind, alias)
async function hydrateRooms() {
  loadRoomsList()
  // If user is signed in, pull server-side links first so other devices' rooms appear
  if (isSignedIn()) { try { await pullServerRooms() } catch {} }
  if (!configured || !state.rooms.length) return state.rooms
  const codes = state.rooms.map(r => r.code)
  const { data } = await sb.from('rooms').select('id,n1,n2,kind,theme,alias,since,visit,interests,tz1,tz2').in('id', codes)
  const byCode = Object.fromEntries((data || []).map(r => [r.id, r]))
  state.rooms = state.rooms.map(r => {
    const row = byCode[r.code]
    if (!row) return r  // partner deleted the room or it's new — keep stub
    return { ...r, alias: row.alias, kind: row.kind, theme: row.theme, n1: row.n1, n2: row.n2 }
  })
  // Drop stub entries that no longer exist on the server
  state.rooms = state.rooms.filter(r => byCode[r.code])
  return state.rooms
}

function partnerNameFor(r) {
  return r.me === 1 ? r.n2 : r.n1
}

function renderCard(r) {
  const meta = KIND_META[r.kind || 'couple'] || KIND_META.other
  const swatch = THEME_SWATCH[r.theme || 'warm'] || THEME_SWATCH.warm
  const partner = partnerNameFor(r) || 'Partner'
  const title = r.alias?.trim() || `${r.n1 || ''} & ${r.n2 || ''}`.trim() || r.code
  return `
    <div class="room-card" data-code="${escapeHtml(r.code)}" data-theme="${escapeHtml(r.theme || 'warm')}"
         style="--rc-accent:${swatch[0]};--rc-bg:${swatch[1]};">
      <div class="room-card-side"></div>
      <div class="room-card-body">
        <div class="room-card-head">
          <span class="room-kind-emoji">${meta.emoji}</span>
          <span class="room-card-title">${escapeHtml(title)}</span>
          <button class="room-leave" type="button" data-code="${escapeHtml(r.code)}" title="Leave room (you can rejoin with the code)">⋯</button>
        </div>
        <div class="room-card-sub">with ${escapeHtml(partner)} · code <code class="room-code">${escapeHtml(r.code)}</code></div>
      </div>
    </div>`
}

function renderEmpty() {
  return `
    <div class="rooms-empty">
      <div class="rooms-empty-emoji">🪟</div>
      <h3>No rooms yet</h3>
      <p>Create your first room or join one with a code your loved one shared.</p>
    </div>`
}

function renderGroups(rooms) {
  const groups = {}
  rooms.forEach(r => {
    const k = r.kind || 'couple'
    if (!groups[k]) groups[k] = []
    groups[k].push(r)
  })
  const keys = Object.keys(groups).sort((a, b) => (KIND_META[a]?.order ?? 99) - (KIND_META[b]?.order ?? 99))
  return keys.map(k => {
    const meta = KIND_META[k] || KIND_META.other
    return `
      <section class="room-group">
        <div class="room-group-label">${meta.emoji} ${meta.label}</div>
        <div class="room-group-list">${groups[k].map(renderCard).join('')}</div>
      </section>`
  }).join('')
}

async function render() {
  const root = document.getElementById('rooms-list-screen')
  if (!root) return
  await hydrateRooms()
  const rooms = sortedRooms()
  root.innerHTML = `
    <div class="rooms-list-wrap">
      <div class="rooms-list-head">
        <div>
          <div class="rooms-list-title">Your rooms</div>
          <div class="rooms-list-sub">Every connection in one place.</div>
        </div>
        <div class="rooms-list-actions">
          <button id="rooms-add-create" class="btn btn-primary  btn-sm">+ New room</button>
          <button id="rooms-add-join"   class="btn btn-secondary btn-sm">Join with code</button>
          <button id="rooms-account"    class="btn btn-ghost     btn-sm">${isSignedIn() ? '👤 Account' : '🔓 Sign in'}</button>
        </div>
      </div>
      ${rooms.length ? renderGroups(rooms) : renderEmpty()}
      <footer class="rooms-list-footer">
        <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · <a href="/landing.html">About</a>
      </footer>
    </div>`

  // Wire interactions
  root.querySelectorAll('.room-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.room-leave')) return  // handled separately
      const code = card.dataset.code
      onSelectCallback?.(code)
    })
  })
  root.querySelectorAll('.room-leave').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const code = btn.dataset.code
      const r = state.rooms.find(x => x.code === code)
      const partner = r ? (partnerNameFor(r) || 'partner') : 'partner'
      if (!confirm(`Remove this room from this device? You can rejoin with the code at any time. This won't affect ${partner}'s side.`)) return
      removeRoomMembership(code)
      if (isSignedIn()) deleteRoomLink(code).catch(console.error)
      render()
    })
  })
  document.getElementById('rooms-add-create')?.addEventListener('click', () => {
    showOnboarding('ob-create')
  })
  document.getElementById('rooms-add-join')?.addEventListener('click', () => {
    showOnboarding('ob-join')
  })
  document.getElementById('rooms-account')?.addEventListener('click', async () => {
    const { openAuthModal } = await import('./auth.js')
    openAuthModal()
  })
}

function showOnboarding(panel) {
  const list = document.getElementById('rooms-list-screen')
  const ob   = document.getElementById('onboarding')
  if (list) list.style.display = 'none'
  if (ob)   ob.style.display = 'flex'
  // Use the existing app.obShow() which knows how to switch panels
  if (window.app?.obShow) window.app.obShow(panel)
}

export async function initRoomsList(onSelect) {
  inited = true
  onSelectCallback = onSelect
  await render()
}

export function showRoomsList() {
  const list  = document.getElementById('rooms-list-screen')
  const main  = document.getElementById('main-app')
  const ob    = document.getElementById('onboarding')
  const load  = document.getElementById('loading')
  if (list)  list.style.display = 'flex'
  if (main)  main.style.display = 'none'
  if (ob)    ob.style.display = 'none'
  if (load)  load.style.display = 'none'
  if (inited) render()
}

export function hideRoomsList() {
  const list = document.getElementById('rooms-list-screen')
  if (list) list.style.display = 'none'
}

export async function refreshRoomsList() { if (inited) await render() }
