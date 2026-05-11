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
    const { n1, n2, dreams, apiKey } = await req.json()
    const anthropicKey = apiKey || Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) return new Response(JSON.stringify({ error: 'Connection key not configured' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })

    const lines = (dreams || []).slice(0, 30).map((d: any) =>
      `- ${d.date} (${d.who}): ${(d.content || '').slice(0, 220)}`
    ).join('\n')

    const prompt = `Two long-distance partners ${n1} and ${n2} have been logging dreams. Read the recent log and find 3-5 themes that recur across BOTH of their dreams (not just one person's). Reflect what their unconscious might be sharing right now — warmly, briefly, never overclaiming.

Recent dream log:
${lines || '(empty)'}

Return ONLY JSON: {"shared_themes":[{"theme":"<short label>","reflection":"<2-3 sentence warm reflection on what shows up for both>"}],"only_n1":["<themes only ${n1} dreams about>"],"only_n2":["<themes only ${n2} dreams about>"]}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
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
