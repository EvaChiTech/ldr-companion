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
  const rl = await rateLimit(req, 'anniversary-surprise', { user, maxPerUser: 6, maxPerIp: 30 })
  if (rl) return rl

  const CORS = corsHeaders(req)
  try {
    const body = await req.json()
    const n1 = clip(body.n1, 60), n2 = clip(body.n2, 60)
    const days = Number(body.days) || 0
    const since = clip(body.since, 20)
    const milestoneLabel = clip(body.milestoneLabel, 80)
    const recent = Array.isArray(body.recent) ? body.recent : []

    const recentBlock = recent.length
      ? `\nRecent moments from their app:\n${recent.slice(0, 12).map((r: any) => `- ${clip(r.date, 20)}: ${clip(r.title, 120)}${r.note ? ' — ' + clip(r.note, 240) : ''}`).join('\n')}`
      : ''

    const prompt = `Today is ${n1} and ${n2}'s **${milestoneLabel}** — ${days} days since ${since}. Write them a short, beautiful surprise: a 4–6 sentence message addressed to BOTH of them, in second person ("you two"). Reference something specific from their actual moments below if useful. No clichés.${recentBlock}

Return ONLY JSON: {"title":"<3-5 word title for today>","message":"<the surprise message>","emoji":"<one perfect emoji>"}`

    const r = await callAI({ prompt, maxTokens: 800, model: 'gpt-4o', json: true })
    if (!r.ok) return json({ error: r.message }, r.status, CORS)
    try { return json(JSON.parse(stripFence(r.text)), 200, CORS) }
    catch { return json({ error: 'Bad AI response' }, 502, CORS) }
  } catch (e) {
    return json({ error: (e as any)?.message || 'Failed' }, 500, CORS)
  }
})
