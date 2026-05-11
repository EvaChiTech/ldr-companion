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
    const { n1, n2, year, stats, topNote, topQuestion, topMilestone, topMood, apiKey } = await req.json()
    const anthropicKey = apiKey || Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) return new Response(JSON.stringify({ error: 'Connection key not configured' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })

    const prompt = `Write a beautiful 'Wrapped' recap for ${n1} and ${n2}'s ${year}. Hand-craft 6 narrative slides covering different sides of their year. Use the data below — quote the actual phrases when you can. Warm, second-person ("you two"), no clichés.

Stats:
- ${stats?.messages ?? 0} messages exchanged
- ${stats?.notes ?? 0} daily notes written
- ${stats?.dreams ?? 0} dreams logged
- ${stats?.questions_answered ?? 0} deep questions answered together
- ${stats?.watch_minutes ?? 0} minutes watched together
- ${stats?.moments ?? 0} moments saved to your story
- ${stats?.care_pings ?? 0} care pings exchanged
- ${stats?.reunions ?? 0} reunions logged
- ${stats?.expenses ?? 0} shared expenses

Most-revisited note: ${topNote || 'none'}
Deepest question you answered: ${topQuestion || 'none'}
Favorite milestone: ${topMilestone || 'none'}
Most frequent mood: ${topMood || 'none'}

Return ONLY a JSON object with this exact shape:
{
  "title": "<3-5 word title for the year>",
  "slides": [
    {"emoji":"<one emoji>","label":"<2-4 word label>","big":"<the headline number or phrase>","caption":"<one warm sentence about it>"},
    ...exactly 6 slides...
  ],
  "closing": "<one final 2-sentence dedication addressed to both of you>"
}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
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
