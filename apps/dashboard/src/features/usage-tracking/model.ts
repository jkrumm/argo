/**
 * Shared formatters and chart helpers for the Usage Tracking page: money and token formatting, the
 * empty-state copy and the series fold. No React, no queries — a null reading
 * is handled once (always `—`, never 0).
 */
import { format as formatDate } from 'date-fns'
import { NBSP, withUnit } from '../../lib/format'
import type { Range } from '../../lib/queries/usage'

export const EM_DASH = '—'

/** `30 d` that never splits across lines. */
const D30 = withUnit(30, 'd')

/** The one empty-state sentence of the section cards: names what is missing and the two ways out (no wider range exists for `all`). */
export const noDataInWindow = (thing: string, range: Range): string =>
  `No ${thing} in this window — clear a filter${range !== 'all' ? ' or widen the range' : ''}`

export const OTHER_KEY = 'Other'

const usdFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

/** Whole dollars with a thousands separator, never compacted; sub-dollar totals read `<$1`. */
export function fmtUsdWhole(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EM_DASH
  if (n <= 0) return '$0'
  if (n < 0.5) return '<$1'
  return `$${usdFormat.format(Math.round(n))}`
}

/** A 0–1 share as a whole percentage, glued (`62 %`); a non-zero share under 1 % reads `<1 %`. */
export function fmtShare(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return EM_DASH
  if (ratio > 0 && ratio < 0.005) return withUnit('<1', '%')
  return withUnit(Math.round(ratio * 100), '%')
}

type Quantity = { value: string; unit: string }

const TOKEN_UNITS = [
  { unit: 'B', size: 1e9 },
  { unit: 'M', size: 1e6 },
  { unit: 'k', size: 1e3 },
  { unit: '', size: 1 },
] as const

/** The figure a unit prints, rounded the way it prints (whole tokens, else one decimal). */
const roundedIn = (abs: number, index: number): number => {
  const { unit, size } = TOKEN_UNITS[index] ?? TOKEN_UNITS[TOKEN_UNITS.length - 1]!
  return Number((abs / size).toFixed(unit === '' ? 0 : 1))
}

/**
 * Roll up while the ROUNDED figure would print as 1000 of its unit: 999.96 M is `1.0 B`, 999.5 is
 * `1.0 k`, never `1000.0 M` / `1000`.
 */
function rollUp(abs: number, from: number): number {
  let index = from
  while (index > 0 && roundedIn(abs, index) >= 1000) index--
  return index
}

/** The one unit ladder: the largest unit the value reaches, judged on the rounded figure. */
function tokenUnitIndex(abs: number): number {
  const reached = TOKEN_UNITS.findIndex((u) => abs >= u.size)
  return rollUp(abs, reached === -1 ? TOKEN_UNITS.length - 1 : reached)
}

/** Token count as a number plus the unit that scales it (`B`, `M`, `k`, or none). */
export function tokensQuantity(n: number | null | undefined): Quantity {
  if (n === null || n === undefined || !Number.isFinite(n)) return { value: EM_DASH, unit: '' }
  const step = TOKEN_UNITS[tokenUnitIndex(Math.abs(n))]!
  return { value: (n / step.size).toFixed(step.unit === '' ? 0 : 1), unit: step.unit }
}

/** Whole tokens, never a false zero: a fraction of a token reads `<1`. */
function wholeText(n: number): string {
  if (n === 0) return '0'
  if (Math.round(n) !== 0) return n.toFixed(0)
  return n > 0 ? '<1' : '>-1'
}

/** A figure in a fixed unit: one decimal from 1 up, two decimals below (one rule per column), never a false zero. */
function scaledText(v: number): string {
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs < 0.01) return v > 0 ? '<0.01' : '>-0.01'
  // Decimal-safe: `toFixed` misrounds binary ties (0.95 → `0.9`), so round the tenth by hand.
  const tenth = (Math.sign(v) * Math.round(abs * 10)) / 10
  return Math.abs(tenth) >= 1 ? tenth.toFixed(1) : v.toFixed(2)
}

/**
 * A token formatter fixed to the magnitude of `reference` (a surface's largest value), so every
 * number on one tooltip, axis or list reads in the same unit and can be compared by eye. A value
 * that would round to 1000 of that unit rolls up to the next one instead.
 */
export function tokensFormatterFor(reference: number): (n: number) => string {
  const start = tokenUnitIndex(Math.abs(reference))
  return (n) => {
    if (!Number.isFinite(n)) return EM_DASH
    const step = TOKEN_UNITS[rollUp(Math.abs(n), start)]!
    if (step.unit === '') return wholeText(n)
    return `${scaledText(n / step.size)}${NBSP}${step.unit}`
  }
}

export function fmtTokens(n: number | null | undefined): string {
  const q = tokensQuantity(n)
  return q.unit === '' ? q.value : `${q.value}${NBSP}${q.unit}`
}

/** Every space unbreakable: a phrase that must never split across lines. */
const glue = (text: string): string => text.replaceAll(' ', NBSP)

/** `18 Oct`, unbreakable so a date never splits: a daily bucket's tooltip header and axis caption. */
export const shortDay = (d: Date): string => glue(formatDate(d, 'd MMM'))

/** `18 Oct 14:00`, local time: an hourly bucket's tooltip header and axis caption. */
export const shortHour = (d: Date): string => glue(formatDate(d, 'd MMM HH:mm'))

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** Epoch ms of the UTC midnight a bucket date names (`dayToDate` keeps the bucket's year-month-day as local fields). */
const bucketStartMs = (d: Date): number => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())

/** Whether the bucket starting on `date` (a day, or `span` ms) has ended at `now`. The one closed-bucket rule. */
const isClosedDay = (date: Date, now: number, span: number = DAY_MS): boolean =>
  bucketStartMs(date) + span <= now

/**
 * A chart's complete buckets: a day or week bucket still running at `now` would draw as a drop
 * against full ones. Buckets are UTC calendar days (a week bucket starts on its date), so they are
 * measured against the UTC clock, whatever the browser's offset. With fewer than two complete
 * buckets (a 7 d window at week grain) dropping the running one would leave nothing to draw, so
 * all of them stay. Whether a figure includes the running bucket is the call site's choice.
 */
export function dropPartialBucket<T extends { date: Date }>(
  points: readonly T[],
  now: number,
  grain: 'hour' | 'day' | 'week',
): T[] {
  // An hour bucket is an exact UTC instant; day and week buckets are calendar dates.
  const complete =
    grain === 'hour'
      ? points.filter((p) => p.date.getTime() + HOUR_MS <= now)
      : points.filter((p) => isClosedDay(p.date, now, (grain === 'day' ? 1 : 7) * DAY_MS))
  return complete.length < 2 ? [...points] : complete
}

const PERIOD_NOUN: Record<'7d' | '30d' | '90d' | 'all', string> = {
  '7d': withUnit(7, 'd'),
  '30d': D30,
  '90d': withUnit(90, 'd'),
  all: 'all time',
}

export function periodNoun(range: '7d' | '30d' | '90d' | 'all'): string {
  return PERIOD_NOUN[range]
}
