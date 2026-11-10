/**
 * Playback sync engine.
 *
 * Two jobs:
 *   1. Estimate the clock offset between this browser and the peer's, so a
 *      "position at timestamp T" message can be translated into "position now".
 *   2. Keep the local player locked to the peer's timeline, correcting drift
 *      with the gentlest tool that will do the job.
 *
 * Transport-agnostic on purpose: construct with a `send` function and feed it
 * inbound payloads. The caller owns the player adapter.
 */

const CLOCK_SAMPLES   = 7        // offset samples kept for the median
const CLOCK_BURST     = 5        // pings fired on connect
const CLOCK_RESYNC_MS = 30000    // periodic re-ping while a peer is present

const DRIFT_HARD = 1.5           // s - beyond this we seek
const DRIFT_SOFT = 0.35          // s - inside this band we nudge rate instead
const NUDGE_MS   = 1500          // how long a rate nudge is held

const TICK_MS = 2000             // position heartbeat cadence while playing

export class SyncEngine {
  /**
   * @param {object} opts
   * @param {(event: string, payload: object) => void} opts.send
   * @param {object} opts.adapter   player adapter (see adapters.js)
   * @param {number|string} opts.me this participant's seat id
   * @param {(s: object) => void} [opts.onStatus]
   */
  constructor({ send, adapter, me, onStatus }) {
    this.send     = send
    this.adapter  = adapter
    this.me       = me
    this.onStatus = onStatus || (() => {})

    this.offsetMs      = 0
    this.offsetSamples = []
    this.peerPresent   = false

    // Reentrancy guard: suppress echo while we are the ones driving the player.
    this.applyingRemote = false
    this.tickTimer      = null
    this.nudgeTimer     = null
    this.resyncTimer    = null

    this.lastPeerState = null
    this.paused        = false   // true once the user stops following
  }

  // -- lifecycle ------------------------------------------------

  start() {
    this.adapter.onPlay(()  => this.onLocal('play'))
    this.adapter.onPause(() => this.onLocal('pause'))
    this.adapter.onSeek(()  => this.onLocal('seek'))

    for (let i = 0; i < CLOCK_BURST; i++) {
      setTimeout(() => this.ping(), 120 + i * 220)
    }
    this.resyncTimer = setInterval(() => {
      if (this.peerPresent) this.ping()
    }, CLOCK_RESYNC_MS)
  }

  stop() {
    this.stopTick()
    this.stopNudge()
    if (this.resyncTimer) { clearInterval(this.resyncTimer); this.resyncTimer = null }
    this.peerPresent   = false
    this.offsetMs      = 0
    this.offsetSamples = []
  }

  setPeerPresent(present) {
    if (this.peerPresent === present) return
    this.peerPresent = present
    if (present) this.ping()
    this.status()
  }

  /** Stop following the peer without disconnecting (lets one side step away). */
  setFollowing(following) {
    this.paused = !following
    if (this.paused) { this.stopTick(); this.stopNudge() }
    else if (this.lastPeerState) this.apply(this.lastPeerState)
    this.status()
  }

  // -- clock offset ---------------------------------------------

  /** The peer's wall clock, as best we can estimate it. */
  peerNow() { return Date.now() + this.offsetMs }

  ping() { this.send('clock_ping', { from: this.me, t0: Date.now() }) }

  handleClockPing(p) {
    if (p.from === this.me) return
    this.send('clock_pong', { from: this.me, to: p.from, t0: p.t0, t1: Date.now() })
  }

  handleClockPong(p) {
    if (p.from === this.me || p.to !== this.me) return
    const rtt = Date.now() - p.t0
    if (rtt < 0 || rtt > 4000) return   // discard implausible samples
    // Assume symmetric latency: peer's t1 happened at (t0 + rtt/2) on our clock.
    this.offsetSamples.push(p.t1 - (p.t0 + rtt / 2))
    if (this.offsetSamples.length > CLOCK_SAMPLES) this.offsetSamples.shift()
    const sorted = [...this.offsetSamples].sort((a, b) => a - b)
    this.offsetMs = sorted[Math.floor(sorted.length / 2)]   // median resists outliers
  }

