import { sb } from './supabase.js'
import { state } from './state.js'

const today = () => new Date().toISOString().split('T')[0]

// Postgres TEXT columns + Supabase JSON request bodies are UTF-8 end-to-end,
// so emojis and accented characters pass through unchanged.
// Identity function, kept so existing call sites don't need refactoring.
function sanitizeForDB(obj) { return obj }

// ── ROOMS ──────────────────────────────────────────────────
export async function roomCodeExists(code) {
  const { data } = await sb.from('rooms').select('id').eq('id', code).maybeSingle()
  return !!data
}

export async function createRoomInDB(cfg) {
  try {
    const cleanCfg = sanitizeForDB(cfg)
    const { data, error } = await sb.from('rooms').insert(cleanCfg).select().single()
    
    if (error) {
      console.error('[DB] Supabase error:', error)
      throw error
    }
    
    console.log('[DB] Room created successfully:', data)
    return data
  } catch (e) {
    console.error('[DB] Create room error:', e)
    // If sanitization didn't work, try without problematic fields
    if (e.message?.includes('ISO-8859-1') || e.message?.includes('Headers')) {
      console.warn('[DB] Headers error detected, retrying with fallback...')
      const fallbackCfg = { ...sanitizeForDB(cfg) }
      try {
        const { data, error } = await sb.from('rooms').insert(fallbackCfg).select().single()
        if (error) throw error
        return data
      } catch (retryErr) {
        console.error('[DB] Retry also failed:', retryErr)
        throw retryErr
      }
    }
    throw e
  }
}

// Translate known-bad TZ IDs that may live in old rows
const TZ_FIXES = { 'Asia/Busan': 'Asia/Seoul' }
function healTz(t) { return t && TZ_FIXES[t] ? TZ_FIXES[t] : t }

export async function fetchRoom(code) {
  const { data, error } = await sb.from('rooms').select('*').eq('id', code).single()
  if (error) throw error
  if (data) {
    data.tz1 = healTz(data.tz1)
    data.tz2 = healTz(data.tz2)
  }
  return data
}

export async function updateRoomVisit(code, visit) {
  const { error } = await sb.from('rooms').update({ visit }).eq('id', code)
  if (error) throw error
}

// ── ROOM RPCs (identity-gated; see schema.sql AUTHORIZATION MODEL) ──
// create_room inserts the room AND records the caller as member (partner 1)
// atomically, with definer rights — a fresh member can't be added by RLS alone.
export async function createRoom(cfg) {
  const { data, error } = await sb.rpc('create_room', {
    p_id: cfg.id, p_n1: cfg.n1, p_n2: cfg.n2,
    p_tz1: cfg.tz1, p_tz2: cfg.tz2,
    p_since: cfg.since, p_visit: cfg.visit || null,
    p_interests: cfg.interests || '',
    p_kind: cfg.kind || 'couple', p_theme: cfg.theme || 'warm',
    p_alias: cfg.alias || null,
  })
  if (error) throw error
  return data
}

// preview_room returns just display fields so the join screen can show
// names/cities before the joiner commits to a partner slot.
export async function previewRoom(code) {
  const { data, error } = await sb.rpc('preview_room', { p_code: code })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('Room not found')
  return row
}

// join_room records the caller as a member, then returns the full room row.
export async function joinRoom(code, partnerIdx) {
  const { data, error } = await sb.rpc('join_room', {
    p_code: code, p_partner_idx: partnerIdx,
  })
  if (error) throw error
  return data
}

// Backfill helper: re-affirm membership for every room the client thinks it
// belongs to. join_room is idempotent (ON CONFLICT DO UPDATE), so this is
// safe to call on every boot. Heals the post-cutover gap where pre-existing
// rooms had no room_members rows — without it, storage writes get a 400.
export async function ensureMembership(rooms) {
  if (!sb || !Array.isArray(rooms) || !rooms.length) return
  await Promise.all(rooms.map(async r => {
    if (!r?.code || ![1, 2].includes(r.me)) return
    try { await sb.rpc('join_room', { p_code: r.code, p_partner_idx: r.me }) }
    catch (e) { console.warn('[db] ensureMembership skipped', r.code, e?.message || e) }
  }))
}

