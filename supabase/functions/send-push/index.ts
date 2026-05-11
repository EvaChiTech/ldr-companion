import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import webpush from "npm:web-push@3.6.7"
import { createClient } from "npm:@supabase/supabase-js@2"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS })

  const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')
  const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')
  const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:hello@example.com'
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response(JSON.stringify({ error: 'VAPID keys not configured (set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Edge Function secrets)' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

  try {
    const { roomCode, targetPartnerIdx, title, body, url, tag } = await req.json()
    if (!roomCode || !title) {
      return new Response(JSON.stringify({ error: 'roomCode and title are required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const SB_URL = Deno.env.get('SUPABASE_URL')!
    const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!
    const sb = createClient(SB_URL, SB_KEY)
    let q = sb.from('push_subscriptions').select('endpoint,p256dh,auth_key,partner_idx').eq('room_code', roomCode)
    if (targetPartnerIdx === 1 || targetPartnerIdx === 2) q = q.eq('partner_idx', targetPartnerIdx)
    const { data: subs, error } = await q
    if (error) throw error

    const payload = JSON.stringify({ title, body: body || '', url: url || '/', tag: tag || 'ldr' })
    const results = await Promise.allSettled((subs || []).map(s => webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
      payload,
      { TTL: 60 * 60 * 24 }
    )))
    const dead: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'rejected' && (r.reason?.statusCode === 410 || r.reason?.statusCode === 404)) {
        dead.push(subs![i].endpoint)
      }
    })
    if (dead.length) await sb.from('push_subscriptions').delete().in('endpoint', dead)

    return new Response(JSON.stringify({
      sent:   results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
      pruned: dead.length,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as any)?.message || 'Failed' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
