import type { SkinfoldSite } from '../../../lib/queries/skinfold-log'

/** A `YYYY-MM-DD` log date as the LOCAL calendar day the user entered it on. */
export function localDay(key: string): Date {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))
}

export type WeightPoint = { date: string; weightKg: number }
export type WeightChartPoint = { date: Date; weightKg: number; ma: number | null }

const dayNumber = (key: string): number =>
  Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) /
  86_400_000

/**
 * Centered 7-day moving average — averages every entry within ±3 days of each entry's date.
 * Sparse-data friendly: a single entry per week still produces a smoothed curve.
 */
export function toWeightChartPoints(points: readonly WeightPoint[]): WeightChartPoint[] {
  const sorted = points.toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return sorted.map((e) => {
    const window = sorted.filter((x) => Math.abs(dayNumber(x.date) - dayNumber(e.date)) <= 3)
    const ma = window.reduce((acc, x) => acc + x.weightKg, 0) / window.length
    return { date: localDay(e.date), weightKg: e.weightKg, ma }
  })
}

/** Mean of the entries in the 30 days up to and including the latest one; `null` when empty. */
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
  return points
    .toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((p) => {
      const bySite: Partial<Record<SkinfoldSite, number>> = {}
      for (const r of p.readings) bySite[r.site] = r.valueMm
      return { date: localDay(p.date), average: p.average, bySite }
    })
}
