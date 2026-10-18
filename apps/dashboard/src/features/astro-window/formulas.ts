import { VX } from 'basalt-ui/tokens'
import { percent, weekday } from 'basalt-ui/format'
import type { ChartFact } from 'basalt-ui/charts'
import { CORE_METER_MAX_DEG, MIN_BAR_SHARE, SKY_DARK_THRESHOLD } from './constants'
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

/** The Core gate row's one line, in words only: the reading and the gate are drawn in the Core cell and the miss is the verdict's headline, so no figure is repeated here. A failed gate branches on the API's `cause` tag, never on its prose; a cause this client does not know (or none) shows the API's reason verbatim. */
export function coreGateDetail(night: Night): string {
  const killer = night.killers.find((k) => k.id === 'core-altitude')
  if (killer !== undefined) {
    switch (killer.cause) {
      case 'ridge':
        return 'the skyline raised the gate'
      case 'floor':
        return 'below the atmospheric floor'
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
 * The Moon gate row's one line: the API's reason when it failed; else, when it passed under the
 * limit, the illumination against it. A moon over the limit only passes by its position, so the line
 * says which: down through the shooting window (`maxMoonAltitude` under 0°) or behind the skyline.
 */
export function moonGateDetail(night: Night, moonLimit: number): string {
  const killer = night.killers.find((k) => k.id === 'moon')
  if (killer !== undefined) return killer.reason
  const lit = Math.round(night.moon.illumination * 100)
  const limit = Math.round(moonLimit * 100)
  if (night.moon.illumination < moonLimit) return `${lit} % lit · limit ${limit} %`
  const shoot = night.window
  if (shoot === null) return `${lit} % lit, over the ${limit} % limit · passed on its position`
  return shoot.maxMoonAltitude < 0
    ? `${lit} % lit, over the ${limit} % limit · down through the shooting window`
    : `${lit} % lit, over the ${limit} % limit · behind the skyline in the shooting window`
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
export function gapToGate(night: Night): number | null {
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
  return `${fmtDegrees(night.maxCoreAltitude)} at transit`
}

/**
 * The page's opening: the live usable count, then which night to look at and how many are ruled
 * out. The shooting window is stated here only when `withWindow` (the Forecast tab, which has no
 * verdict card); on Tonight the verdict card owns it, so it is said once per view.
 */
export function pageSummary(
  data: WindowResponse,
  { withWindow, withMiss }: { withWindow: boolean; withMiss: boolean },
): { sentence: string; facts: string[]; aside: string } {
  const total = data.nights.length
  const usable = usableNightCount(data.nights)
  const marked = markedNightOf(data)
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
    facts.push(
      withMiss
        ? `closest ${fmtShortDay(marked.date)}, ${gateMissText(marked)}`
        : `closest ${fmtShortDay(marked.date)}`,
    )
  } else if (usable === 0 && data.bestDate !== null) {
    facts.push(`first ${fmtShortDay(data.bestDate)}`)
  }
  if (usable > 0 && usable < total) facts.push(`${total - usable} ruled out`)
  return { sentence, facts, aside: data.location.name }
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

/** The thickest low cloud inside astronomical dark, or over the whole night when no dark sample has a reading. Null without data. */
export function peakLowCloud(
  hourly: readonly HourlyPoint[],
): { pct: number; dark: boolean } | null {
  const readings = (pool: readonly HourlyPoint[]) =>
    pool.flatMap((d) => (d.cloudLow === null ? [] : [d.cloudLow]))
  const inDark = readings(hourly.filter((d) => d.astroDark))
  const dark = inDark.length > 0
  const values = dark ? inDark : readings(hourly)
  return values.length === 0 ? null : { pct: Math.round(Math.max(...values)), dark }
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

/** The Sky cell's footer: the dark-sky threshold, the dome and the transparency, each with its unit. */
export function skyCellFooter({
  domePenaltyMag,
  transparency,
}: {
  domePenaltyMag: number | null
  transparency: number | null
}): string {
  const dome =
    domePenaltyMag === null ? 'town glow —' : `town glow adds ${domePenaltyMag.toFixed(2)} mag`
  const clarity = transparency === null ? '—' : `${transparency}/8, 1 = clearest`
  return `dark sky from ${SKY_DARK_THRESHOLD} · ${dome} · transparency ${clarity}`
}

/**
 * Low cloud as a factor row, present only when the API marks the factor `ruinous` (its own ruin
 * level for the layer). It quotes the scored value, the window mean the score used. Cloud is scored,
 * never gated, so the row never reads as a failed gate. Gated nights carry no factors, so none here.
 */
export function lowCloudRow(night: Night): string | null {
  const factor = night.factors.find((f) => f.id === 'cloud-low')
  const mean = night.weather.cloudLow
  if (factor?.ruinous !== true || mean === null) return null
  return `${Math.round(mean)} % mean over the shooting window`
}

/** The verdict card's facts line. A usable night names its score and the factor holding it back, unless the low-cloud row already says it. */
export function verdictFacts(night: Night, nights: readonly Night[]): string[] {
  if (night.verdict === 'out') return [fmtShortDay(night.date), nextUsableText(nights, night.date)]
  const limiting = limitingFactor(night)
  const named =
    limiting === null || (limiting.id === 'cloud-low' && lowCloudRow(night) !== null)
      ? null
      : `limited by ${limiting.label.toLowerCase()} ${limiting.pct} %`
  return [`score ${night.score}/100`, ...(named === null ? [] : [named])]
}

export type GateRowModel = {
  key: string
  label: string
  state: string
  /** `good` and `warn` are gate verdicts; `neutral` is a fact that is neither. */
  tone: 'good' | 'warn' | 'neutral'
  detail: string
}

/**
 * The verdict card's rows: the three gates in the API's order, pass or fail by its `killers` only,
 * then low cloud when the API calls it ruinous. With no astronomical night the core and moon gates
 * have nothing to judge, so they read `n/a`, neutral. Low cloud is scored, never gated: neutral too.
 */
export function gateRows(night: Night, moonLimit: number): GateRowModel[] {
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
    gate('darkness', 'Darkness', darknessDetail(night)),
    gate('core-altitude', 'Core', coreGateDetail(night), dark),
    gate('moon', 'Moon', moonGateDetail(night, moonLimit), dark),
  ]
  const cloud = lowCloudRow(night)
  if (cloud !== null) {
    rows.push({
      key: 'cloud-low',
      label: 'Low cloud',
      state: 'ruinous · scored, not a gate',
      tone: 'neutral',
      detail: cloud,
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
        unit: 'core at its closest to the gate',
        period: `gate ${fmtDegrees(core.gate)}`,
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
