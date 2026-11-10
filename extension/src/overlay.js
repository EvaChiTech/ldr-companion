/**
 * In-page overlay: presence pill, whisper chat, floating reactions.
 *
 * Everything lives inside one fixed-position host element with its own class
 * namespace (.ldrt-*) so it cannot inherit or disturb the streaming site's
 * styles. Nothing is attached to the site's own DOM subtrees.
 */

const REACTION_TTL = 2400
const MAX_MESSAGES = 60
const EMOJI = ['❤️', '😂', '😭', '😱', '🔥', '👏']

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

export class Overlay {
  /**
   * @param {object} opts
   * @param {(text: string) => void} opts.onSend
   * @param {(emoji: string) => void} opts.onReact
   * @param {(following: boolean) => void} opts.onToggleFollow
   * @param {(typing: boolean) => void} opts.onTyping
   */
  constructor({ onSend, onReact, onToggleFollow, onTyping, partnerName }) {
    this.onSend         = onSend
    this.onReact        = onReact
    this.onToggleFollow = onToggleFollow
    this.onTyping       = onTyping
    this.partnerName    = partnerName || null

    this.host      = null
    this.collapsed = false
    this.following = true
    this.typingTimer = null
    this.typingSent  = false
  }

  mount() {
    if (this.host) return
    const host = el('div', 'ldrt-host ldrt-collapsed-no')
    host.setAttribute('role', 'complementary')
    host.setAttribute('aria-label', 'LDR Theater')

    // -- header -------------------------------------------------
    const head = el('div', 'ldrt-head')
    this.dot   = el('span', 'ldrt-dot')
    this.status = el('span', 'ldrt-status', 'Connecting…')
    const spacer = el('span', 'ldrt-spacer')

    this.followBtn = el('button', 'ldrt-btn ldrt-btn-ghost', 'Following')
    this.followBtn.title = 'Pause syncing without leaving'
    this.followBtn.addEventListener('click', () => {
      this.following = !this.following
      this.followBtn.textContent = this.following ? 'Following' : 'Paused'
      this.followBtn.classList.toggle('ldrt-btn-warn', !this.following)
      this.onToggleFollow?.(this.following)
    })

    this.collapseBtn = el('button', 'ldrt-btn ldrt-btn-ghost', '–')
    this.collapseBtn.title = 'Collapse'
    this.collapseBtn.addEventListener('click', () => this.toggleCollapse())

    head.append(this.dot, this.status, spacer, this.followBtn, this.collapseBtn)

    // -- body ---------------------------------------------------
    this.body = el('div', 'ldrt-body')

    this.warn = el('div', 'ldrt-warn')
    this.warn.style.display = 'none'
    this.body.append(this.warn)

    this.log = el('div', 'ldrt-log')
    this.log.setAttribute('aria-live', 'polite')
    this.body.append(this.log)

    this.typing = el('div', 'ldrt-typing')
    this.typing.style.visibility = 'hidden'
    this.typing.textContent = '…'
    this.body.append(this.typing)

    const reactRow = el('div', 'ldrt-reacts')
    for (const e of EMOJI) {
      const b = el('button', 'ldrt-emoji', e)
      b.title = `Send ${e}`
      b.addEventListener('click', () => this.onReact?.(e))
      reactRow.append(b)
    }
    this.body.append(reactRow)

    const form = el('form', 'ldrt-form')
    this.input = el('input', 'ldrt-input')
    this.input.type = 'text'
    this.input.placeholder = 'Whisper while you watch…'
    this.input.maxLength = 500
    this.input.autocomplete = 'off'

    // Streaming sites bind global keys (space = play/pause, arrows = seek).
    // Keep our keystrokes from reaching them while the user is typing.
    const swallow = (ev) => { ev.stopPropagation() }
    for (const k of ['keydown', 'keyup', 'keypress']) {
      this.input.addEventListener(k, swallow)
    }
    this.input.addEventListener('input', () => this.noteTyping())

    const send = el('button', 'ldrt-btn ldrt-btn-send', 'Send')
    send.type = 'submit'
    form.append(this.input, send)
    form.addEventListener('submit', (ev) => {
      ev.preventDefault()
      const text = this.input.value.trim()
      if (!text) return
      this.input.value = ''
      this.clearTyping()
      this.onSend?.(text)
    })
    this.body.append(form)

    this.reactLayer = el('div', 'ldrt-reactlayer')

    host.append(head, this.body)
    document.documentElement.append(host)
    document.documentElement.append(this.reactLayer)
    this.host = host
  }

