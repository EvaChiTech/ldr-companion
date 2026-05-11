import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEPTH_GUIDE: Record<string, string> = {
  light:  `Pick from: Playful what-if, Joy & lightness, Micro-detail (about partner), Gratitude (specific), Nostalgia (light), First memory of each other. Tone: warm, lightly funny, low-stakes. Should make them smile.`,
  medium: `Pick from: Future-self, Sensory memory, Growth edges, Anniversary reflection, Friendship & community, Career & purpose, Identity & change, Future home. Tone: tender, reflective, mid-stakes intimacy.`,
  deep:   `Pick from: Vulnerability (Aron-style), Conflict-repair, Family-of-origin, Loss & fear, Trust, Repair & forgiveness, Body & health, Distance & longing, Self-knowledge, Touch & closeness, Spirituality. Tone: brave, slow, asks them to risk something. NOT therapeutic homework — still warm and personal.`,
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS })

  try {
    const { n1, n2, since, interests, dayIndex, askedSoFar, recentQuestions, depth, theme, apiKey } = await req.json()
    if (!n1 || !n2) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    const anthropicKey = apiKey || Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: 'Anthropic API key not configured' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const days = since ? Math.floor((Date.now() - new Date(since + 'T00:00:00').getTime()) / 86400000) : null
    const seed = (askedSoFar ?? 0) + (dayIndex ?? 0)
    const recentList = (recentQuestions || []).slice(0, 8).map((q: string, i: number) => `${i + 1}. ${q}`).join('\n')
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

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      let msg = `Anthropic API error ${res.status}`
      try { msg = JSON.parse(errText)?.error?.message || msg } catch {}
      return new Response(JSON.stringify({ error: msg }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const data = await res.json()
    const raw = (data.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: (error as any)?.message || 'Failed to generate question' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
