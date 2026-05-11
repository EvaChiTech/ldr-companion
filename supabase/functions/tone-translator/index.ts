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
    const { draft, recent, n1, n2, sender, apiKey } = await req.json()
    if (!draft) return new Response(JSON.stringify({ error: 'No draft' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
    const anthropicKey = apiKey || Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) return new Response(JSON.stringify({ error: 'Connection key not configured' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })

    const recentLines = (recent || []).slice(-6).map((m: any) => `${m.from === sender ? 'Me' : 'Partner'}: ${m.content}`).join('\n')
    const prompt = `You are a calm, warm tone-coach for a couple. ${sender === 1 ? n1 : n2} is about to send the message below to their partner. Show them how it might land, and offer a softer version that keeps the same TRUTH but lowers the heat.

Recent thread (newest last):
${recentLines || '(no recent messages)'}

Draft they're about to send:
"""${draft}"""

Return ONLY JSON:
{
  "heat": <0-10 score for how harsh/likely-to-hurt>,
  "how_it_lands": "<one warm sentence: how the partner might feel reading this>",
  "softer": "<rewritten version that says the same thing without the sting; preserve the actual ask or boundary>",
  "keep_as_is": <boolean, true if heat<=3 and the message is fine>
}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
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
