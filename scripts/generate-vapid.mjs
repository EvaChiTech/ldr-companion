// Run: node scripts/generate-vapid.mjs
// Generates a VAPID key pair using Node's webcrypto + jose, prints the values
// you need to add to your env. Zero install required (uses Node 18+ built-ins).
import { webcrypto } from 'node:crypto'

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const kp = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
)
const pubRaw  = new Uint8Array(await webcrypto.subtle.exportKey('raw',  kp.publicKey))
const privJwk = await webcrypto.subtle.exportKey('jwk', kp.privateKey)

console.log('\nVAPID keys generated. Add these to:\n')
console.log('  • Supabase Edge Function secrets (Project → Edge Functions → Secrets):')
console.log('      VAPID_PUBLIC_KEY  =', b64url(pubRaw))
console.log('      VAPID_PRIVATE_KEY =', privJwk.d)
console.log('      VAPID_SUBJECT     = mailto:you@example.com')
console.log('\n  • Your client .env:')
console.log('      VITE_VAPID_PUBLIC =', b64url(pubRaw))
console.log('\nThen redeploy the send-push function and reload the app.')
