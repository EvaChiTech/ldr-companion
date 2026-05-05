import { sb } from './supabase.js'
import { state } from './state.js'

let channel = null

/**
 * Subscribe to all real-time events for the current room.
 * Calls the provided handlers when data changes.
 */
export function subscribeRoom({ onMessage, onMood, onNote, onBucket, onMilestone }) {
  if (channel) sb.removeChannel(channel)

  channel = sb.channel('room:' + state.room)
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

    .subscribe(status => {
      console.log('[Realtime]', status)
    })

  return channel
}

export function unsubscribeRoom() {
  if (channel && sb) {
    sb.removeChannel(channel)
    channel = null
  }
}
