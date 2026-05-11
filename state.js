/**
 * Reactive state store + multi-room session management.
 *
 * Each browser may belong to multiple rooms (a partner, a parent, a friend, etc.).
 * `state.rooms` is the membership list; `state.room` / `state.cfg` / `state.me` always
 * refer to the *currently active* room.
 */

export const state = {
  // Active-room fields (all the existing modules read from these)
  room:     null,   // active room code
  cfg:      null,   // active room config row from DB
  me:       null,   // 1 or 2 — your seat in the active room

  messages: [],
  bucket:   [],
  stones:   [],
  unread:   0,
  watch:    null,

  // Multi-room membership (this device's joined rooms)
  rooms:    [],     // [{ code, me, alias?, kind?, theme?, lastSeen? }]

  // Computed helpers (refer to active room)
  myName()    { return this.me === 1 ? this.cfg?.n1 : this.cfg?.n2 },
  theirName() { return this.me === 1 ? this.cfg?.n2 : this.cfg?.n1 },
  myTz()      { return this.me === 1 ? this.cfg?.tz1 : this.cfg?.tz2 },
  theirTz()   { return this.me === 1 ? this.cfg?.tz2 : this.cfg?.tz1 },
  theirIdx()  { return this.me === 1 ? 2 : 1 },
}

// ── Multi-room membership persistence ──
const KEY_ROOMS  = 'ldr_rooms_v2'
const KEY_ACTIVE = 'ldr_active_room'
const KEY_LEGACY = 'ldr_session'  // pre-multi-room single-session storage

function readJson(k, fallback) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
function writeJson(k, v) { localStorage.setItem(k, JSON.stringify(v)) }

/** Read the rooms list from localStorage; auto-migrate the old single-session if present. */
export function loadRoomsList() {
  let rooms = readJson(KEY_ROOMS, null)
  if (!rooms) {
    // Migrate legacy single session
    const legacy = readJson(KEY_LEGACY, null)
    if (legacy?.code && legacy?.me) {
      rooms = [{ code: legacy.code, me: legacy.me, lastSeen: Date.now() }]
      writeJson(KEY_ROOMS, rooms)
    } else {
      rooms = []
    }
  }
  state.rooms = rooms
  return rooms
}

export function saveRoomsList() { writeJson(KEY_ROOMS, state.rooms) }

export function getActiveRoomCode() { return localStorage.getItem(KEY_ACTIVE) || null }
export function setActiveRoomCode(code) {
  if (code) localStorage.setItem(KEY_ACTIVE, code)
  else localStorage.removeItem(KEY_ACTIVE)
}

/** Add (or update) a room in the membership list. */
export function upsertRoomMembership({ code, me, alias, kind, theme }) {
  if (!code || !me) return
  const i = state.rooms.findIndex(r => r.code === code)
  const entry = { code, me, alias, kind, theme, lastSeen: Date.now() }
  if (i >= 0) state.rooms[i] = { ...state.rooms[i], ...entry }
  else state.rooms.push(entry)
  saveRoomsList()
}

/** Remove a room from membership (does not delete the DB row — partner can still use it). */
export function removeRoomMembership(code) {
  state.rooms = state.rooms.filter(r => r.code !== code)
  saveRoomsList()
  if (getActiveRoomCode() === code) setActiveRoomCode(null)
}

/** Sort rooms by recency for the rooms-list UI. */
export function sortedRooms() {
  return [...state.rooms].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
}

// ── Backwards-compat shims used by existing code ──
export function persistSession() {
  if (state.room && state.me) {
    upsertRoomMembership({
      code: state.room, me: state.me,
      alias: state.cfg?.alias, kind: state.cfg?.kind, theme: state.cfg?.theme,
    })
    setActiveRoomCode(state.room)
  }
}

export function clearSession() {
  if (state.room) removeRoomMembership(state.room)
  setActiveRoomCode(null)
}

export function loadSession() {
  // Legacy entry-point — returns the *active* room if any, otherwise null
  loadRoomsList()
  const active = getActiveRoomCode()
  if (active) {
    const r = state.rooms.find(x => x.code === active)
    if (r) return { code: r.code, me: r.me }
  }
  return null
}
