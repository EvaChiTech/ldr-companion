import { sb } from './supabase.js'

const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY

/**
 * Generate personalized virtual date ideas using Claude via Supabase Edge Function.
 * @param {Object} opts
 * @param {string} opts.n1        - Partner 1 name
 * @param {string} opts.n2        - Partner 2 name
 * @param {string} opts.tz1       - Partner 1 timezone (e.g. Asia/Seoul)
 * @param {string} opts.tz2       - Partner 2 timezone (e.g. Europe/Helsinki)
 * @param {string} opts.since     - ISO date string (relationship start)
 * @param {string} opts.interests - Shared interests
 * @returns {Promise<Array<{title: string, description: string}>>}
 */
export async function generateDateIdeas({ n1, n2, tz1, tz2, since, interests }) {
  if (!sb) {
    throw new Error('Connection not configured. Add keys to .env first.')
  }

  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY.includes('your-key')) {
    throw new Error('Connection key not configured in .env')
  }

  try {
    const { data, error } = await sb.functions.invoke('generate-date-ideas', {
      body: { n1, n2, tz1, tz2, since, interests, apiKey: ANTHROPIC_API_KEY },
    })

    if (error) {
      throw error
    }

    return data.ideas
  } catch (err) {
    throw new Error(`Could not generate ideas: ${err.message}`)
  }
}

/**
 * Stream date ideas text via SSE from Supabase Edge Function.
 * This is a UX demo of streaming from `streamText`.
 */
export async function streamDateIdeas({ n1, n2, tz1, tz2, since, interests, onToken }) {
  if (!sb) throw new Error('Connection not configured. Add keys to .env first.')
  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY.includes('your-key')) {
    throw new Error('Connection key not configured in .env')
  }

  // Supabase JS doesn't expose streaming invoke helper; we call the function URL.
  // For local dev, the function endpoint is typically:
  // <supabase-url>/functions/v1/<function-name>
  const baseUrl = import.meta.env.VITE_SUPABASE_URL
  const url = `${baseUrl}/functions/v1/generate-date-ideas-stream`

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      n1,
      n2,
      tz1,
      tz2,
      since,
      interests,
      apiKey: ANTHROPIC_API_KEY,
    }),
  })

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    throw new Error(`Stream request failed (${resp.status}): ${txt}`)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE format: lines starting with `data:`.
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice('data:'.length).trim()
      if (!data || data === '[DONE]') {
        if (data === '[DONE]') return
        continue
      }
      try {
        const parsed = JSON.parse(data)
        if (typeof parsed === 'string') onToken?.(parsed)
        else if (parsed?.error) throw new Error(parsed.error)
      } catch (e) {
        if (e instanceof SyntaxError) onToken?.(data)
        else throw e
      }
    }
  }
}

