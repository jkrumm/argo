import { ZONE_COLORS } from './constants'

/**
 * Tiny presentation helpers used by hero cards.
 *
 * Heavy formulas (recovery score, training load EWMA, fitness regression)
 * live server-side now and are consumed via the typed API.
 */

export function scoreColor(score: number | null): string {
  if (score === null) return ZONE_COLORS.neutral
  if (score >= 90) return ZONE_COLORS.excellent
  if (score >= 80) return ZONE_COLORS.good
  if (score >= 60) return ZONE_COLORS.warn
  return ZONE_COLORS.bad
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

/**
 * Format an absolute ISO timestamp as a short relative phrase ("12m ago").
 * Returns "never" for null and "just now" for under one minute.
 */
export function formatRelativeTime(iso: string | null): string {
  if (iso === null) return 'never'
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.round(hr / 24)
  return `${days}d ago`
}

export function isStale(lastCompletedAt: string | null, thresholdMs: number): boolean {
  if (lastCompletedAt === null) return true
  const last = Date.parse(lastCompletedAt)
  if (Number.isNaN(last)) return true
  return Date.now() - last >= thresholdMs
}
