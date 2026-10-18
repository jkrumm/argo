/**
 * Pure derivations for the Garmin Health page: the summary sentence, the strip's numbers and every
 * chart's facts header. No React, no queries — each function takes plain numbers and returns text,
 * so the copy is testable and a null reading is handled once (always `—`, never `0`).
 */

import { APP_LOCALE, NBSP, withUnit } from '../../lib/format'
import { WINDOW_DAYS, activitiesRange } from '../../lib/queries/activities-window'
import type { WindowParams } from '../../lib/queries/daily-metrics'
import { ACWR_ZONE_NAME, type AcwrZone } from './formulas'

const EM_DASH = '—'

/** The fitness regression's window and the VO2max trace's window, fixed regardless of the page selector. */
export const FITNESS_DAYS = 14
export const VO2_DAYS = 180

/** Daily activity target in MET-min — mirrors `ACTIVITY_TARGET_SCORE` in `garmin-formulas.ts`. */
export const ACTIVITY_TARGET_SCORE = 600

/** The recovery cut-offs: below 40 rest, from 70 push. */
export const RECOVERY_REST_BELOW = 40
export const RECOVERY_PUSH_FROM = 70

export type RecoveryVerdict = 'rest' | 'normal' | 'push'

/** Days Home's recovery tile averages and trends over. */
export const RECOVERY_DAYS = 7

/** The cut-off caption both recovery meters print. */
export const RECOVERY_CUTOFF_CAPTION = `rest < ${RECOVERY_REST_BELOW} · push ≥ ${RECOVERY_PUSH_FROM}`

/**
 * The day's recovery verdict: the one derivation Home's tile and Garmin's cell both state. It
 * classifies the rounded score, the number on screen, so 69.9 prints 70 and reads Push.
 */
export function recoveryVerdict(score: number): RecoveryVerdict {
  const shown = Math.round(score)
  if (shown >= RECOVERY_PUSH_FROM) return 'push'
  if (shown >= RECOVERY_REST_BELOW) return 'normal'
  return 'rest'
}

export const RECOVERY_VERDICT_NAME = {
  rest: 'Rest',
  normal: 'Normal',
  push: 'Push',
} as const satisfies Record<RecoveryVerdict, string>

/** Recovery contributor weights in points — `RECOVERY_WEIGHT_*` × 100 in `garmin-formulas.ts`. */
const RECOVERY_WEIGHT_PTS = { hrv: 40, sleep: 35, rhr: 25 } as const

/** ACWR zone cut-offs — `classifyAcwrZone` in `garmin-formulas.ts` (Gabbett 2016). */
export const ACWR_FLOOR = 0.8
export const ACWR_OPTIMAL_TO = 1.3
export const ACWR_CAUTION_TO = 1.5

export const ACWR_METER_MAX = 2

/** The chart legend's zone names, from the same `ACWR_ZONE_NAME` vocabulary the load meters use. */
export const ACWR_LEGEND = {
  undertrained: `${ACWR_ZONE_NAME.undertrained} (< ${ACWR_FLOOR})`,
  optimal: `${ACWR_ZONE_NAME.optimal} (${ACWR_FLOOR}–${ACWR_OPTIMAL_TO})`,
  caution: `${ACWR_ZONE_NAME.caution} (${ACWR_OPTIMAL_TO}–${ACWR_CAUTION_TO})`,
  danger: `${ACWR_ZONE_NAME.danger} (> ${ACWR_CAUTION_TO})`,
} as const satisfies Record<AcwrZone, string>

/** Stress zone edges: below 25 rest, 25–49 low, 50–74 moderate, from 75 high. */
export const STRESS_REST_BELOW = 25
export const STRESS_MODERATE_FROM = 50
export const STRESS_HIGH_FROM = 75

export type StressZone = 'rest' | 'low' | 'moderate' | 'high'

/** One vocabulary for the stress bands: legend labels, tooltip and `stressZone` all read it. */
export const STRESS_ZONE_NAME = {
  rest: 'Rest',
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
} as const satisfies Record<StressZone, string>

