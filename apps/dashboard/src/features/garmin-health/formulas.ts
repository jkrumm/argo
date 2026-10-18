import { ZONE_COLORS } from './constants'

/**
 * Tiny presentation helpers used by hero cards.
 *
 * Heavy formulas (recovery score, training load EWMA, fitness regression)
 * live server-side now and are consumed via the typed API.
 */

export type AcwrZone = 'undertrained' | 'optimal' | 'caution' | 'danger'

/** The one full name per ACWR zone, used in every text surface; a meter segment passes `short` for its narrow fallback. */
export const ACWR_ZONE_NAME = {
  undertrained: 'Undertrained',
  optimal: 'Optimal',
  caution: 'Caution',
  danger: 'Danger',
} as const satisfies Record<AcwrZone, string>

/** The narrow fallback a meter segment shows when the full name does not fit; the one abbreviation per zone. */
export const ACWR_ZONE_SHORT = {
  undertrained: 'Under',
  optimal: 'Optimal',
  caution: 'Caut.',
  danger: 'Danger',
} as const satisfies Record<AcwrZone, string>

export function acwrZoneLabel(zone: AcwrZone | null): string {
  return zone === null ? '' : ACWR_ZONE_NAME[zone]
}

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

export function isStale(lastCompletedAt: string | null, thresholdMs: number): boolean {
  if (lastCompletedAt === null) return true
  const last = Date.parse(lastCompletedAt)
  if (Number.isNaN(last)) return true
  return Date.now() - last >= thresholdMs
}
