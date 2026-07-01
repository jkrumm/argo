import { VX } from '@argo/charts'
import { SKINFOLD_SITES } from './constants'

export type WeightPhase = 'losing' | 'gaining' | 'maintaining'
export type WeightTrend = 'up' | 'down' | 'flat'
export type SkinfoldDirection = 'reducing' | 'increasing' | 'stable'
export type SkinfoldTrend = 'up' | 'down' | 'flat'

/** Weight phase badge color — gaining/losing keep their existing (non-judgmental) meaning. */
export function weightPhaseColor(phase: WeightPhase): string {
  switch (phase) {
    case 'losing':
      return 'blue'
    case 'gaining':
      return 'yellow'
    default:
      return 'gray'
  }
}

/** Weight trend color — down is the "toward goal" direction, up is away from it. */
export function weightTrendColor(trend: WeightTrend): string {
  if (trend === 'flat') return 'gray'
  return trend === 'down' ? VX.goodSolid : VX.warnSolid
}

/** Skinfold direction badge color — reducing (leaner) is good, increasing is bad. */
export function skinfoldDirectionColor(direction: SkinfoldDirection): string {
  switch (direction) {
    case 'reducing':
      return VX.goodSolid
    case 'increasing':
      return VX.badSolid
    default:
      return 'gray'
  }
}

export function skinfoldDirectionLabel(direction: SkinfoldDirection): string {
  switch (direction) {
    case 'reducing':
      return 'Reducing'
    case 'increasing':
      return 'Increasing'
    default:
      return 'Stable'
  }
}

/** Skinfold trend color — down (thinner) is the good direction for body fat. */
export function skinfoldTrendColor(trend: SkinfoldTrend): string {
  if (trend === 'flat') return 'gray'
  return trend === 'down' ? VX.goodSolid : VX.badSolid
}

export function fmtMm(v: number | null): string {
  return v === null ? '—' : v.toFixed(1)
}

export function skinfoldSiteLabel(site: string): string {
  return SKINFOLD_SITES.find((s) => s.key === site)?.label ?? site
}
