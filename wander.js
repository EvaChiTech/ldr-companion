// ============================================================
// WANDER — land somewhere in the world together.
//
// One of you spins, both of you land on the same place at the same moment.
// You each say whether you'd go, and when you both say yes it drops onto the
// bucket list you already keep.
//
// Better than a random-street-view toy in three ways that matter here:
//   - it is SHARED (the spin is broadcast; you are looking at one place, together)
//   - it knows your two clocks, so it tells you what time it is *there* next to
//     what time it is for each of you
//   - a match becomes a plan instead of evaporating
//
// No API keys and nothing to pay for: the place list below is ours, and the
// photo/blurb come from Wikipedia's open REST endpoint, attributed in the UI.
// ============================================================

import { state } from './state.js'
import { configured, sb } from './supabase.js'
import { tzTime } from './clocks.js'
import * as db from './db.js'
import { createScope, safeHttpUrl } from './lifecycle.js'

// Curated by hand: spread across every inhabited continent, biased toward
// places that are interesting to *look at* and to imagine being in together.
// `wiki` is the exact Wikipedia page title used for the photo lookup.
const PLACES = [
  { name: 'Lofoten',            country: 'Norway',        tz: 'Europe/Oslo',        wiki: 'Lofoten' },
  { name: 'Hallstatt',          country: 'Austria',       tz: 'Europe/Vienna',      wiki: 'Hallstatt' },
  { name: 'Cinque Terre',       country: 'Italy',         tz: 'Europe/Rome',        wiki: 'Cinque_Terre' },
  { name: 'Santorini',          country: 'Greece',        tz: 'Europe/Athens',      wiki: 'Santorini' },
  { name: 'Sintra',             country: 'Portugal',      tz: 'Europe/Lisbon',      wiki: 'Sintra' },
  { name: 'Giethoorn',          country: 'Netherlands',   tz: 'Europe/Amsterdam',   wiki: 'Giethoorn' },
  { name: 'Isle of Skye',       country: 'Scotland',      tz: 'Europe/London',      wiki: 'Isle_of_Skye' },
  { name: 'Vík',                country: 'Iceland',       tz: 'Atlantic/Reykjavik', wiki: 'Vík_í_Mýrdal' },
  { name: 'Kotor',              country: 'Montenegro',    tz: 'Europe/Belgrade',    wiki: 'Kotor' },
  { name: 'Bled',               country: 'Slovenia',      tz: 'Europe/Ljubljana',   wiki: 'Lake_Bled' },

  { name: 'Kyoto',              country: 'Japan',         tz: 'Asia/Tokyo',         wiki: 'Kyoto' },
  { name: 'Jeju Island',        country: 'South Korea',   tz: 'Asia/Seoul',         wiki: 'Jeju_Island' },
  { name: 'Hoi An',             country: 'Vietnam',       tz: 'Asia/Ho_Chi_Minh',   wiki: 'Hoi_An_Ancient_Town' },
  { name: 'Luang Prabang',      country: 'Laos',          tz: 'Asia/Vientiane',     wiki: 'Luang_Prabang' },
  { name: 'Pokhara',            country: 'Nepal',         tz: 'Asia/Kathmandu',     wiki: 'Pokhara' },
  { name: 'Cappadocia',         country: 'Türkiye',       tz: 'Europe/Istanbul',    wiki: 'Cappadocia' },
  { name: 'Petra',              country: 'Jordan',        tz: 'Asia/Amman',         wiki: 'Petra' },
  { name: 'Bagan',              country: 'Myanmar',       tz: 'Asia/Yangon',        wiki: 'Bagan' },
  { name: 'Gili Islands',       country: 'Indonesia',     tz: 'Asia/Makassar',      wiki: 'Gili_Islands' },
  { name: 'Shirakawa-go',       country: 'Japan',         tz: 'Asia/Tokyo',         wiki: 'Shirakawa,_Gifu_(village)' },

  { name: 'Marrakesh',          country: 'Morocco',       tz: 'Africa/Casablanca',  wiki: 'Marrakesh' },
  { name: 'Zanzibar',           country: 'Tanzania',      tz: 'Africa/Dar_es_Salaam', wiki: 'Zanzibar' },
  { name: 'Cape Town',          country: 'South Africa',  tz: 'Africa/Johannesburg', wiki: 'Cape_Town' },
  { name: 'Victoria Falls',     country: 'Zambia',        tz: 'Africa/Lusaka',      wiki: 'Victoria_Falls' },
  { name: 'Lalibela',           country: 'Ethiopia',      tz: 'Africa/Addis_Ababa', wiki: 'Lalibela' },
  { name: 'Essaouira',          country: 'Morocco',       tz: 'Africa/Casablanca',  wiki: 'Essaouira' },

  { name: 'Banff',              country: 'Canada',        tz: 'America/Edmonton',   wiki: 'Banff,_Alberta' },
  { name: 'Big Sur',            country: 'USA',           tz: 'America/Los_Angeles', wiki: 'Big_Sur' },
  { name: 'Savannah',           country: 'USA',           tz: 'America/New_York',   wiki: 'Savannah,_Georgia' },
  { name: 'Oaxaca',             country: 'Mexico',        tz: 'America/Mexico_City', wiki: 'Oaxaca_City' },
  { name: 'Antigua',            country: 'Guatemala',     tz: 'America/Guatemala',  wiki: 'Antigua_Guatemala' },
  { name: 'Patagonia',          country: 'Argentina',     tz: 'America/Argentina/Buenos_Aires', wiki: 'Patagonia' },
  { name: 'Cartagena',          country: 'Colombia',      tz: 'America/Bogota',     wiki: 'Cartagena,_Colombia' },
  { name: 'Valparaíso',         country: 'Chile',         tz: 'America/Santiago',   wiki: 'Valparaíso' },
  { name: 'Paraty',             country: 'Brazil',        tz: 'America/Sao_Paulo',  wiki: 'Paraty' },
  { name: 'Cusco',              country: 'Peru',          tz: 'America/Lima',       wiki: 'Cusco' },

  { name: 'Queenstown',         country: 'New Zealand',   tz: 'Pacific/Auckland',   wiki: 'Queenstown,_New_Zealand' },
  { name: 'Byron Bay',          country: 'Australia',     tz: 'Australia/Sydney',   wiki: 'Byron_Bay' },
  { name: 'Bora Bora',          country: 'French Polynesia', tz: 'Pacific/Tahiti',  wiki: 'Bora_Bora' },
  { name: 'Hobart',             country: 'Australia',     tz: 'Australia/Hobart',   wiki: 'Hobart' },
]

