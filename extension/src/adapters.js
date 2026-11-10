/**
 * Player adapters.
 *
 * Every service in scope renders into a plain HTML5 <video> element, so the
 * base adapter drives that directly. Sites differ in three ways that matter:
 *
 *   - where the real <video> lives (and how many decoys are on the page)
 *   - how to name the thing being watched (for the "you're on different
 *     episodes" warning)
 *   - whether writing `currentTime` actually sticks, or whether the site's own
 *     player state machine snaps it back
 *
 * Netflix is the notable case for the third: it keeps its own notion of
 * playhead position and will fight a raw write, so its adapter routes seeks
 * through the page-context bridge instead.
 */

// ------------------------------------------------------------------
// Base: generic HTML5 video
// ------------------------------------------------------------------
export class VideoAdapter {
  static site = 'generic'

  constructor() {
    this.video     = null
    this.listeners = { play: [], pause: [], seek: [] }
    this.bound     = false
    this.lastRate  = 1
  }

  /** Pick the most plausible playing video: largest by area, prefer non-muted. */
  findVideo() {
    const all = [...document.querySelectorAll('video')].filter(v => {
      const r = v.getBoundingClientRect()
      return r.width > 200 && r.height > 100
    })
    if (!all.length) return null
    // Trailers/autoplay previews are usually muted and small; real playback is big.
    all.sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect()
      return (br.width * br.height) - (ar.width * ar.height)
    })
    return all.find(v => !v.muted && v.readyState > 0) || all[0]
  }

  /** Re-resolve the video element; returns true if it changed. */
  refresh() {
    const found = this.findVideo()
    if (found === this.video) return false
    this.video = found
    this.bound = false
    this.bindEvents()
    return true
  }

  bindEvents() {
    if (!this.video || this.bound) return
    this.bound = true
    const fire = (k) => () => this.listeners[k].forEach(fn => { try { fn() } catch {} })
    this.video.addEventListener('play',   fire('play'))
    this.video.addEventListener('pause',  fire('pause'))
    this.video.addEventListener('seeked', fire('seek'))
  }

  onPlay(fn)  { this.listeners.play.push(fn) }
  onPause(fn) { this.listeners.pause.push(fn) }
  onSeek(fn)  { this.listeners.seek.push(fn) }

  isReady()   { return Boolean(this.video) && this.video.readyState > 0 }
  isPlaying() { return Boolean(this.video) && !this.video.paused && !this.video.ended }
  position()  { return this.video ? this.video.currentTime || 0 : 0 }
  duration()  { return this.video ? this.video.duration || 0 : 0 }
  isBuffering() {
    // readyState < HAVE_FUTURE_DATA while nominally playing == stalled.
    return Boolean(this.video) && !this.video.paused && this.video.readyState < 3
  }

  play()  { try { return this.video?.play() } catch {} }
  pause() { try { this.video?.pause() } catch {} }
  seek(t) { if (this.video) { try { this.video.currentTime = Math.max(0, t) } catch {} } }

  canRateNudge() { return true }
  setRate(r) {
    if (!this.video || this.lastRate === r) return
    this.lastRate = r
    try { this.video.playbackRate = r } catch {}
  }

  /** Stable-ish identifier for the current media, for mismatch detection. */
  mediaKey() { return location.pathname + location.search }

  title() { return (document.title || '').trim() || null }
}

// ------------------------------------------------------------------
// Netflix
// ------------------------------------------------------------------
export class NetflixAdapter extends VideoAdapter {
  static site = 'netflix'
  static matches() { return /(^|\.)netflix\.com$/.test(location.hostname) }

  constructor(bridge) {
    super()
    this.bridge = bridge   // page-context bridge, may be null
  }

  /** Netflix puts the real player inside .watch-video; ignore billboard previews. */
  findVideo() {
    const scoped = document.querySelector('.watch-video video, [data-uia="video-canvas"] video')
    if (scoped) return scoped
    return super.findVideo()
  }

  /**
   * Netflix's player tracks position independently of the media element, so a
   * raw currentTime write is often reverted. Go through its own API when the
   * bridge is available; fall back to the element otherwise.
   */
  seek(t) {
    const ms = Math.max(0, Math.round(t * 1000))
    if (this.bridge?.ready) this.bridge.call('netflix.seek', { ms })
    else super.seek(t)
  }

  play()  { if (this.bridge?.ready) this.bridge.call('netflix.play');  else super.play() }
  pause() { if (this.bridge?.ready) this.bridge.call('netflix.pause'); else super.pause() }

  // Netflix's ABR controller dislikes off-nominal rates; seek-only correction.
  canRateNudge() { return false }

  mediaKey() {
    const m = location.pathname.match(/\/watch\/(\d+)/)
    return m ? `nf:${m[1]}` : super.mediaKey()
  }

