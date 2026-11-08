/**
 * The browser's local calendar day as `YYYY-MM-DD`, the format the API uses for stored dates.
 * The one "what day is it for the user" helper: never `toISOString().slice(0, 10)`, which is the
 * UTC day and flips an hour or two early or late around local midnight.
 */
export function localDayKey(at: Date | number = new Date()): string {
  const d = typeof at === 'number' ? new Date(at) : at
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
