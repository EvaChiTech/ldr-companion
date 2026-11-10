// ============================================================
// DEMO MODE — let one person experience a two-sided product.
//
// The app is worthless on your own: no partner online, dead clock on one
// side, empty chat. That is correct behaviour and a broken first impression,
// because the people who most need to evaluate it — an investor, an
// acquirer, a journalist, a curious visitor — always arrive alone.
//
// This seeds a believable partner and drives the app's REAL render paths with
// synthetic events, so what you see is the actual product, not a mockup.
//
// HARD RULE: demo mode never touches the database. It writes nothing, reads
// nothing, and opens no realtime channel. `state.demo` is checked at every
// persistence site; everything here lives and dies in memory. A demo session
// cannot corrupt a real room because it never has one.
//
// Entry:  ?demo=1   (or sessionStorage, so it survives in-session reloads)
// Exit:   exitDemo() — clears the flag and reloads clean.
// ============================================================

import { state } from './state.js'

const FLAG = 'ldr_demo_mode'

// ── the partner ─────────────────────────────────────────────
// Deliberately specific. A demo with "Partner" and lorem ipsum feels like a
// wireframe; a named person with a real timezone and a half-finished
// conversation feels like someone's actual life.
const PERSONA = {
  you:     'Alex',
  them:    'Noor',
  yourTz:  Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London',
  theirTz: 'Asia/Seoul',
  since:   isoDaysAgo(418),
  visit:   isoDaysAhead(23),
}

/** Opening conversation — already in progress, as a real one would be. */
const HISTORY = [
  { mine: false, text: 'just got out of the studio, it rained the whole way home', ago: 184 },
  { mine: true,  text: 'the good kind of rain or the miserable kind', ago: 176 },
  { mine: false, text: 'the good kind. warm. I stood in it for a bit', ago: 170 },
  { mine: false, text: 'kept thinking you would have liked it', ago: 169 },
  { mine: true,  text: 'I would have. 23 days', ago: 44 },
  { mine: false, text: 'counting them properly now', ago: 41 },
]

/**
 * Replies are matched loosely on intent, then fall through to something warm
 * and non-committal. Good enough to feel responsive in a 30-second demo;
 * deliberately not pretending to be an AI companion.
 */
const REPLIES = [
  { match: /\?$/,                      lines: ['mm, let me think about that properly', 'ask me again tonight when I can actually type'] },
  { match: /\b(miss|love|wish)\b/i,    lines: ['me too. more than is reasonable', 'same. 23 days'] },
  { match: /\b(tired|exhausted|long)\b/i, lines: ['go to bed, I will still be here', 'rough day? tell me the short version'] },
  { match: /\b(morning|coffee)\b/i,    lines: ['it is almost midnight here, enjoy it for both of us'] },
  { match: /\b(night|sleep|bed)\b/i,   lines: ['sleep well. I will read this in my morning'] },
]
const FALLBACK = [
  'ok that made me laugh out loud on the train',
  'tell me more when you can',
  'I am stealing that line',
  'wait really?',
  'saving this one',
]

// ── ambient beats ───────────────────────────────────────────
// Small things that happen while you look around, so the room feels inhabited
// rather than staged.
const AMBIENT = [
  { at: 14000, kind: 'message', text: 'the heater in this place finally gave up' },
  { at: 38000, kind: 'mood',    value: 'Missing you 💭' },
  { at: 62000, kind: 'message', text: 'what are you doing right now, exactly' },
]

let handlers = null
let timers = []
let msgId = 1
let running = false

// ── helpers ─────────────────────────────────────────────────
function isoDaysAgo(d)   { const t = new Date(); t.setDate(t.getDate() - d); return t.toISOString().split('T')[0] }
function isoDaysAhead(d) { const t = new Date(); t.setDate(t.getDate() + d); return t.toISOString().split('T')[0] }
const minsAgo = m => new Date(Date.now() - m * 60000).toISOString()
const pick = a => a[Math.floor(Math.random() * a.length)]
const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id }

/**
 * A stand-in photo for the Glance card. Generated rather than bundled: no
 * asset to ship, no licence to worry about, and it adapts to the theme.
 */
function demoPhoto() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
    <defs>
      <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2b3a55"/><stop offset="0.55" stop-color="#7d5a6b"/>
        <stop offset="1" stop-color="#c98a63"/>
      </linearGradient>
    </defs>
    <rect width="640" height="420" fill="url(#s)"/>
    <circle cx="505" cy="108" r="34" fill="#f6e3c8" opacity="0.92"/>
    <path d="M0 330 L120 268 L232 322 L352 244 L470 300 L560 258 L640 292 L640 420 L0 420 Z" fill="#1d2433" opacity="0.88"/>
    <path d="M0 366 L148 322 L286 360 L430 316 L560 352 L640 330 L640 420 L0 420 Z" fill="#141a26"/>
    <g fill="#f6e3c8" opacity="0.85">
      <rect x="196" y="372" width="5" height="9"/><rect x="212" y="366" width="5" height="15"/>
      <rect x="404" y="368" width="5" height="13"/><rect x="418" y="374" width="5" height="7"/>
    </g>
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// ── public API ──────────────────────────────────────────────

