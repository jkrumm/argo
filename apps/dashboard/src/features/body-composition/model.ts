/**
 * Pure derivations for the body-composition page. Every figure a sentence repeats is computed here
 * once, so the summary line, the strip cells and the chart header read the same number.
 */
import type { SkinfoldSite } from '../../lib/queries/skinfold-log'
import {
  compareByDate,
  coveredWindow,
  MEAN_DAYS,
  trailingMean,
  type SkinfoldPoint,
} from './charts/series-data'
import { SKINFOLD_SITES } from './constants'
import type { WeightWindowStats } from './types'

/** The API's trailing-rate lookback. */
const RATE_LOOKBACK_DAYS = 28

/** A last weigh-in this many days old (or older) reads as stale. */
export const STALE_DAYS = 14

/** The rate meter spans ±this many kg/week; the neutral zone is ±RATE_NEUTRAL_KG_WK. */
export const RATE_SCALE_KG_WK = 0.5
export const RATE_NEUTRAL_KG_WK = 0.1

const MINUS = '−'

const dayNumber = (key: string): number =>
  Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) /
  86_400_000

/** A timestamp as the LOCAL `YYYY-MM-DD` calendar day. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Whole calendar days from `fromKey` to `toKey` (negative when `toKey` is earlier). */
export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round(dayNumber(toKey) - dayNumber(fromKey))
}

/** The newest `date` in a series, or `null` when it is empty. */
export function latestDate(points: readonly { date: string }[]): string | null {
  return points.reduce<string | null>((m, p) => (m === null || p.date > m ? p.date : m), null)
}

/** Days since the newest entry; `null` when there is none. Never negative. */
export function entryAgeDays(points: readonly { date: string }[], todayKey: string): number | null {
  const last = latestDate(points)
  return last === null ? null : Math.max(0, daysBetween(last, todayKey))
}

export const isStale = (ageDays: number | null): boolean =>
  ageDays !== null && ageDays >= STALE_DAYS

/** "today" / "1 day ago" / "{n} days ago". */
export function ageLabel(ageDays: number): string {
  if (ageDays === 0) return 'today'
  return ageDays === 1 ? '1 day ago' : `${ageDays} days ago`
}

/** A signed fixed-point figure with a real minus sign; `null` is `—`, never 0. */
export function signed(value: number | null, digits = 1): string {
  if (value === null) return '—'
  const fixed = Math.abs(value).toFixed(digits)
  if (Number(fixed) === 0) return fixed
  return `${value < 0 ? MINUS : '+'}${fixed}`
}

export const fixed = (value: number | null, digits = 1): string =>
  value === null ? '—' : value.toFixed(digits)

/** `80.1 kg` / `0.4 kg/wk`: the value never parts from its unit. */
export const withKg = (value: number, digits = 1, unit = 'kg'): string =>
  `${value.toFixed(digits)}\u00a0${unit}`

export type GoalProgress = {
  /** Kilograms still to go, always >= 0. */
  toGo: number
  /** Kilograms from the window's first weight to the goal. */
  span: number
  /** Kilograms moved toward the goal, clamped to [0, span]. */
  moved: number
}

/** Progress from the window's first weight to the goal; `null` when there is no span to measure. */
export function goalProgress({
  start,
  current,
  goal,
}: {
  start: number | null
  current: number | null
  goal: number | null
}): GoalProgress | null {
  if (start === null || current === null || goal === null) return null
  const span = Math.abs(start - goal)
  if (span < 0.05) return null
  const direction = Math.sign(goal - start)
  const moved = Math.min(Math.max((current - start) * direction, 0), span)
  return { toGo: Math.abs(current - goal), span, moved }
}

/** Which way a weight change must go to read as progress: a verdict for the delta polarity. */
export function weightDeltaPolarity(
  current: number | null,
  goal: number | null,
): 'up-good' | 'up-bad' | 'neutral' {
  if (current === null || goal === null || Math.abs(goal - current) < 0.05) return 'neutral'
  return goal > current ? 'up-good' : 'up-bad'
}

/** Kilograms above (+) or below (−) the mean; `null` when either side is unknown. */
export function deltaFromMean(current: number | null, mean: number | null): number | null {
  return current === null || mean === null ? null : current - mean
}

/** Headline: weight and distance to goal. Facts: the trailing rate and the last weigh-in's age. */
export function summaryParts({
  current,
  kgPerWeek,
  rateDays,
  goal,
  ageDays,
}: {
  current: number | null
  kgPerWeek: number | null
  /** Days the rate covers, see {@link rateDays}. */
  rateDays: number
  goal: number | null
  ageDays: number | null
}): { sentence: string; facts: string[] } {
  if (current === null) return { sentence: 'No weigh-ins in this window.', facts: [] }
  const sentence =
    goal === null
      ? `${fixed(current)} kg`
      : `${fixed(current)} kg, ${fixed(Math.abs(current - goal))} kg to the ${fixed(goal)} kg goal`
  return {
    sentence,
    facts: [
      `${signed(kgPerWeek, 2)} kg/wk over ${rateDays} d`,
      ageDays === null ? null : `last weigh-in ${ageLabel(ageDays)}`,
    ].filter((f) => f !== null),
  }
}

