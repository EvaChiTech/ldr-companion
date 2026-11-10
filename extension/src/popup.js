/**
 * Popup: collect the room code / seat / names, then flip the session on.
 *
 * Validation mirrors the web app's room-code rules so a code that works in the
 * app works here without a second thought.
 */

const STORAGE_KEY = 'ldr_theater_session'
const CODE_RE = /^[A-Z0-9]{4,12}$/

const $ = id => document.getElementById(id)
const els = {}

document.addEventListener('DOMContentLoaded', async () => {
  for (const id of ['code', 'seat', 'name', 'partner', 'auto', 'toggle', 'err', 'pill']) els[id] = $(id)

  const s = await get(STORAGE_KEY)
  if (s) {
    els.code.value    = s.room || ''
    els.seat.value    = String(s.me || 1)
    els.name.value    = s.name || ''
    els.partner.value = s.partnerName || ''
    els.auto.checked  = Boolean(s.autoFollow)
    render(Boolean(s.enabled && s.room))
  } else {
    render(false)
  }

  // Let this one take effect without reconnecting.
  els.auto.addEventListener('change', async () => {
    const cur = await get(STORAGE_KEY)
    if (cur) await set(STORAGE_KEY, { ...cur, autoFollow: els.auto.checked })
  })

  els.code.addEventListener('input', () => {
    els.code.value = els.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    els.err.textContent = ''
  })

  els.toggle.addEventListener('click', onToggle)
})

async function onToggle() {
  const current = await get(STORAGE_KEY)
  const on = Boolean(current?.enabled && current?.room)

  if (on) {
    await set(STORAGE_KEY, { ...current, enabled: false })
    render(false)
    return
  }

  const room = els.code.value.trim().toUpperCase()
  if (!CODE_RE.test(room)) {
    els.err.textContent = 'Room codes are 4–12 letters and numbers.'
    els.code.focus()
    return
  }

  els.err.textContent = ''
  await set(STORAGE_KEY, {
    room,
    me: Number(els.seat.value) === 2 ? 2 : 1,
    name: els.name.value.trim().slice(0, 24),
    partnerName: els.partner.value.trim().slice(0, 24),
    autoFollow: els.auto.checked,
    enabled: true,
  })
  render(true)
}

function render(on) {
  els.toggle.textContent = on ? 'Disconnect' : 'Connect'
  els.toggle.classList.toggle('off', on)
  els.pill.textContent = on ? 'Connected' : 'Not connected'
  for (const id of ['code', 'seat', 'name', 'partner']) els[id].disabled = on
}

function get(key) {
  return new Promise(resolve => chrome.storage.local.get(key, o => resolve(o?.[key])))
}
function set(key, value) {
  return new Promise(resolve => chrome.storage.local.set({ [key]: value }, resolve))
}
