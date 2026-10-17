import { ZONE_COLORS } from './constants'

/**
 * Tiny presentation helpers used by hero cards.
 *
 * Heavy formulas (recovery score, training load EWMA, fitness regression)
 * live server-side now and are consumed via the typed API.
 */

export type AcwrZone = 'undertrained' | 'optimal' | 'caution' | 'danger'

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
