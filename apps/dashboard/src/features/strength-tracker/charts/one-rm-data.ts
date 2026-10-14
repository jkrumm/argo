import type { ChartSeries } from 'basalt-ui/charts'
import { localDay } from '../../garmin-health/charts/local-day'

export type BestSet = { weight_kg: number; reps: number; e1rm: number } | null

export type ApiSeriesByExercise = {
  exercise_id: string
  exercise_name: string
  points: Array<{
    date: string
    e1rm: number | null
    ma30: number | null
    bestSet: BestSet
  }>
}

export type MergedPoint = {
  day: Date
  e1rm: Record<string, number | null>
  ma: Record<string, number | null>
  bestSets: Record<string, BestSet>
  prSet: Set<string>
}

type ApiPoint = ApiSeriesByExercise['points'][number]

/** One row per date across the active lifts, with a per-lift running max flagging PR days. */
export function buildMergedPoints(
  byExercise: readonly ApiSeriesByExercise[],
  activeExercises: readonly string[],
): MergedPoint[] {
  const dateSet = new Set<string>()
  const lookup = new Map<string, Map<string, ApiPoint>>()
  for (const ex of byExercise) {
    if (!activeExercises.includes(ex.exercise_id)) continue
    const m = new Map<string, ApiPoint>()
    for (const p of ex.points) {
      dateSet.add(p.date)
      m.set(p.date, p)
    }
    lookup.set(ex.exercise_id, m)
  }

  const runningMax: Record<string, number | null> = {}
  for (const ex of activeExercises) runningMax[ex] = null

  return [...dateSet].sort().map((date) => {
    const e1rm: Record<string, number | null> = {}
    const ma: Record<string, number | null> = {}
    const bestSets: Record<string, BestSet> = {}
    const prSet = new Set<string>()

    for (const ex of activeExercises) {
      const p = lookup.get(ex)?.get(date) ?? null
      const v = p?.e1rm ?? null
      e1rm[ex] = v
      ma[ex] = p?.ma30 ?? null
      bestSets[ex] = p?.bestSet ?? null

      if (v === null) continue
      const prev = runningMax[ex] ?? null
      // The window carries no history, so its first value is the baseline, not a PR.
      if (prev !== null && v > prev + 1e-6) prSet.add(ex)
      if (prev === null || v > prev) runningMax[ex] = v
    }

    return { day: localDay(date), e1rm, ma, bestSets, prSet }
  })
}

export function trendArrow(
  byExercise: readonly ApiSeriesByExercise[],
  exId: string,
): 'improving' | 'stable' | 'declining' | null {
  const ex = byExercise.find((e) => e.exercise_id === exId)
  if (!ex) return null
  const maVals = ex.points
    .map((p) => p.ma30)
    .filter((v): v is number => v !== null && Number.isFinite(v))
  if (maVals.length < 2) return null
  const diff = maVals[maVals.length - 1]! - maVals[maVals.length - 2]!
  if (Math.abs(diff) < 0.25) return 'stable'
  return diff > 0 ? 'improving' : 'declining'
}

/** Padded envelope over every plotted e1RM and 30d-MA value — `nice: true` on the axis rounds it. */
export function yDomain(
  rows: readonly MergedPoint[],
  visible: readonly ChartSeries<MergedPoint>[],
): [number, number] {
  const vals: number[] = []
  for (const pt of rows) {
    for (const s of visible) {
      const v = s.getValue(pt)
      if (v !== null) vals.push(v)
    }
  }
  if (!vals.length) return [0, 200]
  return [Math.min(...vals) * 0.92, Math.max(...vals) * 1.08]
}