/** Legend labels carry the inclusive integer range, so adjacent bands never share a bound. */
export const STRESS_ZONE_LEGEND = {
  rest: `${STRESS_ZONE_NAME.rest} (< ${STRESS_REST_BELOW})`,
  low: `${STRESS_ZONE_NAME.low} (${STRESS_REST_BELOW}–${STRESS_MODERATE_FROM - 1})`,
  moderate: `${STRESS_ZONE_NAME.moderate} (${STRESS_MODERATE_FROM}–${STRESS_HIGH_FROM - 1})`,
  high: `${STRESS_ZONE_NAME.high} (≥ ${STRESS_HIGH_FROM})`,
} as const satisfies Record<StressZone, string>

export function stressZone(v: number): StressZone {
  if (v >= STRESS_HIGH_FROM) return 'high'
  if (v >= STRESS_MODERATE_FROM) return 'moderate'
  if (v >= STRESS_REST_BELOW) return 'low'
  return 'rest'
}

/** The load meter's empty line while the read is pending or a placeholder (no gap to name yet). */
export const LOAD_LOADING_TEXT = 'Loading training load'

/** The load meter's empty line: the gap's own line, or the loading text while there is no gap yet. */
export function loadMeterEmptyText<G>(gap: G | undefined, line: (gap: G) => string): string {
  return gap === undefined ? LOAD_LOADING_TEXT : line(gap)
}

/**
 * The load cell is a bare worded reason only when there is nothing to show: a gap (no ACWR) with
 * no acute/chronic rows. Rows without an ACWR keep the meter, its empty line and the rows.
 */
export function loadCellBranch(input: { gap: unknown; loadRows: number }): 'empty' | 'meter' {
  return input.gap !== undefined && input.loadRows === 0 ? 'empty' : 'meter'
}

/** The recovery cell is a worded reason only when it shows its gap and the gap has a line. */
export function recoveryCellBranch(input: { showsGap: boolean; gap: unknown }): 'empty' | 'meter' {
  return input.showsGap && input.gap !== null ? 'empty' : 'meter'
}

/** Minus sign (U+2212) so a signed figure aligns with `+` in tabular numerals. */
const MINUS = '−'

export function fmtNum(value: number | null | undefined, digits = 0): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? EM_DASH
    : value.toFixed(digits)
}

export function signed(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH
  const text = Math.abs(value).toFixed(digits)
  if (Number(text) === 0) return text
  return `${value > 0 ? '+' : MINUS}${text}`
}

export function mean(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v))
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length
}

export function countWhere(
  values: readonly (number | null)[],
  predicate: (v: number) => boolean,
): { hits: number; days: number } {
  let hits = 0
  let days = 0
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue
    days += 1
    if (predicate(v)) hits += 1
  }
  return { hits, days }
}

/** Last minus first present value — the same delta `fitnessDirection` reports for RHR and HRV. */
export function firstToLast(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v))
  const first = present.at(0)
  const last = present.at(-1)
  return first === undefined || last === undefined ? null : last - first
}

/** Hours with one decimal from seconds. */
export function hoursFromSec(sec: number | null): number | null {
  return sec === null || !Number.isFinite(sec) ? null : sec / 3600
}

/** "45m", "2h", "1h 20m" from minutes; rounded once before splitting, so never "1h 60m". */
export function fmtMinutes(min: number): string {
  if (!Number.isFinite(min)) return EM_DASH
  const total = Math.round(min)
  if (total < 60) return `${total}m`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** A local `YYYY-MM-DD` key. */
function dayKey(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

/** The last `days` calendar days ending today, as explicit `from`/`to` — independent of the page's window. */
export function lastDaysRange(
  days: number,
  today: Date = new Date(),
): { from: string; to: string } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1))
  return { from: dayKey(start), to: dayKey(today) }
}

/**
 * Calendar days in a window, inclusive. An open start (`all`) runs from `floor`; an open end runs to
 * `today`; a start before `floor` is clipped, since nothing earlier is ever shown.
 */
export function windowDayCount(
  range: { dateFrom?: string | undefined; dateTo?: string | undefined },
  floor: string,
  today: Date = new Date(),
): number {
  const start = range.dateFrom !== undefined && range.dateFrom > floor ? range.dateFrom : floor
  const end = range.dateTo ?? dayKey(today)
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)
  return ms < 0 ? 0 : Math.round(ms / 86_400_000) + 1
}

