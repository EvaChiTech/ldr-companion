// ============================================================
// WELCOME + TOUR — first-run modal that walks new users through
// the key tabs. Persists "shown" flag to localStorage.
// ============================================================
import { t } from './i18n.js'
import { track } from './analytics.js'

const KEY = 'ldr_welcome_shown_v1'

const TOUR = [
  { tab: 'home',     key: 'tour_step_1', emoji: '🏠' },
  { tab: 'chat',     key: 'tour_step_2', emoji: '💬' },
  { tab: 'watch',    key: 'tour_step_3', emoji: '📺' },
  { tab: 'together', key: 'tour_step_4', emoji: '💞' },
  { tab: 'rituals',  key: 'tour_step_5', emoji: '🌙' },
  { tab: 'life',     key: 'tour_step_6', emoji: '🛟' },
]

let modal = null
let stepIdx = 0

function buildModal() {
  if (modal) return modal
  modal = document.createElement('div')
  modal.id = 'welcome-modal'
  modal.className = 'welcome-modal hidden'
  modal.innerHTML = `
    <div class="welcome-card" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <button class="welcome-close" type="button" aria-label="Close">×</button>
      <div class="welcome-emoji" id="welcome-emoji">✨</div>
      <h2 id="welcome-title" class="welcome-title">${t('welcome_title')}</h2>
      <p id="welcome-body" class="welcome-body">${t('welcome_body')}</p>
      <div class="welcome-actions" id="welcome-intro-actions">
        <button id="welcome-tour-btn" class="btn btn-primary  btn-sm">${t('welcome_tour')}</button>
        <button id="welcome-skip-btn" class="btn btn-secondary btn-sm">${t('welcome_skip')}</button>
      </div>
      <div class="welcome-actions" id="welcome-tour-actions" style="display:none;">
        <span class="welcome-step-indicator" id="welcome-step-indicator"></span>
        <button id="welcome-next-btn" class="btn btn-primary btn-sm">${t('btn_next')}</button>
      </div>
    </div>`
  document.body.appendChild(modal)
  modal.querySelector('.welcome-close').onclick = close
  modal.querySelector('#welcome-skip-btn').onclick = () => { track('tour_skipped'); close() }
  modal.querySelector('#welcome-tour-btn').onclick = () => { track('tour_started'); startTour() }
  modal.querySelector('#welcome-next-btn').onclick = nextStep
  modal.addEventListener('click', e => { if (e.target === modal) close() })
  return modal
}

function close() {
  modal?.classList.add('hidden')
  localStorage.setItem(KEY, '1')
}

function startTour() {
  stepIdx = 0
  modal.querySelector('#welcome-intro-actions').style.display = 'none'
  modal.querySelector('#welcome-tour-actions').style.display = ''
  showStep()
}

function showStep() {
  const step = TOUR[stepIdx]
  if (!step) { close(); return }
  // Switch to the relevant tab so the user sees the actual feature
  const tabBtn = document.querySelector(`.tab[data-tab="${step.tab}"]`)
  if (tabBtn) tabBtn.click()
  modal.querySelector('#welcome-emoji').textContent = step.emoji
  modal.querySelector('#welcome-title').textContent = step.tab.charAt(0).toUpperCase() + step.tab.slice(1)
  modal.querySelector('#welcome-body').textContent = t(step.key)
  modal.querySelector('#welcome-step-indicator').textContent = `${stepIdx + 1} / ${TOUR.length}`
  modal.querySelector('#welcome-next-btn').textContent = stepIdx === TOUR.length - 1 ? t('tour_finish') : t('btn_next')
}

function nextStep() {
  stepIdx++
  if (stepIdx >= TOUR.length) {
    track('tour_completed')
    close()
    return
  }
  showStep()
}

/** Show the welcome modal if it hasn't been seen on this device. */
export function maybeShowWelcome(force = false) {
  if (!force && localStorage.getItem(KEY)) return
  buildModal()
  modal.classList.remove('hidden')
  track('welcome_shown')
}

/** Always show the welcome modal — wired to a "Take a tour" link. */
export function showWelcomeForce() { maybeShowWelcome(true) }