const WIKI_API = 'https://en.wikipedia.org/api/rest_v1/page/summary/'
// Wikimedia serves imagery from several subdomains (thumb.* today,
// upload.* historically), so match the domain family rather than pinning
// one host — pinning upload.* silently rejected every image.
const IMG_HOSTS = ['wikimedia.org']

const scope = createScope()
let channel = null
let inited  = false
let current = null      // { idx, place }
let votes   = {}        // { 1: bool, 2: bool }
let els     = {}
let saved   = false

const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ============================================================
// TRANSPORT
// ============================================================
function joinChannel() {
  if (!configured || !sb || channel) return
  channel = sb.channel(`wander:${state.room}`, {
    config: { broadcast: { self: false, ack: false } },
  })
  channel
    .on('broadcast', { event: 'w_land' }, ({ payload }) => {
      if (payload.from === state.me) return
      land(payload.idx, false)
    })
    .on('broadcast', { event: 'w_vote' }, ({ payload }) => {
      if (payload.from === state.me) return
      votes[payload.from] = Boolean(payload.yes)
      renderVotes()
    })
    .subscribe()
}

function send(event, payload) {
  if (!channel) return
  try { channel.send({ type: 'broadcast', event, payload: { ...payload, from: state.me } }) } catch {}
}

// ============================================================
// SPIN / LAND
// ============================================================
function spin() {
  const idx = Math.floor(Math.random() * PLACES.length)
  land(idx, true)
}

function land(idx, broadcast) {
  current = { idx, place: PLACES[idx] }
  votes = {}
  saved = false
  if (broadcast) send('w_land', { idx })
  render()
  loadPhoto(PLACES[idx])
}

/**
 * Fetch the thumbnail + a one-line description. Wikipedia text is CC BY-SA,
 * so the UI credits it and links back to the article.
 */
async function loadPhoto(place) {
  if (!els.photo) return
  setPhoto(null)
  els.photo.textContent = ''
  els.blurb.textContent = 'Looking it up…'

  try {
    const res = await fetch(WIKI_API + encodeURIComponent(place.wiki), {
      headers: {
        accept: 'application/json',
        'Api-User-Agent': 'LDRCompanion/1.0 (https://github.com/EvaChiTech/ldr-companion)',
      },
    })
    if (!res.ok) throw new Error(String(res.status))
    const data = await res.json()
    if (current?.place !== place) return     // a newer spin landed meanwhile

    const src = safeHttpUrl(data.thumbnail?.source || data.originalimage?.source,
                            { hosts: IMG_HOSTS })
    setPhoto(src)
    const extract = String(data.extract || '').split('. ')[0]
    // esc() stops an attacker escaping the attribute but not a `javascript:`
    // scheme inside it, so the href is validated, not merely escaped.
    const link = safeHttpUrl(data.content_urls?.desktop?.page, {
      hosts: ['wikipedia.org'],
    })
    if (!extract) { els.blurb.textContent = ''; return }
    els.blurb.innerHTML = link
      ? `${esc(extract)}. <a class="wd-src" href="${esc(link)}"
           target="_blank" rel="noopener noreferrer">Wikipedia</a>`
      : `${esc(extract)}.`
  } catch {
    if (current?.place === place) { setPhoto(null); els.blurb.textContent = '' }
  }
}