  title() {
    const el = document.querySelector('[data-uia="video-title"]')
    if (el) return el.textContent.trim().replace(/\s+/g, ' ')
    return (document.title || '').replace(/\s*[-|]\s*Netflix\s*$/i, '').trim() || null
  }
}

// ------------------------------------------------------------------
// Disney+
// ------------------------------------------------------------------
export class DisneyAdapter extends VideoAdapter {
  static site = 'disneyplus'
  static matches() { return /(^|\.)disneyplus\.com$/.test(location.hostname) }

  findVideo() {
    return document.querySelector('.btm-media-client-element, video.btm-media-client-element')
        || super.findVideo()
  }

  mediaKey() {
    const m = location.pathname.match(/\/(?:video|play)\/([\w-]+)/)
    return m ? `dp:${m[1]}` : super.mediaKey()
  }

  title() {
    const el = document.querySelector('.title-field, [data-testid="playback-title"]')
    if (el) return el.textContent.trim()
    return (document.title || '').replace(/\s*\|\s*Disney\+\s*$/i, '').trim() || null
  }
}

// ------------------------------------------------------------------
// HBO Max / Max
// ------------------------------------------------------------------
export class MaxAdapter extends VideoAdapter {
  static site = 'max'
  static matches() { return /(^|\.)(max|hbomax)\.com$/.test(location.hostname) }

  mediaKey() {
    const m = location.pathname.match(/\/(?:video\/watch|player)\/([\w:-]+)/)
    return m ? `max:${m[1]}` : super.mediaKey()
  }

  title() {
    return (document.title || '').replace(/\s*[-|]\s*Max\s*$/i, '').trim() || null
  }
}

// ------------------------------------------------------------------
// Hulu
// ------------------------------------------------------------------
export class HuluAdapter extends VideoAdapter {
  static site = 'hulu'
  static matches() { return /(^|\.)hulu\.com$/.test(location.hostname) }

  mediaKey() {
    const m = location.pathname.match(/\/watch\/([\w-]+)/)
    return m ? `hulu:${m[1]}` : super.mediaKey()
  }

  title() {
    const el = document.querySelector('.metadata-area__second-line, [data-automationid="playback-title"]')
    if (el) return el.textContent.trim()
    return (document.title || '').replace(/\s*[-|]\s*Hulu\s*$/i, '').trim() || null
  }
}

// ------------------------------------------------------------------
// Prime Video
// ------------------------------------------------------------------
export class PrimeAdapter extends VideoAdapter {
  static site = 'primevideo'
  static matches() {
    return /(^|\.)primevideo\.com$/.test(location.hostname)
        || (/(^|\.)amazon\./.test(location.hostname) && /\/gp\/video\//.test(location.pathname))
  }

  findVideo() {
    return document.querySelector('.rendererContainer video, .webPlayerElement video')
        || super.findVideo()
  }

  mediaKey() {
    const p = new URLSearchParams(location.search)
    const asin = p.get('asin') || p.get('gti')
    return asin ? `pv:${asin}` : super.mediaKey()
  }

  title() {
    const el = document.querySelector('.atvwebplayersdk-title-text, [data-testid="title"]')
    if (el) return el.textContent.trim()
    return (document.title || '').replace(/\s*[-|]\s*Prime Video\s*$/i, '').trim() || null
  }
}

// ------------------------------------------------------------------
// YouTube (bonus: the in-app player already covers this, but the
// extension lets you use youtube.com itself)
// ------------------------------------------------------------------
export class YouTubeAdapter extends VideoAdapter {
  static site = 'youtube'
  static matches() { return /(^|\.)youtube\.com$/.test(location.hostname) }

  findVideo() {
    return document.querySelector('#movie_player video, .html5-main-video') || super.findVideo()
  }

  mediaKey() {
    const v = new URLSearchParams(location.search).get('v')
    return v ? `yt:${v}` : super.mediaKey()
  }

  title() {
    const el = document.querySelector('#title h1, h1.ytd-watch-metadata')
    if (el) return el.textContent.trim()
    return (document.title || '').replace(/\s*-\s*YouTube\s*$/i, '').trim() || null
  }
}

const REGISTRY = [NetflixAdapter, DisneyAdapter, MaxAdapter, HuluAdapter, PrimeAdapter, YouTubeAdapter]

/** Pick the adapter for the current page. */
export function adapterForPage(bridge) {
  const Cls = REGISTRY.find(A => { try { return A.matches() } catch { return false } })
  if (!Cls) return new VideoAdapter()
  return Cls === NetflixAdapter ? new NetflixAdapter(bridge) : new Cls()
}

/** Human label for the current service. */
export function siteLabel() {
  const Cls = REGISTRY.find(A => { try { return A.matches() } catch { return false } })
  const names = {
    netflix: 'Netflix', disneyplus: 'Disney+', max: 'Max',
    hulu: 'Hulu', primevideo: 'Prime Video', youtube: 'YouTube',
  }
  return Cls ? (names[Cls.site] || Cls.site) : 'this page'
}
