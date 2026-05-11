// ============================================================
// AUTH + CROSS-DEVICE SYNC
// Magic-link sign-in via Supabase Auth. When a user is signed in,
// their rooms list is mirrored to user_room_links so it follows them
// to any device. Anonymous flow (localStorage-only) keeps working.
// ============================================================
import { sb, configured } from './supabase.js'
import { state, loadRoomsList, saveRoomsList, upsertRoomMembership, removeRoomMembership } from './state.js'

let currentUser = null
let authListeners = []
let modal = null

export function getUser() { return currentUser }
export function isSignedIn() { return !!currentUser }
export function onAuthChange(fn) { authListeners.push(fn); return () => { authListeners = authListeners.filter(x => x !== fn) } }

function emitChange() { authListeners.forEach(fn => { try { fn(currentUser) } catch (e) { console.error(e) } }) }

// ── Init: pick up existing session, subscribe to changes ──
export async function initAuth() {
  if (!configured || !sb) return
  try {
    const { data: { session } } = await sb.auth.getSession()
    currentUser = session?.user || null
    sb.auth.onAuthStateChange(async (_event, sess) => {
      const next = sess?.user || null
      const wasSignedIn = !!currentUser
      currentUser = next
      // On first sign-in, sync existing local rooms up to the server, then pull
      if (currentUser && !wasSignedIn) {
        await syncLocalToServer()
        await pullServerRooms()
      }
      emitChange()
      updateBadgeUI()
    })
    updateBadgeUI()
    // If already signed in on load, pull server-side rooms
    if (currentUser) await pullServerRooms()
  } catch (e) {
    console.warn('[auth] init', e)
  }
}

// ── Sign-in via magic link ──
export async function sendMagicLink(email) {
  if (!sb) throw new Error('Connection not configured')
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  })
  if (error) throw error
}

export async function signOut() {
  if (!sb) return
  await sb.auth.signOut()
  currentUser = null
  emitChange()
  updateBadgeUI()
}

// ── Sync helpers ──
export async function pullServerRooms() {
  if (!currentUser || !sb) return
  const { data, error } = await sb.from('user_room_links')
    .select('room_code,me,alias,kind,theme,last_seen')
    .order('last_seen', { ascending: false })
  if (error) { console.warn('[auth] pull', error); return }
  loadRoomsList()
  ;(data || []).forEach(link => {
    upsertRoomMembership({
      code: link.room_code, me: link.me,
      alias: link.alias, kind: link.kind, theme: link.theme,
    })
  })
  saveRoomsList()
}

export async function syncLocalToServer() {
  if (!currentUser || !sb) return
  loadRoomsList()
  if (!state.rooms.length) return
  const rows = state.rooms.map(r => ({
    user_id: currentUser.id,
    room_code: r.code, me: r.me,
    alias: r.alias || null, kind: r.kind || null, theme: r.theme || null,
    last_seen: new Date().toISOString(),
  }))
  await sb.from('user_room_links').upsert(rows, { onConflict: 'user_id,room_code' })
}

export async function pushRoomLink({ code, me, alias, kind, theme }) {
  if (!currentUser || !sb) return
  await sb.from('user_room_links').upsert({
    user_id: currentUser.id, room_code: code, me,
    alias: alias || null, kind: kind || null, theme: theme || null,
    last_seen: new Date().toISOString(),
  }, { onConflict: 'user_id,room_code' })
}

export async function deleteRoomLink(code) {
  if (!currentUser || !sb) return
  await sb.from('user_room_links').delete().eq('user_id', currentUser.id).eq('room_code', code)
}

// ── Modal UI ──
function buildModal() {
  if (modal) return modal
  modal = document.createElement('div')
  modal.id = 'auth-modal'
  modal.className = 'auth-modal hidden'
  modal.innerHTML = `
    <div class="auth-card">
      <div class="auth-head">
        <div class="auth-title">Sign in to sync your rooms</div>
        <button class="auth-close" type="button">×</button>
      </div>
      <div class="auth-body">
        <p class="auth-sub">Sign in with your email and your rooms follow you to any device. We'll send a magic link — no password needed.</p>
        <input id="auth-email" type="email" placeholder="you@example.com" autocomplete="email">
        <button id="auth-send" class="btn btn-primary btn-full" type="button">Send magic link</button>
        <div id="auth-status" class="auth-status"></div>
        <div class="auth-foot">
          <button id="auth-skip" class="btn btn-ghost btn-sm" type="button">Skip — use this device only</button>
        </div>
      </div>
      <div class="auth-body auth-signed-in" style="display:none;">
        <div id="auth-user-line" class="auth-user-line"></div>
        <button id="auth-signout" class="btn btn-secondary btn-full" type="button">Sign out</button>
      </div>
    </div>`
  document.body.appendChild(modal)
  modal.querySelector('.auth-close').onclick = closeModal
  modal.addEventListener('click', e => { if (e.target === modal) closeModal() })
  modal.querySelector('#auth-skip').onclick = closeModal
  modal.querySelector('#auth-send').onclick = async () => {
    const email = modal.querySelector('#auth-email').value.trim()
    if (!email) return
    const status = modal.querySelector('#auth-status')
    const btn = modal.querySelector('#auth-send')
    btn.disabled = true; status.textContent = 'Sending…'
    try {
      await sendMagicLink(email)
      status.innerHTML = `✓ Check <strong>${email}</strong>. Open the link on this device to finish signing in.`
    } catch (e) {
      status.textContent = 'Error: ' + (e.message || 'failed')
    } finally { btn.disabled = false }
  }
  modal.querySelector('#auth-signout').onclick = async () => {
    await signOut()
    closeModal()
  }
  return modal
}

function refreshModalState() {
  if (!modal) return
  const signedInBlock = modal.querySelector('.auth-signed-in')
  const signInBlock   = modal.querySelector('.auth-body:not(.auth-signed-in)')
  const userLine      = modal.querySelector('#auth-user-line')
  if (currentUser) {
    if (signInBlock)   signInBlock.style.display = 'none'
    if (signedInBlock) signedInBlock.style.display = ''
    if (userLine) userLine.innerHTML = `Signed in as <strong>${currentUser.email || ''}</strong>. Your rooms sync across devices.`
  } else {
    if (signInBlock)   signInBlock.style.display = ''
    if (signedInBlock) signedInBlock.style.display = 'none'
  }
}

export function openAuthModal() { buildModal(); refreshModalState(); modal.classList.remove('hidden') }
function closeModal() { modal?.classList.add('hidden') }

function updateBadgeUI() {
  const btn = document.getElementById('account-toggle')
  if (!btn) return
  btn.textContent = currentUser ? '👤' : '🔓'
  btn.title = currentUser ? `Signed in as ${currentUser.email}` : 'Sign in to sync rooms across devices'
  btn.classList.toggle('signed-in', !!currentUser)
  if (modal) refreshModalState()
}

export function initAccountButton() {
  const btn = document.getElementById('account-toggle')
  if (!btn || btn.dataset.bound) return
  btn.dataset.bound = '1'
  btn.addEventListener('click', openAuthModal)
  updateBadgeUI()
}
