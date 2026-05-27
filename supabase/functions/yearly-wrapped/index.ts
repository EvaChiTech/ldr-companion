import {
  preflight, requirePost, checkBodySize,
  requireUser, rateLimit, corsHeaders, json, clip,
} from '../_shared/guard.ts'
import { callAI, stripFence } from '../_shared/ai.ts'

Deno.serve(async (req: Request) => {
  const pf = preflight(req); if (pf) return pf
  const mn = requirePost(req); if (mn) return mn
  const bs = checkBodySize(req, 16384); if (bs) return bs

  const user = await requireUser(req); if (user instanceof Response) return user
  const rl = await rateLimit(req, 'yearly-wrapped', { user, maxPerUser: 4, maxPerIp: 20 })
  if (rl) return rl

  const CORS = corsHeaders(req)
  try {
    const body = await req.json()
    const n1 = clip(body.n1, 60), n2 = clip(body.n2, 60)
    const year = Number(body.year) || new Date().getFullYear()
    const stats = body.stats || {}
    const topNote      = clip(body.topNote, 400)
    const topQuestion  = clip(body.topQuestion, 400)
    const topMilestone = clip(body.topMilestone, 200)
    const topMood      = clip(body.topMood, 60)

    const prompt = `Write a beautiful 'Wrapped' recap for ${n1} and ${n2}'s ${year}. Hand-craft 6 narrative slides covering different sides of their year. Use the data below — quote the actual phrases when you can. Warm, second-person ("you two"), no clichés.

Stats:
- ${Number(stats?.messages) || 0} messages exchanged
- ${Number(stats?.notes) || 0} daily notes written
- ${Number(stats?.dreams) || 0} dreams logged
- ${Number(stats?.questions_answered) || 0} deep questions answered together
- ${Number(stats?.watch_minutes) || 0} minutes watched together
- ${Number(stats?.moments) || 0} moments saved to your story
- ${Number(stats?.care_pings) || 0} care pings exchanged
- ${Number(stats?.reunions) || 0} reunions logged
- ${Number(stats?.expenses) || 0} shared expenses

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

    const r = await callAI({ prompt, maxTokens: 1500, model: 'gpt-4o', json: true })
    if (!r.ok) return json({ error: r.message }, r.status, CORS)
    try { return json(JSON.parse(stripFence(r.text)), 200, CORS) }
    catch { return json({ error: 'Bad AI response' }, 502, CORS) }
  } catch (e) {
    return json({ error: (e as any)?.message || 'Failed' }, 500, CORS)
  }
})
