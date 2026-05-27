import { state } from './state.js'
import { configured, sb } from './supabase.js'
import { playPing } from './sound.js'
import { QUESTIONS, pickFromBank, allCategories } from './question-bank.js'
import { startRecording, stopRecording, isRecording, cancelRecording, uploadVoiceNote } from './recorder.js'

// ============================================================
// RITUALS TAB — multi-Q with depth dial, themes, voice notes
// ============================================================

const today = () => new Date().toISOString().split('T')[0]
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

const PREF_DEPTH = 'ldr_dq_depth'
const PREF_THEME = 'ldr_dq_theme'

let inited = false
let currentQuestion = null
let pendingAudio = null     // {blob, url} after recording, before submit
let recTimer = null

const getDepth = () => localStorage.getItem(PREF_DEPTH) || 'medium'
const getTheme = () => localStorage.getItem(PREF_THEME) || 'random'

// ============================================================
// QUESTION FETCH / GENERATE
// ============================================================
async function fetchActiveQuestion() {
  if (!configured) return null
  const { data, error } = await sb.from('daily_questions')
    .select('*').eq('room_id', state.room)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) { console.error(error); return null }
  return data
}

async function fetchRecentQuestions(limit = 8) {
  if (!configured) return []
  const { data } = await sb.from('daily_questions')
    .select('question').eq('room_id', state.room)
    .order('created_at', { ascending: false }).limit(limit)
  return (data || []).map(d => d.question)
}

async function countQuestionsAsked() {
  if (!configured) return 0
  const { count } = await sb.from('daily_questions')
    .select('id', { count: 'exact', head: true }).eq('room_id', state.room)
  return count || 0
}

async function generateAndInsertQuestion() {
  if (!configured) return null
  const since = state.cfg?.since
  const dayIndex = since ? Math.floor((Date.now() - new Date(since + 'T00:00:00').getTime()) / 86400000) : 0
  const askedSoFar = await countQuestionsAsked()
  const recentQuestions = await fetchRecentQuestions(8)
  const depth = getDepth(), theme = getTheme()

  let question, category
  try {
    const { data, error } = await sb.functions.invoke('daily-question', {
      body: {
        n1: state.cfg.n1, n2: state.cfg.n2,
        since, interests: state.cfg.interests,
        dayIndex, askedSoFar, recentQuestions,
        depth, theme,
      },
    })
    if (error) throw error
    question = data?.question
    category = data?.category || null
    if (!question) throw new Error('Empty question from AI')
  } catch (e) {
    console.error('[rituals] AI fail, using bank fallback', e)
    const picked = pickFromBank({ depth, theme, seed: askedSoFar + dayIndex })
    question = picked.q
    category = picked.c
  }

  const { data: inserted, error: insErr } = await sb.from('daily_questions').insert({
    room_id: state.room, date: today(), question, category,
  }).select().single()
  if (insErr) { console.error(insErr); return null }
  return inserted
}

// ============================================================
// ANSWERS + REVEAL
// ============================================================
async function fetchAnswersForQuestion(qid) {
  if (!configured || !qid) return []
  const { data } = await sb.from('daily_answers').select('*').eq('question_id', qid)
  return data || []
}

async function submitAnswer() {
  if (!currentQuestion) return
  const myAns = document.getElementById('dq-my-answer')
  const submitBtn = document.getElementById('dq-submit')
  const text = myAns.value.trim()
  if (!text && !pendingAudio) return
  if (!configured) { showToast('Connection needed first'); return }
  submitBtn.disabled = true
  try {
    let audio_url = null
    if (pendingAudio?.blob) {
      audio_url = await uploadVoiceNote(sb, pendingAudio.blob, {
        roomId: state.room, questionId: currentQuestion.id, partnerIdx: state.me,
      })
    }
    await sb.from('daily_answers').upsert({
      room_id: state.room, partner_idx: state.me, date: today(),
      question_id: currentQuestion.id,
      answer: text,                 // may be empty if voice-only — handled at render time
      audio_url,
    }, { onConflict: 'question_id,partner_idx' })
    myAns.disabled = true
    pendingAudio = null
    renderRecorderState('idle')
    await renderActiveQuestion()
    showToast('Answer locked in 💌')
    playPing()
  } catch (e) {
    submitBtn.disabled = false
    showToast('Could not save: ' + e.message)
  }
}

