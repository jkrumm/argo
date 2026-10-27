/**
 * The weekly quota history (`GET /usage/quota`) as the sawtooth chart's rows and the compared
 * table's peaks. The collector's samples start 2026-10-24, so every figure names its coverage. No
 * React, no queries.
 */

const DAY_MS = 86_400_000

/** The history asked for: 30 days, hourly buckets. */
export const QUOTA_HOURS = 720

/** The shared time cursor of the time-axis charts. */
export const USAGE_TIME_GROUP = 'usage-time'

type Series = ReadonlyArray<{
  account: string
  points: ReadonlyArray<{ at: string; sevenDayPct: number | null }>
}>

/** One row per sample instant, the seven-day percent of every account that has one then. */
export type QuotaRow = { at: Date; pct: Readonly<Record<string, number | null>> }

/** Rows at or after `sinceMs`, ascending; an account without a sample at an instant is `null` (a gap). */
export function quotaRows(series: Series, sinceMs: number): QuotaRow[] {
  const byInstant = new Map<number, Record<string, number | null>>()
  for (const s of series) {
    for (const p of s.points) {
      const at = Date.parse(p.at)
      if (Number.isNaN(at) || at < sinceMs) continue
      const row = byInstant.get(at) ?? {}
      row[s.account] = p.sevenDayPct
      byInstant.set(at, row)
    }
  }
  return [...byInstant]
    .toSorted(([a], [b]) => a - b)
    .map(([at, pct]) => ({ at: new Date(at), pct }))
}

/** The highest weekly percent per account since `sinceMs`; `null` for an account without a reading. */
export function quotaPeaks(series: Series, sinceMs: number): Record<string, number | null> {
  return Object.fromEntries(
    series.map((s) => {
      const values = s.points
        .filter((p) => Date.parse(p.at) >= sinceMs && p.sevenDayPct !== null)
        .map((p) => p.sevenDayPct as number)
      return [s.account, values.length === 0 ? null : Math.max(...values)] as const
    }),
  )
}

/**
 * Local-midnight x ticks across the rows, at most `max` of them (every day, then every few days as
 * the history grows): a 12-hourly default would print the same day twice.
 */
export function dayTicks(rows: readonly QuotaRow[], max: number): Date[] {
  const first = rows[0]?.at
  const last = rows[rows.length - 1]?.at
  if (first === undefined || last === undefined) return []
  const days = Math.round(
    (new Date(last.getFullYear(), last.getMonth(), last.getDate()).getTime() -
      new Date(first.getFullYear(), first.getMonth(), first.getDate()).getTime()) /
      DAY_MS,
  )
  const midnights = Array.from(
    { length: days },
    (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i + 1),
  )
  const step = Math.max(1, Math.ceil(midnights.length / max))
  return midnights.filter((_, i) => i % step === 0)
}

/** The accounts the history names. */
export const quotaAccounts = (series: Series): string[] => series.map((s) => s.account)

/** The earliest sample of any account, or `null` without samples. */
export function quotaCoverage(series: Series): Date | null {
  const times = series
    .flatMap((s) => s.points.map((p) => Date.parse(p.at)))
    .filter((t) => !Number.isNaN(t))
  return times.length === 0 ? null : new Date(Math.min(...times))
}
