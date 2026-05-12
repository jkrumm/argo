import { VX } from '@argo/charts'
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

export function directionColor(dir: StrengthDirection | null): string {
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

export function momentumLabel(sign: MomentumSign | null): string {
  switch (sign) {
    case 'accelerating':
      return 'Accelerating'
    case 'decelerating':
      return 'Decelerating'
    case 'linear':
      return 'Linear'
    default:
      return ''
  }
}

// ── Load quality (hero 2) ───────────────────────────────────────────────────

export function loadQualityColor(score: number | null): string {
  if (score === null) return ZONE_COLORS.neutral
  if (score >= 75) return ZONE_COLORS.excellent
  if (score >= 50) return ZONE_COLORS.warn
  return ZONE_COLORS.bad
}

export function loadQualityLabel(verdict: LoadQualityVerdict | null): string {
  if (verdict === null) return ''
  return verdict
}

// ── Balance (hero 3a) ───────────────────────────────────────────────────────

export function balanceColor(status: RatioStatus | null): string {
  switch (status) {
    case 'balanced':
      return ZONE_COLORS.excellent
    case 'imbalanced':
      return ZONE_COLORS.warn
    case 'critical':
      return ZONE_COLORS.bad
    default:
      return ZONE_COLORS.neutral
  }
}

export function balanceSymbol(status: RatioStatus | null): string {
  switch (status) {
    case 'balanced':
      return '✓'
    case 'imbalanced':
      return '△'
    case 'critical':
      return '✗'
    default:
      return '—'
  }
}

export function balanceLabel(status: RatioStatus | null): string {
  switch (status) {
    case 'balanced':
      return 'Balanced'
    case 'imbalanced':
      return 'Imbalanced'
    case 'critical':
      return 'Critical'
    default:
      return 'No data'
  }
}

// ── Readiness (hero 3b) ─────────────────────────────────────────────────────

export function readinessColor(score: number | null): string {
  if (score === null) return ZONE_COLORS.neutral
  if (score >= 70) return ZONE_COLORS.excellent
  if (score >= 40) return ZONE_COLORS.warn
  return ZONE_COLORS.bad
}

export function readinessVerdictColor(verdict: ReadinessVerdict | null): string {
  switch (verdict) {
    case 'Push':
      return ZONE_COLORS.excellent
    case 'Normal':
      return ZONE_COLORS.warn
    case 'Rest':
      return ZONE_COLORS.bad
    default:
      return ZONE_COLORS.neutral
  }
}

// ── INOL ────────────────────────────────────────────────────────────────────

export function inolDotColor(inol: number | null): string {
  if (inol === null) return VX.series.acwr
  if (inol < 0.4) return VX.series.acwr
  if (inol < 0.6) return VX.warnSolid
  if (inol <= 1.0) return VX.goodSolid
  if (inol <= 1.5) return VX.series.calories
  return VX.badSolid
}

// ── ACWR ────────────────────────────────────────────────────────────────────

export function acwrZoneColor(zone: AcwrZone | null): string {
  switch (zone) {
    case 'optimal':
      return ZONE_COLORS.excellent
    case 'undertrained':
      return ZONE_COLORS.warn
    case 'caution':
      return ZONE_COLORS.warn
    case 'danger':
      return ZONE_COLORS.bad
    default:
      return ZONE_COLORS.neutral
  }
}

export function acwrZoneLabel(zone: AcwrZone | null): string {
  switch (zone) {
    case 'undertrained':
      return 'Undertrained'
    case 'optimal':
      return 'Optimal'
    case 'caution':
      return 'Caution'
    case 'danger':
      return 'Danger'
    default:
      return ''
  }
}

// ── Misc lookups ────────────────────────────────────────────────────────────

export function exerciseLabel(id: string): string {
  return EXERCISES.find((e) => e.value === (id as ExerciseKey))?.label ?? id
}

export function metricUnit(metric: MetricKey | string): string {
  return METRICS.find((m) => m.value === (metric as MetricKey))?.unit ?? ''
}

export function metricLabel(metric: MetricKey | string): string {
  return METRICS.find((m) => m.value === (metric as MetricKey))?.label ?? metric
}