/** The API's trailing rate looks back 28 d but only sees rows in the selected window. */
export function rateDays(span: number | null): number {
  return span === null ? RATE_LOOKBACK_DAYS : Math.min(RATE_LOOKBACK_DAYS, span)
}

export type WindowParams = { window?: string; from?: string; to?: string }

/** "90 days" / "all time" / "{from} to {to}" for the chart title. */
export function windowLabel(params: WindowParams): string {
  if (params.window === 'all') return 'all time'
  const days = params.window?.match(/^(\d+)d$/)?.[1]
  if (days !== undefined) return `${days} days`
  if (params.from !== undefined && params.to !== undefined) return `${params.from} to ${params.to}`
  return 'selected window'
}

export type SiteRow = {
  site: SkinfoldSite
  label: string
  current: number | null
  /** Chronological readings for the sparkline. */
  values: number[]
  /** Latest reading minus the previous session's; `null` with fewer than two readings. */
  delta: number | null
  /** The previous session's date, the period the delta is measured against. */
  priorDate: string | null
}

/** One row per caliper site: its sparkline values and the change since the previous session. */
export function siteRows(
  points: readonly SkinfoldPoint[],
  perSite: readonly { site: SkinfoldSite; current: number | null }[],
): SiteRow[] {
  const sorted = points.toSorted(compareByDate)
  return SKINFOLD_SITES.map(({ key, label }) => {
    const readings = sorted.flatMap((p) => {
      const reading = p.readings.find((r) => r.site === key)
      return reading === undefined ? [] : [{ date: p.date, valueMm: reading.valueMm }]
    })
    const values = readings.map((r) => r.valueMm)
    const last = values.at(-1)
    const prev = values.at(-2)
    return {
      site: key,
      label,
      current: perSite.find((s) => s.site === key)?.current ?? last ?? null,
      values,
      delta: last === undefined || prev === undefined ? null : last - prev,
      priorDate: readings.at(-2)?.date ?? null,
    }
  })
}

type DatedWeight = { date: string; weightKg: number }

/** Days the selected window spans; `null` for "all". A period longer than this cannot be stated. */
export function windowDays(params: WindowParams): number | null {
  if (params.window === 'all') return null
  const days = params.window?.match(/^(\d+)d$/)?.[1]
  if (days !== undefined) return Number(days)
  if (params.from !== undefined && params.to !== undefined) {
    return daysBetween(params.from, params.to) + 1
  }
  return null
}

/** Mean weight of the last `days` days up to the newest entry; `null` when not covered. */
export function meanOverDays(
  points: readonly DatedWeight[],
  days: number,
  span: number | null,
): number | null {
  const last = latestDate(points)
  return last === null ? null : trailingMean(points, last, days, span)
}

/**
 * Least-squares slope in kg/week over the last `days` days, the same method as the API's 28 d rate
 * (so the hero rate and these footer rates can never be two different methods). `null` when not
 * covered or when the entries span under 3 days, as the API's.
 */
export function slopeOverDays(
  points: readonly DatedWeight[],
  days: number,
  span: number | null,
): number | null {
  const last0 = latestDate(points)
  const slice = last0 === null ? [] : coveredWindow(points, last0, days, span)
  const first = slice.at(0)
  const last = slice.at(-1)
  if (first === undefined || last === undefined || daysBetween(first.date, last.date) < 3) {
    return null
  }
  const xs = slice.map((p) => daysBetween(first.date, p.date))
  const n = slice.length
  const meanX = xs.reduce((a, x) => a + x, 0) / n
  const meanY = slice.reduce((a, p) => a + p.weightKg, 0) / n
  let num = 0
  let den = 0
  slice.forEach((p, i) => {
    const dx = xs[i]! - meanX
    num += dx * (p.weightKg - meanY)
    den += dx * dx
  })
  return den === 0 ? null : (num / den) * 7
}

/** The RATE cell footer: the 7 d slope only; the 28 d hero above it is the one long-span rate. */
export function rateFooter(slope7: number | null): string {
  return `${signed(slope7, 2)} kg/wk over ${MEAN_DAYS} d`
}

/** The kg/week range of the API's intensity tier for a rate ("0.1\u20130.3 kg/wk", "\u2265 0.6 kg/wk"). */
export function intensityBand(rate: number | null): string | null {
  if (rate === null) return null
  const abs = Math.abs(rate)
  if (abs < RATE_NEUTRAL_KG_WK) return `< ${RATE_NEUTRAL_KG_WK} kg/wk`
  const edges = rate < 0 ? [0.4, 0.8] : [0.3, 0.6]
  const [lean, standard] = edges as [number, number]
  if (abs < lean) return `${RATE_NEUTRAL_KG_WK}\u2013${lean} kg/wk`
  if (abs < standard) return `${lean}\u2013${standard} kg/wk`
  return `\u2265 ${standard} kg/wk`
}

/** The day-based means and slopes the strip and the chart header both state. */
export function weightWindowStats(
  points: readonly DatedWeight[],
  span: number | null,
): WeightWindowStats {
  return {
    mean7: meanOverDays(points, MEAN_DAYS, span),
    mean30: meanOverDays(points, 30, span),
    slope7: slopeOverDays(points, 7, span),
  }
}