/** Has demo mode been asked for? Checked before any room/auth logic runs. */
export function isDemoRequested() {
  try {
    const p = new URLSearchParams(location.search)
    if (p.get('demo') === '1') { sessionStorage.setItem(FLAG, '1'); return true }
    return sessionStorage.getItem(FLAG) === '1'
  } catch { return false }
}

export function isDemo() { return Boolean(state.demo) }

/**
 * Put the app into demo mode. Fills `state` exactly as a real room would, so
 * every downstream module renders through its normal path.
 */
export function seedDemoState() {
  state.demo = true
  state.room = 'DEMO'
  state.me   = 1
  state.cfg  = {
    id: 'DEMO',
    n1: PERSONA.you,  tz1: PERSONA.yourTz,
    n2: PERSONA.them, tz2: PERSONA.theirTz,
    since: PERSONA.since,
    visit: PERSONA.visit,
    kind: 'couple',
    theme: 'warm',
    alias: null,
    interests: 'film photography, cooking, long walks, jazz',
  }
  state.messages = HISTORY.map(h => ({
    id: msgId++,
    partner_idx: h.mine ? 1 : 2,
    content: h.text,
    image_url: null,
    created_at: minsAgo(h.ago),
  }))
}

/**
 * Start the simulation.
 * @param {object} h render callbacks, same shape subscribeRoom uses
 * @param {(m:object)=>void} h.onMessage
 * @param {(online:boolean)=>void} h.onPresenceChange
 * @param {(mood:string)=>void} [h.onPartnerMood]
 */
export function startDemo(h) {
  if (running) return
  running = true
  handlers = h || {}

  showBanner()
  // Paint now, then again on the next turn: Glance renders asynchronously and
  // its (now empty) db read resolves in a microtask AFTER this sync block,
  // which would otherwise overwrite the demo photo with the empty state.
  paintGlance()
  later(paintGlance, 60)
  later(paintGlance, 400)

  // Partner "comes online" a beat after load — being greeted by presence
  // reads as alive; finding them already there reads as static.
  later(() => handlers.onPresenceChange?.(true), 900)

  for (const beat of AMBIENT) {
    later(() => {
      if (beat.kind === 'message') pushFromPartner(beat.text)
      else if (beat.kind === 'mood') handlers.onPartnerMood?.(beat.value)
    }, beat.at)
  }
}

export function stopDemo() {
  timers.forEach(clearTimeout)
  timers = []
  running = false
  handlers = null
}

/** Leave demo mode and return to the real app. */
export function exitDemo() {
  try { sessionStorage.removeItem(FLAG) } catch {}
  stopDemo()
  location.href = location.pathname       // drop ?demo=1
}

/**
 * Called when the user sends a message. Produces a reply so the core loop —
 * say something, get something back — actually closes.
 */
export function onUserMessage(text) {
  if (!running) return
  const rule = REPLIES.find(r => r.match.test(text))
  const reply = rule ? pick(rule.lines) : pick(FALLBACK)

  // Typing indicator first, then the reply — the pause is what sells it.
  later(() => handlers.onTyping?.(true), 700)
  later(() => {
    handlers.onTyping?.(false)
    pushFromPartner(reply)
  }, 2100 + Math.random() * 900)
}

function pushFromPartner(text) {
  handlers.onMessage?.({
    id: msgId++,
    partner_idx: 2,
    content: text,
    image_url: null,
    created_at: new Date().toISOString(),
  })
}

// ── chrome ──────────────────────────────────────────────────
function showBanner() {
  if (document.getElementById('demo-banner')) return
  const el = document.createElement('div')
  el.id = 'demo-banner'
  el.className = 'demo-banner'
  el.innerHTML = `
    <span class="demo-dot"></span>
    <span class="demo-text">Demo — <b>${PERSONA.them}</b> is simulated. Nothing is saved.</span>
    <button class="demo-exit" type="button">Exit demo</button>`
  el.querySelector('.demo-exit').addEventListener('click', exitDemo)
  document.body.appendChild(el)
}

/** Drop a photo into the Glance card directly; its normal source is storage. */
function paintGlance() {
  const card = document.getElementById('gl-card')
  if (!card) return
  const img = document.getElementById('gl-img')
  const stage = document.getElementById('gl-stage')
  const empty = document.getElementById('gl-empty')
  if (!img || !stage) return
  card.classList.remove('hidden')
  empty?.classList.add('hidden')
  stage.classList.remove('hidden')
  img.src = demoPhoto()
  img.alt = `Photo from ${PERSONA.them}`
  const who = document.getElementById('gl-who')
  const when = document.getElementById('gl-when')
  const cap = document.getElementById('gl-caption')
  if (who)  who.textContent = PERSONA.them
  if (when) when.textContent = '2 hours ago'
  if (cap)  { cap.textContent = 'walked home the long way'; cap.style.display = '' }
}
