/**
 * Pure derivations for the Strength page. Every figure a sentence repeats is computed here once, so
 * the summary, the verdict card and the lift cells cannot disagree. Unknown is `null` (rendered `—`),
 * never 0.
 */
import {
  ACWR_CAUTION_TO,
  ACWR_FLOOR,
  ACWR_METER_MAX,
  ACWR_OPTIMAL_TO,
} from '../garmin-health/model'
import { exerciseLabel } from './formulas'

export { ACWR_CAUTION_TO, ACWR_FLOOR, ACWR_METER_MAX, ACWR_OPTIMAL_TO }

export const EM_DASH = '—'
export const DELTA_DAYS = 28
export const READINESS_REST_BELOW = 40
export const READINESS_PUSH_FROM = 70
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
  verdict: 'deload' | 'monitor' | 'progress'
  activeSignals: readonly string[]
}
export type TodaysCall = {
  /** `Push`, `Normal`, `Rest`, `Deload`, or `—` when neither source reports. */
  verdict: string
  title: string
  /** The deload signal overrode the readiness verdict (conservative wins). */
  overridden: boolean
  /** `monitor` keeps the readiness verdict and names the signal. */
  monitor: string | null
  /** `16 Oct` when the reading is not from today; null when it is. */
  asOf: string | null
}

/** The viewer's local `YYYY-MM-DD` for a timestamp. */
export function localIso(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The conservative verdict wins: `deload` overrides readiness, `monitor` only annotates. */
export function todaysCall(
  readiness: ReadinessReading | null,
  deload: DeloadReading | undefined,
  now: number,
): TodaysCall {
  const stale = readiness?.date != null && readiness.date !== localIso(now)
  const asOf = stale && readiness?.date != null ? shortDate(readiness.date) : null
  if (deload?.verdict === 'deload') {
    return { verdict: 'Deload', title: 'Today: Deload', overridden: true, monitor: null, asOf }
  }
  const verdict = readiness === null || readiness.score === null ? EM_DASH : readiness.verdict
  return {
    verdict,
    title: asOf === null ? `Today: ${verdict}` : `Latest: ${verdict} · ${asOf}`,
    overridden: false,
    monitor: deload?.verdict === 'monitor' ? (deload.activeSignals[0] ?? null) : null,
    asOf,
  }
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

export function deloadLine(deload: DeloadReading | undefined): string {
  if (deload === undefined) return `Deload signal: ${EM_DASH}`
  const n = deload.activeSignals.length
  return n === 0
    ? 'Deload signal: 0 active'
    : `Deload signal: ${n} active — ${deload.activeSignals.join('; ')}`
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

export const ACWR_METHOD = 'EWMA spans 4 wk / 16 wk of weekly tonnage, all lifts summed'

// ── Lifts ────────────────────────────────────────────────────────────────────────────────────

export function latestE1rm(points: readonly Point[]): number | null {
  return points.findLast((p) => isNum(p.e1rm))?.e1rm ?? null
}

export type LiftDelta = { delta: number | null; phrase: string }

/** e1RM now minus e1RM as of 28d ago, or the reason there is no figure. */
export function liftDelta(points: readonly Point[], now: number, days = DELTA_DAYS): LiftDelta {
  const sessions = points.filter((p) => isNum(p.e1rm))
  const last = sessions.at(-1)
  if (last === undefined || !isNum(last.e1rm)) {
    return { delta: null, phrase: `${EM_DASH} kg in ${days}d` }
  }
  const cutoff = now - days * DAY_MS
  // No session inside the window: "unchanged" would be a claim the data does not make.
  if (Date.parse(last.date) <= cutoff) return { delta: null, phrase: `no session in ${days}d` }
  const base = sessions.findLast((p) => Date.parse(p.date) <= cutoff)
  if (base === undefined || !isNum(base.e1rm)) {
    const first = sessions[0]
    return { delta: null, phrase: `first session ${shortDate(first?.date ?? last.date)}` }
  }
  const delta = Math.round((last.e1rm - base.e1rm) * 10) / 10
  return { delta, phrase: `${signed(delta)} kg in ${days}d` }
}

export function sessionCount(points: readonly Point[]): number {
  return points.filter((p) => isNum(p.e1rm)).length
}

/** The API's `%/day` velocity as the page's one unit, `%/mo`. */
export function perMonth(pctPerDay: number | null): number | null {
  return pctPerDay === null ? null : Math.round(pctPerDay * 30 * 10) / 10
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

export function summarySentence(input: {
  leader: string | null
  e1rm: number | null
  delta: LiftDelta
  acwr: number | null
  call: TodaysCall
  score: number | null
}): string {
  const { leader, e1rm, delta, acwr, call, score } = input
  const lift =
    leader === null
      ? 'e1RM'
      : `${exerciseLabel(leader)} e1RM ${e1rm === null ? EM_DASH : `${e1rm.toFixed(1)} kg`}`
  const move = leader === null || e1rm === null ? '' : `, ${delta.phrase}`
  const load = acwr === null ? 'ACWR —' : `ACWR ${acwr.toFixed(2)} ${acwrZoneWord(acwr)}`
  const ready = `readiness ${score === null ? EM_DASH : `${Math.round(score)}/100`} ${call.verdict}${call.asOf === null ? '' : `, ${call.asOf}`}`
  return `${lift}${move} · ${load} · ${ready}`
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

/** Inside the band is `balanced` whatever the API says; outside, `balanced` is only the tolerance. */
export function statusWord(status: string | null, offset: number | null): string {
  if (status === null || offset === null) return EM_DASH
  if (offset === 0) return 'balanced'
  return status === 'balanced' ? 'near band' : status
}

export function ratioNote(status: string | null, offset: number | null): string {
  if (status === null || offset === null) return EM_DASH
  const tolerance =
    status === 'balanced' && offset !== 0
      ? `, within the ${Math.round(RATIO_TOLERANCE * 100)}% tolerance`
      : ''
  return `${statusWord(status, offset)} · ${offText(offset)}${tolerance}`
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

/** `0.12 under the band`, `inside the band`, `—`. */
export function offText(offset: number | null): string {
  if (offset === null) return EM_DASH
  if (offset === 0) return 'inside the band'
  const size = Math.abs(offset) < 0.005 ? '<0.01' : Math.abs(offset).toFixed(2)
  return `${size} ${offset < 0 ? 'under' : 'over'} the band`
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

const DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

/** `Fri 16 Oct` for a `YYYY-MM-DD` day (parsed as a local date, never shifted by the zone). */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return DAY_FMT.format(new Date(y, m - 1, d)).replace(',', '')
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
