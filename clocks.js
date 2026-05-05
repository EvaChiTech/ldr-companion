/**
 * Format a Date to HH:MM:SS in a given timezone
 */
export function tzTime(tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour:     '2-digit',
    minute:   '2-digit',
    second:   '2-digit',
    hour12:   true,
  }).format(new Date())
}

/**
 * Format a Date to "Weekday, Month Day" in a given timezone
 */
export function tzDate(tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday:  'long',
    month:    'long',
    day:      'numeric',
  }).format(new Date())
}

/**
 * Get UTC offset in minutes for a timezone
 */
export function tzOffsetMinutes(tz) {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone:     tz,
    timeZoneName: 'shortOffset',
  }).format(new Date())
  const m = s.match(/GMT([+-]\d+(?::\d+)?)?/)
  if (!m || !m[1]) return 0
  const parts = m[1].split(':')
  return parseFloat(parts[0]) * 60 +
    (parts[1] ? parseInt(parts[1]) * Math.sign(parseFloat(parts[0])) : 0)
}

/**
 * Human-readable time difference between two timezones
 */
export function tzDiff(tz1, tz2) {
  const diff = Math.abs(tzOffsetMinutes(tz2) - tzOffsetMinutes(tz1))
  if (diff === 0) return 'same time'
  const h = Math.floor(diff / 60)
  const m = diff % 60
  return h + (m ? ':' + String(m).padStart(2, '0') : '') + ' hr apart'
}

/**
 * Days between two dates
 */
export function daysBetween(from, to = new Date()) {
  return Math.floor((to - new Date(from + 'T00:00:00')) / 86400000)
}

/**
 * City label from timezone string
 */
export function cityLabel(tz) {
  return tz.split('/').pop().replace(/_/g, ' ')
}
