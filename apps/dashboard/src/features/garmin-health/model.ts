/**
 * Pure derivations for the Garmin Health page: the summary sentence, the strip's numbers and every
 * chart's facts header. No React, no queries — each function takes plain numbers and returns text,
 * so the copy is testable and a null reading is handled once (always `—`, never `0`).
 */

export const EM_DASH = '—'

/** Daily activity target in MET-min — mirrors `ACTIVITY_TARGET_SCORE` in `garmin-formulas.ts`. */
export const ACTIVITY_TARGET_SCORE = 600

/** The rest/push cut-offs of `recoveryActionLabel`: below 40 rest, from 70 push. */
export const RECOVERY_REST_BELOW = 40
export const RECOVERY_PUSH_FROM = 70

/** Recovery contributor weights in points — `RECOVERY_WEIGHT_*` × 100 in `garmin-formulas.ts`. */
export const RECOVERY_WEIGHT_PTS = { hrv: 40, sleep: 35, rhr: 25 } as const

/** ACWR zone cut-offs — `classifyAcwrZone` in `garmin-formulas.ts` (Gabbett 2016). */
export const ACWR_FLOOR = 0.8
export const ACWR_OPTIMAL_TO = 1.3
export const ACWR_CAUTION_TO = 1.5
export const ACWR_METER_MAX = 2

/** Stress below this is the "rest" zone (`stressZoneLabel`). */
export const STRESS_REST_BELOW = 25

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
    if (v === null) continue
    days += 1
    if (predicate(v)) hits += 1
  }
  return { hits, days }
}

/** Last minus first present value — the same delta `fitnessDirection` reports for RHR and HRV. */
export function firstToLast(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null)
  const first = present.at(0)
  const last = present.at(-1)
  return first === undefined || last === undefined ? null : last - first
}

/** Hours with one decimal from seconds. */
export function hoursFromSec(sec: number | null): number | null {
  return sec === null ? null : sec / 3600
}

/** "45m", "2h", "1h 20m" from minutes. */
export function fmtMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
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

export type SummaryInput = {
  recovery: number | null
  acwr: number | null
  rhrDelta: number | null
  hrvDelta: number | null
}

/** The one-line page summary: three live numbers, each with its unit and scale. */
export function summarySentence({ recovery, acwr, rhrDelta, hrvDelta }: SummaryInput): string {
  const load = acwr === null ? EM_DASH : `${acwr.toFixed(2)} ACWR, ${acwrRelation(acwr)}`
  return (
    `Recovery ${fmtNum(recovery)}/100 · load ${load} · ` +
    `RHR ${signed(rhrDelta)} bpm and HRV ${signed(hrvDelta)} ms over 14 d`
  )
}

// ── Strip ──────────────────────────────────────────────────────────────────

type Components = { hrv: number | null; sleep: number | null; rhr: number | null }

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
      : [{ label: r.label, value: r.value, secondary: `/ ${r.weight} pts`, key: r.label }],
  )
}

/** Whether a delta is the good direction. RHR down and HRV up are good; the sign alone is not. */
export type DeltaDirection = 'up-good' | 'up-bad'

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
    context: [fmtMinutes(input.totalMin), `last ${days(input.dayCount)}`],
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

export function divergenceFact(input: { divergence: number | null }): Fact {
  return {
    value: signed(input.divergence, 1),
    unit: 'MET-min/day',
    context: ['acute minus chronic', 'today'],
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
  hours: number | null
  score: number | null
  meanHours: number | null
  dayCount: number
}): Fact {
  return {
    value: fmtNum(input.hours, 1),
    unit: 'h last night',
    context: [
      `score ${fmtNum(input.score)}/100`,
      `${fmtNum(input.meanHours, 1)} h mean over ${days(input.dayCount)}`,
    ],
  }
}

export function bodyBatteryFact(input: {
  net: number | null
  mean: number | null
  high: number | null
  low: number | null
  dayCount: number
}): Fact {
  return {
    value: signed(input.net),
    unit: 'net today',
    context: [
      `${signed(input.mean)} mean over ${days(input.dayCount)}`,
      `high ${fmtNum(input.high)}, low ${fmtNum(input.low)}`,
    ],
  }
}

export function stressFact(input: { stress: number | null; rest: number; dayCount: number }): Fact {
  return {
    value: fmtNum(input.stress),
    unit: 'avg stress',
    context: [`${input.rest} of ${days(input.dayCount)} in the rest zone (< ${STRESS_REST_BELOW})`],
  }
}

export function activityScoreFact(input: {
  score: number | null
  mean: number | null
  dayCount: number
}): Fact {
  const pct =
    input.score === null ? EM_DASH : String(Math.round((input.score / ACTIVITY_TARGET_SCORE) * 100))
  return {
    value: fmtNum(input.score),
    unit: 'MET-min today',
    context: [
      `${pct} % of the ${ACTIVITY_TARGET_SCORE} target`,
      `${fmtNum(input.mean)} mean over ${days(input.dayCount)}`,
    ],
  }
}
