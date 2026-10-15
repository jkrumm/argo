import type { Tone } from 'basalt-ui'
import { ZONE_COLORS } from './constants'

/**
 * Tiny presentation helpers used by hero cards.
 *
 * Heavy formulas (recovery score, training load EWMA, fitness regression)
 * live server-side now and are consumed via the typed API.
 */

/**
 * The `StatCard` verdict for a 0–100 score. `undefined` is NOT 'good' — it covers a reading that is
 * absent, so a card with nothing measured never renders a green rail.
 */
export function scoreTone(score: number | null): Tone | undefined {
  if (score === null) return undefined
  if (score >= 80) return 'good'
  if (score >= 60) return 'warn'
  return 'bad'
}

export function recoveryActionLabel(score: number | null): string {
  if (score === null) return ''
  if (score >= 70) return 'Push hard'
  if (score >= 40) return 'Normal session'
  return 'Prioritize rest'
}

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

/** The `StatCard` verdict for an ACWR zone — the same thresholds `acwrZoneColor` paints. */
export function acwrZoneTone(zone: AcwrZone | null): Tone | undefined {
  switch (zone) {
    case 'optimal':
      return 'good'
    case 'undertrained':
    case 'caution':
      return 'warn'
    case 'danger':
      return 'bad'
    default:
      return undefined
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
