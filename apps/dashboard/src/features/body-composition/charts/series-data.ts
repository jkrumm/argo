import { format } from 'date-fns'
import type { SkinfoldSite } from '../../../lib/queries/skinfold-log'

/** A `YYYY-MM-DD` log date as the LOCAL calendar day the user entered it on. */
export function localDay(key: string): Date {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))
}

export type WeightPoint = { date: string; weightKg: number }
/** `ma` is `null` where the window is under-covered: the line has a gap, never a made-up value. */
export type WeightChartPoint = { date: Date; weightKg: number; ma: number | null }

const dayNumber = (key: string): number =>
  Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) /
  86_400_000

/** Ascending order on a `YYYY-MM-DD` key. */
export const compareByDate = (a: { date: string }, b: { date: string }): number =>
  a.date.localeCompare(b.date)

/** Marker radius for a series of `count` points: smaller as the plot gets denser. */
export function markerRadiusFor(count: number): number {
  if (count > 60) return 2.5
  if (count > 20) return 3.5
  return 4.5
}

/** Days a weight's trailing mean looks back (inclusive, the API's `date >= last - days`). */
export const MEAN_DAYS = 7

/** A period's figure needs entries spanning at least this share of it; one entry is not a "30 d mean". */
export const COVERAGE_SHARE = 0.7

/**
 * The entries dated 0 to `days` days up to `endDate` (inclusive, the API's `date >= end - days`),
 * oldest first, or `[]` when the selected window (`span` days, `null` for all) is shorter than the
 * period or the entries do not span {@link COVERAGE_SHARE} of it. The one definition every
 * period figure (mean, slope) and the chart's mean line go through.
 */
export function coveredWindow<T extends { date: string }>(
  points: readonly T[],
  endDate: string,
  days: number,
  span: number | null,
): T[] {
  if (span !== null && span < days) return []
  const slice = points
    .filter((p) => {
      const back = dayNumber(endDate) - dayNumber(p.date)
      return back >= 0 && back <= days
    })
    .toSorted(compareByDate)
  const first = slice.at(0)
  if (first === undefined || dayNumber(endDate) - dayNumber(first.date) < days * COVERAGE_SHARE) {
    return []
  }
  return slice
}

/** Mean weight of the covered window ending at `endDate`; `null` when it is not covered. */
export function trailingMean(
  points: readonly WeightPoint[],
  endDate: string,
  days: number,
  span: number | null,
): number | null {
  const slice = coveredWindow(points, endDate, days, span)
  return slice.length === 0 ? null : slice.reduce((a, p) => a + p.weightKg, 0) / slice.length
}

/**
 * The chart points with the trailing {@link MEAN_DAYS}-day mean at each entry. The header's and the
 * strip's "7 d mean" are `trailingMean` at the newest date, so the dashed line's last value is
 * that same number, and where the header says "—" the line has a gap.
 */
export function toWeightChartPoints(
  points: readonly WeightPoint[],
  span: number | null,
): WeightChartPoint[] {
  const sorted = points.toSorted(compareByDate)
  return sorted.map((e) => ({
    date: localDay(e.date),
    weightKg: e.weightKg,
    ma: trailingMean(sorted, e.date, MEAN_DAYS, span),
  }))
}

/** Mean of the entries dated 0–30 days (both ends inclusive) before the latest one; `null` when empty. */
export function thirtyDayMean(points: readonly WeightPoint[]): number | null {
  const last = points.reduce<string | null>((m, p) => (m === null || p.date > m ? p.date : m), null)
  if (last === null) return null
  const slice = points.filter((p) => dayNumber(last) - dayNumber(p.date) <= 30)
  return slice.reduce((acc, p) => acc + p.weightKg, 0) / slice.length
}

export type SkinfoldPoint = {
  date: string
  average: number
  readings: { site: SkinfoldSite; valueMm: number }[]
}
export type SkinfoldChartPoint = {
  date: Date
  average: number
  bySite: Partial<Record<SkinfoldSite, number>>
}

export function toSkinfoldChartPoints(points: readonly SkinfoldPoint[]): SkinfoldChartPoint[] {
  return points.toSorted(compareByDate).map((p) => {
    const bySite: Partial<Record<SkinfoldSite, number>> = {}
    for (const r of p.readings) bySite[r.site] = r.valueMm
    return { date: localDay(p.date), average: p.average, bySite }
  })
}

/**
 * The x-axis tick format for what is plotted: `7 Oct` inside a year, `Oct 2026` once the first and
 * last point are over a year apart (a bare day would repeat across years).
 */
export function axisDateFormat(dates: readonly Date[]): (d: Date) => string {
  const times = dates.map((d) => d.getTime())
  const spanDays = times.length === 0 ? 0 : (Math.max(...times) - Math.min(...times)) / 86_400_000
  return (d) => format(d, spanDays > 365 ? 'MMM yyyy' : 'd MMM')
}
