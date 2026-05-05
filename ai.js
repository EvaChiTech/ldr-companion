const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY

/**
 * Generate personalized virtual date ideas using Claude.
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
  if (!ANTHROPIC_KEY || ANTHROPIC_KEY.includes('your-key')) {
    throw new Error('Anthropic API key not configured in .env')
  }

  const city1 = tz1.split('/').pop().replace(/_/g, ' ')
  const city2 = tz2.split('/').pop().replace(/_/g, ' ')
  const days   = Math.floor((Date.now() - new Date(since + 'T00:00:00')) / 86400000)

  const prompt = `Generate 4 creative, heartfelt virtual date ideas for a long-distance couple.

Couple: ${n1} (in ${city1}) and ${n2} (in ${city2})
Together for: ${days} days
Shared interests: ${interests || 'not specified — use universally appealing ideas'}

Requirements:
- Each idea must be doable over a video call
- Be specific to their locations/cultures when possible
- Warm, personal, not generic
- Mix different vibes: cozy, playful, romantic, adventurous

Return ONLY a JSON array. No markdown, no explanation. Format:
[{"title":"short evocative title","description":"2 warm, specific, actionable sentences"}]`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1200,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `API error ${res.status}`)
  }

  const data = await res.json()
  const raw  = data.content.filter(b => b.type === 'text').map(b => b.text).join('')
  return JSON.parse(raw.replace(/```json|```/g, '').trim())
}
