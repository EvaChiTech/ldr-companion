// ============================================================
// ICON SYSTEM
//
// A hand-built SVG sprite, injected once and referenced with <use>. Replaces
// the emoji that were doing structural work in the UI — emoji render as a
// different glyph on every OS, can't inherit colour or stroke weight, and are
// the single clearest "unfinished" tell in an interface.
//
// Emoji are deliberately KEPT where they are content rather than chrome:
// reactions, mood pills, and card suits. Those are expression, not iconography.
//
// All paths are original, drawn on a 24×24 grid with a 1.75 stroke and round
// caps/joins so every icon shares one visual language. `currentColor` means
// they theme themselves from whatever text colour they sit in.
// ============================================================

const VIEWBOX = '0 0 24 24'

/** name → inner markup, drawn on a 24×24 grid. */
const PATHS = {
  // ── primary navigation ──────────────────────────────────
  home:     '<path d="M3.5 10.5 12 4l8.5 6.5"/><path d="M5.5 9.5V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5"/><path d="M10 20v-5.5h4V20"/>',
  chat:     '<path d="M20 12.5a7 7 0 0 1-7 7H8l-4 2.5.9-3.6A7 7 0 0 1 11 5.5h2a7 7 0 0 1 7 7Z"/>',
  together: '<circle cx="8.5" cy="9" r="2.8"/><circle cx="16" cy="9" r="2.3"/><path d="M3.5 19c.6-2.8 2.6-4.3 5-4.3s4.4 1.5 5 4.3"/><path d="M15 14.9c2 .3 3.4 1.7 3.9 4.1"/>',
  story:    '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5Z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5Z"/>',
  life:     '<path d="M12 21s-7-4.7-7-10a7 7 0 0 1 14 0c0 5.3-7 10-7 10Z"/><circle cx="12" cy="10.5" r="2.5"/>',

  // ── sections & actions ──────────────────────────────────
  clock:    '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  heart:    '<path d="M12 20s-7.5-4.8-7.5-9.8A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.8C19.5 15.2 12 20 12 20Z"/>',
  camera:   '<path d="M3.5 8.5h3l1.4-2h6.2l1.4 2h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3"/>',
  video:    '<rect x="3" y="6.5" width="12" height="11" rx="2"/><path d="M15 11.5 21 8v8l-6-3.5Z"/>',
  game:     '<rect x="3" y="7.5" width="18" height="9" rx="3.5"/><path d="M7.5 10.5v3M6 12h3"/><circle cx="16" cy="11.5" r="1"/><circle cx="18" cy="13.5" r="1"/>',
  puzzle:   '<path d="M4.5 4.5h5a1.8 1.8 0 1 1 3.6 0h5v5a1.8 1.8 0 1 0 0 3.6v5h-5a1.8 1.8 0 1 0-3.6 0h-5v-5a1.8 1.8 0 1 1 0-3.6Z"/>',
  pencil:   '<path d="m5 19 .9-3.4 9.3-9.3a1.7 1.7 0 0 1 2.4 0l1.1 1.1a1.7 1.7 0 0 1 0 2.4l-9.3 9.3Z"/><path d="m14 7.5 2.5 2.5"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  mail:     '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  book:     '<path d="M4 5a1 1 0 0 1 1-1h5.5A2.5 2.5 0 0 1 13 6.5V20a2 2 0 0 0-2-2H4Z"/><path d="M20 5a1 1 0 0 0-1-1h-5.5A2.5 2.5 0 0 0 11 6.5V20a2 2 0 0 1 2-2h7Z"/>',
  moon:     '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z"/>',
  sparkle:  '<path d="M12 3.5 13.6 9 19 10.6 13.6 12.2 12 17.7 10.4 12.2 5 10.6 10.4 9Z"/><path d="M18.5 16.5 19.2 18.8 21.5 19.5 19.2 20.2 18.5 22.5 17.8 20.2 15.5 19.5 17.8 18.8Z"/>',
  pin:      '<path d="M12 21s-6.5-5-6.5-9.8A6.5 6.5 0 0 1 18.5 11c0 4.8-6.5 10-6.5 10Z"/><circle cx="12" cy="11" r="2.3"/>',
  plane:    '<path d="M21 4.5 3 11.2l6 2.3 1.7 6.3 2.9-4.6 5.1 3.4Z"/><path d="m9 13.5 10-9"/>',
  globe:    '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4a13 13 0 0 1 0 16 13 13 0 0 1 0-16Z"/>',
  pulse:    '<path d="M3 12.5h4l2-5 3.5 10 2.5-6 1.5 3h4.5"/>',
  mic:      '<rect x="9.5" y="3.5" width="5" height="10" rx="2.5"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21M9.5 21h5"/>',
  brush:    '<path d="M14.5 4.8 19.2 9.5 10 18.7a3.3 3.3 0 0 1-4.7-4.7Z"/><path d="M6.5 15.5 3.5 20.5l5-3"/>',
  list:     '<path d="M8.5 7h11M8.5 12h11M8.5 17h11"/><circle cx="4.5" cy="7" r="1.1"/><circle cx="4.5" cy="12" r="1.1"/><circle cx="4.5" cy="17" r="1.1"/>',
  share:    '<circle cx="17.5" cy="6" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="m8.8 10.8 6.4-3.6M8.8 13.2l6.4 3.6"/>',
  settings: '<circle cx="12" cy="12" r="2.8"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>',
  chevron:  '<path d="m9 5.5 7 6.5-7 6.5"/>',
  plus:     '<path d="M12 5.5v13M5.5 12h13"/>',
  check:    '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close:    '<path d="m6 6 12 12M18 6 6 18"/>',
}

export const ICON_NAMES = Object.keys(PATHS)

/** Build the <symbol> sprite. Injected once; referenced everywhere by <use>. */
function spriteMarkup() {
  const symbols = Object.entries(PATHS)
    .map(([name, inner]) => `<symbol id="i-${name}" viewBox="${VIEWBOX}">${inner}</symbol>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"
    style="position:absolute;width:0;height:0;overflow:hidden"
    fill="none" stroke="currentColor" stroke-width="1.75"
    stroke-linecap="round" stroke-linejoin="round">${symbols}</svg>`
}

let injected = false

/** Put the sprite in the document. Safe to call more than once. */
export function initIcons() {
  if (injected || document.getElementById('icon-sprite')) return
  injected = true
  const host = document.createElement('div')
  host.id = 'icon-sprite'
  host.innerHTML = spriteMarkup()
  document.body.prepend(host)
}

/**
 * Markup for one icon.
 *
 * Decorative by default (aria-hidden) because an icon beside a text label is
 * noise to a screen reader. Pass `label` only when the icon is the sole
 * content of a control.
 *
 * @param {string} name   key from PATHS
 * @param {{cls?: string, label?: string, size?: number}} [opts]
 */
export function icon(name, opts = {}) {
  const { cls = '', label = '', size } = opts
  if (!PATHS[name]) return ''
  const sizing = size ? ` style="width:${size}px;height:${size}px"` : ''
  const a11y = label
    ? ` role="img" aria-label="${String(label).replace(/"/g, '&quot;')}"`
    : ' aria-hidden="true" focusable="false"'
  return `<svg class="icn ${cls}"${sizing}${a11y}><use href="#i-${name}"/></svg>`
}

/** Replace an element's contents with an icon (for dynamic UI). */
export function setIcon(el, name, opts) {
  if (el) el.innerHTML = icon(name, opts)
}
