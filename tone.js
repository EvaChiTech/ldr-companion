// ============================================================
// TONE TRANSLATOR — review draft chat messages before sending.
// Wired into the chat input as a small button next to "Send".
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))

let inited = false
let modal = null

function buildModal() {
  if (modal) return modal
  modal = document.createElement('div')
  modal.id = 'tone-modal'
  modal.className = 'tone-modal hidden'
  modal.innerHTML = `
    <div class="tone-card">
      <div class="tone-head">
        <span class="tone-title">How might this land?</span>
        <button class="tone-close" type="button">×</button>
      </div>
      <div class="tone-body">
        <div class="tone-loading">
          <span class="ldot"></span><span class="ldot"></span><span class="ldot"></span>
          Reading the draft…
        </div>
        <div class="tone-result" style="display:none;">
          <div class="tone-heat">
            <div class="tone-heat-label">Heat</div>
            <div class="tone-heat-bar"><div class="tone-heat-fill"></div></div>
            <div class="tone-heat-value"></div>
          </div>
          <div class="tone-section">
            <div class="tone-section-label">How it might land</div>
            <div class="tone-lands"></div>
          </div>
          <div class="tone-section">
            <div class="tone-section-label">Softer version</div>
            <div class="tone-softer"></div>
          </div>
          <div class="tone-actions">
            <button class="btn btn-secondary btn-sm tone-keep">Send original</button>
            <button class="btn btn-primary  btn-sm tone-use-softer">Use softer ↑</button>
          </div>
        </div>
      </div>
    </div>`
  document.body.appendChild(modal)
  modal.querySelector('.tone-close').addEventListener('click', () => closeModal())
  modal.addEventListener('click', e => { if (e.target === modal) closeModal() })
  return modal
}

function openModal() { buildModal(); modal.classList.remove('hidden') }
function closeModal() { modal?.classList.add('hidden') }

async function reviewDraft() {
  const inp = document.getElementById('chat-inp')
  const draft = inp?.value.trim()
  if (!draft) return
  if (!configured) return  // silent — chat fallback handles offline
  openModal()
  modal.querySelector('.tone-loading').style.display = ''
  modal.querySelector('.tone-result').style.display = 'none'

  try {
    // Last 6 chat messages for context
    const { data: recent } = await sb.from('messages')
      .select('partner_idx,content').eq('room_id', state.room)
      .order('created_at', { ascending: false }).limit(6)
    const recentArr = (recent || []).reverse().map(m => ({ from: m.partner_idx, content: m.content }))
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
    const { data, error } = await sb.functions.invoke('tone-translator', {
      body: {
        draft, recent: recentArr,
        n1: state.cfg.n1, n2: state.cfg.n2,
        sender: state.me, apiKey,
      },
    })
    if (error) throw error
    modal.querySelector('.tone-loading').style.display = 'none'
    modal.querySelector('.tone-result').style.display = ''
    const heat = Number(data?.heat) || 0
    const fill = modal.querySelector('.tone-heat-fill')
    fill.style.width = Math.min(100, Math.max(0, heat * 10)) + '%'
    fill.style.background = heat <= 3 ? 'var(--green)' : heat <= 6 ? 'var(--gold)' : 'var(--primary)'
    modal.querySelector('.tone-heat-value').textContent = `${heat}/10`
    modal.querySelector('.tone-lands').textContent = data?.how_it_lands || ''
    modal.querySelector('.tone-softer').textContent = data?.softer || draft
    modal.querySelector('.tone-keep').onclick = () => closeModal()
    modal.querySelector('.tone-use-softer').onclick = () => {
      if (inp) inp.value = data?.softer || draft
      closeModal()
      inp?.focus()
    }
  } catch (e) {
    modal.querySelector('.tone-loading').style.display = 'none'
    modal.querySelector('.tone-result').style.display = ''
    modal.querySelector('.tone-lands').textContent = `Couldn't analyze: ${e.message || e}`
    modal.querySelector('.tone-softer').textContent = ''
  }
}

export function initTone() {
  if (inited) return
  inited = true
  document.getElementById('tone-btn')?.addEventListener('click', reviewDraft)
}
export function teardownTone() { inited = false; modal?.remove(); modal = null }