async function nextQuestion() {
  const nextBtn = document.getElementById('dq-next')
  if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = '✨ Crafting…' }
  const q = await generateAndInsertQuestion()
  if (q) {
    currentQuestion = q
    pendingAudio = null
    await renderActiveQuestion()
    await renderHistory()
  }
  if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = 'Next question →' }
}

// ============================================================
// VOICE RECORDER UI
// ============================================================
async function startRec() {
  try {
    await startRecording()
    renderRecorderState('recording')
    let secs = 0
    recTimer = setInterval(() => {
      secs++
      const t = document.getElementById('rec-timer')
      if (t) t.textContent = `${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`
      if (secs >= 90) stopRec()  // hard cap at 90s
    }, 1000)
  } catch (e) {
    showToast('Mic blocked: ' + (e.message || 'permission denied'))
  }
}

async function stopRec() {
  if (recTimer) { clearInterval(recTimer); recTimer = null }
  if (!isRecording()) return
  try {
    const blob = await stopRecording()
    pendingAudio = { blob, url: URL.createObjectURL(blob) }
    renderRecorderState('preview')
  } catch (e) {
    showToast('Recording failed: ' + (e.message || ''))
    renderRecorderState('idle')
  }
}

function discardRec() {
  if (pendingAudio?.url) URL.revokeObjectURL(pendingAudio.url)
  pendingAudio = null
  renderRecorderState('idle')
}

function renderRecorderState(state) {
  const wrap = document.getElementById('rec-wrap')
  if (!wrap) return
  wrap.dataset.state = state
  const btnStart = document.getElementById('rec-start')
  const btnStop  = document.getElementById('rec-stop')
  const btnDisc  = document.getElementById('rec-discard')
  const audio    = document.getElementById('rec-preview')
  const timer    = document.getElementById('rec-timer')
  if (btnStart) btnStart.style.display = state === 'idle'      ? '' : 'none'
  if (btnStop)  btnStop.style.display  = state === 'recording' ? '' : 'none'
  if (btnDisc)  btnDisc.style.display  = state === 'preview'   ? '' : 'none'
  if (timer)    timer.style.display    = state === 'recording' ? '' : 'none'
  if (timer && state === 'recording') timer.textContent = '00:00'
  if (audio) {
    if (state === 'preview' && pendingAudio?.url) {
      audio.src = pendingAudio.url
      audio.style.display = ''
    } else {
      audio.removeAttribute('src')
      audio.style.display = 'none'
    }
  }
}

// ============================================================
// RENDERING
// ============================================================
function setText(el, txt, voiceOnly = false) {
  if (!el) return
  el.textContent = txt
  el.classList.toggle('voice-only', !!voiceOnly)
}

function setAudio(el, url) {
  if (!el) return
  if (url) { el.src = url; el.style.display = '' }
  else     { el.removeAttribute('src'); el.style.display = 'none' }
}