// delete_my_data — GDPR Art. 17 / CCPA erasure. Schedules every room
// the caller belongs to for permanent deletion in 30 days. Either partner
// can cancel during that window via cancelPendingDeletion(roomId).
export async function deleteMyData() {
  const { data, error } = await sb.rpc('delete_my_data')
  if (error) throw error
  return data || null
}

export async function cancelPendingDeletion(roomId) {
  const { data, error } = await sb.rpc('cancel_pending_deletion', { p_room_id: roomId })
  if (error) throw error
  return data || null
}

// ── MESSAGES ───────────────────────────────────────────────
export async function fetchMessages() {
  const { data, error } = await sb.from('messages').select('*')
    .eq('room_id', state.room).order('created_at')
  if (error) throw error
  return data || []
}

export async function insertMessage(content, attachment) {
  const row = {
    room_id:     state.room,
    partner_idx: state.me,
    content:     content || '',
  }
  if (attachment?.url) {
    row.image_url  = attachment.url
    row.image_kind = attachment.kind || 'image'
  }
  const { error } = await sb.from('messages').insert(row)
  if (error) throw error
}

// Mark all unread messages in this room from the OTHER partner as read by me.
export async function markRoomMessagesRead() {
  const { data: unread } = await sb.from('messages')
    .select('id,read_by,partner_idx').eq('room_id', state.room).neq('partner_idx', state.me).limit(200)
  if (!unread?.length) return
  const meKey = String(state.me)
  const now = new Date().toISOString()
  const updates = unread
    .filter(m => !m.read_by?.[meKey])
    .map(m => sb.from('messages').update({ read_by: { ...(m.read_by || {}), [meKey]: now } }).eq('id', m.id))
  if (!updates.length) return
  await Promise.allSettled(updates)
}

// Fetch all chat images in this room for the photo album.
export async function fetchChatImages() {
  const { data } = await sb.from('messages')
    .select('id,partner_idx,image_url,content,created_at')
    .eq('room_id', state.room).not('image_url', 'is', null)
    .order('created_at', { ascending: false }).limit(200)
  return data || []
}

// Export everything in a room as a single JSON blob (for backup / download).
export async function exportRoomData() {
  const tables = [
    'rooms', 'messages', 'moods', 'notes', 'bucket_items', 'milestones',
    'watch_sessions', 'daily_questions', 'daily_answers', 'sleep_events',
    'memory_chapters', 'sound_capsules', 'reunion_sessions', 'heartbeat_sessions',
    'future_letters', 'dreams', 'calendar_events', 'expenses', 'visa_items', 'care_pings',
  ]
  const out = { exported_at: new Date().toISOString(), room: state.room }
  for (const t of tables) {
    const col = (t === 'rooms') ? 'id' : 'room_id'
    const { data } = await sb.from(t).select('*').eq(col, state.room)
    out[t] = data || []
  }
  return out
}

// Upload a chat image to storage and return the public URL.
export async function uploadChatImage(blob, kind = 'image') {
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large (max 10 MB).')
  }
  if (!(blob.type || '').startsWith('image/')) {
    throw new Error('Only image files can be attached.')
  }
  const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0]
  const path = `${state.room}/${Date.now()}-p${state.me}.${ext}`
  const { error } = await sb.storage.from('chat-images').upload(path, blob, {
    contentType: blob.type, upsert: true,
  })
  if (error) throw error
  const { data } = sb.storage.from('chat-images').getPublicUrl(path)
  return { url: data.publicUrl, kind }
}

