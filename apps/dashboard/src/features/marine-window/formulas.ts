import { VX } from 'basalt-ui/tokens'
import type { Conditions, Day, Sources, Verdict, WindKind } from './types'

/** Mirrors `RIDEABLE_HEIGHT_M.min` in the API's `apps/api/src/lib/marine-score.ts` — below this a
 * wave-height gate failure reads "flat" rather than "too big". Duplicated locally because the
 * dashboard only imports `@argo/api` for types, never runtime server code. */
const RIDEABLE_HEIGHT_FLOOR_M = 0.5

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

export function fmtPercent(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`
}

export function fmtDegrees(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}°`
}

export function fmtBearing(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)}°`
}

export function fmtMetres(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)} m`
}

export function fmtSeconds(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)} s`
}

export function fmtKnots(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)} kn`
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

/** Weekday abbreviation + day-of-month, for the day-strip cell header. */
export function fmtDayLabel(dateString: string): { weekday: string; day: number } {
  const [, , d] = dateString.split('-').map(Number)
  return { weekday: fmtWeekday(dateString), day: d ?? 0 }
}

/** Offshore holds a wave face up (good), onshore knocks it into mush (bad), cross-shore sits
 * between the two (neutral/warn) — the wind-chart baseline strip reads this as a status signal,
 * not decoration, so it earns the same status-tone vocabulary as `verdictTone`. */
export function windKindTone(kind: WindKind | null): string {
  switch (kind) {
    case 'offshore':
      return VX.goodSolid
    case 'cross-shore':
      return VX.warnSolid
    case 'onshore':
      return VX.badSolid
    default:
      return VX.muted
  }
}

export function windKindLabel(kind: WindKind | null): string {
  if (kind === null) return '—'
  switch (kind) {
    case 'offshore':
      return 'Offshore'
    case 'cross-shore':
      return 'Cross-shore'
    case 'onshore':
      return 'Onshore'
    default:
      return kind
  }
}

/** `8kn offshore` — the single most important qualitative fact on the page, compacted for the
 * strip's last row. `—` when either half of the reading is missing. */
export function fmtWindLine(conditions: {
  windSpeed: number | null
  windKind: WindKind | null
}): string {
  if (conditions.windSpeed === null || conditions.windKind === null) return '—'
  return `${Math.round(conditions.windSpeed)}kn ${conditions.windKind}`
}

/** `0.8m 5.5s` — swell height + period, compacted for the strip's always-present conditions row.
 * `—` when either half of the reading is missing. Unlike `fmtWindLine` this row never depends on
 * `verdict`, so it stays legible on a gated day, which is the whole point of adding it. */
export function fmtSwellLine(conditions: Pick<Conditions, 'swellHeight' | 'swellPeriod'>): string {
  if (conditions.swellHeight === null || conditions.swellPeriod === null) return '—'
  return `${conditions.swellHeight.toFixed(1)}m ${conditions.swellPeriod.toFixed(1)}s`
}

/** Smallest wrap-around angle between two compass bearings, 0..180 — a local copy of the API's
 * `angularDistance` (`apps/api/src/lib/window-score.ts`), since that is server code the dashboard
 * cannot import. */
function angularDistance(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360) + 360) % 360
  return diff > 180 ? 360 - diff : diff
}

/** `143° off` dead-offshore, computed from data that is always present (`windDirection` +
 * `shoreNormal`) rather than the `wind-direction` factor, which the API omits entirely on a gated
 * day. Dead offshore is `shoreNormal + 180`. `—` when there is no wind reading. */
export function fmtOffDeadOffshore(windDirection: number | null, shoreNormal: number): string {
  if (windDirection === null) return '—'
  const deadOffshore = (shoreNormal + 180) % 360
  return `${Math.round(angularDistance(windDirection, deadOffshore))}° off`
}

/** One muted line naming which upstreams are degraded — the "reduced confidence" surface the
 * brief calls for. Null when everything is healthy. */
export function dataHealthLine(sources: Sources): string | null {
  const down: string[] = []
  if (!sources.marine) down.push('marine forecast')
  if (!sources.wind) down.push('wind forecast')
  return down.length > 0 ? `${down.join(', ')} unavailable` : null
}

/** The lowest-scoring factor for a day, expressed as a percent — but only when it's genuinely
 * limiting (< 80%). Null when every scored factor is ≥ 80%, i.e. nothing is meaningfully holding
 * the day back. Feeds the hero's second row, which must never restate a fact the facts panel
 * already owns (score, swell, wind). */
export function limitingFactor(day: Day): { label: string; pct: number } | null {
  let lowest: { label: string; pct: number } | null = null
  for (const factor of day.factors) {
    if (factor.value === null) continue
    const pct = Math.round(factor.value * 100)
    if (lowest === null || pct < lowest.pct) lowest = { label: factor.label, pct }
  }
  return lowest !== null && lowest.pct < 80 ? lowest : null
}

/** Short tag for a ruled-out day's strip cell — the full `reason` sentence (`6.3 s period —
 * windsea…`) always truncates at strip width and reads identically to every other gated day.
 * Picks the first killer, since a cell this small can't stack more than one, and derives a
 * one-or-two-word tag from its `id` rather than parsing the sentence. */
export function killerTag(day: Day): string {
  const killer = day.killers[0]
  if (!killer) return '—'
  switch (killer.id) {
    case 'swell-period':
      return 'windsea'
    case 'wave-height': {
      const height = day.conditions.waveHeight ?? day.conditions.swellHeight ?? 0
      return height < RIDEABLE_HEIGHT_FLOOR_M ? 'flat' : 'too big'
    }
    case 'wind-direction':
      return day.conditions.windKind ?? killer.label.toLowerCase()
    default:
      return killer.label.toLowerCase()
  }
}