async function renderActiveQuestion() {
  const qBox = document.getElementById('dq-question')
  const catEl = document.getElementById('dq-category')
  const myAns = document.getElementById('dq-my-answer')
  const myAudio = document.getElementById('dq-my-audio')
  const partnerAns = document.getElementById('dq-partner-answer')
  const partnerLabel = document.getElementById('dq-partner-label')
  const partnerAudio = document.getElementById('dq-partner-audio')
  const submitBtn = document.getElementById('dq-submit')
  const status = document.getElementById('dq-status')
  const nextBtn = document.getElementById('dq-next')
  if (!qBox) return

  if (!currentQuestion) {
    qBox.textContent = 'No questions yet — tap below to start.'
    if (catEl) catEl.textContent = ''
    myAns.value = ''; myAns.disabled = false
    submitBtn.disabled = false; submitBtn.style.display = 'none'
    if (nextBtn) { nextBtn.style.display = ''; nextBtn.textContent = 'Generate first question ✨' }
    setText(partnerAns, '')
    setAudio(partnerAudio, null)
    setAudio(myAudio, null)
    status.textContent = ''
    renderRecorderState('idle')
    return
  }

  qBox.textContent = currentQuestion.question
  if (catEl) catEl.textContent = currentQuestion.category ? '· ' + currentQuestion.category : ''
  partnerLabel.textContent = (state.theirName?.() || 'Partner') + "'s answer"
  submitBtn.style.display = ''

  const answers = await fetchAnswersForQuestion(currentQuestion.id)
  const mine   = answers.find(a => a.partner_idx === state.me)
  const theirs = answers.find(a => a.partner_idx === (state.me === 1 ? 2 : 1))

  // Helper to render either side respecting "voice-only" / "text-only" / "both"
  const renderAnswer = (ansEl, audioEl, row, lockedMsg) => {
    if (!row) {
      setText(ansEl, lockedMsg || '')
      setAudio(audioEl, null)
      return
    }
    if (row.answer && row.audio_url) {
      setText(ansEl, row.answer)
      setAudio(audioEl, row.audio_url)
    } else if (row.audio_url) {
      setText(ansEl, '🎙 Voice answer', /* voiceOnly */ true)
      setAudio(audioEl, row.audio_url)
    } else {
      setText(ansEl, row.answer || '')
      setAudio(audioEl, null)
    }
  }

  // My side (textarea + own audio playback after submit)
  myAns.value = mine ? (mine.answer || '') : ''
  myAns.disabled = !!mine
  submitBtn.disabled = !!mine
  if (mine?.audio_url) setAudio(myAudio, mine.audio_url); else setAudio(myAudio, null)

  // Partner reveal
  if (mine && theirs) {
    renderAnswer(partnerAns, partnerAudio, theirs)
    status.textContent = '✓ Both answered — revealed.'
    if (nextBtn) nextBtn.style.display = ''
    renderRecorderState('idle')
  } else if (mine && !theirs) {
    renderAnswer(partnerAns, partnerAudio, null, '🔒 Hidden until they answer')
    status.textContent = `Waiting on ${state.theirName?.() || 'them'}…`
    if (nextBtn) nextBtn.style.display = 'none'
    renderRecorderState('idle')
  } else if (!mine && theirs) {
    renderAnswer(partnerAns, partnerAudio, null, '🔒 Hidden until you answer')
    status.textContent = `${state.theirName?.() || 'They'} answered already. Your turn.`
    if (nextBtn) nextBtn.style.display = 'none'
  } else {
    renderAnswer(partnerAns, partnerAudio, null)
    status.textContent = 'Both answer privately, then it reveals. Type, record, or both.'
    if (nextBtn) nextBtn.style.display = 'none'
  }
  if (nextBtn && nextBtn.style.display !== 'none') nextBtn.textContent = 'Next question →'
}

async function renderHistory() {
  const list = document.getElementById('dq-history')
  if (!list || !configured) return
  const { data: qs } = await sb.from('daily_questions')
    .select('*').eq('room_id', state.room)
    .order('created_at', { ascending: false })
  const all = qs || []
  const ids = all.filter(q => q.id !== currentQuestion?.id).map(q => q.id)
  let answersByQ = {}
  if (ids.length) {
    const { data: ans } = await sb.from('daily_answers').select('*').in('question_id', ids)
    ans?.forEach(a => {
      if (!answersByQ[a.question_id]) answersByQ[a.question_id] = []
      answersByQ[a.question_id].push(a)
    })
  }
  const previous = all.filter(q => q.id !== currentQuestion?.id)
  list.innerHTML = ''
  if (!previous.length) { list.innerHTML = '<div class="empty-state">No previous questions yet.</div>'; return }
  const renderAnsText = a => {
    if (!a) return '<em>—</em>'
    if (a.answer)    return escapeHtml(a.answer)
    if (a.audio_url) return '<span class="voice-only">🎙 Voice answer</span>'
    return '<em>—</em>'
  }
  previous.forEach(q => {
    const ans = answersByQ[q.id] || []
    const a1 = ans.find(a => a.partner_idx === 1)
    const a2 = ans.find(a => a.partner_idx === 2)
    const card = document.createElement('article')
    card.className = 'dq-history-card'
    card.innerHTML = `
      <div class="dq-history-meta">${escapeHtml(q.date)} ${q.category ? '· ' + escapeHtml(q.category) : ''}</div>
      <div class="dq-history-q">${escapeHtml(q.question)}</div>
      <div class="dq-history-answers">
        <div class="dq-history-ans">
          <span class="dq-history-who">${escapeHtml(state.cfg?.n1 || 'Partner 1')}</span>
          <span>${renderAnsText(a1)}</span>
          ${a1?.audio_url ? `<audio controls preload="none" src="${escapeHtml(a1.audio_url)}" class="dq-history-audio"></audio>` : ''}
        </div>
        <div class="dq-history-ans">
          <span class="dq-history-who">${escapeHtml(state.cfg?.n2 || 'Partner 2')}</span>
          <span>${renderAnsText(a2)}</span>
          ${a2?.audio_url ? `<audio controls preload="none" src="${escapeHtml(a2.audio_url)}" class="dq-history-audio"></audio>` : ''}
        </div>
      </div>`
    list.appendChild(card)
  })
}