// ── MOODS ──────────────────────────────────────────────────
export async function fetchTodayMoods() {
  const { data, error } = await sb.from('moods').select('*')
    .eq('room_id', state.room).eq('date', today())
  if (error) throw error
  return data || []
}

export async function upsertMood(mood) {
  const { error } = await sb.from('moods').upsert({
    room_id:     state.room,
    partner_idx: state.me,
    mood,
    date:        today(),
    updated_at:  new Date().toISOString(),
  }, { onConflict: 'room_id,partner_idx,date' })
  if (error) throw error
}

// ── NOTES ──────────────────────────────────────────────────
export async function fetchNote(partnerIdx) {
  const { data } = await sb.from('notes').select('content')
    .eq('room_id', state.room).eq('partner_idx', partnerIdx).eq('date', today()).single()
  return data?.content || ''
}

export async function upsertNote(content) {
  try {
    const cleanContent = sanitizeForDB(content)
    const { error } = await sb.from('notes').upsert({
      room_id:     state.room,
      partner_idx: state.me,
      content: cleanContent,
      date:        today(),
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'room_id,partner_idx,date' })
    if (error) throw error
  } catch (e) {
    if (e.message?.includes('ISO-8859-1') || e.message?.includes('Headers')) {
      console.warn('Note with special characters failed, storing as ASCII...')
      const { error } = await sb.from('notes').upsert({
        room_id:     state.room,
        partner_idx: state.me,
        content: sanitizeForDB(content),
        date:        today(),
        updated_at:  new Date().toISOString(),
      }, { onConflict: 'room_id,partner_idx,date' })
      if (error) throw error
    } else {
      throw e
    }
  }
}

