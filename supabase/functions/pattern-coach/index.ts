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
  const rl = await rateLimit(req, 'pattern-coach', { user, maxPerUser: 12, maxPerIp: 60 })
  if (rl) return rl

  const CORS = corsHeaders(req)
  try {
    const body = await req.json()
    const n1 = clip(body.n1, 60), n2 = clip(body.n2, 60)
    const moods       = Array.isArray(body.moods) ? body.moods : []
    const notes       = Array.isArray(body.notes) ? body.notes : []
    const messageDays = Array.isArray(body.messageDays) ? body.messageDays : []
    const sleepEvents = Array.isArray(body.sleepEvents) ? body.sleepEvents : []

    const summary = (arr: any[], fmt: (x: any) => string, max = 30) =>
      arr.slice(0, max).map(fmt).join('\n')

    const corpus = [
      `Mood entries (newest first):`,
      summary(moods, (m: any) => `- ${clip(m.date, 20)} (${clip(m.who, 30)}): ${clip(m.mood, 60)}`),
      ``,
      `Note entries:`,
      summary(notes, (n: any) => `- ${clip(n.date, 20)} (${clip(n.who, 30)}): ${clip(n.content, 80)}`, 25),
      ``,
      `Daily message volume (last 14 days): ${messageDays.slice(0, 14).map((d: any) => `${clip(d.date, 20)}=${Number(d.count) || 0}`).join(', ')}`,
      ``,
      `Sleep timing samples:`,
      summary(sleepEvents, (s: any) => `- ${clip(s.date, 20)} (${clip(s.who, 30)}): bed ${clip(s.goodnight_at, 30) || '?'}`, 14),
    ].join('\n')

    const prompt = `You are a kind, observant relationship companion for ${n1} and ${n2}. From the data below, surface ONE gentle, specific noticing they could act on this week.

Rules:
- Be warm, not therapeutic. NOT "I notice you've been..." — instead use "This week:" or a small story.
- Be SPECIFIC. Cite a day, a phrase, a number. Don't generalize.
- Suggest one tiny action they could try. Optional.
- If data is sparse, say so warmly and suggest something low-effort to start.
- 2-3 sentences max.

Data:
${corpus}

Return ONLY JSON: {"insight":"<the noticing>","nudge":"<one tiny optional suggestion>"}`

    const r = await callAI({ prompt, maxTokens: 500, json: true })
    if (!r.ok) return json({ error: r.message }, r.status, CORS)
    try { return json(JSON.parse(stripFence(r.text)), 200, CORS) }
    catch { return json({ error: 'Bad AI response' }, 502, CORS) }
  } catch (e) {
    return json({ error: (e as any)?.message || 'Failed' }, 500, CORS)
  }
})