  // -- outbound -------------------------------------------------

  onLocal(kind) {
    if (this.applyingRemote || this.paused) return
    this.broadcastState()
    if (kind === 'play') this.startTick()
    else this.stopTick()
  }

  broadcastState(extra = {}) {
    if (this.paused) return
    this.send('state', {
      from:       this.me,
      media:      this.adapter.mediaKey(),
      title:      this.adapter.title(),
      position:   this.adapter.position(),
      is_playing: this.adapter.isPlaying(),
      sender_t:   Date.now(),
      ...extra,
    })
  }

  startTick() {
    this.stopTick()
    this.tickTimer = setInterval(() => {
      if (!this.adapter.isPlaying() || this.paused) return
      this.send('tick', {
        from:     this.me,
        media:    this.adapter.mediaKey(),
        position: this.adapter.position(),
        sender_t: Date.now(),
      })
    }, TICK_MS)
  }

  stopTick() { if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null } }

  // -- inbound --------------------------------------------------

  handleState(p) {
    if (p.from === this.me) return
    this.lastPeerState = p
    if (!this.paused) this.apply(p)
    this.status(p)
  }

  handleTick(p) {
    if (p.from === this.me || this.paused) return
    if (!this.adapter.isReady()) return
    // Peer is on different media - correcting our position would be meaningless.
    const mine = this.adapter.mediaKey()
    if (p.media && mine && p.media !== mine) { this.status(p); return }

    const elapsed = Math.max(0, (this.peerNow() - p.sender_t) / 1000)
    this.correct((Number(p.position) || 0) + elapsed)
  }

  /** Apply a full state snapshot (play/pause + position). */
  apply(p) {
    if (!this.adapter.isReady()) return
    const elapsed = p.is_playing
      ? Math.max(0, (this.peerNow() - p.sender_t) / 1000)
      : 0
    const target = (Number(p.position) || 0) + elapsed

    this.applyingRemote = true
    try {
      if (Math.abs(this.adapter.position() - target) > DRIFT_SOFT) {
        this.adapter.seek(target)
      }
      if (p.is_playing && !this.adapter.isPlaying())      this.adapter.play()
      else if (!p.is_playing && this.adapter.isPlaying()) this.adapter.pause()
    } finally {
      // Release only after the player has emitted its own play/pause/seeked
      // events, or we echo our own correction straight back to the peer.
      setTimeout(() => { this.applyingRemote = false }, 250)
    }

    if (p.is_playing) this.startTick(); else this.stopTick()
  }

  /** Move toward `target` seconds using the least jarring correction available. */
  correct(target) {
    const drift = this.adapter.position() - target
    const mag   = Math.abs(drift)

    if (mag > DRIFT_HARD) {
      this.applyingRemote = true
      try { this.adapter.seek(target) }
      finally { setTimeout(() => { this.applyingRemote = false }, 250) }
      this.stopNudge()
      this.status(null, { corrected: 'seek', drift })
      return
    }

    if (mag > DRIFT_SOFT && this.adapter.canRateNudge()) {
      // Ahead of the peer -> run slightly slow; behind -> slightly fast.
      this.adapter.setRate(drift > 0 ? 0.95 : 1.05)
      this.stopNudge()
      this.nudgeTimer = setTimeout(() => {
        this.adapter.setRate(1)
        this.nudgeTimer = null
      }, NUDGE_MS)
      this.status(null, { corrected: 'nudge', drift })
      return
    }

    this.status(null, { corrected: 'none', drift })
  }

  stopNudge() {
    if (this.nudgeTimer) { clearTimeout(this.nudgeTimer); this.nudgeTimer = null }
    this.adapter.setRate(1)
  }

  status(peer = null, extra = {}) {
    this.onStatus({
      peerPresent: this.peerPresent,
      following:   !this.paused,
      offsetMs:    this.offsetMs,
      peerTitle:   peer?.title || this.lastPeerState?.title || null,
      ...extra,
    })
  }
}
