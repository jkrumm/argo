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
}

/** The conservative verdict wins: `deload` overrides readiness, `monitor` only annotates. */
export function todaysCall(
  readiness: ReadinessReading | null,
  deload: DeloadReading | undefined,
): TodaysCall {
  if (deload?.verdict === 'deload') {
    return { verdict: 'Deload', title: 'Today: Deload', overridden: true, monitor: null }
  }
  const verdict = readiness === null || readiness.score === null ? EM_DASH : readiness.verdict
  return {
    verdict,
    title: `Today: ${verdict}`,
    overridden: false,
    monitor: deload?.verdict === 'monitor' ? (deload.activeSignals[0] ?? null) : null,
  }
}

/** The last non-null point of the readiness series, as the verdict card reads it. */
export function readinessReading(
  points: readonly { readiness: number | null; driver: string | null }[],
): ReadinessReading | null {
  const last = points.findLast((p) => isNum(p.readiness))
  if (last === undefined || !isNum(last.readiness)) return null
  const verdict =
    last.readiness >= READINESS_PUSH_FROM
      ? 'Push'
      : last.readiness >= READINESS_REST_BELOW
        ? 'Normal'
        : 'Rest'
  return { score: last.readiness, verdict, driver: last.driver }
}

export function deloadLine(deload: DeloadReading | undefined): string {
  if (deload === undefined) return `Deload signal: ${EM_DASH}`
  const n = deload.activeSignals.length
  return n === 0
    ? 'Deload signal: 0 active'
    : `Deload signal: ${n} active — ${deload.activeSignals.join('; ')}`
}

// ── ACWR ─────────────────────────────────────────────────────────────────────────────────────

/** Mean of each lift's latest non-null ACWR — the same reduction the alignment matrix uses. */
export function meanAcwr(
  lifts: readonly { points: readonly { acwr: number | null }[] }[],
): number | null {
  const latest = lifts
    .map((l) => l.points.findLast((p) => isNum(p.acwr))?.acwr ?? null)
    .filter(isNum)
  if (latest.length === 0) return null
  return Math.round((latest.reduce((a, b) => a + b, 0) / latest.length) * 100) / 100
}

/** The newest week any lift's ACWR was measured: the figure is that old, not today's. */
export function acwrAsOf(
  lifts: readonly { points: readonly { date: string; acwr: number | null }[] }[],
): string | null {
  const dates = lifts
    .map((l) => l.points.findLast((p) => isNum(p.acwr))?.date ?? null)
    .filter((d): d is string => d !== null)
  return dates.length === 0 ? null : dates.reduce((a, b) => (a > b ? a : b))
}

/** The mean ACWR only while its newest week is inside the delta window; older is unknown, not current. */
export function currentAcwr(
  lifts: Parameters<typeof meanAcwr>[0] & Parameters<typeof acwrAsOf>[0],
  now: number,
): number | null {
  const asOf = acwrAsOf(lifts)
  if (asOf === null || Date.parse(asOf) + 7 * DAY_MS <= now - DELTA_DAYS * DAY_MS) return null
  return meanAcwr(lifts)
}

export function acwrZoneWord(acwr: number | null): string {
  if (acwr === null) return EM_DASH
  if (acwr < ACWR_FLOOR) return 'undertrained'
  if (acwr <= ACWR_OPTIMAL_TO) return 'optimal'
  if (acwr <= ACWR_CAUTION_TO) return 'caution'
  return 'danger'
}

export const ACWR_METHOD = 'EWMA 4 wk / 16 wk of weekly tonnage, mean of the lifts'

// ── Lifts ────────────────────────────────────────────────────────────────────────────────────

export function latestE1rm(points: readonly Point[]): number | null {
  return points.findLast((p) => isNum(p.e1rm))?.e1rm ?? null
}

/** e1RM now minus e1RM as of `days` before `now`; null without a session inside the window or one before its start. */
export function e1rmDelta(points: readonly Point[], now: number, days = DELTA_DAYS): number | null {
  const current = latestE1rm(points)
  if (current === null) return null
  const cutoff = now - days * DAY_MS
  // No session inside the window: "unchanged" would be a claim the data does not make.
  const lastDate = points.findLast((p) => isNum(p.e1rm))?.date
  if (lastDate === undefined || Date.parse(lastDate) <= cutoff) return null
  const base = points.findLast((p) => isNum(p.e1rm) && Date.parse(p.date) <= cutoff)?.e1rm
  return isNum(base) ? Math.round((current - base) * 10) / 10 : null
}

/** `+4.2 kg in 28d`, or the reason there is no figure. */
export function deltaPhrase(delta: number | null, e1rm: number | null): string {
  if (e1rm === null) return `${EM_DASH} kg in ${DELTA_DAYS}d`
  return delta === null ? `no session in ${DELTA_DAYS}d` : `${signed(delta)} kg in ${DELTA_DAYS}d`
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
  delta: number | null
  acwr: number | null
  call: TodaysCall
  score: number | null
}): string {
  const { leader, e1rm, delta, acwr, call, score } = input
  const lift =
    leader === null
      ? 'e1RM'
      : `${exerciseLabel(leader)} e1RM ${e1rm === null ? EM_DASH : `${e1rm.toFixed(1)} kg`}`
  const move = leader === null || e1rm === null ? '' : `, ${deltaPhrase(delta, e1rm)}`
  const load = acwr === null ? 'ACWR —' : `ACWR ${acwr.toFixed(2)} ${acwrZoneWord(acwr)}`
  const ready = `readiness ${score === null ? EM_DASH : `${Math.round(score)}/100`} ${call.verdict}`
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

/** The API calls a ratio `balanced` up to 15% outside its band; say so instead of contradicting the offset. */
export function statusWord(status: string | null, offset: number | null): string {
  if (status === null) return EM_DASH
  return status === 'balanced' && offset !== 0 ? 'near band' : status
}

export function ratioNote(status: string | null, offset: number | null): string {
  if (status === null || offset === null) return EM_DASH
  const tolerance = status === 'balanced' && offset !== 0 ? ', within the 15% tolerance' : ''
  return `${statusWord(status, offset)} · ${offText(offset)}${tolerance}`
}

export function bandOffset(
  ratio: number | null,
  [lo, hi]: readonly [number, number],
): number | null {
  if (ratio === null) return null
  if (ratio < lo) return Math.round((ratio - lo) * 100) / 100
  if (ratio > hi) return Math.round((ratio - hi) * 100) / 100
  return 0
}

/** `0.12 under the band`, `inside the band`, `—`. */
export function offText(offset: number | null): string {
  if (offset === null) return EM_DASH
  if (offset === 0) return 'inside the band'
  return `${Math.abs(offset).toFixed(2)} ${offset < 0 ? 'under' : 'over'} the band`
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
