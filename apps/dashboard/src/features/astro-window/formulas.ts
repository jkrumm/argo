import { VX } from 'basalt-ui/tokens'
import { weekday } from 'basalt-ui/format'
import type { ChartFact } from 'basalt-ui/charts'
import { NBSP, formatMinutes, withUnit } from '../../lib/format'
import { CORE_METER_MAX_DEG, CORE_UNIT, MIN_BAR_SHARE, SKY_DARK_THRESHOLD } from './constants'
import type { HourlyPoint, Killer, Night, Verdict, WindowResponse } from './types'

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

function verdictLabel(verdict: Verdict): string {
  if (verdict === 'out') return 'Ruled out'
  return verdict.charAt(0).toUpperCase() + verdict.slice(1)
}

export function fmtDegrees(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}°`
}

/**
 * The one percent spelling for cloud cover and moon illumination (`46 %`, glued). Floored, so a
 * reading never shows at the limit while the engine's `>=` check says under it; callers with a
 * fraction round it to whole percent first.
 */
export function fmtPercent(v: number): string {
  return withUnit(Math.floor(v), '%')
}

/** The app's duration spelling (`2 h 30 min`, `45 min`), `—` without a value. */
export function fmtMinutes(v: number | null): string {
  return v === null ? '—' : formatMinutes(v)
}

/** Weekday abbreviation + day-of-month, for the night-strip cell header. */
function fmtDayLabel(dateString: string): { weekday: string; day: number } {
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
export function limitingFactor(night: Night): { id: string; label: string; pct: number } | null {
  let lowest: { id: string; label: string; pct: number } | null = null
  for (const factor of night.factors) {
    if (factor.value === null) continue
    const pct = Math.round(factor.value * 100)
    if (lowest === null || pct < lowest.pct) lowest = { id: factor.id, label: factor.label, pct }
  }
  return lowest !== null && lowest.pct < 80 ? lowest : null
}

/** The one fact line of a strip cell. A night out on the core gate states how far it fell short, so
 * an all-out week still ranks; any other out night names its first killer; a usable night its window. */
export function nightNote(night: Night): string {
  if (night.verdict !== 'out' && night.window !== null) return fmtMinutes(night.window.minutes)
  const gap = coreGateFailure(night) ? gapToGate(night) : null
  return gap !== null && gap > 0 ? `${gap.toFixed(1)}° short` : killerLabel(night)
}

/** Compact reason label for a ruled-out night's strip cell — the operator's actual question on a
 * dead night is "why", not just "not tonight". Derived from the first killer only; a night can
 * carry more than one, but stacking them doesn't fit a single small cell. */
function killerLabel(night: Night): string {
  const killer = night.killers[0]
  if (killer === undefined) return '—'
  switch (killer.id) {
    case 'moon':
      return `moon ${fmtPercent(Math.round(night.moon.illumination * 100))}`
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
function usableNightCount(nights: readonly Night[]): number {
  return nights.filter((n) => n.verdict !== 'out').length
}

/** The night the top-level `verdict`/`killers` describe, by the API's own `bestDate`. */
function bestNightOf(data: WindowResponse): Night | null {
  return data.nights.find((n) => n.date === data.bestDate) ?? data.nights[0] ?? null
}

/** Did the API rule this night out on the core gate? The one place that reads the killer id. */
export function coreGateFailure(night: Night): boolean {
  return night.killers.some((k) => k.id === 'core-altitude')
}

/** The Core gate row's one line, in words only: the reading and the gate are drawn in the Core cell and the miss is the verdict's headline, so no figure is repeated here. A failed gate branches on the API's `cause` tag, never on its prose; a cause this client does not know (or none) shows the API's reason verbatim. */
export function coreGateDetail(night: Night): string {
  const killer = night.killers.find((k) => k.id === 'core-altitude')
  if (killer !== undefined) {
    switch (killer.cause) {
      case 'ridge':
        return 'the skyline raised the gate'
      case 'floor':
        return 'stayed too low above the horizon'
      case 'never-rises':
        return 'never rises while it is dark'
      default:
        return killer.reason
    }
  }
  return night.gateCoreAltitude === null || night.coreGateDeg === null
    ? 'no astronomical night'
    : 'clears the gate'
}

/**
 * A failed Moon gate with no shooting window, from the hourly samples only: the moon's peak over
 * the astronomical-dark hours, or why there is none to state.
 */
function moonDarkDetail(hourly: readonly HourlyPoint[]): string {
  const dark = hourly.filter((h) => h.astroDark).map((h) => h.moonAltitude)
  if (dark.length === 0) return 'no dark sample'
  const peak = Math.max(...dark)
  if (peak > 0) return `up to ${fmtDegrees(peak)} while it is dark`
  return peak < 0 ? 'below the horizon while it is dark' : 'on the horizon while it is dark'
}

/**
 * The Moon gate row's one line, in words only (the illumination and the limit are drawn in the Moon
 * cell). A failed gate: the moon's peak altitude over the window, else over the dark hours (or a
 * stated absence of a dark sample), always from structured fields, never the API's prose. A pass:
 * `under limit`, or, for a moon over the limit, why the engine counted it down: `below horizon`
 * (peak under 0°) or `behind skyline` (a window sample reports `moonBehindTerrain`); `over limit`
 * alone when neither field says.
 */
export function moonGateDetail(
  night: Night,
  moonLimit: number,
  hourly: readonly HourlyPoint[],
): string {
  const killer = night.killers.find((k) => k.id === 'moon')
  if (killer !== undefined) {
    if (night.window !== null) {
      return `up to ${fmtDegrees(night.window.maxMoonAltitude)} during the window`
    }
    return moonDarkDetail(hourly)
  }
  if (night.moon.illumination < moonLimit) return 'under limit'
  const shoot = night.window
  if (shoot === null) return 'over limit'
  if (shoot.maxMoonAltitude < 0) return 'over limit, below horizon'
  const [start, end] = [Date.parse(shoot.start), Date.parse(shoot.end)]
  const behind = hourly.some((h) => {
    const t = Date.parse(h.time)
    return h.moonBehindTerrain && t >= start && t <= end
  })
  return behind ? 'over limit, behind skyline' : 'over limit'
}

/** The Darkness gate row's one line. */
export function darknessDetail(night: Night): string {
  if (night.darkMinutes > 0) return 'astronomical night present'
  return night.killers.find((k) => k.id === 'darkness')?.reason ?? 'none'
}

/** The upper end of the Core gauge: the scale the core never tops, widened to the gate so a gate above it still shows a miss. */
export function coreGaugeMax(gate: number): number {
  return Math.max(CORE_METER_MAX_DEG, gate)
}

/** The core reading and its gate, for the Core cell's gauge — present on every night with a dark
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
function gapToGate(night: Night): number | null {
  const gap = rawGapToGate(night)
  return gap === null ? null : Math.round(gap * 10) / 10
}

/** The same gap unrounded: what ranking and bar lengths use, so 3.96° beats 3.99° though both show as 4.0°. */
function rawGapToGate(night: Night): number | null {
  if (night.gateCoreAltitude === null || night.coreGateDeg === null) return null
  if (!coreGateFailure(night)) return null
  return Math.max(0, night.coreGateDeg - night.gateCoreAltitude)
}

/** The verdict as a word and its colour (the same `verdictTone` the strip uses): the verdict's own tier (Excellent … Poor) or OUT, drawn as a status dot + word, never a bare word. */
export function verdictStatus(night: Night): { word: string; color: string } {
  return {
    word: night.verdict === 'out' ? 'OUT' : verdictLabel(night.verdict),
    color: verdictTone(night.verdict),
  }
}

/** The one gate a ruled-out night is headlined by: the core-altitude killer when its gap is shown
 * (any unrounded gap above 0, so a 0.0°-looking miss still counts), else the API's first killer. */
function headlineKiller(night: Night): Killer | undefined {
  const gap = rawGapToGate(night)
  const core =
    gap !== null && gap > 0 ? night.killers.find((k) => k.id === 'core-altitude') : undefined
  return core ?? night.killers[0]
}

/** Which gate a ruled-out night misses and by how much: `core 3.9° under its gate`, else the API's first killer. */
export function gateMissText(night: Night): string {
  const raw = rawGapToGate(night)
  const gap = gapToGate(night)
  if (raw !== null && raw > 0 && gap !== null) return `core ${fmtDegrees(gap)} under its gate`
  const headline = headlineKiller(night)
  return headline === undefined ? 'ruled out' : headline.label.toLowerCase()
}

/** `Sat 17, 23:10–01:40 · 2h 30m` for a GO night, `core 3.9° under its gate` for an OUT one (the status dot carries GO/OUT). */
export function verdictHeadline(night: Night): string {
  if (night.verdict !== 'out') {
    const shoot = night.window
    return shoot === null
      ? fmtShortDay(night.date)
      : `${fmtShortDay(night.date)}, ${shoot.localStart}–${shoot.localEnd} · ${fmtMinutes(shoot.minutes)}`
  }
  return gateMissText(night)
}

/** The next usable night after `date`, with its window. When none is usable it says so without a count: the headline owns the number of nights. */
export function nextUsableText(nights: readonly Night[], date: string): string {
  const later = nights.filter((n) => n.date > date)
  const next = later.find((n) => n.verdict !== 'out')
  if (next !== undefined) {
    const minutes = next.window === null ? '' : `, ${fmtMinutes(next.window.minutes)}`
    return `next usable ${fmtShortDay(next.date)}${minutes}`
  }
  return later.length === 0 ? 'no later night in this range' : 'no later night is usable'
}

const COMPASS_WORDS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

/** The 8-point compass word an azimuth (degrees from north through east) falls in. */
export function compassWord(azimuthDeg: number): string {
  const index = Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8
  return COMPASS_WORDS[index] ?? 'N'
}

/** `az 180° S` — an azimuth with its unit and compass word. */
export function fmtAzimuth(azimuthDeg: number): string {
  const rounded = ((Math.round(azimuthDeg) % 360) + 360) % 360
  return `az ${rounded}° ${compassWord(azimuthDeg)}`
}

/** Degrees short of the core gate, UNROUNDED, the one gap the strip can draw. Null for any other kind of night. */
export function nightShortfall(night: Night): number | null {
  return night.verdict === 'out' ? rawGapToGate(night) : null
}

/** A night's value as a share of a scale, 0–1: null when there is nothing to draw, and never under
 * `MIN_BAR_SHARE` (a failed gate whose gap rounds to 0.0° still shows a hairline). */
function barShare(value: number | null, scale: number): number | null {
  if (value === null || !(scale > 0)) return null
  return Math.min(1, Math.max(MIN_BAR_SHARE, value / scale))
}

/** A strip bar: the fill's share of its track, and the gate tick's position when the night has a gate to draw. */
export type GateBar = { fill: number; gate: number | null }

/** Does this night draw a gate bar: out on the core gate with both its reading and its gate. The one predicate the scale and the bar share. */
export function drawsGateBar(night: Night): boolean {
  return (
    nightShortfall(night) !== null && night.gateCoreAltitude !== null && night.coreGateDeg !== null
  )
}

/** The shared scale of the strip's gate bars: the highest gate among the nights that draw one, so the track always reaches the tallest gate. Never under 1°. */
export function gateBarScale(nights: readonly Night[]): number {
  const gates = nights.flatMap((n) => (drawsGateBar(n) ? [n.coreGateDeg ?? 0] : []))
  return Math.max(1, ...gates)
}

/** A night out on the core gate: fill = the core reading, tick = the gate, both on the shared scale; the distance between them is the miss. Null for any other night. A reading under 0° keeps a hairline. */
export function gateBar(night: Night, scale: number): (GateBar & { gate: number }) | null {
  if (!drawsGateBar(night) || night.gateCoreAltitude === null || night.coreGateDeg === null) {
    return null
  }
  if (!(scale > 0)) return null
  const fill = barShare(night.gateCoreAltitude, scale)
  return fill === null ? null : { fill, gate: Math.min(1, night.coreGateDeg / scale) }
}

/** The longest shooting window on screen, minutes: the scale usable nights are drawn against. */
export function longestWindow(nights: readonly Night[]): number {
  return Math.max(0, ...nights.map((n) => (n.verdict === 'out' ? 0 : (n.window?.minutes ?? 0))))
}

/** A usable night's window length as a share of the longest; null for a night with no (or an empty) window. */
export function windowShare(night: Night, longest: number): number | null {
  if (night.verdict === 'out' || night.window === null || night.window.minutes <= 0) return null
  return barShare(night.window.minutes, longest)
}

/**
 * The out night nearest to passing: the smallest core-gate shortfall. The API's `bestDate` is only
 * the FIRST night when every night is out, so "closest" has to come from the real gap. Null when no
 * out night has a degree gap to rank by.
 */
export function closestNight(nights: readonly Night[]): Night | null {
  let closest: Night | null = null
  let least = Infinity
  for (const night of nights) {
    const gap = nightShortfall(night)
    if (gap !== null && gap < least) {
      closest = night
      least = gap
    }
  }
  return closest
}

/** The night the strip marks and the headline names: the API's best when any night is usable, else the closest. */
export function markedNightOf(data: WindowResponse): Night | null {
  return usableNightCount(data.nights) > 0 ? bestNightOf(data) : closestNight(data.nights)
}

/** How many cells end past the scroller's right edge (all in viewport coordinates). */
export function countOffscreen(
  cellRights: readonly number[],
  scrollerRight: number,
  tolerance: number,
): number {
  return cellRights.filter((right) => right > scrollerRight + tolerance).length
}

/** The off-screen strip count in words: `visible` is the cue's text, `spoken` the group's aria suffix. */
export function offscreenNightsText(count: number): { visible: string; spoken: string } {
  if (count <= 0) return { visible: '', spoken: '' }
  const phrase = `${count} more ${count === 1 ? 'night' : 'nights'}`
  return { visible: `${phrase} →`, spoken: `${phrase} off-screen` }
}

/** The Core cell's footer: the transit altitude. Transit can fall in daylight, so it is never "the night's" best. */
export function coreTransitFooter(night: Night): string {
  return `${fmtDegrees(night.maxCoreAltitude)} ${glue('at transit')}`
}

/**
 * The night the headline names, or null when the view already states it. The marked night is named
 * while another night is selected. When the marked night IS the selected one, Tonight's verdict card
 * states it (day, window or miss) and the Forecast timeline states a ruled-out night's miss, so
 * both drop it; a usable night keeps its fact on Forecast, whose timeline carries the length but
 * no headline-level window.
 */
export function headlineNight(
  data: WindowResponse,
  { forecast, selectedDate }: { forecast: boolean; selectedDate: string },
): Night | null {
  const marked = markedNightOf(data)
  if (marked === null || marked.date !== selectedDate) return marked
  return forecast && usableNightCount(data.nights) > 0 ? marked : null
}

/**
 * The API's first night, for an all-out week with no degree gap to rank (so no marked night):
 * null when a night is marked, when the API names none, or when that night is the selected one.
 */
export function headlineFirstDate(
  data: WindowResponse,
  { selectedDate }: { selectedDate: string },
): string | null {
  if (markedNightOf(data) !== null) return null
  return data.bestDate === selectedDate ? null : data.bestDate
}

/**
 * The page's opening: the live usable count, then the night to look at (`marked`, from
 * `headlineNight`) and how many are ruled out. Its shooting window is added only when `withWindow`.
 * With no night to rank at all, `firstDate` (from `headlineFirstDate`) names the API's first night.
 */
export function pageSummary(
  data: WindowResponse,
  {
    withWindow,
    marked,
    firstDate,
  }: { withWindow: boolean; marked: Night | null; firstDate: string | null },
): { sentence: string; facts: string[] } {
  const total = data.nights.length
  const usable = usableNightCount(data.nights)
  const nightWord = total === 1 ? 'night' : 'nights'
  const sentence =
    usable === 0
      ? `No usable night${total === 1 ? '' : ` in the next ${total} nights`}`
      : `${usable} of ${total} ${nightWord} usable`
  const facts: string[] = []
  if (usable > 0 && marked !== null) {
    const shoot = marked.window
    const range = withWindow && shoot !== null ? `, ${shoot.localStart}–${shoot.localEnd}` : ''
    facts.push(`best ${fmtShortDay(marked.date)}${range}`)
  } else if (usable === 0 && marked !== null) {
    facts.push(`closest ${fmtShortDay(marked.date)}, ${gateMissText(marked)}`)
  } else if (usable === 0 && firstDate !== null) {
    facts.push(`first ${fmtShortDay(firstDate)}`)
  }
  if (usable > 0 && usable < total) facts.push(`${total - usable} ruled out`)
  return { sentence, facts }
}

/** The timeline's one fact. The timeline draws the shooting window whenever the API has one, so it is
 * stated whenever it exists. The missed gate is named only when `withMiss` (the Forecast tab); on
 * Tonight the verdict card states it. No window: `none within the dark` on a usable night. */
export function windowFact(
  night: Night,
  { withMiss }: { withMiss: boolean },
): { value: string; period: string } {
  const shoot = night.window
  const out = night.verdict === 'out'
  if (shoot === null) {
    if (!out) return { value: 'No window', period: 'none within the dark' }
    return {
      value: 'No window',
      period: withMiss ? gateMissText(night) : 'no stretch passes every gate',
    }
  }
  const range = `${shoot.localStart}–${shoot.localEnd}`
  return {
    value: fmtMinutes(shoot.minutes),
    period: out && withMiss ? `${range} · ${gateMissText(night)}` : `shooting window ${range}`,
  }
}

/** The cloud layers besides low, in print order: the name and the key on both `Weather` and `HourlyPoint`. */
const OTHER_LAYERS = [
  ['mid', 'cloudMid'],
  ['high', 'cloudHigh'],
] as const

/**
 * `mid {m} %` / `high {h} %`, label and value glued: the other two layers, the same statistic as
 * the low value. A layer without data (null or absent) is left out.
 */
function layerParts({ weather }: Night): string[] {
  return OTHER_LAYERS.flatMap(([name, key]) => {
    const v = weather[key]
    return v === null || v === undefined ? [] : [`${name}${NBSP}${fmtPercent(v)}`]
  })
}

/** The low-cloud figure as printed: the floored scored mean with its unit; null without a reading. */
function lowCloudValue(night: Night): string | null {
  const mean = night.weather.cloudLow
  return mean === null ? null : fmtPercent(mean)
}

type LowCloudStat = {
  value: string
  unit: string
  /** What the low value is a mean over: `shooting-window mean` or `dark-hours mean`. */
  basis: string
  /** `mid {m} %` / `high {h} %`, each pair glued; empty when neither layer has data. */
  layers: string[]
  /** The reading and the limit tick for the gauge; the tick only when the night has the shooting window the limit applies to. */
  reading: number
  target: number | null
}

/** The Cloud cell's footer line. Pairs are glued; the plain-space ` · ` between phrases may wrap. */
export function cloudFooter({ basis, layers }: Pick<LowCloudStat, 'basis' | 'layers'>): string {
  return [basis, ...layers].join(' · ')
}

/**
 * The one low-cloud figure the page prints: the mean the engine scores against its limit, over the
 * shooting window, or over the astronomical-dark hours when the night has no window. Floored, so a
 * reading never shows at the limit while the engine's `>=` check says under it. A night without a
 * shooting window, or a response without a limit, has a value but no tick.
 */
export function lowCloudStat(night: Night, limit: number | undefined): LowCloudStat | null {
  const mean = night.weather.cloudLow
  if (mean === null) return null
  const scored = night.window !== null
  const reading = Math.floor(mean)
  return {
    value: lowCloudValue(night) ?? '',
    unit: 'low cloud',
    basis: scored ? 'shooting-window mean' : 'dark-hours mean',
    layers: layerParts(night),
    reading,
    target: scored && limit !== undefined ? limit : null,
  }
}

/** Minutes → hours at one decimal, the one converter the budget chart and its fact line share. */
export function minutesToHours(minutes: number | undefined): number | null {
  return minutes === undefined ? null : Math.round((minutes / 60) * 10) / 10
}

/** The month (index 0 = January) with the most usable hours; gaps (`null`) never win. */
export function peakMonth(
  hoursByMonth: readonly (number | null)[],
): { monthIndex: number; hours: number } | null {
  let best: { monthIndex: number; hours: number } | null = null
  for (const [monthIndex, hours] of hoursByMonth.entries()) {
    if (hours !== null && (best === null || hours > best.hours)) best = { monthIndex, hours }
  }
  return best
}

/** `facts` as an optional ChartCard prop, spread in: the one shape every chart uses for a fact it may not have. */
export function withFacts(fact: ChartFact | null): { facts?: ChartFact } {
  return fact === null ? {} : { facts: fact }
}

/** Every plain space → no-break space: one phrase that never wraps inside itself. */
const glue = (text: string): string => text.replaceAll(' ', NBSP)

/** Footer phrases joined by `·`, each dot bound to the phrase before it so a wrapped line never opens on one. */
const joinPhrases = (phrases: readonly string[]): string => phrases.join(`${NBSP}· `)

/**
 * The Sky cell's footer: the dark-sky threshold (the scale's tick is unlabelled), the town glow
 * and the transparency. Each run is glued internally (≤ 24 characters), so a wrap falls only on a
 * plain space: after a ` · `, or inside the transparency phrase between its value and its hint.
 */
export function skyCellFooter({
  domePenaltyMag,
  transparency,
}: {
  domePenaltyMag: number | null
  transparency: number | null
}): string {
  const dome = domePenaltyMag === null ? '—' : `+${withUnit(domePenaltyMag.toFixed(2), 'mag')}`
  const clarity = transparency === null ? '—' : `${transparency}/8`
  return joinPhrases([
    `dark ${glue(`≥ ${withUnit(SKY_DARK_THRESHOLD, 'mag/arcsec²')}`)}`,
    glue(`town glow ${dome}`),
    `${glue(`transparency ${clarity}`)} ${glue('(lower = clearer)')}`,
  ])
}

/** The Moon cell's footer: the limit, the phase and (when the moon sets) the set time; no line opens on a `·`. */
export function moonFooter({
  limit,
  phase,
  set,
}: {
  limit: string
  phase: string
  set: string | null
}): string {
  return joinPhrases([
    glue(`limit ${limit}`),
    glue(phase),
    ...(set === null ? [] : [glue(`sets ${set}`)]),
  ])
}

/**
 * The cloud-layers headline as a `ChartFact`: `{v} % low cloud · dark-hours mean`. ChartCard puts
 * no separator between unit and period, so the period carries its own `· `; both phrases are glued.
 */
export function cloudHeadline({ value, unit, basis }: LowCloudStat): ChartFact {
  return { value, unit: glue(unit), period: `· ${glue(basis)}` }
}

/**
 * Low cloud as a factor row, present only when the API marks the factor `ruinous` (its own ruin
 * level for the layer, judged on the scored window mean). The row quotes the Cloud cell's own statistic (`lowCloudStat`), never a second one. Cloud is
 * scored, never gated, so the row never reads as a failed gate. Gated nights carry no factors.
 */
export function lowCloudRuinous(night: Night): boolean {
  const factor = night.factors.find((f) => f.id === 'cloud-low')
  return factor?.ruinous === true && night.weather.cloudLow !== null
}

/**
 * Why low cloud earns a verdict-card row: the API calls the layer ruinous, or it is the factor
 * holding the score back (the engine's lowest, under 80 %). Null when it earns none.
 */
function lowCloudState(night: Night): 'ruinous' | 'limits the score' | null {
  if (night.weather.cloudLow === null) return null
  if (lowCloudRuinous(night)) return 'ruinous'
  return limitingFactor(night)?.id === 'cloud-low' ? 'limits the score' : null
}

/** Does the night have a scored low-cloud factor and a reading, for a cloud row to state? */
function hasLowCloudFact(night: Night): boolean {
  const factor = night.factors.find((f) => f.id === 'cloud-low')
  return night.weather.cloudLow !== null && factor !== undefined && factor.value !== null
}

/**
 * The state word of the verdict card's low-cloud row, or null when it has no row. Early returns,
 * in order: the API calls the layer ruinous or it holds the score back (`lowCloudState`); a scored
 * cloud factor that limits nothing (`not limiting`); a ruled-out night whose cloud factor is missing,
 * though the API still sends its cloud figure (`not scored`).
 */
function cloudRowState(night: Night): string | null {
  const flagged = lowCloudState(night)
  if (flagged !== null) return flagged
  if (hasLowCloudFact(night)) return 'not limiting'
  return night.verdict === 'out' && night.weather.cloudLow !== null ? 'not scored' : null
}

/** The verdict card's facts line. A usable night names its score and the factor holding it back, unless the low-cloud row already says it. */
export function verdictFacts(night: Night, nights: readonly Night[]): string[] {
  if (night.verdict === 'out') return [fmtShortDay(night.date), nextUsableText(nights, night.date)]
  const limiting = limitingFactor(night)
  const named =
    limiting === null || lowCloudState(night) !== null
      ? null
      : `limited by ${limiting.label.toLowerCase()} ${limiting.pct} %`
  return [`score ${night.score}/100`, ...(named === null ? [] : [named])]
}

/** The hard gates, in the order `gateRows` lists them: the ids a verdict-card row exists for. */
const GATE_IDS = ['darkness', 'core-altitude', 'moon'] as const

/**
 * The lines the score card shows for a gated night. When every killer is one of the gates the
 * verdict card has a row for, one generic line (the rows name them). A killer this client does not
 * know has no row, so every killer keeps its own label and reason here.
 */
export function withheldLines(night: Night): string[] {
  const known = night.killers.every((k) => (GATE_IDS as readonly string[]).includes(k.id))
  return known
    ? ['Score withheld on a ruled-out night']
    : ['Score withheld', ...night.killers.map((k) => `${k.label}: ${k.reason}`)]
}

export type GateRowModel = {
  key: string
  label: string
  state: string
  /** `good` and `warn` are gate verdicts; `neutral` is a fact that is neither. */
  tone: 'good' | 'warn' | 'neutral'
  detail: string | null
}

/**
 * The verdict card's rows: the three gates in the API's order, pass or fail by its `killers` only,
 * then low cloud when the API calls it ruinous. With no astronomical night the core and moon gates
 * have nothing to judge, so they read `n/a`, neutral. Low cloud is scored, never gated: neutral too.
 */
export function gateRows(
  night: Night,
  moonLimit: number,
  hourly: readonly HourlyPoint[],
): GateRowModel[] {
  const failed = new Set(night.killers.map((k) => k.id))
  const dark = night.darkMinutes > 0
  const gate = (id: string, label: string, detail: string, judged = true): GateRowModel =>
    judged
      ? {
          key: id,
          label,
          state: failed.has(id) ? 'failed' : 'passed',
          tone: failed.has(id) ? 'warn' : 'good',
          detail,
        }
      : { key: id, label, state: 'n/a', tone: 'neutral', detail: 'no astronomical night' }
  const rows = [
    gate(GATE_IDS[0], 'Darkness', darknessDetail(night)),
    gate(GATE_IDS[1], 'Core', coreGateDetail(night), dark),
    gate(GATE_IDS[2], 'Moon', moonGateDetail(night, moonLimit, hourly), dark),
  ]
  const cloudState = cloudRowState(night)
  if (cloudState !== null) {
    rows.push({
      key: 'cloud-low',
      label: 'Low cloud',
      state: cloudState,
      tone: 'neutral',
      detail: lowCloudValue(night),
    })
  }
  return rows
}

/**
 * The core reading the Forecast panorama's header states: the SAME API fields the Tonight Core cell
 * reads (`gateCoreAltitude` at the sample closest to the gate, `coreGateDeg`), never a figure
 * re-derived from the hourly samples. The hourly rows are a coarser sampling and a different
 * question (the highest point, not the tightest one), which is how the two used to disagree.
 */
export function coreGateFact(night: Night): ChartFact | null {
  const core = coreMeterReading(night)
  return core === null
    ? null
    : {
        value: fmtDegrees(core.reading),
        unit: `${CORE_UNIT}, needs > ${fmtDegrees(core.gate)}`,
      }
}

/**
 * The one bar a strip cell draws. A usable night: its window length against the longest on screen,
 * no gate. A night out on the core gate: its core altitude against a tick at the gate, on the shared
 * degree scale. Any other night: nothing to rank, so no bar.
 */
export function nightBar(
  night: Night,
  { gateScale, longest }: { gateScale: number; longest: number },
): GateBar | null {
  if (night.verdict !== 'out') {
    const fill = windowShare(night, longest)
    return fill === null ? null : { fill, gate: null }
  }
  return gateBar(night, gateScale)
}

/**
 * `mid {m} % all night`, `high {h} % all night`: the layers that hold one value for the whole
 * night (a flat line reads as chart furniture). Null when none does.
 */
export function flatLayersNote(hourly: readonly HourlyPoint[]): string | null {
  const parts = OTHER_LAYERS.flatMap(([name, key]) => {
    const first = hourly[0]?.[key]
    if (first === null || first === undefined) return []
    return hourly.every((h) => h[key] === first)
      ? [`${name}${NBSP}${fmtPercent(first)} all night`]
      : []
  })
  return parts.length === 0 ? null : parts.join(' · ')
}
