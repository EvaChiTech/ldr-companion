/**
 * Service worker.
 *
 * Intentionally thin. The Supabase connection lives in the content script,
 * because its lifetime should match the watch tab rather than the worker's
 * idle timer. This file only keeps session state and nudges tabs on change.
 */

const STORAGE_KEY = 'ldr_theater_session'

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await get(STORAGE_KEY)
  if (!existing) {
    await set(STORAGE_KEY, { room: null, me: 1, name: '', partnerName: '', enabled: false })
  }
})

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'getSession') {
    get(STORAGE_KEY).then(s => reply(s || null))
    return true   // async reply
  }
  if (msg?.type === 'setSession') {
    set(STORAGE_KEY, msg.session).then(() => reply({ ok: true }))
    return true
  }
  return false
})

/** Reflect connection state in the toolbar badge. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return
  const s = changes[STORAGE_KEY].newValue
  const on = Boolean(s?.enabled && s?.room)
  chrome.action.setBadgeText({ text: on ? 'ON' : '' })
  chrome.action.setBadgeBackgroundColor({ color: '#C4594A' })
})

function get(key) {
  return new Promise(resolve => chrome.storage.local.get(key, o => resolve(o?.[key])))
}
function set(key, value) {
  return new Promise(resolve => chrome.storage.local.set({ [key]: value }, resolve))
}
