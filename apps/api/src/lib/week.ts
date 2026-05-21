/**
 * Calendar-week bucketing — the single source of truth for "by week".
 *
 * Weeks are Monday–Sunday (UTC) and keyed by the Monday week-start date
 * (`YYYY-MM-DD`). A Monday date is a real date: it sorts naturally, renders on
 * a date axis, and reads as "week of May 18". Never anchor on Sunday, an ISO
 * week number, or a trailing 7 days from now / from the latest data point.
 *
 * See `.claude/rules/weekly-aggregation.md` for the why and the
 * weekly-bucket-vs-rolling-smoother distinction.
 */

function utcDate(iso: string): Date {
  // Accepts 'YYYY-MM-DD' or a full ISO timestamp; buckets by the UTC calendar
  // date regardless of the time portion.
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`)
}

/** Monday (week-start) of the Mon–Sun week containing `iso`. Returns 'YYYY-MM-DD'. */
export function weekStart(iso: string): string {
  const d = utcDate(iso)
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay() // 1=Mon .. 7=Sun
  d.setUTCDate(d.getUTCDate() - (dow - 1))
  return d.toISOString().slice(0, 10)
}

/** Inclusive list of Monday week-starts spanning the weeks of `fromIso`..`toIso`. */
export function eachWeekStart(fromIso: string, toIso: string): string[] {
  const out: string[] = []
  const end = weekStart(toIso)
  let cur = weekStart(fromIso)
  while (cur <= end) {
    out.push(cur)
    const next = utcDate(cur)
    next.setUTCDate(next.getUTCDate() + 7)
    cur = next.toISOString().slice(0, 10)
  }
  return out
}

/**
 * True iff the Mon–Sun week containing `anyIsoInWeek` has fully elapsed — i.e.
 * `now` is at or past the following Monday 00:00 UTC. Accepts any date within
 * the week.
 */
export function isWeekComplete(anyIsoInWeek: string, now: Date): boolean {
  const nextMonday = utcDate(weekStart(anyIsoInWeek))
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7)
  return now.getTime() >= nextMonday.getTime()
}
