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
    const { n1, n2, tz1, tz2, sleepEvents, weekStart, apiKey } = await req.json()
    if (!n1 || !n2 || !tz1 || !tz2) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    const anthropicKey = apiKey || Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: 'Connection key not configured' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const sleepLines = (Array.isArray(sleepEvents) ? sleepEvents : [])
      .slice(0, 30)
      .map((s: any) => `- partner ${s.partner_idx} on ${s.date}: bed ${s.goodnight_at || '?'}, wake ${s.wakeup_at || '?'}`)
      .join('\n') || '(no sleep history yet)'

    const prompt = `You are a thoughtful scheduler for ${n1} (timezone ${tz1}) and ${n2} (timezone ${tz2}), a long-distance couple. Find them the SIX best windows to be together (call, watch-party, message marathon, etc.) over the next 7 days starting ${weekStart}.

Sleep patterns from the last few weeks (use these to avoid suggesting times when either is likely asleep):
${sleepLines}

Rules:
- Each window must be a real overlap when BOTH are likely awake.
- Vary the slots: morning-coffee for one, lunch-break for the other; one weekday-evening; one weekend cozy block.
- Respect what looks like normal sleep windows in their data. If no data, assume 23:00–07:30 sleep in each tz.
- Each suggestion should feel different in tone (cozy night call, productive co-working, weekend brunch, etc.).
- DURATION is your call: 20–90 minutes, picked to match the activity.

Return ONLY a JSON array of 6 objects:
[{"date":"YYYY-MM-DD","time1":"HH:MM (24h, ${n1}'s local time)","time2":"HH:MM (24h, ${n2}'s local time)","duration_min":<int>,"vibe":"<short label, e.g. cozy night call>","why":"<one warm sentence why this slot is good for THEM>"}]`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      let msg = `Connection error ${res.status}`
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
    const windows = JSON.parse(raw.replace(/```json|```/g, '').trim())

    return new Response(JSON.stringify({ windows }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: (error as any)?.message || 'Failed to generate harmony' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
