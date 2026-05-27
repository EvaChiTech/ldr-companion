import { sb } from './supabase.js'

// NOTE: the Anthropic API key lives ONLY as a Supabase Edge Function secret
// (ANTHROPIC_API_KEY). It is never bundled into client code — a `VITE_`-prefixed
// key would be served to every visitor's browser.

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

  try {
    const { data, error } = await sb.functions.invoke('generate-date-ideas', {
      body: { n1, n2, tz1, tz2, since, interests },
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

  // Supabase JS doesn't expose a streaming invoke helper; we call the function URL.
  // Endpoint: <supabase-url>/functions/v1/<function-name>
  const baseUrl = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  const url = `${baseUrl}/functions/v1/generate-date-ideas-stream`

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ n1, n2, tz1, tz2, since, interests }),
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

