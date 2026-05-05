import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const configured =
  Boolean(supabaseUrl) &&
  Boolean(supabaseKey) &&
  !supabaseUrl.includes('your-project-id') &&
  !supabaseKey.includes('your-key-here') &&
  !supabaseKey.includes('your-anon-key')

export const sb = configured
  ? createClient(supabaseUrl, supabaseKey, {
      realtime: { params: { eventsPerSecond: 10 } }
    })
  : null

if (!configured) {
  console.warn('[LDR] Supabase not configured. Add valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env')
}