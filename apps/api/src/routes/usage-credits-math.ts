/**
 * Pure arithmetic of the Credits tab (the Claude API credit pools the inference gateway spends from):
 * a cycle's day axis, the burn-down, the projected unspent credit, the pick fallback rule and the
 * cache-hit rate. No database, no clock of its own: `now` is always passed in. Days are UTC dates
 * (`YYYY-MM-DD`), matching how the usage queries bucket.
 */

export const DAY_MS = 86_400_000
/** The axis of a pool whose cycle end is unknown: this many days ending today. */
export const UNKNOWN_CYCLE_DAYS = 31
/** The projection's run rate is the mean daily spend over this many days. */
export const RATE_DAYS = 7

/** The pick target that means "the IU passthrough" (a pool may itself be named `iu`). */
export const IU_PASSTHROUGH = 'iu-api'
/** The reason of a pick the caller demanded; the only one that is not a fallback. */
export const FORCED_REASON = 'forced'

export const round4 = (n: number): number => Math.round(n * 10_000) / 10_000

export const utcDay = (instant: Date): string => instant.toISOString().slice(0, 10)

export function addDays(day: string, n: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS))
}

/** Every UTC day from `from` through `to` inclusive. */
function daysBetween(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day)
  return days
}

export interface CycleWindow {
  /** The pool's cycle is known (it has a start and an end); false = the last 31 days stand in. */
  known: boolean
  /** The axis: every UTC day of the cycle, or the last 31 days ending today. */
  days: string[]
  /** Rows at or after this instant count towards the pool. */
  fromTs: Date
  /** Rows before this instant count; null = no upper bound. */
  toTs: Date | null
}

/**
 * The day axis of a pool. A cycle with a start and an end runs `cycle_start .. cycle_end` (the end is the
 * next cycle's start, so the last day is the one before it). Without an end (`cycle_end` NULL, or no cycle
 * row at all) the axis is the last 31 days, and a row counts from the later of the cycle start and the
 * axis start.
 */
export function cycleWindow(
  cycle: { start: Date; end: Date | null } | null,
  now: Date,
): CycleWindow {
  if (cycle?.end && cycle.end.getTime() > cycle.start.getTime()) {
    const lastDay = utcDay(new Date(cycle.end.getTime() - 1))
    return {
      known: true,
      days: daysBetween(utcDay(cycle.start), lastDay),
      fromTs: cycle.start,
      toTs: cycle.end,
    }
  }
  const today = utcDay(now)
  const first = addDays(today, -(UNKNOWN_CYCLE_DAYS - 1))
  const axisStart = new Date(`${first}T00:00:00Z`)
  const fromTs = cycle && cycle.start.getTime() > axisStart.getTime() ? cycle.start : axisStart
  return { known: false, days: daysBetween(first, today), fromTs, toTs: null }
}

export interface DaySpend {
  day: string
  usd: number
}

export interface BurnPoint {
  day: string
  /** Cumulative gateway spend metered by us; null after today. */
  meteredUsd: number | null
  /** Cumulative spend the provider reports (Admin API, lags, includes spend outside the gateway); null when it has no figure or after today. */
  reportedUsd: number | null
  /** grant − max(metered, reported) to date; null after today or without a grant. */
  creditLeftUsd: number | null
}

/**
 * The burn-down over the axis. Both series are cumulative sums of their daily figures. Credit left is the
 * grant less the larger of the two, because the provider's figure lags (it undercounts the newest days)
 * and ours misses spend made outside the gateway. `reported` null = the provider has no figure for the
 * window (the table is unavailable or empty): the reported series stays null.
 */
export function burndown(input: {
  days: readonly string[]
  today: string
  grantUsd: number | null
  metered: readonly DaySpend[]
  reported: readonly DaySpend[] | null
}): BurnPoint[] {
  const meteredByDay = new Map(input.metered.map((d) => [d.day, d.usd]))
  const reportedByDay = input.reported ? new Map(input.reported.map((d) => [d.day, d.usd])) : null
  let metered = 0
  let reported = 0
  return input.days.map((day) => {
    if (day > input.today) {
      return { day, meteredUsd: null, reportedUsd: null, creditLeftUsd: null }
    }
    metered += meteredByDay.get(day) ?? 0
    reported += reportedByDay?.get(day) ?? 0
    return {
      day,
      meteredUsd: round4(metered),
      reportedUsd: reportedByDay ? round4(reported) : null,
      creditLeftUsd:
        input.grantUsd === null ? null : round4(input.grantUsd - Math.max(metered, reported)),
    }
  })
}

export interface Projection {
  /** The larger of metered and reported spend to date. */
  spentUsd: number
  /** Mean daily spend over the last 7 days (fewer while the axis is younger). */
  dailyRateUsd: number
  /** Whole and fractional days until the cycle ends; null when the end is unknown. */
  daysLeft: number | null
  /** grant − spent − rate × days left, floored at 0; null without a grant or a known end. */
  projectedUnspentUsd: number | null
}

/**
 * Where the pool lands at the cycle end if the last week's pace holds. The rate is the spend of the last
 * seven days (the larger of the two cumulative series at today minus at seven days ago) over seven; on a
 * younger axis it is the spend to date over the days elapsed.
 */
export function projectUnspent(input: {
  points: readonly BurnPoint[]
  today: string
  grantUsd: number | null
  cycleEnd: Date | null
  now: Date
}): Projection {
  const spentAt = (day: string): number => {
    let spent = 0
    for (const p of input.points) {
      if (p.day > day) break
      spent = Math.max(p.meteredUsd ?? 0, p.reportedUsd ?? 0)
    }
    return spent
  }
  const spent = spentAt(input.today)
  const first = input.points[0]?.day ?? input.today
  const elapsed = Math.max(1, (Date.parse(input.today) - Date.parse(first)) / DAY_MS + 1)
  const window = Math.min(RATE_DAYS, elapsed)
  const before = elapsed > RATE_DAYS ? spentAt(addDays(input.today, -RATE_DAYS)) : 0
  const rate = (spent - before) / window
  const daysLeft = input.cycleEnd
    ? Math.max(0, (input.cycleEnd.getTime() - input.now.getTime()) / DAY_MS)
    : null
  const projected =
    input.grantUsd === null || daysLeft === null
      ? null
      : Math.max(0, input.grantUsd - spent - rate * daysLeft)
  return {
    spentUsd: round4(spent),
    dailyRateUsd: round4(rate),
    daysLeft: daysLeft === null ? null : round4(daysLeft),
    projectedUnspentUsd: projected === null ? null : round4(projected),
  }
}

/**
 * A pick that left the credit pools for any reason other than `forced`: the IU passthrough chosen without
 * the caller demanding it (`claude-code`, `no-pool`, `drained`, …). A refusal is not a fallback (nothing
 * was served), and a pool named `iu` is a pool, not the passthrough.
 */
export const isFallback = (picked: string, reason: string): boolean =>
  picked === IU_PASSTHROUGH && reason !== FORCED_REASON

/** cache-read / (input + cache-read + cache-write); null while the caller has no input at all. */
export function cacheHitRate(tokens: {
  input: number
  cacheRead: number
  cacheWrite: number
}): number | null {
  const total = tokens.input + tokens.cacheRead + tokens.cacheWrite
  return total > 0 ? tokens.cacheRead / total : null
}
