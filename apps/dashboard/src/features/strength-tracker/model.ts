/**
 * Pure derivations for the Strength page. Every figure a sentence repeats is computed here once, so
 * the summary, the verdict card and the lift cells cannot disagree. Unknown is `null` (rendered `—`),
 * never 0.
 */
import { format } from 'date-fns'
import {
  ACWR_CAUTION_TO,
  ACWR_FLOOR,
  ACWR_OPTIMAL_TO,
  READINESS_PUSH_FROM,
  READINESS_REST_BELOW,
} from './bands'
import { exerciseLabel, type RatioStatus } from './formulas'

export const EM_DASH = '—'
export const DELTA_DAYS = 28
const DAY_MS = 86_400_000

export type Point = { date: string; e1rm: number | null; inol: number | null }
export type LiftSeries = { exercise_id: string; points: readonly Point[] }

const isNum = (v: number | null | undefined): v is number => typeof v === 'number'

// ── Today's call ─────────────────────────────────────────────────────────────────────────────

export type ReadinessReading = {
  score: number | null
  verdict: 'Push' | 'Normal' | 'Rest'
  driver: string | null
  /** `YYYY-MM-DD` of the reading, null when the series names none. */
  date: string | null
}
export type DeloadReading = {
  /** `stale`: no session inside the delta window, so the signals describe a past state. */
  verdict: 'deload' | 'monitor' | 'progress' | 'stale'
  activeSignals: readonly string[]
}
export type TodaysCall = {
  /** `Push`, `Normal`, `Rest`, `Deload`, or `—` when neither source reports. */
  verdict: string
  title: string
  /** The deload signal overrode the readiness verdict (conservative wins). */
  overridden: boolean
  /** An active `monitor` signal caps `Push` at `Normal`; it names the signal. */
  monitor: string | null
  /** The verdict readiness alone gave, before any deload cap or override. */
  readinessVerdict: string
  /** `16 Oct` when the reading is not from today; null when it is. */
  asOf: string | null
}