/**
 * The window's length as the selector names it, for copy: a `30d` preset is 30 days (its query
 * range starts 30 days back and so spans 31 calendar days), a custom range counts its days. Clipped
 * at the visible floor like `windowDayCount`.
 */
export function windowCopyDays(
  params: WindowParams,
  floor: string,
  today: Date = new Date(),
): number {
  const counted = windowDayCount(activitiesRange(params, today), floor, today)
  const preset =
    !params.from && !params.to && params.window && params.window !== 'all'
      ? WINDOW_DAYS[params.window]
      : undefined
  return preset === undefined ? counted : Math.min(preset, counted)
}

/** One day-month order for every date the page prints: the page locale's, like basalt's chart ticks and tooltip (`4 Oct`). */
const DAY_MONTH = new Intl.DateTimeFormat(APP_LOCALE, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** "14 Oct" from a `YYYY-MM-DD` key; anything that is not a real calendar day comes back raw. */
export function shortDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (match === null) return date
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const at = new Date(Date.UTC(y, m - 1, d))
  // Round-trip: `2026-02-31` and `2026-10-00` roll into another month and must not be printed as one.
  const real = at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d
  return real ? DAY_MONTH.format(at) : date
}

/**
 * What a header may call the point it shows, from that point's own date: a day reading dated today is
 * "today", sleep dated today is "last night" (the night that ended this morning), anything else is its
 * short date — so a historical window, a hidden today or a sync gap never claims a day it is not.
 */
export function dayLabel(
  date: string | null | undefined,
  kind: 'day' | 'night' = 'day',
  today: Date = new Date(),
): string {
  if (date === null || date === undefined) return EM_DASH
  if (date === dayKey(today)) return kind === 'night' ? 'last night' : 'today'
  return shortDate(date)
}

/** The recovery cell's kicker qualifier: the score's own day, none when the read carries no date. */
export const recoveryQualifier = (date: string | null | undefined): string | undefined =>
  date ? dayLabel(date) : undefined

/** The fixed window the fitness regression and its rows read; the loader prefetches this same key. */
export function fitnessRange(today: Date = new Date()): { from: string; to: string } {
  return lastDaysRange(FITNESS_DAYS, today)
}

/** The Fitness hero: the 180 d trace's latest reading, else the regression's own figure. */
export function vo2Hero(
  trace: readonly number[],
  fallback: number | null | undefined,
): number | null {
  return trace.at(-1) ?? fallback ?? null
}

// ── Page summary ───────────────────────────────────────────────────────────

/** Where the ratio sits against the optimal band, as the phrase the summary uses. */
export function acwrRelation(acwr: number | null): string {
  if (acwr === null) return EM_DASH
  if (acwr < ACWR_FLOOR) return `under the ${ACWR_FLOOR} floor`
  if (acwr <= ACWR_OPTIMAL_TO) return `inside the ${ACWR_FLOOR}–${ACWR_OPTIMAL_TO} optimal band`
  if (acwr <= ACWR_CAUTION_TO) return `over the ${ACWR_OPTIMAL_TO} ceiling`
  return `past the ${ACWR_CAUTION_TO} danger line`
}

export type QueryStatus = 'pending' | 'error' | 'success'

export type SummaryInput = {
  recovery: number | null
  /** The snapshot's own date; names the day a missing recovery is missing for. */
  recoveryDate?: string | null
  /** The recovery query's state; a failed load never reads as a data gap. Default `success`. */
  recoveryStatus?: QueryStatus
  acwr: number | null
}

/**
 * The page's opening: the headline answers "how recovered and how loaded". The ACWR figure and the
 * fitness deltas live in the strip cells below, so no facts line repeats them.
 */
