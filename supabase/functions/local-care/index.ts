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
    const { senderName, recipientName, recipientCity, recipientCountry, recipientTz, mood, intent, apiKey } = await req.json()
    if (!recipientCity && !recipientTz) {
      return new Response(JSON.stringify({ error: 'Need at least a city or timezone for the recipient' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    const anthropicKey = apiKey || Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) return new Response(JSON.stringify({ error: 'Connection key not configured' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })

    const place = recipientCity || (recipientTz?.split('/').pop()?.replace(/_/g, ' ') || 'their city')
    const country = recipientCountry || ''
    const moodLine = mood ? `\nThey're feeling: ${mood}` : ''
    const intentLine = intent && intent !== 'any' ? `\nFocus on: ${intent}` : ''

    const prompt = `${senderName || 'Someone'} is far away and wants to send something kind to ${recipientName || 'their partner'} who lives in ${place}${country ? ', ' + country : ''}.${moodLine}${intentLine}

Give them 6 concrete, real, well-known options to send to ${place}. Mix categories: food delivery, flowers, grocery delivery, a small gift, a curated experience (spa/coffee voucher), and a service that fits the mood. Each must be a service that actually operates in ${place} (Wolt, DoorDash, Uber Eats, local florists, regional grocery apps, Coupang for Korea, FoodPanda for Asia, Bolt Food in Eastern Europe, etc. — pick what's actually used there).

Rules:
- Real, currently-operating services in ${place} only. Don't invent.
- Each option needs a working website URL the sender can open right now (homepage or city-search URL).
- Keep emotional context: if mood is sad, prefer comfort food / warm things; if celebrating, lean fun/bubbly.
- Be specific. Not 'a flower shop' — name a real florist or service.

Return ONLY a JSON array of 6 objects:
[{"category":"food|flowers|grocery|gift|experience|other","emoji":"<one emoji>","service":"<service name>","what":"<one warm sentence about what to send and why it fits>","url":"<full https URL the sender can click to start>"}]`

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
    const options = JSON.parse(raw.replace(/```json|```/g, '').trim())
    return new Response(JSON.stringify({ options }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as any)?.message || 'Failed' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
