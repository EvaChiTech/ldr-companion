import { sb } from './supabase.js'
import { state } from './state.js'

const today = () => new Date().toISOString().split('T')[0]

// Helper to ensure text is ASCII-safe by removing or replacing non-ASCII characters
function sanitizeForDB(obj) {
  if (typeof obj === 'string') {
    // Keep only ASCII and common punctuation/spaces
    return obj.replace(/[^\x20-\x7E\n]/g, (char) => {
      // For common letters with accents, try to replace with base letter
      const replacements = {
        'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
        'á': 'a', 'à': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a',
        'ó': 'o', 'ò': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o',
        'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
        'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
        'ñ': 'n', 'ç': 'c',
      }
      return replacements[char] || '?'
    })
  }
  if (typeof obj === 'object' && obj !== null) {
    const sanitized = {}
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeForDB(value)
    }
    return sanitized
  }
  return obj
}

// ── ROOMS ──────────────────────────────────────────────────
export async function createRoomInDB(cfg) {
  try {
    console.log('[DB] createRoomInDB called with cfg:', cfg)
    const cleanCfg = sanitizeForDB(cfg)
    console.log('[DB] Sanitized cfg:', cleanCfg)
    
    // Log each field to check for non-ASCII characters
    Object.entries(cleanCfg).forEach(([key, val]) => {
      if (typeof val === 'string') {
        const hasNonASCII = /[^\x20-\x7E\n]/.test(val)
        console.log(`[DB] Field "${key}": "${val}" (non-ASCII: ${hasNonASCII})`)
      }
    })
    
    console.log('[DB] Attempting to insert into Supabase...')
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

export async function fetchRoom(code) {
  const { data, error } = await sb.from('rooms').select('*').eq('id', code).single()
  if (error) throw error
  return data
}

export async function updateRoomVisit(code, visit) {
  const { error } = await sb.from('rooms').update({ visit }).eq('id', code)
  if (error) throw error
}

// ── MESSAGES ───────────────────────────────────────────────
export async function fetchMessages() {
  const { data, error } = await sb.from('messages').select('*')
    .eq('room_id', state.room).order('created_at')
  if (error) throw error
  return data || []
}

export async function insertMessage(content) {
  try {
    const cleanContent = sanitizeForDB(content)
    const { error } = await sb.from('messages').insert({
      room_id:     state.room,
      partner_idx: state.me,
      content: cleanContent,
    })
    if (error) throw error
  } catch (e) {
    if (e.message?.includes('ISO-8859-1') || e.message?.includes('Headers')) {
      console.warn('Message with special characters failed, storing as ASCII...')
      const { error } = await sb.from('messages').insert({
        room_id:     state.room,
        partner_idx: state.me,
        content: sanitizeForDB(content),
      })
      if (error) throw error
    } else {
      throw e
    }
  }
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
