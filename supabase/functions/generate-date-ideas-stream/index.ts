import {
  preflight, requirePost, checkBodySize,
  requireUser, rateLimit, corsHeaders, json, clip,
} from '../_shared/guard.ts'

Deno.serve(async (req: Request) => {
  const pf = preflight(req); if (pf) return pf
  const mn = requirePost(req); if (mn) return mn
  const bs = checkBodySize(req, 8192); if (bs) return bs

  const user = await requireUser(req); if (user instanceof Response) return user
  const rl = await rateLimit(req, 'generate-date-ideas-stream', { user, maxPerUser: 20, maxPerIp: 60 })
  if (rl) return rl

  const CORS = corsHeaders(req)
  try {
    const body = await req.json()
    const n1 = clip(body.n1, 60), n2 = clip(body.n2, 60)
    const tz1 = clip(body.tz1, 60), tz2 = clip(body.tz2, 60)
    const since = clip(body.since, 20)
    const interests = clip(body.interests, 500)
    if (!n1 || !n2 || !tz1 || !tz2 || !since) {
      return json({ error: 'Missing required fields' }, 400, CORS)
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) return json({ error: 'OpenAI key not configured' }, 500, CORS)

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

    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 1200,
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => '')
      let msg = `Upstream error ${upstream.status}`
      try { msg = JSON.parse(errText)?.error?.message || msg } catch {}
      return json({ error: msg }, 502, CORS)
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
                // OpenAI streaming chunks look like:
                //   {"choices":[{"delta":{"content":"…"}}]}
                const evt = JSON.parse(payload)
                const text = evt?.choices?.[0]?.delta?.content || ''
                if (text) controller.enqueue(encoder.encode(`data: ${JSON.stringify(text)}\n\n`))
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
  } catch (e) {
    return json({ error: (e as any)?.message || 'Failed' }, 500, CORS)
  }
})