async function loadAll() {
  currentQuestion = await fetchActiveQuestion()
  await renderActiveQuestion()
  await renderHistory()
}

// ============================================================
// DEPTH DIAL + THEME PICKER
// ============================================================
function buildDepthDial() {
  const wrap = document.getElementById('dq-depth')
  if (!wrap || wrap.dataset.bound) return
  wrap.dataset.bound = '1'
  const cur = getDepth()
  ;['light','medium','deep'].forEach(d => {
    const b = wrap.querySelector(`[data-depth="${d}"]`)
    if (!b) return
    if (d === cur) b.classList.add('active')
    b.onclick = () => {
      localStorage.setItem(PREF_DEPTH, d)
      wrap.querySelectorAll('button').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      showToast(`Depth: ${d}`)
    }
  })
}

function buildThemePicker() {
  const sel = document.getElementById('dq-theme')
  if (!sel || sel.dataset.bound) return
  sel.dataset.bound = '1'
  const cats = allCategories()
  sel.innerHTML = '<option value="random">Random theme</option>' +
    cats.map(c => `<option value="${c}">Tonight: ${c}</option>`).join('')
  sel.value = getTheme()
  sel.onchange = () => {
    localStorage.setItem(PREF_THEME, sel.value)
    showToast(sel.value === 'random' ? 'Theme: random' : `Theme locked: ${sel.value}`)
  }
}

// ============================================================
// SLEEP — unchanged
// ============================================================
async function loadSleep() {
  if (!configured) return
  const date = today()
  const { data } = await sb.from('sleep_events').select('*').eq('room_id', state.room).eq('date', date)
  const mine = data?.find(d => d.partner_idx === state.me)
  const theirs = data?.find(d => d.partner_idx === (state.me === 1 ? 2 : 1))
  renderSleep(mine, theirs)
}
function renderSleep(mine, theirs) {
  const my = document.getElementById('sleep-my')
  const their = document.getElementById('sleep-their')
  const status = document.getElementById('sleep-status')
  const btnGN = document.getElementById('sleep-goodnight')
  const btnWU = document.getElementById('sleep-wakeup')
  if (!my) return
  const fmt = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'
  my.textContent    = mine    ? `Goodnight ${fmt(mine.goodnight_at)}  •  Wake ${fmt(mine.wakeup_at)}`     : 'Not yet tonight'
  their.textContent = theirs  ? `Goodnight ${fmt(theirs.goodnight_at)}  •  Wake ${fmt(theirs.wakeup_at)}` : 'Not yet'
  if (mine?.goodnight_at && theirs?.goodnight_at && !mine?.wakeup_at && !theirs?.wakeup_at) {
    status.innerHTML = '<span class="breath">Both asleep — breathing together 🌙</span>'
  } else if (mine?.goodnight_at && !theirs?.goodnight_at) {
    status.textContent = `${state.theirName?.() || 'They'} is still up.`
  } else if (theirs?.goodnight_at && !mine?.goodnight_at) {
    status.textContent = `${state.theirName?.() || 'They'} just said goodnight.`
  } else if (mine?.wakeup_at && !theirs?.wakeup_at) {
    status.textContent = `You woke first today ☀️ — ${state.theirName?.() || 'they'} still asleep.`
  } else if (theirs?.wakeup_at && !mine?.wakeup_at) {
    status.textContent = `${state.theirName?.() || 'They'} is already awake — good morning.`
  } else {
    status.textContent = ''
  }
  btnGN.disabled = !!mine?.goodnight_at
  btnWU.disabled = !mine?.goodnight_at || !!mine?.wakeup_at
  btnGN.textContent = mine?.goodnight_at ? '💤 Goodnight (logged)' : '💤 Goodnight'
  btnWU.textContent = mine?.wakeup_at    ? '☀️ Awake (logged)'      : '☀️ I\'m awake'
}
async function logGoodnight() {
  if (!configured) return
  await sb.from('sleep_events').upsert({ room_id: state.room, partner_idx: state.me, date: today(), goodnight_at: new Date().toISOString() }, { onConflict: 'room_id,partner_idx,date' })
  await loadSleep(); showToast('Goodnight 💤')
}
async function logWakeup() {
  if (!configured) return
  await sb.from('sleep_events').upsert({ room_id: state.room, partner_idx: state.me, date: today(), wakeup_at: new Date().toISOString() }, { onConflict: 'room_id,partner_idx,date' })
  await loadSleep(); showToast('Good morning ☀️')
}

