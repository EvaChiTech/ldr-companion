// ============================================================
// MINI-GAMES — async play that builds intimacy through silliness.
// Phase 1: Drawing prompt chain. (Reuses the Together canvas.)
// ============================================================
import { state } from './state.js'
import { configured, sb } from './supabase.js'
import { playPing } from './sound.js'

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))

// Drawing prompts pool — mix of silly + sweet
const PROMPTS = [
  "Draw your partner's hair", "Draw the smell of their morning",
  "Draw your last shared meal", "Draw what you'd cook them tomorrow",
  "Draw your future house — one detail", "Draw their laugh",
  "Draw what your love looks like as a creature",
  "Draw the place you'd most like to be together right now",
  "Draw your inside joke", "Draw a memory only you two share",
  "Draw their hands", "Draw the weather of your relationship today",
  "Draw a portrait of them in 30 seconds — no looking",
  "Draw the song stuck in your head",
  "Draw what 'home' looks like to you",
  "Draw an animal that looks like them",
  "Draw what you wish for them this week",
  "Draw the last thing that made you think of them",
  "Draw your dream date",
  "Draw the constellation of you two",
]

let inited = false

function pickPrompt() {
  return PROMPTS[Math.floor(Math.random() * PROMPTS.length)]
}

async function startGame() {
  const prompt = pickPrompt()
  const display = document.getElementById('mg-prompt')
  if (display) {
    display.classList.remove('hidden')
    display.textContent = prompt
  }
  // Broadcast to partner via the existing 'together' room channel
  if (configured) {
    sb.channel(`together:${state.room}`).send({
      type: 'broadcast', event: 'minigame', payload: { from: state.me, prompt },
    }).catch(() => {})
  }
  // Save as a story entry (so the prompts become a permanent log of your shared games)
  try {
    if (configured) {
      await sb.from('milestones').insert({
        room_id: state.room,
        date: new Date().toISOString().split('T')[0],
        title: 'Drawing prompt',
        note: prompt,
      })
    }
  } catch {}
  playPing()
}

function onRemotePrompt(payload) {
  if (!payload || payload.from === state.me) return
  const display = document.getElementById('mg-prompt')
  if (display) {
    display.classList.remove('hidden')
    display.innerHTML = `<span class="mg-from">${escapeHtml(state.theirName?.() || 'Partner')} sent:</span> ${escapeHtml(payload.prompt)}`
  }
  playPing()
}

export function initMiniGame() {
  if (inited) return
  inited = true
  document.getElementById('mg-start')?.addEventListener('click', startGame)
  // Subscribe to partner's prompt broadcasts on the existing together channel
  if (configured) {
    const ch = sb.channel(`together:${state.room}`)
    ch.on('broadcast', { event: 'minigame' }, ({ payload }) => onRemotePrompt(payload))
    ch.subscribe()
  }
}

export function teardownMiniGame() { inited = false }
