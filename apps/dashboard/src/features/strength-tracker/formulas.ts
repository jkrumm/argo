import { VX } from 'basalt-ui/tokens'
import { SERIES } from '../../lib/series'
import { INOL_OPTIMAL_FROM, INOL_OPTIMAL_TO } from './bands'
import { EXERCISES, METRICS, ZONE_COLORS, type ExerciseKey, type MetricKey } from './constants'

/**
 * Presentation-only helpers for the strength-tracker UI.
 *
 * Heavy formulas (velocity, ACWR, INOL, composites, ratios, readiness,
 * achievements) live server-side in `apps/api/src/lib/strength-formulas.ts`.
 */

export type StrengthDirection = 'improving' | 'stable' | 'declining'
export type MomentumSign = 'accelerating' | 'linear' | 'decelerating'
export type LoadQualityVerdict = 'Quality' | 'Adequate' | 'Poor'
export type RatioStatus = 'balanced' | 'imbalanced' | 'critical'
export type AcwrZone = 'undertrained' | 'optimal' | 'caution' | 'danger'
export type ReadinessVerdict = 'Push' | 'Normal' | 'Rest'

// ── Strength direction (hero 1) ─────────────────────────────────────────────

export function directionArrow(dir: StrengthDirection | null): string {
  switch (dir) {
    case 'improving':
      return '▲'
    case 'declining':
      return '▼'
    case 'stable':
      return '►'
    default:
      return '—'
  }
}

/** Direction INK for text. `excellent` is a chart fill the text solver never tunes (~2.9:1), so text takes `good`. */
export function directionColor(dir: StrengthDirection | null): string {
  return dir === 'improving' ? ZONE_COLORS.good : directionFill(dir)
}

/** Direction FILL for dots and marks (no text-contrast floor). */
function directionFill(dir: StrengthDirection | null): string {
  switch (dir) {
    case 'improving':
      return ZONE_COLORS.excellent
    case 'stable':
      return ZONE_COLORS.warn
    case 'declining':
      return ZONE_COLORS.bad
    default:
      return ZONE_COLORS.neutral
  }
}

// ── Load quality (hero 2) ───────────────────────────────────────────────────

// ── Balance (hero 3a) ───────────────────────────────────────────────────────

// ── Readiness (hero 3b) ─────────────────────────────────────────────────────

// ── INOL ────────────────────────────────────────────────────────────────────

export function inolDotColor(inol: number | null): string {
  if (inol === null) return SERIES.acwr
  if (inol < 0.4) return SERIES.acwr
  if (inol < INOL_OPTIMAL_FROM) return VX.warnSolid
  if (inol <= INOL_OPTIMAL_TO) return VX.goodSolid
  if (inol <= 1.5) return SERIES.calories
  return VX.badSolid
}

// ── ACWR ────────────────────────────────────────────────────────────────────

export { acwrZoneLabel } from '../garmin-health/formulas'

// ── Misc lookups ────────────────────────────────────────────────────────────

export function exerciseLabel(id: string): string {
  return EXERCISES.find((e) => e.value === (id as ExerciseKey))?.label ?? id
}

export function metricLabel(metric: MetricKey | string): string {
  return METRICS.find((m) => m.value === (metric as MetricKey))?.label ?? metric
}

/** The INOL zone word for one session: the INOL chart's legend and the per-lift table share it. */
export function inolZoneLabel(v: number): string {
  if (v < 0.4) return 'Too Light'
  if (v < INOL_OPTIMAL_FROM) return 'Recovery'
  if (v <= INOL_OPTIMAL_TO) return 'Optimal'
  if (v <= 1.5) return 'Hard'
  return 'Excessive'
}
