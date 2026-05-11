// LDR Companion service worker
// - App-shell cache so the homescreen icon opens instantly
// - Network-first strategy for HTML/JS so updates land
// - Web Push handler (no-op until a real backend pushes)

const VERSION = 'ldr-v1'
const SHELL = ['./', './index.html', './styles.css', './manifest.json']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))).catch(() => {}))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Don't intercept Supabase / external API traffic
  if (url.origin !== location.origin) return
  // Network-first for HTML/JS, cache-first for everything else
  const isCode = req.destination === 'document' || req.destination === 'script' || req.destination === 'style'
  if (isCode) {
    e.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone()
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {})
        return resp
      }).catch(() => caches.match(req).then(r => r || new Response('Offline', { status: 503 })))
    )
  } else {
    e.respondWith(
      caches.match(req).then(r => r || fetch(req).then(resp => {
        const copy = resp.clone()
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {})
        return resp
      }))
    )
  }
})

// Web Push receiver — fires when the backend sends a notification
self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch {}
  const title = data.title || 'LDR Companion'
  const body  = data.body  || 'You have a new moment.'
  const icon  = data.icon  || './manifest.json'
  e.waitUntil(self.registration.showNotification(title, {
    body, icon, badge: icon, tag: data.tag || 'ldr', data: { url: data.url || './' },
    vibrate: [60, 40, 60],
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = e.notification.data?.url || './'
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(wins => {
    for (const w of wins) { if (w.url.includes(url) && 'focus' in w) return w.focus() }
    if (self.clients.openWindow) return self.clients.openWindow(url)
  }))
})