export function summaryParts({
  recovery,
  recoveryDate,
  recoveryStatus = 'success',
  acwr,
}: SummaryInput): {
  sentence: string
} {
  const load = acwr === null ? null : `load ${acwrRelation(acwr)}`
  return { sentence: recoverySentence({ recovery, recoveryDate, recoveryStatus, load }) }
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * The headline: a present score leads and the load follows; otherwise what is known (the load) leads
 * and the missing score states its reason or its load state, so the sentence is never empty.
 */
export function recoverySentence(input: {
  recovery: number | null
  recoveryDate?: string | null | undefined
  recoveryStatus?: QueryStatus | undefined
  /** The load clause, e.g. `load under the 0.8 floor`; `null` when ACWR is unknown. */
  load: string | null
}): string {
  if (input.recovery !== null) {
    return [`Recovery ${fmtNum(input.recovery)}/100`, input.load].filter(Boolean).join(', ')
  }
  const { headline } = recoveryGap({ date: input.recoveryDate, status: input.recoveryStatus })
  return capitalize([input.load, headline].filter(Boolean).join('; '))
}

/** The newest finite recovery score among already-filtered points (ascending by date) and the date it was scored on. */
export function lastScored(
  points: readonly { date: string; recovery: number | null }[],
): { value: number; date: string } | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]
    if (p?.recovery != null && Number.isFinite(p.recovery)) {
      return { value: p.recovery, date: p.date }
    }
  }
  return null
}

/** The Garmin sync sidecar's cadence, hours: every "fills after the next sync" claim reads this. */
export const GARMIN_SYNC_HOURS = 6

/** `this 30 d window`; `this window` when the length is unknown. */
const thisWindow = (windowDays: number): string =>
  windowDays > 0 ? `this ${withUnit(windowDays, 'd')} window` : 'this window'

/** The next step for any gap in Garmin data: a sync is the only thing that fills it. */
const SYNC_CADENCE = `Garmin syncs every ${withUnit(GARMIN_SYNC_HOURS, 'h')}`
const SYNC_NEXT_STEP = ` — ${SYNC_CADENCE}`

/**
 * The one Garmin gap pair (docs/design/README.md § One form for a repeated gap). `short` is the
 * sentence's leading clause, verbatim; `full` adds the cadence/next step. `full` is `null` for a
 * line that is not a data gap (a failed read names its own cause): it never takes the screen's one
 * full form. {@link allocateForms} decides which surface prints `full`.
 */
export type Gap = { short: string; full: string | null }
export type GapForm = 'full' | 'short'

/** A data gap: the clause, and the clause plus the sync cadence. */
const dataGap = (clause: string, full = `${clause}${SYNC_NEXT_STEP}`): Gap => ({
  short: clause,
  full,
})

/** A line that is not a data gap (a failure, a loading line): one wording, no cadence to carry. */
export const plainGap = (text: string): Gap => ({ short: text, full: null })

/** Cadence only, no clause of its own (Home's unsettled recovery footer): it carries the cadence as is. */
export const cadenceGap: Gap = { short: SYNC_CADENCE, full: SYNC_CADENCE }

/**
 * The one allocation rule, in reading order: the first surface whose gap can carry the cadence
 * prints the `full` sentence, every other surface its `short` form. A surface without a gap
 * (`null`/`undefined`) or with a plain line never takes the slot.
 */
export function allocateForms(gaps: readonly (Gap | null | undefined)[]): GapForm[] {
  const lead = gaps.findIndex((g) => g?.full != null)
  return gaps.map((_, i) => (i === lead ? 'full' : 'short'))
}

/** The line a surface prints for its allocated form. */
export const gapLine = (gap: Gap, form: GapForm): string =>
  form === 'full' && gap.full !== null ? gap.full : gap.short

/**
 * An empty chart card's one wording: what is missing, the window it is missing from, and the next
 * step. The cause is always the same: no synced day in the window.
 */
export const chartEmpty = (metric: string, windowDays: number): Gap =>
  dataGap(`No ${metric} in ${thisWindow(windowDays)}`)

/** The recovery gap's noun: the strip cell and the recovery chart both build their clause from it. */
export const RECOVERY_GAP_METRIC = 'recovery score'

/**
 * What the load cell says when it has no ratio, once (the meter's empty line; the cell has no
 * footer or bar list for it). A loading or placeholder read is never a data gap: it has no copy, a
 * failure says so, and only a settled read without a ratio states the gap.
 */