/**
 * Paint (or clear) the photo panel. Some articles genuinely have no image,
 * so the empty state is labelled rather than left as a blank slab that
 * reads as a broken feature.
 */
function setPhoto(url) {
  if (!els.photo) return
  if (url) {
    els.photo.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`
    els.photo.classList.remove('is-empty')
    els.photo.textContent = ''
  } else {
    els.photo.style.backgroundImage = ''
    els.photo.classList.add('is-empty')
    els.photo.textContent = 'No photo for this one'
  }
}

// ============================================================
// VOTING
// ============================================================
function vote(yes) {
  if (!current) return
  votes[state.me] = yes
  send('w_vote', { yes })
  renderVotes()
}

async function saveMatch() {
  if (!current || saved) return
  saved = true
  const { place } = current
  try {
    await db.insertBucketItem(`Go to ${place.name}, ${place.country} together`)
    els.match.textContent = `Added to your bucket list ✓`
  } catch {
    saved = false
    els.match.textContent = `Could not save that — try again.`
  }
}

// ============================================================
// RENDER
// ============================================================
function render() {
  if (!els.stage) return

  if (!current) {
    els.stage.classList.add('hidden')
    els.empty.classList.remove('hidden')
    return
  }
  els.empty.classList.add('hidden')
  els.stage.classList.remove('hidden')

  const { place } = current
  els.name.textContent = place.name
  els.country.textContent = place.country

  // Three clocks: there, you, them.
  const rows = [[`In ${place.name}`, tzTime(place.tz)]]
  if (state.myTz?.())    rows.push([state.myName?.() || 'You', tzTime(state.myTz())])
  if (state.theirTz?.()) rows.push([state.theirName?.() || 'Partner', tzTime(state.theirTz())])
  els.clocks.innerHTML = rows.map(([l, v]) =>
    `<div class="wd-clock"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')

  renderVotes()
}

function renderVotes() {
  if (!els.votes) return
  const mine = votes[state.me]
  const theirIdx = state.theirIdx?.() ?? (state.me === 1 ? 2 : 1)
  const theirs = votes[theirIdx]

  els.yes.classList.toggle('is-on', mine === true)
  els.no.classList.toggle('is-on', mine === false)

  const theirName = state.theirName?.() || 'Partner'
  if (theirs === undefined) {
    els.votes.textContent = mine === undefined ? '' : `Waiting on ${theirName}…`
  } else {
    els.votes.textContent = `${theirName} said ${theirs ? 'yes' : 'no'}`
  }

  const both = mine === true && theirs === true
  els.match.textContent = both ? '' : ''
  els.saveBtn.classList.toggle('hidden', !both || saved)
  if (both && saved) els.match.textContent = 'Added to your bucket list ✓'
  else if (both) els.match.textContent = 'You both said yes 💞'
}

// ============================================================
// LIFECYCLE
// ============================================================
export function initWander() {
  if (inited) return
  els = {
    spinBtn: $('wd-spin'),
    stage:   $('wd-stage'),
    empty:   $('wd-empty'),
    photo:   $('wd-photo'),
    name:    $('wd-name'),
    country: $('wd-country'),
    blurb:   $('wd-blurb'),
    clocks:  $('wd-clocks'),
    yes:     $('wd-yes'),
    no:      $('wd-no'),
    votes:   $('wd-votes'),
    match:   $('wd-match'),
    saveBtn: $('wd-save'),
  }
  if (!els.spinBtn) return
  inited = true

  scope.on(els.spinBtn, 'click', spin)
  scope.on(els.yes,     'click', () => vote(true))
  scope.on(els.no,      'click', () => vote(false))
  scope.on(els.saveBtn, 'click', saveMatch)

  joinChannel()
  render()
}

export function teardownWander() {
  scope.destroy()
  if (channel && sb) { try { sb.removeChannel(channel) } catch {} }
  channel = null
  current = null
  votes = {}
  inited = false
}
