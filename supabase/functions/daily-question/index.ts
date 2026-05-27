import {
  preflight, requirePost, checkBodySize,
  requireUser, rateLimit, corsHeaders, json, clip,
} from '../_shared/guard.ts'
import { callAI, stripFence } from '../_shared/ai.ts'

const DEPTH_GUIDE: Record<string, string> = {
  light:  `Pick from: Playful what-if, Joy & lightness, Micro-detail (about partner), Gratitude (specific), Nostalgia (light), First memory of each other. Tone: warm, lightly funny, low-stakes. Should make them smile.`,
  medium: `Pick from: Future-self, Sensory memory, Growth edges, Anniversary reflection, Friendship & community, Career & purpose, Identity & change, Future home. Tone: tender, reflective, mid-stakes intimacy.`,
  deep:   `Pick from: Vulnerability (Aron-style), Conflict-repair, Family-of-origin, Loss & fear, Trust, Repair & forgiveness, Body & health, Distance & longing, Self-knowledge, Touch & closeness, Spirituality. Tone: brave, slow, asks them to risk something. NOT therapeutic homework — still warm and personal.`,
}

Deno.serve(async (req: Request) => {
  const pf = preflight(req); if (pf) return pf
  const mn = requirePost(req); if (mn) return mn
  const bs = checkBodySize(req, 16384); if (bs) return bs

  const user = await requireUser(req); if (user instanceof Response) return user
  const rl = await rateLimit(req, 'daily-question', { user, maxPerUser: 20, maxPerIp: 60 })
  if (rl) return rl

  const CORS = corsHeaders(req)
  try {
    const body = await req.json()
    const n1 = clip(body.n1, 60), n2 = clip(body.n2, 60)
    const since = clip(body.since, 20)
    const interests = clip(body.interests, 500)
    const dayIndex = Number(body.dayIndex) || 0
    const askedSoFar = Number(body.askedSoFar) || 0
    const depth = clip(body.depth, 16)
    const theme = clip(body.theme, 60)
    const recentQuestions = Array.isArray(body.recentQuestions) ? body.recentQuestions : []
    if (!n1 || !n2) return json({ error: 'Missing required fields' }, 400, CORS)

    const days = since ? Math.floor((Date.now() - new Date(since + 'T00:00:00').getTime()) / 86400000) : null
    const seed = askedSoFar + dayIndex
    const recentList = recentQuestions.slice(0, 8).map((q: string, i: number) => `${i + 1}. ${clip(q, 240)}`).join('\n')
    const depthBlock = DEPTH_GUIDE[depth] || DEPTH_GUIDE.medium
    const themeBlock = theme && theme !== 'random'
      ? `\n\nTHEMED NIGHT: tonight's theme is locked to **${theme}**. Stay strictly within that category. Don't drift to other categories.`
      : ''

    const prompt = `You are crafting deep-dive questions for ${n1} and ${n2}, a long-distance couple${days != null ? ` (together ${days} days)` : ''}${interests ? ` who share these interests: ${interests}.` : '.'} They will both answer privately, then reveal to each other.

DEPTH SETTING: ${depth || 'medium'}
${depthBlock}${themeBlock}

Requirements:
- 14–26 words. Specific, evocative. Banned: "How was your day?", "What are you grateful for?", "What's your favorite ___?".
- Frame as if the asker were a relationship therapist who knows research (Aron, Gottman, Perel, Esther Perel, narrative therapy) and writes like a poet.
- Pull on something they'd hesitate to ask casually — that's where intimacy lives, even at lighter depths.
- Don't repeat themes already covered. Their last 8 questions were:\n${recentList || '(none yet)'}
- Use the seed ${seed} to vary your category pick within the depth-allowed set.

Return ONLY a JSON object: {"category":"<the specific category you chose>","question":"<the question, written as one warm direct sentence>"}`

    const r = await callAI({ prompt, maxTokens: 400, json: true })
    if (!r.ok) return json({ error: r.message }, r.status, CORS)
    try { return json(JSON.parse(stripFence(r.text)), 200, CORS) }
    catch { return json({ error: 'Bad AI response' }, 502, CORS) }
  } catch (e) {
    return json({ error: (e as any)?.message || 'Failed' }, 500, CORS)
  }
})
