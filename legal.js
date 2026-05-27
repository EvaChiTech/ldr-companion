// ============================================================
// LEGAL / COMPLIANCE — privacy policy modal, first-run consent +
// age gate, and the soft-deletion flow with typed confirmation.
// ============================================================
import * as db from './db.js'

const CONSENT_KEY = 'ldr_consent_v2'

export function hasConsent() {
  try { return !!localStorage.getItem(CONSENT_KEY) } catch { return false }
}

function show(id) { const m = document.getElementById(id); if (m) m.style.display = 'flex' }
function hide(id) { const m = document.getElementById(id); if (m) m.style.display = 'none' }

export function showPrivacyPolicy() { show('privacy-modal') }

// Blocks first run until the user confirms age + accepts the policy.
// Records a structured consent receipt locally (timestamp + policy version)
// so we can show what was accepted, when. A future improvement is to
// mirror that receipt to the server for an auditable record.
export function requireConsent() {
  return new Promise(resolve => {
    if (hasConsent()) return resolve()
    const modal = document.getElementById('consent-modal')
    if (!modal) return resolve()
    modal.style.display = 'flex'
    const agree = document.getElementById('consent-agree')
    const age   = document.getElementById('consent-age')
    const terms = document.getElementById('consent-terms')
    const sync = () => { agree.disabled = !(age.checked && terms.checked) }
    age.checked = false; terms.checked = false; sync()
    age.onchange = sync
    terms.onchange = sync
    agree.onclick = () => {
      const receipt = {
        accepted_at: new Date().toISOString(),
        policy_version: '2.0',
        ua_lang: navigator.language || null,
      }
      try { localStorage.setItem(CONSENT_KEY, JSON.stringify(receipt)) } catch {}
      modal.style.display = 'none'
      resolve()
    }
  })
}

// GDPR Art. 17 / CCPA erasure with friction — a soft-delete with a
// 30-day cancellation window. Either partner can cancel during the
// window from their own session; after that a service-role purge runs.
export async function runDataDeletion() {
  // Step 1: typed confirmation, not a single OK button. A clicked
  // confirm() dialog is a one-step destructive action; typing "DELETE"
  // forces the user to read what they're doing and prevents stored-XSS
  // or social-engineering one-click destruction.
  const phrase = window.prompt(
    'This schedules deletion of EVERY room you belong to — messages, vlogs, ' +
    'letters, dreams, expenses, all of it — for both you AND your partner.\n\n' +
    'The deletion is reversible for 30 days; either of you can cancel from ' +
    'your account modal. After 30 days the data is permanently purged.\n\n' +
    'Type DELETE (in capitals) to confirm:',
    '',
  )
  if (phrase !== 'DELETE') return
  try {
    const result = await db.deleteMyData()
    const purgeAt = result?.purge_at ? new Date(result.purge_at).toLocaleDateString() : '30 days from now'
    try { localStorage.clear() } catch {}
    alert(
      `Deletion scheduled. ${result?.rooms_scheduled || 0} room(s) will be ` +
      `permanently removed on ${purgeAt}. If you change your mind before then, ` +
      `sign in again and use "Cancel deletion".\n\nThe app will now reload.`,
    )
    location.reload()
  } catch (e) {
    alert('Could not schedule deletion: ' + (e?.message || 'unknown error'))
  }
}

export function initLegal() {
  document.addEventListener('click', e => {
    const trigger = e.target.closest('[data-open-privacy]')
    if (trigger) { e.preventDefault(); showPrivacyPolicy() }
  })
  document.getElementById('privacy-close')?.addEventListener('click', () => hide('privacy-modal'))
  document.getElementById('privacy-modal')?.addEventListener('click', e => {
    if (e.target.id === 'privacy-modal') hide('privacy-modal')
  })
}
