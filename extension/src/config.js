/**
 * Build-time Supabase config.
 *
 * Values are inlined by vite from the same VITE_* env vars the web app uses,
 * so `npm run build:ext` picks up your existing .env with no extra setup.
 * Only the publishable key is ever bundled - the same key the web client
 * already ships - so RLS remains the authorization boundary.
 */

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''

export const configured =
  Boolean(SUPABASE_URL) &&
  Boolean(SUPABASE_KEY) &&
  /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SUPABASE_URL) &&
  SUPABASE_KEY.startsWith('sb_publishable_')