export function loadGap(input: {
  acwr: number | null
  status: QueryStatus
  placeholder: boolean
  windowDays: number
}): Gap | undefined {
  const { acwr, status, placeholder, windowDays } = input
  if (status === 'error') return plainGap('The training load failed to load')
  if (status === 'pending' || acwr !== null || placeholder) return undefined
  return chartEmpty('training load', windowDays)
}

/**
 * What the fitness cell says when none of its reads holds a reading, once (its meter's empty
 * line). The reads span two windows (RHR/HRV over {@link FITNESS_DAYS}, VO2max over
 * {@link VO2_DAYS}), so the wording names both. A pending or placeholder read has no copy and a
 * failure says so, mirroring {@link loadGap}.
 */
export function fitnessGap(input: {
  status: QueryStatus
  placeholder: boolean
  hasReading: boolean
}): Gap | undefined {
  const { status, placeholder, hasReading } = input
  // Readings that did load stay: a partial failure replaces the cell only when nothing is left to show.
  if (hasReading) return undefined
  if (status === 'error') return plainGap('The fitness readings failed to load')
  if (status === 'pending' || placeholder) return undefined
  return dataGap(
    `No RHR or HRV in this ${withUnit(FITNESS_DAYS, 'd')} window and no VO2max in ${withUnit(VO2_DAYS, 'd')}`,
  )
}

/**
 * Why there is no recovery score, worded once for both places that say so: the headline clause and
 * the recovery cell's line. A failed read is its own wording, never the data gap. `line` is `null`
 * until the reads settle (a loading cell is not a data gap). The unscored-input detail sits in the
 * full form only, between the clause and the cadence.
 */
export function recoveryGap(input: {
  date?: string | null | undefined
  status?: QueryStatus | undefined
  /** Both recovery reads have settled on the selected window. */
  settled?: boolean
  /** The newest scored day in the window, if any. */
  last?: { value: number; date: string } | null
  windowDays?: number
  /** The inputs the unscored day could not score from, e.g. `['HRV', 'sleep']`; empty names nothing. */
  missing?: readonly RecoveryInput[]
  today?: Date
}): { headline: string; line: Gap | null } {
  const {
    date,
    status = 'success',
    settled = false,
    last = null,
    windowDays = 0,
    missing = [],
  } = input
  const today = input.today ?? new Date()
  if (status === 'pending') return { headline: 'recovery loading', line: null }
  if (status === 'error') {
    const headline = 'the recovery score failed to load'
    return { headline, line: plainGap(capitalize(headline)) }
  }
  const day = date == null ? 'the latest day' : dayLabel(date, 'day', today)
  const headline = `no recovery score for ${day}`
  if (!settled) return { headline, line: null }
  // The suffix is about the unscored day (`date`), never the last scored one; no date, no subject.
  const why =
    date != null && missing.length > 0
      ? `${NBSP}· ${dayLabel(date, 'day', today).replaceAll(' ', NBSP)}: ${missing.join(', ')} not scored`
      : ''
  const clause =
    last !== null
      ? `Last scored ${fmtNum(last.value)}/100 on ${dayLabel(last.date).replaceAll(' ', NBSP)}`
      : chartEmpty(RECOVERY_GAP_METRIC, windowDays).short
  return { headline, line: dataGap(clause, `${clause}${why}${SYNC_NEXT_STEP}`) }
}

// ── Strip ──────────────────────────────────────────────────────────────────

export type RecoveryInput = 'HRV' | 'sleep' | 'RHR'

type Components = { hrv: number | null; sleep: number | null; rhr: number | null }

/** The recovery inputs a day did not measure, in the order the cell lists them. */
export function missingInputs(components: Components): RecoveryInput[] {
  return [
    ...(components.hrv === null ? (['HRV'] as const) : []),
    ...(components.sleep === null ? (['sleep'] as const) : []),
    ...(components.rhr === null ? (['RHR'] as const) : []),
  ]
}

