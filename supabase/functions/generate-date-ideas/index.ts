import {
  preflight, requirePost, checkBodySize,
  requireUser, rateLimit, corsHeaders, json, clip,
} from '../_shared/guard.ts'
import { callAI, stripFence } from '../_shared/ai.ts'

Deno.serve(async (req: Request) => {
  const pf = preflight(req); if (pf) return pf
  const mn = requirePost(req); if (mn) return mn
  const bs = checkBodySize(req, 8192); if (bs) return bs

  const user = await requireUser(req); if (user instanceof Response) return user
  const rl = await rateLimit(req, 'generate-date-ideas', { user, maxPerUser: 20, maxPerIp: 60 })
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

    const city1 = tz1.split('/').pop()?.replace(/_/g, ' ') || tz1
    const city2 = tz2.split('/').pop()?.replace(/_/g, ' ') || tz2
    const days = Math.floor((Date.now() - new Date(since + 'T00:00:00').getTime()) / 86400000)

    const prompt = `Generate 4 creative, heartfelt virtual date ideas for a long-distance couple.

Couple: ${n1} (in ${city1}) and ${n2} (in ${city2})
Together for: ${days} days
Shared interests: ${interests || 'not specified — use universally appealing ideas'}

Requirements:
- Each idea must be doable over a video call
- Be specific to their locations/cultures when possible
- Warm, personal, not generic
- Mix different vibes: cozy, playful, romantic, adventurous

Return ONLY a JSON object of shape {"ideas": [...]} with exactly 4 entries:
{"ideas":[{"title":"short evocative title","description":"2 warm, specific, actionable sentences"}]}`

    const r = await callAI({ prompt, maxTokens: 1200, json: true })
    if (!r.ok) return json({ error: r.message }, r.status, CORS)
    try {
      const parsed = JSON.parse(stripFence(r.text))
      return json({ ideas: parsed.ideas || [] }, 200, CORS)
    } catch { return json({ error: 'Bad AI response' }, 502, CORS) }
  } catch (e) {
    return json({ error: (e as any)?.message || 'Failed' }, 500, CORS)
  }
})
