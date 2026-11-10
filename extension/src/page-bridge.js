/**
 * Page-context bridge.
 *
 * Content scripts run in an isolated world and cannot touch the page's own JS
 * objects. Some players (Netflix in particular) keep an internal notion of the
 * playhead that overrides writes to the <video> element, so driving them
 * reliably means calling their own player object - which only exists in page
 * context. This file is injected into the page and relays a tiny, fixed set of
 * commands over window.postMessage.
 *
 * Only transport controls are exposed: play, pause, seek, position. Nothing
 * here reads account data, tokens, or media streams.
 */
(() => {
  const CHANNEL = 'ldr-theater-bridge'

  function netflixPlayer() {
    // Netflix exposes its player session registry on the page's global object.
    const app = window.netflix?.appContext?.state?.playerApp
    const api = app?.getAPI?.()
    const vp  = api?.videoPlayer
    if (!vp?.getAllPlayerSessionIds) return null
    const ids = vp.getAllPlayerSessionIds() || []
    // Session ids are prefixed by type; the watch player is the "watch-" one.
    const id = ids.find(s => String(s).startsWith('watch-')) || ids[0]
    if (!id) return null
    return vp.getVideoPlayerBySessionId(id) || null
  }

  const handlers = {
    'netflix.probe': () => Boolean(netflixPlayer()),
    'netflix.play':  () => { netflixPlayer()?.play();  return true },
    'netflix.pause': () => { netflixPlayer()?.pause(); return true },
    'netflix.seek':  ({ ms }) => {
      const p = netflixPlayer()
      if (!p) return false
      p.seek(Math.max(0, Number(ms) || 0))
      return true
    },
    'netflix.position': () => {
      const p = netflixPlayer()
      const ms = p?.getCurrentTime?.()
      return typeof ms === 'number' ? ms / 1000 : null
    },
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return
    const msg = ev.data
    if (!msg || msg.channel !== CHANNEL || msg.dir !== 'req') return

    let result = null, ok = false
    try {
      const fn = handlers[msg.cmd]
      if (fn) { result = fn(msg.args || {}); ok = true }
    } catch {
      ok = false
    }
    window.postMessage({ channel: CHANNEL, dir: 'res', id: msg.id, ok, result }, '*')
  })

  window.postMessage({ channel: CHANNEL, dir: 'ready' }, '*')
})()
