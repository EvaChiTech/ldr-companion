import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS })

  try {
    const { n1, n2, interests, mood, apiKey } = await req.json()
    if (!n1 || !n2) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    const anthropicKey = apiKey || Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: 'Anthropic API key not configured' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const prompt = `You are a date-night curator for ${n1} and ${n2}, a long-distance couple watching together over a synced player (YouTube + direct video links work; no Netflix/DRM).

Shared interests: ${interests || 'unspecified — mix popular vibes'}
Current mood: ${mood || 'unspecified'}

Return 6 concrete watch suggestions they can find on YouTube tonight. Mix types: a movie clip/full short film, a cozy music livestream/album playthrough, a documentary or vlog, a comedy special clip, a karaoke/sing-along, and a wildcard surprise. Be specific to titles that actually exist on YouTube (e.g. official channels, well-known uploads).

Return ONLY a JSON array. No markdown, no prose. Format:
[{"kind":"movie|music|doc|comedy|karaoke|wildcard","title":"specific title","why":"one warm sentence why this fits *them*","search":"the exact YouTube search query that finds it"}]`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      let msg = `Anthropic API error ${res.status}`
      try { msg = JSON.parse(errText)?.error?.message || msg } catch {}
      return new Response(JSON.stringify({ error: msg }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const data = await res.json()
    const raw = (data.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
    const suggestions = JSON.parse(raw.replace(/```json|```/g, '').trim())

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: (error as any)?.message || 'Failed to suggest watch night' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
