// ============================================================
// LOCAL CARE — send food / flowers / groceries to partner's city.
// Surfaces curated, AI-picked, real-world services with deep links
// you can open and order through.
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))

let inited = false
let modal = null

const INTENTS = [
  { key: 'any',        label: 'Anything thoughtful' },
  { key: 'food',       label: 'A meal' },
  { key: 'flowers',    label: 'Flowers' },
  { key: 'grocery',    label: 'Grocery delivery' },
  { key: 'gift',       label: 'A small gift' },
  { key: 'experience', label: 'An experience (coffee, spa, etc.)' },
]

function buildModal() {
  if (modal) return modal
  modal = document.createElement('div')
  modal.id = 'lc-modal'
  modal.className = 'lc-modal hidden'
  modal.innerHTML = `
    <div class="lc-card">
      <div class="lc-head">
        <div>
          <div class="lc-title">Send something to them</div>
          <div class="lc-sub" id="lc-sub"></div>
        </div>
        <button class="lc-close" type="button">×</button>
      </div>
      <div class="lc-body">
        <div class="lc-intent-row">
          <label class="lc-label">What kind of care</label>
          <select id="lc-intent">
            ${INTENTS.map(i => `<option value="${i.key}">${i.label}</option>`).join('')}
          </select>
          <button id="lc-go" class="btn btn-primary btn-sm">Find options →</button>
        </div>
        <div id="lc-loading" class="loading-text" style="display:none;">
          <span class="ldot"></span><span class="ldot"></span><span class="ldot"></span>
          Finding services in their city…
        </div>
        <div id="lc-out" class="lc-grid"></div>
        <div class="lc-foot">Opens the service in a new tab — finish the order on their site. We never see your payment.</div>
      </div>
    </div>`
  document.body.appendChild(modal)
  modal.querySelector('.lc-close').onclick = closeModal
  modal.querySelector('#lc-go').onclick = run
  modal.addEventListener('click', e => { if (e.target === modal) closeModal() })
  return modal
}

function openModal() {
  buildModal()
  // Refresh subtitle each time it opens (in case partner mood changed)
  const sub = modal.querySelector('#lc-sub')
  const them = state.theirName?.() || 'them'
  const tz = state.theirTz?.() || ''
  const city = tz ? tz.split('/').pop().replace(/_/g, ' ') : ''
  const mood = window.__lc_partnerMood || ''
  sub.textContent = `${them}${city ? ` · ${city}` : ''}${mood ? ` · feeling ${mood}` : ''}`
  modal.classList.remove('hidden')
  // Clear previous results so reopening feels fresh
  modal.querySelector('#lc-out').innerHTML = ''
}

function closeModal() { modal?.classList.add('hidden') }

async function run() {
  if (!configured) { showToast('Connection needed first'); return }
  const out = modal.querySelector('#lc-out')
  const lo  = modal.querySelector('#lc-loading')
  const intent = modal.querySelector('#lc-intent').value
  out.innerHTML = ''
  lo.style.display = 'flex'

  try {
    const tz = state.theirTz?.()
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
    const { data, error } = await sb.functions.invoke('local-care', {
      body: {
        senderName: state.cfg?.[`n${state.me}`],
        recipientName: state.theirName?.(),
        recipientTz: tz,
        recipientCity: tz ? tz.split('/').pop().replace(/_/g, ' ') : null,
        mood: window.__lc_partnerMood || null,
        intent,
        apiKey,
      },
    })
    lo.style.display = 'none'
    if (error) throw error
    const options = data?.options || []
    if (!options.length) { out.innerHTML = '<div class="empty-state">No options found. Try a different category.</div>'; return }
    out.innerHTML = options.map(o => `
      <article class="lc-option lc-cat-${escapeHtml(o.category || 'other')}">
        <div class="lc-emoji">${escapeHtml(o.emoji || '🎁')}</div>
        <div class="lc-service">${escapeHtml(o.service || '')}</div>
        <div class="lc-what">${escapeHtml(o.what || '')}</div>
        <a class="btn btn-primary btn-sm lc-open" target="_blank" rel="noopener" href="${escapeHtml(o.url || '#')}">Open ↗</a>
      </article>`).join('')
  } catch (e) {
    lo.style.display = 'none'
    out.innerHTML = `<div class="empty-state">Couldn't find options: ${escapeHtml(e.message || String(e))}</div>`
  }
}

function showToast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(showToast._tm)
  showToast._tm = setTimeout(() => t.style.opacity = '0', 2200)
}

// Update the partner-mood hint exposed to the modal (called by main.js when mood loads)
export function setPartnerMood(mood) {
  window.__lc_partnerMood = mood || null
}

export function initLocalCare() {
  if (inited) return
  inited = true
  document.getElementById('mood-send-btn')?.addEventListener('click', openModal)
  document.getElementById('lc-launch')?.addEventListener('click', openModal)
}

export function teardownLocalCare() {
  modal?.remove(); modal = null
  inited = false
  window.__lc_partnerMood = null
}