/** Contributor rows as points of their weight. A component that did not measure is left out. */
export function contributorItems(components: Components) {
  const rows = [
    { label: 'HRV', value: components.hrv, weight: RECOVERY_WEIGHT_PTS.hrv },
    { label: 'Sleep', value: components.sleep, weight: RECOVERY_WEIGHT_PTS.sleep },
    { label: 'RHR', value: components.rhr, weight: RECOVERY_WEIGHT_PTS.rhr },
  ]
  return rows.flatMap((r) =>
    r.value === null
      ? []
      : [
          {
            label: r.label,
            value: r.value,
            max: r.weight,
            key: r.label,
          },
        ],
  )
}

// ── Chart facts headers ────────────────────────────────────────────────────

export type Fact = {
  /** The headline figure, already formatted. */
  value: string
  /** Its unit; muted next to the value. */
  unit?: string
  /** Comparison and period, in reading order, `·`-separated on screen. */
  context: readonly string[]
}

const days = (n: number): string => `${n} d`

export function activitiesFact(input: {
  sessions: number
  totalMin: number
  dayCount: number
}): Fact {
  return {
    value: String(input.sessions),
    unit: input.sessions === 1 ? 'session' : 'sessions',
    // Without a window length there is no rate and no period to state; never "last 0 d".
    context:
      input.dayCount > 0
        ? [
            fmtMinutes(input.totalMin),
            `${((input.sessions / input.dayCount) * 7).toFixed(1)} sessions per week`,
            `last ${days(input.dayCount)}`,
          ]
        : [fmtMinutes(input.totalMin)],
  }
}

export function acwrFact(input: {
  acwr: number | null
  zoneLabel: string
  inZone: number
  dayCount: number
}): Fact {
  return {
    value: fmtNum(input.acwr, 2),
    unit: 'ACWR',
    context: [
      input.zoneLabel.toLowerCase() || EM_DASH,
      `${input.inZone} of ${days(input.dayCount)} in the optimal zone`,
    ],
  }
}

export function divergenceFact(input: { divergence: number | null; when: string }): Fact {
  return {
    value: signed(input.divergence, 1),
    unit: 'MET-min/day',
    context: ['acute minus chronic', input.when],
  }
}

export function recoveryFact(input: { mean: number | null; high: number; dayCount: number }): Fact {
  return {
    value: fmtNum(input.mean),
    unit: '/100 mean',
    context: [`${input.high} of ${days(input.dayCount)} ≥ ${RECOVERY_PUSH_FROM}`],
  }
}

export function sleepFact(input: {
  /** From `dayLabel(date, 'night')`. */
  when: string
  hours: number | null
  score: number | null
  meanHours: number | null
  dayCount: number
}): Fact {
  return {
    value: fmtNum(input.hours, 1),
    unit: `h ${input.when}`,
    context: [
      `score ${fmtNum(input.score)}/100`,
      `${fmtNum(input.meanHours, 1)} h mean over ${days(input.dayCount)}`,
    ],
  }
}

export function bodyBatteryFact(input: {
  /** From `dayLabel(date)`. */
  when: string
  net: number | null
  mean: number | null
  high: number | null
  low: number | null
  dayCount: number
}): Fact {
  return {
    value: signed(input.net),
    unit: `pts net ${input.when}`,
    context: [
      `${signed(input.mean)} pts mean over ${days(input.dayCount)}`,
      `high ${fmtNum(input.high)}/100, low ${fmtNum(input.low)}/100`,
    ],
  }
}

export function stressFact(input: { stress: number | null; rest: number; dayCount: number }): Fact {
  return {
    value: fmtNum(input.stress),
    unit: '/100 avg stress',
    context: [`${input.rest} of ${days(input.dayCount)} in the rest zone (< ${STRESS_REST_BELOW})`],
  }
}

export function activityScoreFact(input: {
  /** From `dayLabel(date)`. */
  when: string
  score: number | null
  mean: number | null
  dayCount: number
}): Fact {
  const pct =
    input.score === null ? EM_DASH : String(Math.round((input.score / ACTIVITY_TARGET_SCORE) * 100))
  return {
    value: fmtNum(input.score),
    unit: `MET-min ${input.when}`,
    context: [
      `${pct} % of the ${ACTIVITY_TARGET_SCORE} target`,
      `${fmtNum(input.mean)} MET-min mean over ${days(input.dayCount)}`,
    ],
  }
}
