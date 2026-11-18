import { SKINFOLD_SITES } from './constants'

export type WeightPhase = 'losing' | 'gaining' | 'maintaining'
export type WeightTrend = 'up' | 'down' | 'flat'
export type SkinfoldDirection = 'reducing' | 'increasing' | 'stable'
export type SkinfoldTrend = 'up' | 'down' | 'flat'

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

export function skinfoldSiteLabel(site: string): string {
  return SKINFOLD_SITES.find((s) => s.key === site)?.label ?? site
}
