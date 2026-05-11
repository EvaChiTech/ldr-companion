// ============================================================
// POLISH — global UX behaviours (a11y, keyboard, mobile)
// ============================================================

// Selector list of every modal in the app (each has .hidden when closed)
const MODAL_SELECTORS = [
  '.tone-modal', '.lc-modal', '.auth-modal', '.wrap-modal', '.lightbox',
]

let lastFocusedBeforeModal = null

function visibleModal() {
  for (const sel of MODAL_SELECTORS) {
    const el = document.querySelector(sel)
    if (el && !el.classList.contains('hidden') && el.offsetParent !== null) return el
  }
  return null
}

function closeModalDom(el) {
  if (!el) return
  el.classList.add('hidden')
  // Some overlays remove themselves; if not, restore focus
  if (lastFocusedBeforeModal && document.body.contains(lastFocusedBeforeModal)) {
    try { lastFocusedBeforeModal.focus() } catch {}
  }
  lastFocusedBeforeModal = null
}

// Keyboard wiring
function onKeydown(e) {
  if (e.key === 'Escape') {
    const m = visibleModal()
    if (m) {
      e.preventDefault()
      closeModalDom(m)
      return
    }
    // Close the lightbox-by-id case (legacy: not in MODAL_SELECTORS yet)
    const lb = document.getElementById('lightbox')
    if (lb && !lb.classList.contains('hidden')) { lb.classList.add('hidden'); return }
    // Close the rooms-list-style overlay (back to active room when one exists)
    const rooms = document.getElementById('rooms-list-screen')
    if (rooms && rooms.style.display !== 'none' && document.getElementById('main-app')?.style.display === 'block') {
      rooms.style.display = 'none'
    }
  }
}

// Track focus so we can restore it after the modal closes
function rememberFocus() { lastFocusedBeforeModal = document.activeElement }

// Mark active tab with aria-current="page" so screen readers announce it
function announceTabSwitch() {
  document.querySelectorAll('.tabs .tab').forEach(b => {
    b.setAttribute('aria-current', b.classList.contains('active') ? 'page' : 'false')
    b.setAttribute('role', 'tab')
  })
}

// Watch for tab changes (we don't have a custom event; simplest is observing class changes)
function watchTabsForA11y() {
  const tabs = document.querySelector('.tabs')
  if (!tabs) return
  const obs = new MutationObserver(announceTabSwitch)
  tabs.querySelectorAll('.tab').forEach(t => obs.observe(t, { attributes: true, attributeFilter: ['class'] }))
  announceTabSwitch()
}

// Auto-focus the most likely first input in newly-opened modals (delegated)
function watchModalsForFocus() {
  const obs = new MutationObserver(() => {
    const m = visibleModal()
    if (!m) return
    if (m.dataset.focused) return
    m.dataset.focused = '1'
    rememberFocus()
    setTimeout(() => {
      const target = m.querySelector('input, textarea, select, button:not([disabled])')
      try { target?.focus() } catch {}
    }, 50)
  })
  document.body && obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
}

// Open file/url helpers — lightbox click-to-close binding (existing handler stays)

// Add a "skip to content" link if the user tabs first thing
function ensureSkipLink() {
  if (document.getElementById('skip-link')) return
  const a = document.createElement('a')
  a.id = 'skip-link'
  a.href = '#main-app'
  a.textContent = 'Skip to content'
  a.className = 'skip-link'
  document.body.prepend(a)
}

export function initPolish() {
  // <html lang> in case it wasn't set
  document.documentElement.lang ||= 'en'
  document.addEventListener('keydown', onKeydown)
  watchTabsForA11y()
  watchModalsForFocus()
  ensureSkipLink()

  // Tabs: horizontal scroll snap, scroll active into view on mobile
  const tabs = document.querySelector('.tabs')
  if (tabs) {
    const obs = new MutationObserver(() => {
      const active = tabs.querySelector('.tab.active')
      if (active && tabs.scrollWidth > tabs.clientWidth) {
        active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      }
    })
    tabs.querySelectorAll('.tab').forEach(t => obs.observe(t, { attributes: true, attributeFilter: ['class'] }))
  }
}

// Tag each modal element with proper ARIA roles. Idempotent.
export function tagModalA11y(el, labelId) {
  if (!el) return
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-modal', 'true')
  if (labelId) el.setAttribute('aria-labelledby', labelId)
}
