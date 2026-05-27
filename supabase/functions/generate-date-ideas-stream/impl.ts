import { streamText } from 'ai'

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const {
      n1,
      n2,
      tz1,
      tz2,
      since,
      interests,
    } = await req.json()

    if (!n1 || !n2 || !tz1 || !tz2 || !since) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Supabase Edge runtime provides env via `Deno.env`.
    // Some IDEs don't typecheck Edge globals; at runtime this works.
    // @ts-ignore
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')

    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: 'Anthropic API key not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const city1 = tz1.split('/').pop()?.replace(/_/g, ' ') || tz1
    const city2 = tz2.split('/').pop()?.replace(/_/g, ' ') || tz2
    const days = Math.floor(
      (Date.now() - new Date(since + 'T00:00:00').getTime()) / 86400000,
    )

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

    // The `ai` package expects a model object in some versions.
    // Provide only what the runtime needs, and relax typechecking for compatibility.
    // @ts-ignore
    const result = streamText({
      model: 'anthropic/claude-opus-4.7',
      prompt,
    })


    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // @ts-ignore
          for await (const chunk of result.textStream ?? result.stream ?? []) {
            const text = typeof chunk === 'string' ? chunk : chunk?.text
            if (!text) continue
            controller.enqueue(encoder.encode(`data: ${text}\n\n`))
          }
        } catch (e) {
          const msg = (e && (e as any).message) || 'stream error'
          controller.enqueue(encoder.encode(`event: error\ndata: ${msg}\n\n`))
        } finally {
          controller.enqueue(
            encoder.encode('event: done\ndata: [DONE]\n\n'),
          )
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: (error as any)?.message || 'Failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

