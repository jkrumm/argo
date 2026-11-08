/**
 * Calendar-date helpers. Stored dates (workouts, daily metrics, activities, weigh-ins) are
 * Berlin local dates, so "today" is the Berlin date, never the UTC one. Arithmetic on
 * `YYYY-MM-DD` strings runs on UTC midnight of the date, which has no DST gaps.
 */

export const LOCAL_TZ = 'Europe/Berlin'

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** The calendar date of `now` in `tz` (default Berlin) as `YYYY-MM-DD`. */
export function localDate(now: Date = new Date(), tz: string = LOCAL_TZ): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** `date` shifted by `n` calendar days (negative = back). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10)
}

/** The local date `n` days before today. */
export function daysAgo(n: number, now: Date = new Date(), tz: string = LOCAL_TZ): string {
  return addDays(localDate(now, tz), -n)
}

/** True for a real calendar date written `YYYY-MM-DD` (rejects `2026-02-31`). */
export function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  return addDays(value, 0) === value
}
