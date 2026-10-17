import type { SkinfoldSite } from '../../../lib/queries/skinfold-log'

/** A `YYYY-MM-DD` log date as the LOCAL calendar day the user entered it on. */
export function localDay(key: string): Date {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))
}

export type WeightPoint = { date: string; weightKg: number }
export type WeightChartPoint = { date: Date; weightKg: number; ma: number }

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

/**
 * Trailing 7-day mean — averages every entry dated 0 to 7 days up to and including each entry's
 * date. The header and the strip's "7 d mean" are this same set of entries at the newest date, so
 * the dashed line's last value and those figures are one number.
 */
export function toWeightChartPoints(points: readonly WeightPoint[]): WeightChartPoint[] {
  const sorted = points.toSorted(compareByDate)
  return sorted.map((e) => {
    const window = sorted.filter((x) => {
      const back = dayNumber(e.date) - dayNumber(x.date)
      return back >= 0 && back <= MEAN_DAYS
    })
    const ma = window.reduce((acc, x) => acc + x.weightKg, 0) / window.length
    return { date: localDay(e.date), weightKg: e.weightKg, ma }
  })
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
