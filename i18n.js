// ============================================================
// I18N — minimal key/value lookup with locale detection.
// Strings live in locales/<lang>.js (default en). Falls back to English
// for any missing key. setLocale() persists to localStorage.
// ============================================================
import en from './locales/en.js'
import es from './locales/es.js'
import ko from './locales/ko.js'
import fr from './locales/fr.js'
import de from './locales/de.js'
import ja from './locales/ja.js'
import pt from './locales/pt.js'

const TABLES = { en, es, ko, fr, de, ja, pt }
const KEY = 'ldr_locale'

let current = 'en'

function detect() {
  const saved = localStorage.getItem(KEY)
  if (saved && TABLES[saved]) return saved
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase()
  return TABLES[nav] ? nav : 'en'
}

export function getLocale() { return current }
export function setLocale(loc) {
  if (!TABLES[loc]) return
  current = loc
  localStorage.setItem(KEY, loc)
  applyDom()
  document.documentElement.lang = loc
}
export const SUPPORTED = Object.keys(TABLES)

/** Translate a key. Falls back to English, then to the key itself. */
export function t(key, vars) {
  const v = (TABLES[current] && TABLES[current][key]) ?? TABLES.en[key] ?? key
  if (!vars) return v
  return v.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`))
}

/** Translate every element in DOM with a [data-i18n="key"] attribute. */
export function applyDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')
    el.textContent = t(key)
  })
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder')
    el.setAttribute('placeholder', t(key))
  })
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title')
    el.setAttribute('title', t(key))
  })
  root.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria')
    el.setAttribute('aria-label', t(key))
  })
}

const LOCALE_NAMES = { en: 'English', es: 'Español', ko: '한국어', fr: 'Français', de: 'Deutsch', ja: '日本語', pt: 'Português' }

export function initI18n() {
  current = detect()
  document.documentElement.lang = current
  applyDom()
  // Wire language picker if present
  const sel = document.getElementById('lang-picker')
  if (sel) {
    sel.innerHTML = SUPPORTED.map(l => `<option value="${l}" ${l === current ? 'selected' : ''}>${LOCALE_NAMES[l]}</option>`).join('')
    sel.addEventListener('change', () => setLocale(sel.value))
  }
}
