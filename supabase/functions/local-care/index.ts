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
  const rl = await rateLimit(req, 'local-care', { user, maxPerUser: 20, maxPerIp: 60 })
  if (rl) return rl

  const CORS = corsHeaders(req)
  try {
    const body = await req.json()
    const senderName    = clip(body.senderName, 60)
    const recipientName = clip(body.recipientName, 60)
    const recipientCity = clip(body.recipientCity, 80)
    const recipientCountry = clip(body.recipientCountry, 60)
    const recipientTz   = clip(body.recipientTz, 60)
    const mood   = clip(body.mood, 80)
    const intent = clip(body.intent, 60)
    if (!recipientCity && !recipientTz) {
      return json({ error: 'Need at least a city or timezone for the recipient' }, 400, CORS)
    }

    const place = recipientCity || (recipientTz.split('/').pop()?.replace(/_/g, ' ') || 'their city')
    const moodLine = mood ? `\nThey're feeling: ${mood}` : ''
    const intentLine = intent && intent !== 'any' ? `\nFocus on: ${intent}` : ''

    const prompt = `${senderName || 'Someone'} is far away and wants to send something kind to ${recipientName || 'their partner'} who lives in ${place}${recipientCountry ? ', ' + recipientCountry : ''}.${moodLine}${intentLine}

Give them 6 concrete, real, well-known options to send to ${place}. Mix categories: food delivery, flowers, grocery delivery, a small gift, a curated experience (spa/coffee voucher), and a service that fits the mood. Each must be a service that actually operates in ${place} (Wolt, DoorDash, Uber Eats, local florists, regional grocery apps, Coupang for Korea, FoodPanda for Asia, Bolt Food in Eastern Europe, etc. — pick what's actually used there).

Rules:
- Real, currently-operating services in ${place} only. Don't invent.
- Each option needs a working website URL the sender can open right now (homepage or city-search URL).
- Keep emotional context: if mood is sad, prefer comfort food / warm things; if celebrating, lean fun/bubbly.
- Be specific. Not 'a flower shop' — name a real florist or service.

Return ONLY a JSON object of shape {"options": [...]} with exactly 6 entries:
{"options":[{"category":"food|flowers|grocery|gift|experience|other","emoji":"<one emoji>","service":"<service name>","what":"<one warm sentence about what to send and why it fits>","url":"<full https URL the sender can click to start>"}]}`

    const r = await callAI({ prompt, maxTokens: 1500, json: true })
    if (!r.ok) return json({ error: r.message }, r.status, CORS)
    try {
      const parsed = JSON.parse(stripFence(r.text))
      return json({ options: parsed.options || [] }, 200, CORS)
    } catch { return json({ error: 'Bad AI response' }, 502, CORS) }
  } catch (e) {
    return json({ error: (e as any)?.message || 'Failed' }, 500, CORS)
  }
})
