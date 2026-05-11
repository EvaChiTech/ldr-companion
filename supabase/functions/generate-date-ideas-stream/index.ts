import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS })
  }

  try {
    const { n1, n2, tz1, tz2, since, interests, apiKey } = await req.json()

    if (!n1 || !n2 || !tz1 || !tz2 || !since) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    const anthropicKey = apiKey || Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: 'Anthropic API key not configured' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    const city1 = tz1.split('/').pop()?.replace(/_/g, ' ') || tz1
    const city2 = tz2.split('/').pop()?.replace(/_/g, ' ') || tz2
    const days = Math.floor((Date.now() - new Date(since + 'T00:00:00').getTime()) / 86400000)

    const prompt = `Generate 4 creative, heartfelt virtual date ideas for a long-distance couple.

Couple: ${n1} (in ${city1}) and ${n2} (in ${city2})
Together for: ${days} days
Shared interests: ${interests || 'not specified — use universally appealing ideas'}

Requirements:
- Each idea must be doable over a video call
- Warm, personal, not generic
- Mix different vibes: cozy, playful, romantic, adventurous

Format as plain prose (no markdown):
Idea 1: <title>
<2 warm specific sentences>

Idea 2: <title>
<2 warm specific sentences>

Idea 3: <title>
<2 warm specific sentences>

Idea 4: <title>
<2 warm specific sentences>`

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => '')
      let msg = `Anthropic API error ${upstream.status}`
      try { msg = JSON.parse(errText)?.error?.message || msg } catch {}
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader()
        let buffer = ''
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            for (const line of lines) {
              const t = line.trim()
              if (!t.startsWith('data:')) continue
              const payload = t.slice('data:'.length).trim()
              if (!payload || payload === '[DONE]') continue
              try {
                const evt = JSON.parse(payload)
                if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                  const text = evt.delta.text || ''
                  if (text) controller.enqueue(encoder.encode(`data: ${JSON.stringify(text)}\n\n`))
                }
              } catch { /* skip non-JSON */ }
            }
          }
        } catch (e) {
          const msg = (e as any)?.message || String(e)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`))
        } finally {
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        ...CORS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: (error as any)?.message || 'Failed to generate streamed ideas' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
