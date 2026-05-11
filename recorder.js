// ============================================================
// MediaRecorder wrapper for short voice-note answers
// Records → returns a Blob you can upload to Supabase Storage.
// ============================================================

let stream = null
let recorder = null
let chunks = []

export async function startRecording() {
  if (recorder && recorder.state !== 'inactive') throw new Error('Already recording')
  stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  // Pick the best supported mime — Chrome prefers webm/opus, Safari falls back to mp4
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || ''
  recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
  chunks = []
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
  recorder.start(250)
  return recorder.mimeType
}

export function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!recorder) return reject(new Error('Not recording'))
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      stream?.getTracks().forEach(t => t.stop())
      stream = null; recorder = null; chunks = []
      resolve(blob)
    }
    recorder.onerror = (e) => reject(e.error || new Error('Recorder error'))
    try { recorder.stop() } catch (e) { reject(e) }
  })
}

export function isRecording() {
  return recorder && recorder.state === 'recording'
}

export function cancelRecording() {
  try { recorder?.stop() } catch {}
  stream?.getTracks().forEach(t => t.stop())
  stream = null; recorder = null; chunks = []
}

// Upload a recorded blob to the public 'voice-notes' bucket and return the URL.
export async function uploadVoiceNote(sb, blob, { roomId, questionId, partnerIdx }) {
  const ext = (blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm')
  const path = `${roomId}/${questionId}-p${partnerIdx}-${Date.now()}.${ext}`
  const { error } = await sb.storage.from('voice-notes').upload(path, blob, {
    contentType: blob.type, upsert: true,
  })
  if (error) throw error
  const { data } = sb.storage.from('voice-notes').getPublicUrl(path)
  return data.publicUrl
}
