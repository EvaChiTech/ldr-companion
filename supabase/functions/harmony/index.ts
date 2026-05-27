import {
  preflight, requirePost, checkBodySize,
  requireUser, rateLimit, corsHeaders, json, clip,
} from '../_shared/guard.ts'
import { callAI, stripFence } from '../_shared/ai.ts'

Deno.serve(async (req: Request) => {
  const pf = preflight(req); if (pf) return pf
  const mn = requirePost(req); if (mn) return mn
  const bs = checkBodySize(req, 32768); if (bs) return bs

  const user = await requireUser(req); if (user instanceof Response) return user
  const rl = await rateLimit(req, 'harmony', { user, maxPerUser: 12, maxPerIp: 60 })
  if (rl) return rl

  const CORS = corsHeaders(req)
  try {
    const body = await req.json()
    const n1 = clip(body.n1, 60), n2 = clip(body.n2, 60)
    const tz1 = clip(body.tz1, 60), tz2 = clip(body.tz2, 60)
    const weekStart = clip(body.weekStart, 20)
    if (!n1 || !n2 || !tz1 || !tz2) return json({ error: 'Missing required fields' }, 400, CORS)

    const sleepLines = (Array.isArray(body.sleepEvents) ? body.sleepEvents : [])
      .slice(0, 30)
      .map((s: any) => `- partner ${s.partner_idx} on ${clip(s.date, 20)}: bed ${clip(s.goodnight_at, 30) || '?'}, wake ${clip(s.wakeup_at, 30) || '?'}`)
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

Return ONLY a JSON object of shape {"windows": [...]} with exactly 6 entries:
{"windows":[{"date":"YYYY-MM-DD","time1":"HH:MM (24h, ${n1}'s local time)","time2":"HH:MM (24h, ${n2}'s local time)","duration_min":<int>,"vibe":"<short label, e.g. cozy night call>","why":"<one warm sentence why this slot is good for THEM>"}]}`

    const r = await callAI({ prompt, maxTokens: 1500, json: true })
    if (!r.ok) return json({ error: r.message }, r.status, CORS)
    try {
      const parsed = JSON.parse(stripFence(r.text))
      return json({ windows: parsed.windows || [] }, 200, CORS)
    } catch { return json({ error: 'Bad AI response' }, 502, CORS) }
  } catch (e) {
    return json({ error: (e as any)?.message || 'Failed' }, 500, CORS)
  }
})
