import { HIDE_TODAY_BEFORE_HOUR, VISIBLE_DATE_MIN } from './constants'

/**
 * Returns today's date in local time as a `YYYY-MM-DD` string. Matches the
 * format used throughout the page (Garmin syncs in local time, the API stores
 * the local date string).
 */
function todayLocalIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Whether today's partial aggregate should be hidden — true before the
 * `HIDE_TODAY_BEFORE_HOUR` cutoff in local time. Daily aggregates (steps,
 * intensity minutes, body battery, stress, ACWR) build up throughout the day;
 * showing a partial reading reads as a misleading dip until the day is done.
 *
 * Sleep / fitness-trend metrics lock in overnight, so they pass `hideToday: false`.
 */
export function shouldHideTodayNow(): boolean {
  return new Date().getHours() < HIDE_TODAY_BEFORE_HOUR
}

export type VisibilityOptions = {
  /**
   * When true, today's date is filtered out if local time is before the
   * configured cutoff. Default: true — most daily-aggregate charts opt in.
   * Charts that lock in overnight (fitness-trends, sleep-breakdown) pass `false`.
   */
  hideToday?: boolean
}

/**
 * Apply the page-wide visibility window to an array of date-keyed points.
 *
 * - Drops anything before `VISIBLE_DATE_MIN` (hard floor — keeps charts/MAs
 *   anchored to a clean baseline regardless of what the API returns).
 * - Optionally drops today's row when called before `HIDE_TODAY_BEFORE_HOUR`.
 *
 * The accessor stays generic so the helper works for daily-metrics points,
 * activities, recovery series, training-load series, etc.
 */
export function applyVisibilityFilter<T>(
  points: readonly T[],
  getDate: (p: T) => string,
  opts: VisibilityOptions = {},
): T[] {
  const hideToday = opts.hideToday ?? true
  const skipToday = hideToday && shouldHideTodayNow()
  const today = skipToday ? todayLocalIso() : null

  const out: T[] = []
  for (const p of points) {
    const d = getDate(p)
    if (d < VISIBLE_DATE_MIN) continue
    if (today !== null && d === today) continue
    out.push(p)
  }
  return out
}
