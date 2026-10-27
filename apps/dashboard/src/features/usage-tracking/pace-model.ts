/**
 * The subscription's week as a curve: the seven-day quota percent sampled so far against the pace
 * diagonal (0 % at the window's start, 100 % at the reset). The window is the seven days ending at
 * the reset instant. No React, no queries.
 */
const WEEK_MS = 7 * 86_400_000
/** Samples are hourly buckets: a first sample within this of the window start is full coverage. */
const COVERAGE_SLACK_MS = 2 * 3_600_000

export type WeekPoint = { at: Date; pct: number | null; pace: number }

export type WeekCurve = {
  data: WeekPoint[]
  start: Date
  reset: Date
  /** Set when the samples begin after the window did: the curve covers only part of the week. */
  coverageFrom: Date | null
}

/** Where the diagonal stands at `at`, 0–100. */
export const paceAt = (at: number, start: number): number =>
  Math.min(100, Math.max(0, ((at - start) / WEEK_MS) * 100))

/**
 * This week's points: the samples inside the window (up to `now`) between two bare endpoints that
 * carry only the diagonal, so the diagonal spans the whole week. `null` without a reset instant.
 */
export function weekCurve(
  samples: ReadonlyArray<{ at: string; sevenDayPct: number | null }>,
  resetsAt: string | null | undefined,
  now: number,
): WeekCurve | null {
  if (resetsAt === null || resetsAt === undefined) return null
  const reset = Date.parse(resetsAt)
  if (Number.isNaN(reset)) return null
  const start = reset - WEEK_MS
  const inWeek = samples
    .map((s) => ({ at: Date.parse(s.at), pct: s.sevenDayPct }))
    .filter((s) => !Number.isNaN(s.at) && s.at >= start && s.at <= Math.min(now, reset))
    .toSorted((a, b) => a.at - b.at)
  const point = (at: number, pct: number | null): WeekPoint => ({
    at: new Date(at),
    pct,
    pace: paceAt(at, start),
  })
  const first = inWeek[0]
  return {
    data: [point(start, null), ...inWeek.map((s) => point(s.at, s.pct)), point(reset, null)],
    start: new Date(start),
    reset: new Date(reset),
    coverageFrom:
      first === undefined || first.at - start <= COVERAGE_SLACK_MS ? null : new Date(first.at),
  }
}
