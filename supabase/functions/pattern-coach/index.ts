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
    const { n1, n2, moods, notes, messageDays, sleepEvents, apiKey } = await req.json()
    const anthropicKey = apiKey || Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) return new Response(JSON.stringify({ error: 'Connection key not configured' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })

    const summary = (arr: any[], fmt: (x: any) => string, max = 30) =>
      Array.isArray(arr) ? arr.slice(0, max).map(fmt).join('\n') : ''

    const corpus = [
      `Mood entries (newest first):`,
      summary(moods, m => `- ${m.date} (${m.who}): ${m.mood}`),
      ``,
      `Note entries:`,
      summary(notes, n => `- ${n.date} (${n.who}): ${n.content?.slice(0, 80) || ''}`, 25),
      ``,
      `Daily message volume (last 14 days): ${(messageDays || []).map((d: any) => `${d.date}=${d.count}`).join(', ')}`,
      ``,
      `Sleep timing samples:`,
      summary(sleepEvents, s => `- ${s.date} (${s.who}): bed ${s.goodnight_at || '?'}`, 14),
    ].join('\n')

    const prompt = `You are a kind, observant relationship companion for ${n1} and ${n2}. From the data below, surface ONE gentle, specific noticing they could act on this week.

Rules:
- Be warm, not therapeutic. NOT "I notice you've been..." — instead use "This week:" or a small story.
- Be SPECIFIC. Cite a day, a phrase, a number. Don't generalize.
- Suggest one tiny action they could try. Optional.
- If data is sparse, say so warmly and suggest something low-effort to start.
- 2-3 sentences max.

Data:
${corpus}

Return ONLY JSON: {"insight":"<the noticing>","nudge":"<one tiny optional suggestion>"}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      let msg = `Connection error ${res.status}`
      try { msg = JSON.parse(errText)?.error?.message || msg } catch {}
      return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
    const data = await res.json()
    const raw = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
    return new Response(JSON.stringify(parsed), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as any)?.message || 'Failed' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
