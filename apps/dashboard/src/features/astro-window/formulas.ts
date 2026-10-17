import { VX } from 'basalt-ui/tokens'
import { percent, weekday } from 'basalt-ui/format'
import type { Night, Verdict, WindowResponse } from './types'

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

/** Weekday abbreviation + day-of-month, for the night-strip cell header. */
export function fmtDayLabel(dateString: string): { weekday: string; day: number } {
  const [, , d] = dateString.split('-').map(Number)
  return { weekday: weekday(dateString, { locale: 'en-GB' }), day: d ?? 0 }
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

/** The lowest-scoring factor for a night, expressed as a percent — but only when it's genuinely
 * limiting (< 80%). Null when every scored factor is ≥ 80%, i.e. nothing is meaningfully holding
 * the night back. Feeds the hero's second row, which must never restate a fact the facts panel
 * already owns (score, moon %, core altitude). */
export function limitingFactor(night: Night): { label: string; pct: number } | null {
  let lowest: { label: string; pct: number } | null = null
  for (const factor of night.factors) {
    if (factor.value === null) continue
    const pct = Math.round(factor.value * 100)
    if (lowest === null || pct < lowest.pct) lowest = { label: factor.label, pct }
  }
  return lowest !== null && lowest.pct < 80 ? lowest : null
}

/** The one fact line of a strip cell. A night out on the core gate states how far it fell short, so
 * an all-out week still ranks; any other out night names its first killer; a usable night its window. */
export function nightNote(night: Night): string {
  if (night.verdict !== 'out' && night.window !== null) return fmtMinutes(night.window.minutes)
  const gap = coreGateFailure(night) ? gapToGate(night) : null
  return gap !== null ? `${gap.toFixed(1)}° short` : killerLabel(night)
}

/** Compact reason label for a ruled-out night's strip cell — the operator's actual question on a
 * dead night is "why", not just "not tonight". Derived from the first killer only; a night can
 * carry more than one, but stacking them doesn't fit a single small cell. */
export function killerLabel(night: Night): string {
  const killer = night.killers[0]
  if (killer === undefined) return '—'
  switch (killer.id) {
    case 'moon':
      return `moon ${percent(night.moon.illumination)}`
    case 'core-altitude':
      return 'core low'
    case 'darkness':
      return 'no dark'
    default:
      return killer.label.toLowerCase()
  }
}

/**
 * Maps an hourly point's instant (the x `Date`, epoch ms) back to its `localTime` label for
 * `formatX`. The label cannot BE the key: `localTime` is an "HH:MM" wall clock, and on the DST
 * fall-back night 02:00/02:30 occur twice — keyed by it, two samples would share one entry. The
 * epoch is unique per sample, so both fall-back hours keep their own label. Shared by the two
 * charts that plot the same hourly array so their x values, and therefore their shared cursor,
 * cannot drift. An instant that is not a sample has no wall-clock label here, hence `''`.
 */
export function hourlyTimeLabel(hourly: readonly { time: string; localTime: string }[]) {
  const byInstant = new Map(hourly.map((d) => [new Date(d.time).getTime(), d.localTime]))
  return (x: Date) => byInstant.get(x.getTime()) ?? ''
}

/**
 * Tick instants for the hourly x axis: the on-the-hour samples, thinned to at most `max` evenly
 * strided ones. Explicit ticks always land on a sample, so `hourlyTimeLabel` always has a label —
 * the default time ticks fall on arbitrary instants it cannot name.
 */
export function hourlyTicks(
  hourly: readonly { time: string; localTime: string }[],
  max = 7,
): Date[] {
  const onTheHour = hourly.filter((d) => d.localTime.endsWith(':00'))
  const stride = Math.max(1, Math.ceil(onTheHour.length / max))
  return onTheHour.filter((_, i) => i % stride === 0).map((d) => new Date(d.time))
}

/** Weekday + day-of-month, `Sat 17` — the one short date label the page uses. */
export function fmtShortDay(dateString: string): string {
  const { weekday: wd, day } = fmtDayLabel(dateString)
  return `${wd} ${day}`
}

/** Nights that passed every hard gate. The API decides; this only counts. */
export function usableNightCount(nights: readonly Night[]): number {
  return nights.filter((n) => n.verdict !== 'out').length
}

/** The night the top-level `verdict`/`killers` describe, by the API's own `bestDate`. */
export function bestNightOf(data: WindowResponse): Night | null {
  return data.nights.find((n) => n.date === data.bestDate) ?? data.nights[0] ?? null
}

/** Did the API rule this night out on the core gate? The one place that reads the killer id. */
export function coreGateFailure(night: Night): boolean {
  return night.killers.some((k) => k.id === 'core-altitude')
}

/** The Core gate row's one line. A failed gate keeps the API's own reason (it names the terrain
 * ridge when the skyline raised the gate); the generic text is only the fallback. */
export function coreGateDetail(night: Night): string {
  if (coreGateFailure(night)) {
    const reason = night.killers.find((k) => k.id === 'core-altitude')?.reason
    return reason ?? 'below the gate at its closest'
  }
  return night.gateCoreAltitude === null || night.coreGateDeg === null
    ? 'no astronomical night'
    : 'clears the gate'
}

/** The core reading and its gate, for the verdict meter — present on every night with a dark
 * stretch, whether or not the gate failed, so a clearing night still shows how far it cleared. */
export function coreMeterReading(night: Night): { reading: number; gate: number } | null {
  const { gateCoreAltitude: reading, coreGateDeg: gate } = night
  return reading === null || gate === null ? null : { reading, gate }
}

/**
 * Degrees the core falls short of its gate at the tightest dark sample. With a `core-altitude`
 * killer the gap is shown even at 0.0° (the API's gate is a strict `>`); null when the core clears
 * the gate or there is no dark stretch.
 */
export function gapToGate(night: Night): number | null {
  if (night.gateCoreAltitude === null || night.coreGateDeg === null) return null
  const gap = night.coreGateDeg - night.gateCoreAltitude
  if (!coreGateFailure(night)) return null
  return Math.round(Math.max(0, gap) * 10) / 10
}
