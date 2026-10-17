import type { SkinfoldSite } from '../../lib/queries/skinfold-log'
import type { SkinfoldDirection, WeightPhase, WeightTrend } from './formulas'

export type { WindowPreset } from './constants'

/**
 * Window/range parameters both body-composition endpoints (weight-log, skinfold-log)
 * accept. Matches the API's `WindowQuerySchema`.
 */
export type SummaryParams = {
  window?: '7d' | '30d' | '90d' | 'all'
  from?: string
  to?: string
}

/** `GET /weight-log/summary`. */
export type WeightSummary = {
  current: number | null
  ma7: number | null
  ma30: number | null
  trend: WeightTrend
  weeklyDelta: number | null
  monthlyDelta: number | null
  kgPerWeek: number | null
  phase: WeightPhase
  intensity: string
}

/** `GET /skinfold-log/summary`. */
export type SkinfoldSummary = {
  current: number | null
  mmPerWeek: number | null
  direction: SkinfoldDirection
  perSite: { site: SkinfoldSite; current: number | null }[]
}

/** Day-based figures derived from the weight series, shared by the strip and the chart header. */
export type WeightWindowStats = {
  mean7: number | null
  mean30: number | null
  /** Least-squares kg/week, the API's method. */
  slope7: number | null
}
