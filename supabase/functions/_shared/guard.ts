// Shared edge-function guard — JWT verification, rate limiting, CORS.
// Designed to be re-used by every AI / push endpoint so the cost-pumping
// surface from anonymous callers is closed at one chokepoint.
/// <reference lib="deno.ns" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

// ── Singleton service-role client (used for rate-limit accounting and
// auth.getUser verification). We REQUIRE the service-role key here —
// silently falling back to the anon key masks misconfiguration and lets
// RLS-enforced reads break in prod with no signal.
let _svc: SupabaseClient | null = null
export function svc(): SupabaseClient {
  if (!_svc) {
    const url = Deno.env.get('SUPABASE_URL')
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) {
      throw new Error(
        '[guard] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured',
      )
    }
    _svc = createClient(url, key, { auth: { persistSession: false } })
  }
  return _svc
}

// ── CORS — strict allowlist. Default is to allow none (closed) so a
// misconfigured deploy can't be abused. Set ALLOWED_ORIGINS=
// "https://app.example.com,https://staging.example.com" on the function.
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '')
  .split(',').map((s: string) => s.trim()).filter(Boolean)

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || ''
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }
  return null
}

// ── Auth — verify the caller's bearer token against Supabase Auth and
// return the resolved user. Fail closed on any error.
export type CallerUser = { id: string; email: string | null }

export async function requireUser(req: Request): Promise<CallerUser | Response> {
  const CORS = corsHeaders(req)
  const auth = req.headers.get('Authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return json({ error: 'Unauthorized' }, 401, CORS)
  try {
    const { data, error } = await svc().auth.getUser(jwt)
    if (error || !data?.user) return json({ error: 'Unauthorized' }, 401, CORS)
    return { id: data.user.id, email: data.user.email ?? null }
  } catch {
    return json({ error: 'Unauthorized' }, 401, CORS)
  }
}

// ── Room membership — confirm the caller is in the room they claim.
export async function requireRoomMember(
  req: Request, user: CallerUser, roomId: string,
): Promise<Response | null> {
  const CORS = corsHeaders(req)
  if (!roomId) return json({ error: 'roomId required' }, 400, CORS)
  const { data, error } = await svc()
    .from('room_members')
    .select('room_id')
    .eq('room_id', roomId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (error)   return json({ error: 'Membership check failed' }, 500, CORS)
  if (!data)   return json({ error: 'Not a member of this room' }, 403, CORS)
  return null
}

// ── Rate limiting — fail CLOSED on any internal error. Two buckets:
//   1. caller's user_id (signed-in identity, primary)
//   2. caller IP (defense in depth, harder to rotate at scale)
// Returns 429 Response if blocked, null if allowed.
export async function rateLimit(
  req: Request, name: string,
  opts: { user?: CallerUser; maxPerUser?: number; maxPerIp?: number; windowSec?: number } = {},
): Promise<Response | null> {
  const CORS = corsHeaders(req)
  const max  = opts.maxPerUser ?? 30
  const ipMax = opts.maxPerIp ?? 120
  const win  = opts.windowSec ?? 60
  try {
    const checks: Array<{ key: string; max: number }> = []
    if (opts.user) checks.push({ key: `${name}:u:${opts.user.id}`, max })
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    if (ip) checks.push({ key: `${name}:ip:${ip}`, max: ipMax })
    if (!checks.length) {
      // No identity AND no IP — refuse (fail closed).
      return json({ error: 'Rate limit precondition failed' }, 429, CORS)
    }
    for (const c of checks) {
      const { data, error } = await svc().rpc('check_rate_limit', {
        p_key: c.key, p_max: c.max, p_window_seconds: win,
      })
      if (error || data === null || data === undefined) {
        return json({ error: 'Rate limiter unavailable' }, 503, CORS)
      }
      if (data === false) {
        return json({ error: 'Too many requests — please wait a moment.' }, 429, CORS)
      }
    }
    return null
  } catch {
    return json({ error: 'Rate limiter unavailable' }, 503, CORS)
  }
}

// ── Lightweight payload size guard — call BEFORE req.json() to refuse
// prompt-injection / cost-amplification bodies.
export function checkBodySize(req: Request, maxBytes = 8192): Response | null {
  const len = Number(req.headers.get('content-length') || 0)
  if (len > maxBytes) {
    return json({ error: 'Request body too large' }, 413, corsHeaders(req))
  }
  return null
}

// ── Bound a string before it goes into an LLM prompt. Prevents an
// attacker from inflating token usage with a 100 KB "interests" field.
export function clip(s: unknown, max = 800): string {
  return String(s ?? '').slice(0, max)
}

// ── Method gate.
export function requirePost(req: Request): Response | null {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders(req) })
  }
  return null
}

// ── JSON response helper.
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

// ── Back-compat shim for any function not yet migrated.
// Returns true if the caller has EXCEEDED the limit (block them).
// Fail-closed under the hood.
export async function rateLimited(
  req: Request, name: string, max = 30, windowSec = 60,
): Promise<boolean> {
  const blocked = await rateLimit(req, name, { maxPerIp: max, windowSec })
  return blocked !== null
}