  unmount() {
    this.host?.remove()
    this.reactLayer?.remove()
    this.host = null
    if (this.typingTimer) clearTimeout(this.typingTimer)
  }

  toggleCollapse() {
    this.collapsed = !this.collapsed
    this.host.classList.toggle('ldrt-collapsed', this.collapsed)
    this.collapseBtn.textContent = this.collapsed ? '+' : '–'
    this.collapseBtn.title = this.collapsed ? 'Expand' : 'Collapse'
  }

  // -- status -------------------------------------------------

  setStatus(text, kind = 'idle') {
    if (!this.host) return
    this.status.textContent = text
    this.dot.className = `ldrt-dot ldrt-dot-${kind}`
  }

  /**
   * Warn when the two sides are demonstrably on different media.
   * Passing `onOpen` turns the bar into a one-tap "open what they opened".
   */
  setMismatch(peerTitle, onOpen = null) {
    if (!this.host) return
    this.warn.textContent = ''
    if (!peerTitle) { this.warn.style.display = 'none'; return }

    const who = this.partnerName || 'Your partner'
    if (onOpen) {
      this.warn.append(el('span', 'ldrt-warn-text', `${who} started "${peerTitle}".`))
      const btn = el('button', 'ldrt-btn ldrt-btn-open', 'Open it')
      btn.addEventListener('click', () => onOpen())
      this.warn.append(btn)
    } else {
      this.warn.append(el('span', 'ldrt-warn-text',
        `${who} is on "${peerTitle}" — open the same thing to sync up.`))
    }
    this.warn.style.display = ''
  }

  /** Transient notice that we are navigating to the partner's title. */
  setOpening(title) {
    if (!this.host) return
    this.warn.textContent = ''
    this.warn.append(el('span', 'ldrt-warn-text', `Opening "${title}"…`))
    this.warn.style.display = ''
  }

  // -- chat ---------------------------------------------------

  addMessage({ text, who, mine, system }) {
    if (!this.host) return
    const row = el('div', `ldrt-msg${mine ? ' ldrt-mine' : ''}${system ? ' ldrt-sys' : ''}`)
    if (!system) {
      row.append(el('span', 'ldrt-who', who || (mine ? 'You' : 'Partner')))
    }
    row.append(el('span', 'ldrt-text', text))
    this.log.append(row)
    while (this.log.childElementCount > MAX_MESSAGES) this.log.firstElementChild.remove()
    this.log.scrollTop = this.log.scrollHeight
  }

  noteTyping() {
    if (!this.typingSent) { this.typingSent = true; this.onTyping?.(true) }
    if (this.typingTimer) clearTimeout(this.typingTimer)
    this.typingTimer = setTimeout(() => this.clearTyping(), 2200)
  }

  clearTyping() {
    if (this.typingTimer) { clearTimeout(this.typingTimer); this.typingTimer = null }
    if (this.typingSent) { this.typingSent = false; this.onTyping?.(false) }
  }

  setPeerTyping(on, who) {
    if (!this.host) return
    this.typing.textContent = on ? `${who || 'Partner'} is typing…` : '…'
    this.typing.style.visibility = on ? 'visible' : 'hidden'
  }

  // -- reactions ----------------------------------------------

  spawnReaction(emoji) {
    if (!this.reactLayer) return
    const n = el('div', 'ldrt-float', emoji)
    n.style.left = `${12 + Math.random() * 60}%`
    n.style.setProperty('--ldrt-drift', `${(Math.random() * 2 - 1) * 40}px`)
    this.reactLayer.append(n)
    setTimeout(() => n.remove(), REACTION_TTL)
  }
}
