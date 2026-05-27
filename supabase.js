import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Validate URL and key are ASCII-only
function validateSupabaseCredentials() {
  const issues = []
  
  if (!supabaseUrl) issues.push('VITE_SUPABASE_URL is not set')
  else if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(supabaseUrl)) {
    issues.push(`VITE_SUPABASE_URL has invalid format: ${supabaseUrl}`)
  } else if (/[^\x20-\x7E]/.test(supabaseUrl)) {
    issues.push('VITE_SUPABASE_URL contains non-ASCII characters')
  }
  
  if (!supabaseKey) issues.push('VITE_SUPABASE_PUBLISHABLE_KEY is not set')
  else if (!/^sb_publishable_/.test(supabaseKey)) {
    issues.push(`VITE_SUPABASE_PUBLISHABLE_KEY has invalid format`)
  } else if (/[^\x20-\x7E]/.test(supabaseKey)) {
    issues.push('VITE_SUPABASE_PUBLISHABLE_KEY contains non-ASCII characters')
  }
  
  return issues
}

const issues = validateSupabaseCredentials()
if (issues.length > 0) {
  console.error('[Supabase] Configuration issues:', issues)
}

export const configured =
  Boolean(supabaseUrl) &&
  Boolean(supabaseKey) &&
  !supabaseUrl.includes('your-project-id') &&
  !supabaseKey.includes('your-key-here') &&
  !supabaseKey.includes('your-anon-key') &&
  issues.length === 0

export const sb = configured
  ? createClient(supabaseUrl, supabaseKey, {
      realtime: { params: { eventsPerSecond: 10 } }
    })
  : null

if (!configured) {
  console.warn('[LDR] Supabase not configured. Issues:', issues.length > 0 ? issues : ['Invalid credentials format'])
}