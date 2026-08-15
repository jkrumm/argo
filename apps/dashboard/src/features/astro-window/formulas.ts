import { VX } from 'basalt-ui/tokens'
import type { Sources, Verdict } from './types'

/** Verdict → tone. `out` is a hard gate, not a low score, so it reads neutral, never red. */
export function verdictTone(verdict: Verdict): string {
  switch (verdict) {
    case 'excellent':
    case 'good':
      return VX.goodSolid
    case 'marginal':
      return VX.warnSolid
    case 'poor':
      return VX.badSolid
    case 'out':
      return VX.muted
    default:
      return VX.muted
  }
}

export function verdictLabel(verdict: Verdict): string {
  if (verdict === 'out') return 'Ruled out'
  return verdict.charAt(0).toUpperCase() + verdict.slice(1)
}

/** `v` is a 0..1 fraction (moon illumination, factor value). */
export function fmtPercent(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`
}

/** `v` is already a 0..100 percentage (cloud cover means from the API). */
export function fmtPercent100(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)}%`
}

export function fmtDegrees(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}°`
}

export function fmtMinutes(v: number | null): string {
  if (v === null) return '—'
  const h = Math.floor(v / 60)
  const m = Math.round(v % 60)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

/** `dateString` is a local calendar date (`YYYY-MM-DD`) — parsed as a local date, not UTC, so the
 * weekday never shifts a day depending on the reader's timezone. */
export function fmtWeekday(dateString: string): string {
  const [y, m, d] = dateString.split('-').map(Number)
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(date)
}

/** Weekday abbreviation + day-of-month, for the night-strip cell header. */
export function fmtDayLabel(dateString: string): { weekday: string; day: number } {
  const [, , d] = dateString.split('-').map(Number)
  return { weekday: fmtWeekday(dateString), day: d ?? 0 }
}

/** Converts an ISO instant (UTC) to a local `HH:MM` clock string for fields the API leaves in UTC
 * (`darkStart`/`darkEnd`, `moon.rise`/`moon.set`) — unlike `localStart`/`localTransit` etc., which
 * the API already formats. Returns `—` for null or an unparseable value. */
export function fmtLocalClock(iso: string | null, timeZone: string): string {
  if (iso === null) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function moonPhaseLabel(phase: number): string {
  if (phase < 22.5 || phase >= 337.5) return 'New'
  if (phase < 67.5) return 'Waxing crescent'
  if (phase < 112.5) return 'First quarter'
  if (phase < 157.5) return 'Waxing gibbous'
  if (phase < 202.5) return 'Full'
  if (phase < 247.5) return 'Waning gibbous'
  if (phase < 292.5) return 'Last quarter'
  return 'Waning crescent'
}

/** One muted line naming which upstreams are degraded and whether sky darkness could be inferred
 * — the "reduced confidence" surface the brief calls for. Null when everything is healthy. */
export function dataHealthLine(
  sources: Sources,
  bortleSource: 'site' | 'nearest-site' | 'query' | 'unknown',
): string | null {
  const down: string[] = []
  if (!sources.dwdIcon) down.push('DWD ICON')
  if (!sources.globalForecast) down.push('global forecast')
  if (!sources.sevenTimer) down.push('7Timer transparency')

  const parts: string[] = []
  if (down.length > 0) parts.push(`${down.join(', ')} unavailable`)
  if (bortleSource === 'unknown') parts.push('sky darkness unknown')

  return parts.length > 0 ? parts.join(' · ') : null
}
