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
  const rl = await rateLimit(req, 'dream-themes', { user, maxPerUser: 12, maxPerIp: 60 })
  if (rl) return rl

  const CORS = corsHeaders(req)
  try {
    const body = await req.json()
    const n1 = clip(body.n1, 60), n2 = clip(body.n2, 60)
    const dreams = (Array.isArray(body.dreams) ? body.dreams : [])
      .slice(0, 30)
      .map((d: any) => `- ${clip(d.date, 20)} (${clip(d.who, 30)}): ${clip(d.content, 220)}`)
      .join('\n')

    const prompt = `Two long-distance partners ${n1} and ${n2} have been logging dreams. Read the recent log and find 3-5 themes that recur across BOTH of their dreams (not just one person's). Reflect what their unconscious might be sharing right now — warmly, briefly, never overclaiming.

Recent dream log:
${dreams || '(empty)'}

Return ONLY JSON: {"shared_themes":[{"theme":"<short label>","reflection":"<2-3 sentence warm reflection on what shows up for both>"}],"only_n1":["<themes only ${n1} dreams about>"],"only_n2":["<themes only ${n2} dreams about>"]}`

    const r = await callAI({ prompt, maxTokens: 1200, json: true })
    if (!r.ok) return json({ error: r.message }, r.status, CORS)
    try { return json(JSON.parse(stripFence(r.text)), 200, CORS) }
    catch { return json({ error: 'Bad AI response' }, 502, CORS) }
  } catch (e) {
    return json({ error: (e as any)?.message || 'Failed' }, 500, CORS)
  }
})
