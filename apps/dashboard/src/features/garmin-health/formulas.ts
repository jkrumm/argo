import type { MeterZone } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
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
  undertrained: 'Low',
  optimal: 'Optimal',
  caution: 'Caution',
  danger: 'Danger',
} as const satisfies Record<AcwrZone, string>

/** A real abbreviation for the one zone name too long for a narrow segment; the other zones have none. */
export const ACWR_ZONE_SHORT = {
  caution: 'Caut.',
} as const satisfies Partial<Record<AcwrZone, string>>

export type AcwrMeterBounds = { floor: number; optimalTo: number; cautionTo: number; max: number }

/** The four ACWR meter zones: the one vocabulary (`ACWR_ZONE_NAME` / `ACWR_ZONE_SHORT`) on Home, Garmin and Strength. */
export function acwrMeterZones(
  { floor, optimalTo, cautionTo, max }: AcwrMeterBounds,
  colors: Record<AcwrZone, string> = {
    undertrained: VX.warn,
    optimal: VX.good,
    caution: VX.warn,
    danger: VX.bad,
  },
): MeterZone[] {
  return [
    { from: 0, to: floor, label: ACWR_ZONE_NAME.undertrained, color: colors.undertrained },
    { from: floor, to: optimalTo, label: ACWR_ZONE_NAME.optimal, color: colors.optimal },
    {
      from: optimalTo,
      to: cautionTo,
      label: ACWR_ZONE_NAME.caution,
      short: ACWR_ZONE_SHORT.caution,
      color: colors.caution,
    },
    { from: cautionTo, to: max, label: ACWR_ZONE_NAME.danger, color: colors.danger },
  ]
}

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
