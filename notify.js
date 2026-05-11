// ============================================================
// NOTIFICATIONS
// 1) In-page Notification API — fires when the user's tab is hidden
//    and partner does something. Works immediately, no backend.
// 2) Web Push subscription — registers the device for real push
//    notifications via the service worker. Requires a server-side
//    sender (we save the subscription; backend completes the loop).
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'
import { isSignedIn, getUser } from './auth.js'

const PREF_KEY = 'ldr_notif_pref'   // 'on' | 'off' | null
let permPrompted = false

export function notifPref() {
  return localStorage.getItem(PREF_KEY) || (Notification.permission === 'granted' ? 'on' : 'off')
}
export function setNotifPref(v) { localStorage.setItem(PREF_KEY, v) }

export async function requestNotifPermission() {
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied')  return 'denied'
  permPrompted = true
  return await Notification.requestPermission()
}

// Fire a local notification only when the tab isn't currently focused.
// Otherwise the toast/UI already shows it.
export function notify(title, body, opts = {}) {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (notifPref() !== 'on') return
  if (!document.hidden && !opts.alwaysShow) return  // don't spam when user is looking
  try {
    const n = new Notification(title, {
      body, icon: '/manifest.json', tag: opts.tag || 'ldr',
      silent: false, vibrate: [60, 40, 60],
    })
    n.onclick = () => { window.focus(); n.close() }
  } catch {}
}

// ── Service worker registration + push subscription ──
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    return reg
  } catch (e) {
    console.warn('[notify] sw register', e)
    return null
  }
}

// VAPID public key — set this in .env when you add a real push backend.
// Without it, web push won't work but the app still functions.
const VAPID_PUBLIC = (typeof import.meta !== 'undefined') && import.meta?.env?.VITE_VAPID_PUBLIC || null

function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - b64.length % 4) % 4)
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i)
  return out
}

export async function subscribeToPush(reg) {
  if (!reg || !VAPID_PUBLIC) return null
  try {
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      })
    }
    if (configured && sb && state.room) {
      const json = sub.toJSON()
      await sb.from('push_subscriptions').upsert({
        user_id:    isSignedIn() ? getUser().id : null,
        room_code:  state.room,
        endpoint:   json.endpoint,
        p256dh:     json.keys?.p256dh,
        auth_key:   json.keys?.auth,
        partner_idx: state.me,
        user_agent: navigator.userAgent.slice(0, 200),
      }, { onConflict: 'endpoint' })
    }
    return sub
  } catch (e) {
    console.warn('[notify] subscribeToPush', e)
    return null
  }
}

// ── Public init ──
export async function initNotifications() {
  // Service worker first — it caches the shell + handles future push events
  const reg = await registerServiceWorker()

  // If user has previously enabled notifications, try to subscribe to push
  if (notifPref() === 'on' && reg) await subscribeToPush(reg)
}

// Toggle handler
export async function enableNotifications() {
  const p = await requestNotifPermission()
  if (p === 'granted') {
    setNotifPref('on')
    const reg = await navigator.serviceWorker?.ready
    if (reg) await subscribeToPush(reg)
    notify('Notifications on', 'You\'ll know when your partner reaches out.', { alwaysShow: true })
    return true
  }
  if (p === 'denied') return false
  return false
}

export function disableNotifications() {
  setNotifPref('off')
}

/**
 * Ask the backend to deliver a push to this room's other partner.
 * Fire-and-forget: errors are logged, never thrown into the calling flow.
 */
export async function pushToPartner({ title, body, tag } = {}) {
  if (!configured || !sb || !state.room || !title) return
  try {
    const targetPartnerIdx = state.me === 1 ? 2 : 1
    await sb.functions.invoke('send-push', {
      body: { roomCode: state.room, targetPartnerIdx, title, body, tag, url: '/' },
    })
  } catch (e) { console.warn('[notify] pushToPartner', e) }
}
