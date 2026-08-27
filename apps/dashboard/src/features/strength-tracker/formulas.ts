import type { StatCardTone } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { SERIES } from '../../lib/series'
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

/** The `StatCard` verdict for a strength direction — the same thresholds `directionColor` paints. */
export function directionTone(dir: StrengthDirection | null): StatCardTone | undefined {
  switch (dir) {
    case 'improving':
      return 'good'
    case 'stable':
      return 'warn'
    case 'declining':
      return 'bad'
    default:
      return undefined
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

/** The `StatCard` verdict for a 0–100 load-quality score. `undefined` covers an absent reading. */
export function loadQualityTone(score: number | null): StatCardTone | undefined {
  if (score === null) return undefined
  if (score >= 75) return 'good'
  if (score >= 50) return 'warn'
  return 'bad'
}

export function loadQualityLabel(verdict: LoadQualityVerdict | null): string {
  if (verdict === null) return ''
  return verdict
}

// ── Balance (hero 3a) ───────────────────────────────────────────────────────

/** The `StatCard` verdict for a ratio balance — the same thresholds `balanceColor` paints. */
export function balanceTone(status: RatioStatus | null): StatCardTone | undefined {
  switch (status) {
    case 'balanced':
      return 'good'
    case 'imbalanced':
      return 'warn'
    case 'critical':
      return 'bad'
    default:
      return undefined
  }
}

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

/** The `StatCard` verdict for a 0–100 readiness score. `undefined` covers an absent reading. */
export function readinessTone(score: number | null): StatCardTone | undefined {
  if (score === null) return undefined
  if (score >= 70) return 'good'
  if (score >= 40) return 'warn'
  return 'bad'
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
  if (inol === null) return SERIES.acwr
  if (inol < 0.4) return SERIES.acwr
  if (inol < 0.6) return VX.warnSolid
  if (inol <= 1.0) return VX.goodSolid
  if (inol <= 1.5) return SERIES.calories
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
