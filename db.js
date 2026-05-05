import { sb } from './supabase.js'
import { state } from './state.js'

const today = () => new Date().toISOString().split('T')[0]

// ── ROOMS ──────────────────────────────────────────────────
export async function createRoomInDB(cfg) {
  const { data, error } = await sb.from('rooms').insert(cfg).select().single()
  if (error) throw error
  return data
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
  const { error } = await sb.from('messages').insert({
    room_id:     state.room,
    partner_idx: state.me,
    content,
  })
  if (error) throw error
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
  const { error } = await sb.from('notes').upsert({
    room_id:     state.room,
    partner_idx: state.me,
    content,
    date:        today(),
    updated_at:  new Date().toISOString(),
  }, { onConflict: 'room_id,partner_idx,date' })
  if (error) throw error
}

// ── BUCKET LIST ────────────────────────────────────────────
export async function fetchBucket() {
  const { data, error } = await sb.from('bucket_items').select('*')
    .eq('room_id', state.room).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function insertBucketItem(text) {
  const { error } = await sb.from('bucket_items').insert({
    room_id:   state.room,
    text,
    done:      false,
    added_by:  state.me,
  })
  if (error) throw error
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
  const { error } = await sb.from('milestones').insert({
    room_id: state.room,
    date,
    title,
    note: note || null,
  })
  if (error) throw error
}

export async function deleteMilestone(id) {
  const { error } = await sb.from('milestones').delete().eq('id', id)
  if (error) throw error
}
