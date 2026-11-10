// ============================================================
// LIFECYCLE SCOPE
//
// Every tab module in this app follows the same shape: init() wires up DOM
// listeners and timers, teardown() is called when the active room changes, and
// init() may then run again against the *same* static markup.
//
// That pattern leaks unless teardown unregisters precisely what init
// registered. Tracking each listener by hand is where it goes wrong — one
// missed removeEventListener and handlers stack silently, so a user who
// switches rooms three times fires every click handler three times.
//
// A scope bundles listeners and timers together so teardown is one call and
// cannot drift out of step with init:
//
//   const scope = createScope()
//   scope.on(btn, 'click', onClick)
//   scope.interval(tick, 1000)
//   ...
//   scope.destroy()        // removes the listeners AND clears the timers
//
// Listener removal rides on AbortController, which browsers apply natively to
// addEventListener via the `signal` option — so it is exact, covers listeners
// added to window/document just as well as to elements, and needs no bookkeeping.
// A scope is reusable: destroy() leaves it ready for the next init().
// ============================================================

/**
 * @typedef {object} Scope
 * @property {AbortSignal} signal           pass to APIs that accept one (e.g. fetch)
 * @property {(t: EventTarget|null|undefined, type: string, fn: Function, opts?: object) => void} on
 * @property {(fn: Function, ms: number) => number} interval
 * @property {(fn: Function, ms: number) => number} timeout
 * @property {(id: number) => void} clear
 * @property {() => void} destroy
 */

/** @returns {Scope} */
export function createScope() {
  let ac = new AbortController()
  const timers = new Set()

  return {
    get signal() { return ac.signal },

    /**
     * Add a listener bound to this scope. Target may be null so callers can
     * pass an optional element without guarding every line.
     */
    on(target, type, fn, opts) {
      if (!target?.addEventListener) return
      target.addEventListener(type, fn, { ...(opts || {}), signal: ac.signal })
    },

    interval(fn, ms) {
      const id = setInterval(fn, ms)
      timers.add(id)
      return id
    },

    timeout(fn, ms) {
      // Self-removing so long-lived scopes don't accumulate finished ids.
      const id = setTimeout(() => { timers.delete(id); fn() }, ms)
      timers.add(id)
      return id
    },

    clear(id) {
      if (id == null) return
      clearInterval(id)
      clearTimeout(id)
      timers.delete(id)
    },

    destroy() {
      ac.abort()
      for (const id of timers) { clearInterval(id); clearTimeout(id) }
      timers.clear()
      // Fresh controller: the aborted one would reject every later listener.
      ac = new AbortController()
    },
  }
}

/**
 * Reject any URL we would not be willing to navigate to or embed.
 * Blocks javascript:/data:/vbscript: — `esc()` stops an attacker breaking out
 * of an HTML attribute but does nothing about a hostile scheme inside one.
 * @param {string} raw
 * @param {{ hosts?: string[] }} [opts] optional hostname allowlist (exact or subdomain)
 * @returns {string|null} the URL when safe, else null
 */
export function safeHttpUrl(raw, opts = {}) {
  let u
  try { u = new URL(String(raw)) } catch { return null }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const hosts = opts.hosts
  if (Array.isArray(hosts) && hosts.length) {
    const h = u.hostname.toLowerCase()
    const ok = hosts.some(d => h === d || h.endsWith(`.${d}`))
    if (!ok) return null
  }
  return u.href
}
