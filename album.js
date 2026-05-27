// ============================================================
// PHOTO ALBUM — chronological grid of every chat photo in this room.
// Zero schema; reads from messages.image_url.
// ============================================================
import { state } from './state.js'
import { configured } from './supabase.js'
import * as db from './db.js'

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
const fmtDate = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// Only ever render media from our own Supabase storage. A row in a
// (formerly open-RLS) table could carry an arbitrary URL; refuse anything else.
const SUPABASE_ORIGIN = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL).origin } catch { return '' }
})()
function isSafeMediaUrl(url) {
  try {
    const u = new URL(String(url))
    return u.protocol === 'https:' && !!SUPABASE_ORIGIN && u.origin === SUPABASE_ORIGIN
  } catch { return false }
}

let inited = false

async function render() {
  const grid = document.getElementById('album-grid')
  if (!grid) return
  if (!configured) { grid.innerHTML = '<div class="empty-state">Connection needed.</div>'; return }
  const items = (await db.fetchChatImages()).filter(it => isSafeMediaUrl(it.image_url))
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state center">No photos yet — send one from the Chat tab.</div>'
    return
  }
  grid.innerHTML = items.map(it => `
    <figure class="album-cell" data-url="${escapeHtml(it.image_url)}">
      <img src="${escapeHtml(it.image_url)}" alt="shared photo" loading="lazy">
      <figcaption class="album-cap">
        <span class="album-who">${escapeHtml(it.partner_idx === state.me ? 'You' : (state.theirName?.() || 'Partner'))}</span>
        <span class="album-date">${escapeHtml(fmtDate(it.created_at))}</span>
      </figcaption>
    </figure>`).join('')
  grid.querySelectorAll('.album-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const lb = document.getElementById('lightbox') || (() => {
        const el = document.createElement('div'); el.id = 'lightbox'; el.className = 'lightbox'
        document.body.appendChild(el)
        el.addEventListener('click', () => el.classList.add('hidden'))
        return el
      })()
      lb.textContent = ''
      const img = document.createElement('img')
      img.src = cell.dataset.url
      img.alt = 'photo'
      lb.appendChild(img)
      lb.classList.remove('hidden')
    })
  })
}

export function initAlbum() {
  if (inited) return
  inited = true
  render()
  document.getElementById('album-refresh')?.addEventListener('click', render)
}

export function onRemoteAlbumUpdate() { if (inited) render() }
export function teardownAlbum() { inited = false }
