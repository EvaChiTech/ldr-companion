/**
 * Simple reactive state store for the LDR app.
 * All mutable state lives here; UI modules subscribe to changes.
 */

export const state = {
  room:     null,   // room code string
  cfg:      null,   // room config object from DB
  me:       null,   // 1 or 2

  messages: [],
  bucket:   [],
  stones:   [],
  unread:   0,

  // Computed helpers
  myName()    { return this.me === 1 ? this.cfg?.n1 : this.cfg?.n2 },
  theirName() { return this.me === 1 ? this.cfg?.n2 : this.cfg?.n1 },
  myTz()      { return this.me === 1 ? this.cfg?.tz1 : this.cfg?.tz2 },
  theirTz()   { return this.me === 1 ? this.cfg?.tz2 : this.cfg?.tz1 },
  theirIdx()  { return this.me === 1 ? 2 : 1 },
}

// Persist session so browser refresh doesn't log you out
export function persistSession() {
  localStorage.setItem('ldr_session', JSON.stringify({ code: state.room, me: state.me }))
}

export function clearSession() {
  localStorage.removeItem('ldr_session')
}

export function loadSession() {
  try {
    const s = localStorage.getItem('ldr_session')
    return s ? JSON.parse(s) : null
  } catch { return null }
}
