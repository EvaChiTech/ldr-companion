import { sb } from './supabase.js'
import { state } from './state.js'

let channel = null

/**
 * Subscribe to all real-time events for the current room.
 * Calls the provided handlers when data changes.
 */
export function subscribeRoom({ onMessage, onMood, onNote, onBucket, onMilestone, onWatch, onDailyAnswer, onSleepEvent, onDailyQuestion, onPresenceChange, onSoundCapsule, onReunion, onLetter, onDream, onCalendar, onExpense, onVisa, onCare }) {
  if (channel) sb.removeChannel(channel)

  channel = sb.channel('room:' + state.room, {
    config: { presence: { key: String(state.me) } },
  })
    // New chat message
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'messages',
      filter: `room_id=eq.${state.room}`,
    }, payload => onMessage?.(payload.new))

    // Mood update (upsert fires as INSERT or UPDATE)
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'moods',
      filter: `room_id=eq.${state.room}`,
    }, () => onMood?.())

    // Note update
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'notes',
      filter: `room_id=eq.${state.room}`,
    }, () => onNote?.())

    // Bucket list change
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'bucket_items',
      filter: `room_id=eq.${state.room}`,
    }, () => onBucket?.())

    // Milestone added/removed
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'milestones',
      filter: `room_id=eq.${state.room}`,
    }, () => onMilestone?.())

    // Watch session — load/play/pause/seek/tick
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'watch_sessions',
      filter: `room_id=eq.${state.room}`,
    }, payload => onWatch?.(payload.new))

    // Daily-question answers (mutual reveal trigger)
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'daily_answers',
      filter: `room_id=eq.${state.room}`,
    }, () => onDailyAnswer?.())

    // Sleep events (goodnight / wake-up)
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'sleep_events',
      filter: `room_id=eq.${state.room}`,
    }, () => onSleepEvent?.())

    // New questions inserted by partner — refresh current view
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'daily_questions',
      filter: `room_id=eq.${state.room}`,
    }, payload => onDailyQuestion?.(payload.new))

    // Sound capsule sent
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'sound_capsules',
      filter: `room_id=eq.${state.room}`,
    }, () => onSoundCapsule?.())

    // Reunion session started / ended
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'reunion_sessions',
      filter: `room_id=eq.${state.room}`,
    }, () => onReunion?.())

    // Future letters
    .on('postgres_changes', { event: '*', schema: 'public', table: 'future_letters',  filter: `room_id=eq.${state.room}` }, () => onLetter?.())
    // Dreams
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dreams',          filter: `room_id=eq.${state.room}` }, () => onDream?.())
    // Calendar
    .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events', filter: `room_id=eq.${state.room}` }, () => onCalendar?.())
    // Expenses
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses',        filter: `room_id=eq.${state.room}` }, () => onExpense?.())
    // Visa items
    .on('postgres_changes', { event: '*', schema: 'public', table: 'visa_items',      filter: `room_id=eq.${state.room}` }, () => onVisa?.())
    // Care pings
    .on('postgres_changes', { event: '*', schema: 'public', table: 'care_pings',      filter: `room_id=eq.${state.room}` }, () => onCare?.())

    // Presence — detect when partner comes online / offline
    .on('presence', { event: 'sync' }, () => {
      const ps = channel.presenceState()
      const partnerOnline = Object.keys(ps).some(k => k !== String(state.me))
      onPresenceChange?.(partnerOnline)
    })

    .subscribe(async status => {
      console.log('[Realtime]', status)
      if (status === 'SUBSCRIBED') {
        try { await channel.track({ partner_idx: state.me, t: Date.now() }) }
        catch (e) { console.error('[Realtime] track failed', e) }
      }
    })

  return channel
}

export function unsubscribeRoom() {
  if (channel && sb) {
    sb.removeChannel(channel)
    channel = null
  }
}