// ── BUCKET LIST ────────────────────────────────────────────
export async function fetchBucket() {
  const { data, error } = await sb.from('bucket_items').select('*')
    .eq('room_id', state.room).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function insertBucketItem(text) {
  try {
    const cleanText = sanitizeForDB(text)
    const { error } = await sb.from('bucket_items').insert({
      room_id:   state.room,
      text: cleanText,
      done:      false,
      added_by:  state.me,
    })
    if (error) throw error
  } catch (e) {
    if (e.message?.includes('ISO-8859-1') || e.message?.includes('Headers')) {
      console.warn('Bucket item with special characters failed, storing as ASCII...')
      const { error } = await sb.from('bucket_items').insert({
        room_id:   state.room,
        text: sanitizeForDB(text),
        done:      false,
        added_by:  state.me,
      })
      if (error) throw error
    } else {
      throw e
    }
  }
}

export async function toggleBucketItem(id, currentDone) {
  const { error } = await sb.from('bucket_items').update({ done: !currentDone }).eq('id', id)
  if (error) throw error
}

export async function deleteBucketItem(id) {
  const { error } = await sb.from('bucket_items').delete().eq('id', id)
  if (error) throw error
}

// ── MILESTONES ─────────────────────────────────────────────
export async function fetchMilestones() {
  const { data, error } = await sb.from('milestones').select('*')
    .eq('room_id', state.room).order('date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function insertMilestone({ date, title, note }) {
  try {
    const cleanTitle = sanitizeForDB(title)
    const cleanNote = sanitizeForDB(note)
    const { error } = await sb.from('milestones').insert({
      room_id: state.room,
      date,
      title: cleanTitle,
      note: cleanNote || null,
    })
    if (error) throw error
  } catch (e) {
    if (e.message?.includes('ISO-8859-1') || e.message?.includes('Headers')) {
      console.warn('Milestone with special characters failed, storing as ASCII...')
      const { error } = await sb.from('milestones').insert({
        room_id: state.room,
        date,
        title: sanitizeForDB(title),
        note: sanitizeForDB(note) || null,
      })
      if (error) throw error
    } else {
      throw e
    }
  }
}

export async function deleteMilestone(id) {
  const { error } = await sb.from('milestones').delete().eq('id', id)
  if (error) throw error
}

// ── WATCH SESSION ──────────────────────────────────────────
export async function fetchWatchSession() {
  const { data, error } = await sb.from('watch_sessions')
    .select('*').eq('room_id', state.room).maybeSingle()
  if (error && error.code !== 'PGRST116') throw error
  return data || null
}

export async function upsertWatchSession({ source, media_id, is_playing, position }) {
  const { error } = await sb.from('watch_sessions').upsert({
    room_id:     state.room,
    source,
    media_id,
    is_playing:  !!is_playing,
    position:    Number(position) || 0,
    position_at: new Date().toISOString(),
    updated_by:  state.me,
    updated_at:  new Date().toISOString(),
  }, { onConflict: 'room_id' })
  if (error) throw error
}

export async function updateWatchQueue(queue) {
  const { error } = await sb.from('watch_sessions')
    .update({ queue, updated_by: state.me, updated_at: new Date().toISOString() })
    .eq('room_id', state.room)
  if (error) throw error
}

// ── Upload validation limits ───────────────────────────────
const MAX_VLOG_BYTES  = 524288000  // 500 MB
const MAX_IMAGE_BYTES = 10485760   // 10 MB
const ALLOWED_VLOG_TYPES  = ['video/webm', 'video/mp4']

// ── VLOGS ──────────────────────────────────────────────────
export async function uploadVlog(blob, { partnerIdx, ext = 'webm' }) {
  // Strip codec params (e.g. "video/webm;codecs=vp9,opus") — Supabase Storage
  // wants a bare MIME type in the Content-Type header.
  const contentType = (blob.type || 'video/webm').split(';')[0].trim() || 'video/webm'
  if (blob.size > MAX_VLOG_BYTES) {
    throw new Error('Video is too large (max 500 MB) — record a shorter clip.')
  }
  if (!ALLOWED_VLOG_TYPES.includes(contentType)) {
    throw new Error(`Unsupported video format: ${contentType}`)
  }
  const path = `${state.room}/${Date.now()}-p${partnerIdx}.${ext}`
  const { error } = await sb.storage.from('vlogs').upload(path, blob, {
    contentType, upsert: true,
  })
  if (error) { console.error('[db] uploadVlog failed', error); throw error }
  const { data } = sb.storage.from('vlogs').getPublicUrl(path)
  return data.publicUrl
}

export async function uploadVlogThumb(blob, partnerIdx) {
  const path = `${state.room}/${Date.now()}-p${partnerIdx}-thumb.jpg`
  const { error } = await sb.storage.from('vlogs').upload(path, blob, {
    contentType: 'image/jpeg', upsert: true,
  })
  if (error) { console.error('[db] uploadVlogThumb failed', error); throw error }
  const { data } = sb.storage.from('vlogs').getPublicUrl(path)
  return data.publicUrl
}

export async function insertVlog(row) {
  const { data, error } = await sb.from('vlogs')
    .insert({ room_id: state.room, partner_idx: state.me, ...row })
    .select().single()
  if (error) throw error
  return data
}

export async function fetchVlogs() {
  const { data, error } = await sb.from('vlogs').select('*')
    .eq('room_id', state.room).order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return data || []
}

export async function deleteVlog(id) {
  const { error } = await sb.from('vlogs').delete().eq('id', id)
  if (error) throw error
}

export async function markVlogWatched(id) {
  const { data: v } = await sb.from('vlogs').select('watched_by').eq('id', id).maybeSingle()
  const meKey = String(state.me)
  if (v?.watched_by?.[meKey]) return
  await sb.from('vlogs').update({
    watched_by: { ...(v?.watched_by || {}), [meKey]: new Date().toISOString() },
  }).eq('id', id)
}

// Fetch the first reply to a vlog (newest if there are several).
export async function fetchVlogReply(vlogId) {
  const { data } = await sb.from('vlogs').select('*')
    .eq('room_id', state.room).eq('reply_to', vlogId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data || null
}
