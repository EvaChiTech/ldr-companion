import webpush from "npm:web-push@3.6.7"
import {
  preflight, requirePost, checkBodySize,
  requireUser, requireRoomMember, rateLimit,
  corsHeaders, json, clip, svc,
} from '../_shared/guard.ts'

Deno.serve(async (req: Request) => {
  const pf = preflight(req); if (pf) return pf
  const mn = requirePost(req); if (mn) return mn
  const bs = checkBodySize(req, 8192); if (bs) return bs

  const user = await requireUser(req); if (user instanceof Response) return user
  const rl = await rateLimit(req, 'send-push', { user, maxPerUser: 60, maxPerIp: 240 })
  if (rl) return rl

  const CORS = corsHeaders(req)

  const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')
  const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')
  const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:hello@example.com'
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ error: 'VAPID keys not configured' }, 500, CORS)
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

  try {
    const body = await req.json()
    const roomCode = clip(body.roomCode, 60)
    const title    = clip(body.title, 200)
    const msgBody  = clip(body.body, 800)
    const url      = clip(body.url, 300) || '/'
    const tag      = clip(body.tag, 60) || 'ldr'
    const targetPartnerIdx = body.targetPartnerIdx === 1 || body.targetPartnerIdx === 2
      ? body.targetPartnerIdx : null
    if (!roomCode || !title) {
      return json({ error: 'roomCode and title are required' }, 400, CORS)
    }

    const membership = await requireRoomMember(req, user, roomCode)
    if (membership) return membership

    let q = svc().from('push_subscriptions')
      .select('endpoint,p256dh,auth_key,partner_idx').eq('room_code', roomCode)
    if (targetPartnerIdx !== null) q = q.eq('partner_idx', targetPartnerIdx)
    const { data: subs, error } = await q
    if (error) throw error

    const payload = JSON.stringify({ title, body: msgBody, url, tag })
    const results = await Promise.allSettled((subs || []).map((s: any) => webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
      payload,
      { TTL: 60 * 60 * 24 }
    )))
    const dead: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'rejected' && ((r as any).reason?.statusCode === 410 || (r as any).reason?.statusCode === 404)) {
        dead.push((subs as any[])![i].endpoint)
      }
    })
    if (dead.length) await svc().from('push_subscriptions').delete().in('endpoint', dead)

    return json({
      sent:   results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
      pruned: dead.length,
    }, 200, CORS)
  } catch (e) {
    return json({ error: (e as any)?.message || 'Failed' }, 500, CORS)
  }
})
