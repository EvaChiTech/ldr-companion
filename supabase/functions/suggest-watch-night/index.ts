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
  const rl = await rateLimit(req, 'suggest-watch-night', { user, maxPerUser: 20, maxPerIp: 60 })
  if (rl) return rl

  const CORS = corsHeaders(req)
  try {
    const body = await req.json()
    const n1 = clip(body.n1, 60), n2 = clip(body.n2, 60)
    const interests = clip(body.interests, 500)
    const mood      = clip(body.mood, 80)
    if (!n1 || !n2) return json({ error: 'Missing required fields' }, 400, CORS)

    const prompt = `You are a date-night curator for ${n1} and ${n2}, a long-distance couple watching together over a synced player (YouTube + direct video links work; no Netflix/DRM).

Shared interests: ${interests || 'unspecified — mix popular vibes'}
Current mood: ${mood || 'unspecified'}

Return 6 concrete watch suggestions they can find on YouTube tonight. Mix types: a movie clip/full short film, a cozy music livestream/album playthrough, a documentary or vlog, a comedy special clip, a karaoke/sing-along, and a wildcard surprise. Be specific to titles that actually exist on YouTube (e.g. official channels, well-known uploads).

Return ONLY a JSON object of shape {"suggestions": [...]} with exactly 6 entries:
{"suggestions":[{"kind":"movie|music|doc|comedy|karaoke|wildcard","title":"specific title","why":"one warm sentence why this fits *them*","search":"the exact YouTube search query that finds it"}]}`

    const r = await callAI({ prompt, maxTokens: 1500, json: true })
    if (!r.ok) return json({ error: r.message }, r.status, CORS)
    try {
      const parsed = JSON.parse(stripFence(r.text))
      return json({ suggestions: parsed.suggestions || [] }, 200, CORS)
    } catch { return json({ error: 'Bad AI response' }, 502, CORS) }
  } catch (e) {
    return json({ error: (e as any)?.message || 'Failed' }, 500, CORS)
  }
})
