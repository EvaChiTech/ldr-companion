import "jsr:@supabase/functions-js/edge-runtime.d.ts"

Deno.serve(async (req: Request) => {
  // Only allow POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const { n1, n2, tz1, tz2, since, interests } = await req.json()

    // Validate inputs
    if (!n1 || !n2 || !tz1 || !tz2 || !since) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: 'Anthropic API key not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Extract cities
    const city1 = tz1.split('/').pop()?.replace(/_/g, ' ') || tz1
    const city2 = tz2.split('/').pop()?.replace(/_/g, ' ') || tz2
    const days = Math.floor((Date.now() - new Date(since + 'T00:00:00').getTime()) / 86400000)

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

    // Call Anthropic API
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message || `API error ${res.status}`)
    }

    const data = await res.json()
    const raw = data.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
    const ideas = JSON.parse(raw.replace(/```json|```/g, '').trim())

    return new Response(JSON.stringify({ ideas }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to generate ideas' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
