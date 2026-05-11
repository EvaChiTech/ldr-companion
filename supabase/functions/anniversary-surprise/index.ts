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
    const { n1, n2, days, since, milestoneLabel, recent, apiKey } = await req.json()
    const anthropicKey = apiKey || Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) return new Response(JSON.stringify({ error: 'Connection key not configured' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })

    const recentBlock = (recent && recent.length)
      ? `\nRecent moments from their app:\n${recent.slice(0, 12).map((r: any) => `- ${r.date}: ${r.title}${r.note ? ' — ' + r.note : ''}`).join('\n')}`
      : ''

    const prompt = `Today is ${n1} and ${n2}'s **${milestoneLabel}** — ${days} days since ${since}. Write them a short, beautiful surprise: a 4–6 sentence message addressed to BOTH of them, in second person ("you two"). Reference something specific from their actual moments below if useful. No clichés.${recentBlock}

Return ONLY JSON: {"title":"<3-5 word title for today>","message":"<the surprise message>","emoji":"<one perfect emoji>"}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
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