/** The viewer's local `YYYY-MM-DD` for a timestamp. */
export function localIso(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The conservative verdict wins: `deload` overrides readiness, an active `monitor` signal caps
 * `Push` at `Normal`, and a stale signal changes nothing. The call is never `Push` beside an
 * active signal.
 */
export function todaysCall(
  readiness: ReadinessReading | null,
  deload: DeloadReading | undefined,
  now: number,
): TodaysCall {
  const stale = readiness?.date != null && readiness.date !== localIso(now)
  const asOf = stale && readiness?.date != null ? shortDate(readiness.date) : null
  const readinessVerdict =
    readiness === null || readiness.score === null ? EM_DASH : readiness.verdict
  if (deload?.verdict === 'deload') {
    return {
      verdict: 'Deload',
      title: 'Today: Deload',
      overridden: true,
      monitor: null,
      readinessVerdict,
      asOf,
    }
  }
  const monitor = deload?.verdict === 'monitor' ? (deload.activeSignals[0] ?? null) : null
  const verdict = monitor !== null && readinessVerdict === 'Push' ? 'Normal' : readinessVerdict
  return {
    verdict,
    title: asOf === null ? `Today: ${verdict}` : `Latest: ${verdict} · ${asOf}`,
    overridden: false,
    monitor,
    readinessVerdict,
    asOf,
  }
}

/** The newest session date over all lifts. */
export function lastSessionDate(lifts: readonly LiftSeries[]): string | null {
  return lifts
    .flatMap((l) => l.points.filter((p) => isNum(p.e1rm)).map((p) => p.date))
    .reduce<string | null>((a, b) => (a === null || b > a ? b : a), null)
}

/** Deload signals describe the trailing 90 d; with no session in the delta window they are stale. */
export function recentDeload(
  deload: DeloadReading | undefined,
  lastDate: string | null,
  now: number,
): DeloadReading | undefined {
  if (deload === undefined) return undefined
  const recent = lastDate !== null && Date.parse(lastDate) > now - DELTA_DAYS * DAY_MS
  return recent ? deload : { verdict: 'stale', activeSignals: [] }
}

/** The last non-null point of the readiness series, as the verdict card reads it. */
export function readinessReading(
  points: readonly { date?: string; readiness: number | null; driver: string | null }[],
): ReadinessReading | null {
  const last = points.findLast((p) => isNum(p.readiness))
  if (last === undefined || !isNum(last.readiness)) return null
  const verdict =
    last.readiness >= READINESS_PUSH_FROM
      ? 'Push'
      : last.readiness >= READINESS_REST_BELOW
        ? 'Normal'
        : 'Rest'
  return { score: last.readiness, verdict, driver: last.driver, date: last.date ?? null }
}

/**
 * The deload signal as a card line. A stale signal is explained by the facts line's last session
 * when that line shows one (`lastSessionShown`); without it the line keeps its own explanation.
 */
export function deloadLine(
  deload: DeloadReading | undefined,
  { lastSessionShown, lastDate }: { lastSessionShown: boolean; lastDate: string | null },
): string | null {
  if (deload === undefined) return `Deload signal: ${EM_DASH}`
  const signals = deload.activeSignals.join('; ')
  switch (deload.verdict) {
    case 'stale':
      return lastSessionShown
        ? null
        : `Deload signal: no recent sessions${lastDate === null ? '' : `, last was ${shortDate(lastDate)}`}`
    case 'deload':
      return `Deload signal: deload — ${signals}`
    case 'monitor':
      return `Deload signal: monitor — ${signals}`
    default:
      return 'Deload signal: none active'
  }
}

/** `88/100`, its zone and its date, read by the call card, the summary and the readiness header. */
export function readinessHeader(
  reading: ReadinessReading | null,
): { text: string; verdict: string; date: string | null } | null {
  if (reading === null || reading.score === null) return null
  return {
    text: `${Math.round(reading.score)}/100`,
    verdict: reading.verdict,
    date: reading.date === null ? null : shortDate(reading.date),
  }
}

// ── ACWR ─────────────────────────────────────────────────────────────────────────────────────

/** EWMA smoothing for the 4 wk and 16 wk spans (`2 / (span + 1)`). */
const ACUTE_ALPHA = 2 / 5
const CHRONIC_ALPHA = 2 / 17

export type AcwrLift = {
  points: readonly { date: string; acute: number; chronic: number; acwr: number | null }[]
}
export type AcwrReading = {
  /** Total-tonnage ACWR; null when no week is measured or the newest one is older than the window. */
  acwr: number | null
  /** The newest measured week (`YYYY-MM-DD`), kept even when stale so the copy can name it. */
  week: string | null
}

/**
 * Total-tonnage ACWR: summed acute EWMA over summed chronic EWMA for ONE week (the newest any lift
 * was measured), so a heavy lift weighs more than a light one. A lift not trained that week is
 * carried forward with zero tonnage. Older than the delta window it is unknown, not current. The card, the summary sentence
 * and the chart header all read this one function.
 */
export function acwrReading(lifts: readonly AcwrLift[], now: number): AcwrReading {
  const week = lifts
    .flatMap((l) => l.points.filter((p) => isNum(p.acwr)).map((p) => p.date))
    .reduce<string | null>((a, b) => (a === null || b > a ? b : a), null)
  if (week === null) return { acwr: null, week: null }
  if (Date.parse(week) + 7 * DAY_MS <= now - DELTA_DAYS * DAY_MS) return { acwr: null, week }
  let acute = 0
  let chronic = 0
  for (const l of lifts) {
    const p = l.points.findLast((q) => isNum(q.acwr) && q.date <= week)
    if (p === undefined) continue
    // A lift not trained since `p.date` has had zero-tonnage weeks: its EWMAs decay by (1 - alpha)
    // each, alpha = 2 / (span + 1), mirroring `ewmaSeries` in strength-formulas.ts.
    const missed = Math.round((Date.parse(week) - Date.parse(p.date)) / (7 * DAY_MS))
    acute += p.acute * (1 - ACUTE_ALPHA) ** missed
    chronic += p.chronic * (1 - CHRONIC_ALPHA) ** missed
  }
  return { acwr: chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null, week }
}

export function acwrZoneWord(acwr: number | null): string {
  if (acwr === null) return EM_DASH
  if (acwr < ACWR_FLOOR) return 'undertrained'
  if (acwr <= ACWR_OPTIMAL_TO) return 'optimal'
  if (acwr <= ACWR_CAUTION_TO) return 'caution'
  return 'danger'
}

/** The headline fact's prefix. */
export const ACWR_LABEL = 'ACWR'

export const ACWR_METHOD = '4 wk / 16 wk EWMA of weekly tonnage, all lifts summed'

// ── Lifts ────────────────────────────────────────────────────────────────────────────────────

export function latestE1rm(points: readonly Point[]): number | null {
  return points.findLast((p) => isNum(p.e1rm))?.e1rm ?? null
}

/**
 * `stale`: no session inside the window. The reason is the strip's one note (`staleNote`); the
 * phrase then carries the date of the last session, which the headline keeps as its qualifier.
 */
export type LiftDelta = {
  delta: number | null
  phrase: string
  stale: boolean
  /** The window the move is measured over, in days. */
  days: number
}

/** e1RM now minus e1RM as of 28 d ago, or the reason there is no figure. */
export function liftDelta(points: readonly Point[], now: number, days = DELTA_DAYS): LiftDelta {
  const sessions = points.filter((p) => isNum(p.e1rm))
  const last = sessions.at(-1)
  if (last === undefined || !isNum(last.e1rm)) {
    return { delta: null, phrase: 'no sessions yet', stale: false, days }
  }
  const cutoff = now - days * DAY_MS
  // No session inside the window: "unchanged" would be a claim the data does not make.
  if (Date.parse(last.date) <= cutoff) {
    return { delta: null, phrase: `last scored session ${shortDate(last.date)}`, stale: true, days }
  }
  const base = sessions.findLast((p) => Date.parse(p.date) <= cutoff)
  if (base === undefined || !isNum(base.e1rm)) {
    const first = sessions[0]
    return {
      delta: null,
      phrase: `first session ${shortDate(first?.date ?? last.date)}`,
      stale: false,
      days,
    }
  }
  const delta = Math.round((last.e1rm - base.e1rm) * 10) / 10
  return { delta, phrase: `${signed(delta)} kg in ${days} d`, stale: false, days }
}

/**
 * The strip cell's one footer line: the personal record (kg and day), led by the reason there is
 * no 28 d move when the badge is absent. A stale lift's reason is the strip's shared note, so its
 * cell carries the record alone. Never explains the sparkline.
 */
export function liftFooter(input: {
  delta: LiftDelta
  prKg: number | null
  prDate: string | null
}): string {
  const { delta, prKg, prDate } = input
  const record =
    prKg === null
      ? null
      : `PR ${prKg.toFixed(1)} kg${prDate === null ? '' : ` · ${shortDate(prDate)}`}`
  // A move that cannot be computed is explained on the cell, except a stale lift: the strip's note does that.
  const reasonOnCell = delta.delta === null && !delta.stale
  const parts = (reasonOnCell ? [delta.phrase, record] : [record]).filter(
    (v): v is string => v !== null && v !== '',
  )
  return parts.length === 0 ? EM_DASH : parts.join(' · ')
}

export type CallFactsInput = {
  asOf: string | null
  driver: string | null
  session: { exercise_id: string; date: string; inol: number } | null
}

/** The one note for lifts with no session in the delta window; null when every lift has one. */
export function staleNote(lifts: readonly { id: string; delta: LiftDelta }[]): string | null {
  const stale = lifts.filter((l) => l.delta.stale)
  if (stale.length === 0) return null
  // Only sessions with a scored e1RM move the figure; a session without one does not count.
  const days = stale[0]?.delta.days ?? DELTA_DAYS
  if (stale.length === lifts.length) return `Every lift: no scored e1RM in ${days} d`
  return `No scored e1RM in ${days} d: ${stale.map((l) => exerciseLabel(l.id)).join(', ')}`
}

/** The call card's facts line, split around the INOL figure (which carries its own definition). */
export function callFacts({ asOf, driver, session }: CallFactsInput): {
  text: string
  inol: string | null
} {
  const parts = [
    ...(asOf === null ? [] : [`latest ${asOf}`]),
    ...(driver ? [`driver ${driver}`] : []),
    ...(session === null
      ? []
      : [`last session ${exerciseLabel(session.exercise_id)}, ${dayLabel(session.date)}`]),
  ]
  return {
    text: parts.join(' · '),
    inol: session === null ? null : `INOL ${session.inol.toFixed(2)}`,
  }
}

/** The API's `%/day` velocity as the page's one unit, `%/mo`. */
export function perMonth(pctPerDay: number | null): number | null {
  return pctPerDay === null ? null : Math.round(pctPerDay * 30 * 10) / 10
}

/** The unrounded monthly rate, for bars: rounding belongs to the display (`fmtMonthly`). */
export const perMonthRaw = (pctPerDay: number): number => pctPerDay * 30

/** `+1.2` / `−0.4` / `0.0`: rounds first, so a rate that displays as zero carries no sign. */
export function fmtMonthly(v: number): string {
  const rounded = Math.round(v * 10) / 10
  return rounded === 0 ? '0.0' : signed(rounded)
}

export function signed(v: number | null, digits = 1): string {
  if (v === null) return EM_DASH
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`
}

/** The most recent session over all lifts, with its INOL. */
export function lastSession(
  lifts: readonly LiftSeries[],
): { exercise_id: string; date: string; inol: number } | null {
  let best: { exercise_id: string; date: string; inol: number } | null = null
  for (const l of lifts) {
    const p = l.points.findLast((q) => isNum(q.inol))
    if (p !== undefined && isNum(p.inol) && (best === null || p.date > best.date)) {
      best = { exercise_id: l.exercise_id, date: p.date, inol: p.inol }
    }
  }
  return best
}

// ── Summary sentence ─────────────────────────────────────────────────────────────────────────

export type SummaryFact = { kind: 'acwr' | 'plain'; text: string }

export function summaryParts(input: {
  leader: string | null
  e1rm: number | null
  delta: LiftDelta
  acwr: number | null
  call: TodaysCall
  score: number | null
}): { sentence: string; facts: SummaryFact[] } {
  const { leader, e1rm, delta, acwr, call, score } = input
  const load: SummaryFact = {
    kind: 'acwr',
    text:
      acwr === null ? `${ACWR_LABEL} —` : `${ACWR_LABEL} ${acwr.toFixed(2)} ${acwrZoneWord(acwr)}`,
  }
  const figure = `readiness ${score === null ? EM_DASH : `${Math.round(score)}/100`}`
  const when = call.asOf === null ? '' : `, ${call.asOf}`
  const ready =
    call.verdict === call.readinessVerdict
      ? `${figure} ${call.readinessVerdict}${when}`
      : `${figure} (${call.readinessVerdict})${when}, ${
          call.overridden
            ? `overridden to ${call.verdict} by the deload signal`
            : `capped to ${call.verdict} by a monitor signal`
        }`
  // The headline is the leader lift's e1RM and its move; without one, the call leads.
  if (leader === null || e1rm === null) {
    return { sentence: ready.charAt(0).toUpperCase() + ready.slice(1), facts: [load] }
  }
  return {
    sentence: `${exerciseLabel(leader)} e1RM ${e1rm.toFixed(1)} kg, ${delta.phrase}`,
    facts: [load, { kind: 'plain', text: ready }],
  }
}

// ── Balance ──────────────────────────────────────────────────────────────────────────────────

const NAMES: Record<string, string> = {
  DL: 'Deadlift',
  Squat: 'Squat',
  Bench: 'Bench press',
  'Pull-up': 'Pull-up',
  BW: 'body weight',
}

/** `DL / Squat` → `Deadlift / Squat`: the API abbreviates, the page names the lifts. */
export function ratioName(label: string): string {
  return label
    .split(' / ')
    .map((part) => NAMES[part] ?? part)
    .join(' / ')
}

/**
 * The API calls a ratio `balanced` up to this fraction outside its band (`computeRatioStatus` in
 * apps/api/src/lib/strength-formulas.ts); mirrored here, the one place in the dashboard, like the
 * 40 / 70 readiness thresholds above.
 */
export const RATIO_TOLERANCE = 0.15

export type StatusWord = RatioStatus | 'borderline' | typeof EM_DASH

/** The API says `balanced` within the tolerance; outside the band itself that is only borderline. */
export function isBorderline(status: RatioStatus | null, offset: number | null): boolean {
  return status === 'balanced' && offset !== null && offset !== 0
}

/** Inside the band is `balanced` whatever the API says; a tolerance-only `balanced` is borderline. */
export function statusWord(status: RatioStatus | null, offset: number | null): StatusWord {
  if (status === null || offset === null) return EM_DASH
  if (offset === 0) return 'balanced'
  return status === 'balanced' ? 'borderline' : status
}

/** The words after the verdict: how far from the band, and for a borderline ratio the tolerance. */
export function ratioDetail(
  status: RatioStatus | null,
  offset: number | null,
  range: readonly [number, number],
): string {
  const detail = offText(offset, range)
  return isBorderline(status, offset)
    ? `${detail}, within ${Math.round(RATIO_TOLERANCE * 100)} % of its nearest edge`
    : detail
}

/** Unrounded: a ratio a hair outside the band is outside it. */
export function bandOffset(
  ratio: number | null,
  [lo, hi]: readonly [number, number],
): number | null {
  if (ratio === null) return null
  if (ratio < lo) return ratio - lo
  if (ratio > hi) return ratio - hi
  return 0
}

/** A band bound with at least one decimal: `1.0`, `1.25`. */
export const fmtBound = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v))

/** `0.12 under the 0.8–1.0 band`, `inside the 0.8–1.0 band`, `—`. */
export function offText(offset: number | null, [lo, hi]: readonly [number, number]): string {
  if (offset === null) return EM_DASH
  const band = `${fmtBound(lo)}–${fmtBound(hi)} band`
  if (offset === 0) return `inside the ${band}`
  const size = Math.abs(offset) < 0.005 ? '<0.01' : Math.abs(offset).toFixed(2)
  return `${size} ${offset < 0 ? 'under' : 'over'} the ${band}`
}

// ── Records ──────────────────────────────────────────────────────────────────────────────────

export type RecordRow = { date: string }
export type DayGroup<T extends RecordRow> = { date: string; rows: T[] }

/** Records arrive newest first; consecutive rows with one date form a day. */
export function groupByDay<T extends RecordRow>(records: readonly T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  for (const r of records) {
    const last = groups.at(-1)
    if (last !== undefined && last.date === r.date) last.rows.push(r)
    else groups.push({ date: r.date, rows: [r] })
  }
  return groups
}

/**
 * `Fri 16 Oct` for a `YYYY-MM-DD` day (parsed as a local date, never shifted by the zone). date-fns,
 * not `Intl`: ICU's en-GB month abbreviations differ by runtime (`Sept` on newer ICU), the app's are fixed.
 */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return format(new Date(y, m - 1, d), 'EEE d MMM')
}

/** `13 Aug` for a `YYYY-MM-DD` day. */
export function shortDate(date: string): string {
  return dayLabel(date).split(' ').slice(1).join(' ')
}

/** Section period from the page window: `90 days`, `all time`, or the custom range. */
export function periodLabel(window: string, from?: string, to?: string): string {
  if (window === 'all') return 'all time'
  if (window === 'custom')
    return from !== undefined && to !== undefined ? `${from} – ${to}` : 'custom range'
  const m = /^(\d+)([dmy])$/.exec(window)
  if (m === null) return window.toUpperCase()
  const n = Number(m[1])
  const unit = { d: 'day', m: 'month', y: 'year' }[m[2] as 'd' | 'm' | 'y']
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}
