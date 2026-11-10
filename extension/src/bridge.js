/**
 * Content-script half of the page bridge.
 *
 * Injects page-bridge.js into page context and exposes a promise-based call().
 * If injection fails or the page has no player API, `ready` stays false and
 * adapters silently fall back to driving the <video> element directly.
 */

const CHANNEL = 'ldr-theater-bridge'
const TIMEOUT = 1200

export class PageBridge {
  constructor() {
    this.ready   = false
    this.seq     = 0
    this.pending = new Map()
    this.onMessage = this.onMessage.bind(this)
  }

  async init({ probe } = {}) {
    window.addEventListener('message', this.onMessage)

    const url = chrome.runtime.getURL('page-bridge.js')
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script')
        s.src = url
        s.onload  = () => { s.remove(); resolve() }
        s.onerror = () => { s.remove(); reject(new Error('bridge injection blocked')) }
        ;(document.head || document.documentElement).appendChild(s)
      })
    } catch {
      return false   // CSP blocked it - adapters fall back to the element
    }

    if (probe) {
      // Give the page script a beat to register its listener, then verify the
      // player object is actually reachable before we rely on it.
      this.ready = true
      const ok = await this.call(probe).catch(() => false)
      this.ready = Boolean(ok)
    } else {
      this.ready = true
    }
    return this.ready
  }

  onMessage(ev) {
    if (ev.source !== window) return
    const msg = ev.data
    if (!msg || msg.channel !== CHANNEL || msg.dir !== 'res') return
    const entry = this.pending.get(msg.id)
    if (!entry) return
    this.pending.delete(msg.id)
    clearTimeout(entry.timer)
    if (msg.ok) entry.resolve(msg.result)
    else entry.reject(new Error('bridge command failed'))
  }

  call(cmd, args = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('bridge timeout'))
      }, TIMEOUT)
      this.pending.set(id, { resolve, reject, timer })
      window.postMessage({ channel: CHANNEL, dir: 'req', id, cmd, args }, '*')
    })
  }

  destroy() {
    window.removeEventListener('message', this.onMessage)
    for (const { timer, reject } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('bridge destroyed'))
    }
    this.pending.clear()
    this.ready = false
  }
}
