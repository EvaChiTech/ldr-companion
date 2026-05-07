import { sb } from './supabase.js'

/**
 * Generate personalized virtual date ideas using Claude via Supabase Edge Function.
 * @param {Object} opts
 * @param {string} opts.n1        - Partner 1 name
 * @param {string} opts.n2        - Partner 2 name
 * @param {string} opts.tz1       - Partner 1 timezone (e.g. Asia/Seoul)
 * @param {string} opts.tz2       - Partner 2 timezone (e.g. Europe/Helsinki)
 * @param {string} opts.since     - ISO date string (relationship start)
 * @param {string} opts.interests - Shared interests
 * @returns {Promise<Array<{title: string, description: string}>>}
 */
export async function generateDateIdeas({ n1, n2, tz1, tz2, since, interests }) {
  if (!sb) {
    throw new Error('Supabase not configured. Add keys to .env first.')
  }

  try {
    const { data, error } = await sb.functions.invoke('generate-date-ideas', {
      body: { n1, n2, tz1, tz2, since, interests },
    })

    if (error) {
      throw error
    }

    return data.ideas
  } catch (err) {
    throw new Error(`Could not generate ideas: ${err.message}`)
  }
}
