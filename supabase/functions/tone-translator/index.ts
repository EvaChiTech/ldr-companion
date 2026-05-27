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
  const rl = await rateLimit(req, 'tone-translator', { user, maxPerUser: 30, maxPerIp: 120 })
  if (rl) return rl

  const CORS = corsHeaders(req)
  try {
    const body = await req.json()
    const draft  = clip(body.draft, 4000)
    const n1     = clip(body.n1, 60)
    const n2     = clip(body.n2, 60)
    const sender = body.sender === 1 || body.sender === 2 ? body.sender : 1
    if (!draft) return json({ error: 'No draft' }, 400, CORS)

    const recentLines = (Array.isArray(body.recent) ? body.recent : [])
      .slice(-6)
      .map((m: any) => `${m.from === sender ? 'Me' : 'Partner'}: ${clip(m.content, 300)}`)
      .join('\n')

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

    const r = await callAI({ prompt, maxTokens: 600, json: true })
    if (!r.ok) return json({ error: r.message }, r.status, CORS)
    try { return json(JSON.parse(stripFence(r.text)), 200, CORS) }
    catch { return json({ error: 'Bad AI response' }, 502, CORS) }
  } catch (e) {
    return json({ error: (e as any)?.message || 'Failed' }, 500, CORS)
  }
})
