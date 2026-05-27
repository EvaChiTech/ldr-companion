import {
  preflight, requirePost, checkBodySize,
  requireUser, rateLimit, corsHeaders, json, clip,
} from '../_shared/guard.ts'
import { callAI, stripFence } from '../_shared/ai.ts'

Deno.serve(async (req: Request) => {
  const pf = preflight(req); if (pf) return pf
  const mn = requirePost(req); if (mn) return mn
  const bs = checkBodySize(req, 65536); if (bs) return bs

  const user = await requireUser(req); if (user instanceof Response) return user
  const rl = await rateLimit(req, 'memory-chapter', { user, maxPerUser: 6, maxPerIp: 30 })
  if (rl) return rl

  const CORS = corsHeaders(req)
  try {
    const body = await req.json()
    const n1 = clip(body.n1, 60), n2 = clip(body.n2, 60)
    const period_start = clip(body.period_start, 20)
    const period_end   = clip(body.period_end, 20)
    if (!n1 || !n2 || !period_start || !period_end) return json({ error: 'Missing required fields' }, 400, CORS)

    const summarize = (arr: any[], formatter: (x: any) => string, max = 30) =>
      Array.isArray(arr) ? arr.slice(0, max).map(formatter).join('\n') : ''

    const corpus = [
      `Daily notes the couple wrote each other:`,
      summarize(body.notes, (n: any) => `- ${clip(n.date, 20)} (${clip(n.who, 30)}): ${clip(n.content, 600)}`),
      ``,
      `Daily moods:`,
      summarize(body.moods, (m: any) => `- ${clip(m.date, 20)} (${clip(m.who, 30)}): ${clip(m.mood, 60)}`),
      ``,
      `Milestones added in period:`,
      summarize(body.milestones, (s: any) => `- ${clip(s.date, 20)}: ${clip(s.title, 120)}${s.note ? ' — ' + clip(s.note, 200) : ''}`),
      ``,
      `Daily-question answers:`,
      summarize(body.daily_answers, (q: any) => `- ${clip(q.date, 20)}: Q: "${clip(q.question, 240)}" | ${n1}: "${clip(q.a1, 400) || '—'}" | ${n2}: "${clip(q.a2, 400) || '—'}"`, 50),
      ``,
      `Quantitative: ${Number(body.message_count) || 'unknown'} messages exchanged, ${Number(body.watch_count) || 'unknown'} watch sessions.`,
    ].filter(Boolean).join('\n')

    const prompt = `You are writing a short, beautiful chapter of a couple's memory book for ${n1} and ${n2} (long-distance), covering ${period_start} to ${period_end}.

Source material from this period:
---
${corpus}
---

Write the chapter as warm second-person prose addressed to BOTH of them ("you two", "your week"). Pull out *specific* moments from the source material — quote a phrase, name a feeling, reference an actual milestone if any. Don't invent facts. If material is sparse, write briefly and tenderly.

Return ONLY JSON: {"title":"3-5 word evocative chapter title","content":"the chapter prose, 4-8 short paragraphs, no markdown headers"}`

    const r = await callAI({ prompt, maxTokens: 2000, model: 'gpt-4o', json: true })
    if (!r.ok) return json({ error: r.message }, r.status, CORS)
    try { return json(JSON.parse(stripFence(r.text)), 200, CORS) }
    catch { return json({ error: 'Bad AI response' }, 502, CORS) }
  } catch (e) {
    return json({ error: (e as any)?.message || 'Failed' }, 500, CORS)
  }
})