// ============================================================
// STREAKS
// ============================================================
async function computeStreaks() {
  if (!configured) return { notes: 0, answers: 0 }
  const since = new Date(); since.setDate(since.getDate() - 90)
  const sinceISO = since.toISOString().split('T')[0]
  const [{ data: notes }, { data: answers }] = await Promise.all([
    sb.from('notes').select('date').eq('room_id', state.room).eq('partner_idx', state.me).gte('date', sinceISO).order('date', { ascending: false }),
    sb.from('daily_answers').select('date').eq('room_id', state.room).eq('partner_idx', state.me).gte('date', sinceISO).order('date', { ascending: false }),
  ])
  return {
    notes:   countConsecutive(notes?.map(n => n.date) || []),
    answers: countConsecutive(answers?.map(a => a.date) || []),
  }
}
function countConsecutive(dates) {
  if (!dates.length) return 0
  const set = new Set(dates)
  let count = 0
  let cursor = new Date()
  let allowToday = true
  while (true) {
    const key = cursor.toISOString().split('T')[0]
    if (set.has(key)) { count++; allowToday = false }
    else if (allowToday) { allowToday = false }
    else break
    cursor.setDate(cursor.getDate() - 1)
  }
  return count
}
async function renderStreaks() {
  const wrap = document.getElementById('streaks-wrap')
  if (!wrap) return
  wrap.innerHTML = '<div class="streak-skel">…</div>'
  const s = await computeStreaks()
  wrap.innerHTML = `
    <div class="streak-card"><div class="streak-num">${s.notes}</div><div class="streak-lbl">days writing daily notes 📝</div></div>
    <div class="streak-card"><div class="streak-num">${s.answers}</div><div class="streak-lbl">days answering questions 💌</div></div>`
}

function showToast(msg) {
  const t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg; t.style.opacity = '1'
  clearTimeout(showToast._tm)
  showToast._tm = setTimeout(() => t.style.opacity = '0', 2200)
}

// ============================================================
// PUBLIC API
// ============================================================
export function initRitualsTab() {
  if (inited) return
  inited = true
  buildDepthDial()
  buildThemePicker()
  document.getElementById('dq-submit')?.addEventListener('click', submitAnswer)
  document.getElementById('dq-next')?.addEventListener('click', nextQuestion)
  document.getElementById('rec-start')?.addEventListener('click', startRec)
  document.getElementById('rec-stop')?.addEventListener('click', stopRec)
  document.getElementById('rec-discard')?.addEventListener('click', discardRec)
  document.getElementById('sleep-goodnight')?.addEventListener('click', logGoodnight)
  document.getElementById('sleep-wakeup')?.addEventListener('click', logWakeup)
  loadAll(); loadSleep(); renderStreaks()
}

export function onRemoteRitualEvent(kind) {
  if (!inited) return
  if (kind === 'daily_answer')        { renderActiveQuestion(); renderHistory(); playPing() }
  else if (kind === 'daily_question') { loadAll(); playPing() }
  else if (kind === 'sleep_event')    { loadSleep() }
}

export function teardownRituals() {
  cancelRecording()
  if (recTimer) { clearInterval(recTimer); recTimer = null }
  inited = false
  currentQuestion = null
  pendingAudio = null
}
