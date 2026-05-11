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
    const { n1, n2, period_start, period_end, notes, moods, milestones, watch_count, message_count, daily_answers, apiKey } = await req.json()
    if (!n1 || !n2 || !period_start || !period_end) {
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

    const summarize = (arr: any[], formatter: (x: any) => string, max = 30) =>
      Array.isArray(arr) ? arr.slice(0, max).map(formatter).join('\n') : ''

    const corpus = [
      `Daily notes the couple wrote each other:`,
      summarize(notes || [], (n) => `- ${n.date} (${n.who}): ${n.content}`),
      ``,
      `Daily moods:`,
      summarize(moods || [], (m) => `- ${m.date} (${m.who}): ${m.mood}`),
      ``,
      `Milestones added in period:`,
      summarize(milestones || [], (s) => `- ${s.date}: ${s.title}${s.note ? ' — ' + s.note : ''}`),
      ``,
      `Daily-question answers:`,
      summarize(daily_answers || [], (q) => `- ${q.date}: Q: "${q.question}" | ${n1}: "${q.a1 || '—'}" | ${n2}: "${q.a2 || '—'}"`, 50),
      ``,
      `Quantitative: ${message_count ?? 'unknown'} messages exchanged, ${watch_count ?? 'unknown'} watch sessions.`,
    ].filter(Boolean).join('\n')

    const prompt = `You are writing a short, beautiful chapter of a couple's memory book for ${n1} and ${n2} (long-distance), covering ${period_start} to ${period_end}.

Source material from this period:
---
${corpus}
---

Write the chapter as warm second-person prose addressed to BOTH of them ("you two", "your week"). Pull out *specific* moments from the source material — quote a phrase, name a feeling, reference an actual milestone if any. Don't invent facts. If material is sparse, write briefly and tenderly.

Return ONLY JSON: {"title":"3-5 word evocative chapter title","content":"the chapter prose, 4-8 short paragraphs, no markdown headers"}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
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
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: (error as any)?.message || 'Failed to generate chapter' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
