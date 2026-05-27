// Shared OpenAI call helper for AI edge functions.
// Switched from Anthropic in May 2026 — OpenAI's Platform billing is
// simpler to administer. Default model is gpt-4o-mini (cheap + fast);
// long-form narrative functions opt into gpt-4o explicitly.
/// <reference lib="deno.ns" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

export type AIOpts = {
  prompt: string
  maxTokens: number
  /** Default 'gpt-4o-mini'. Pass 'gpt-4o' for higher-quality long-form. */
  model?: string
  stream?: boolean
  system?: string
  /** Set true to force the model to emit a single valid JSON object. */
  json?: boolean
}

export type AIResult =
  | { ok: true; text: string }
  | { ok: false; status: number; message: string }

export async function callAI(opts: AIOpts): Promise<AIResult> {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) return { ok: false, status: 500, message: 'OpenAI key not configured' }

  const messages: Array<{ role: string; content: string }> = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
  messages.push({ role: 'user', content: opts.prompt })

  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: opts.model || 'gpt-4o-mini',
        messages,
        max_tokens: opts.maxTokens,
        ...(opts.stream ? { stream: true } : {}),
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
  } catch (e) {
    return { ok: false, status: 502, message: (e as Error)?.message || 'Upstream fetch failed' }
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    let message = `Upstream error ${res.status}`
    try { message = JSON.parse(errText)?.error?.message || message } catch {}
    return { ok: false, status: 502, message }
  }
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content || ''
  return { ok: true, text }
}

// Backwards-compat alias so older callers still build.
export const callAnthropic = callAI

export function stripFence(s: string): string {
  return s.replace(/```json|```/g, '').trim()
}
