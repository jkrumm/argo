import type { CategoryMonth, Month, TxRow } from '../api/types'
import { NONE } from './categories'
import { shiftMonth } from './months'

/** Days in a `YYYY-MM` month. */
export function daysInMonth(month: Month): number {
  const [year = 0, number = 1] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number, 0)).getUTCDate()
}

/** A booking that counts as spending: the same rule as the service's monthly expense (expense or uncategorized, refunds net out). */
export const isSpend = (row: Pick<TxRow, 'category_kind'>): boolean =>
  row.category_kind === 'expense' || row.category_kind === null

/** Spending per day of `month` (index 0 = day 1), positive cents, refunds netted. */
export function dailySpend(rows: readonly TxRow[], month: Month): number[] {
  const days = daysInMonth(month)
  const daily = Array.from({ length: days }, () => 0)
  for (const row of rows) {
    if (row.budget_month !== month || !isSpend(row)) continue
    const day = Math.min(Math.max(Number(row.booked_on.slice(8, 10)), 1), days)
    daily[day - 1] = (daily[day - 1] ?? 0) - row.amount_cents
  }
  return daily
}

/** Running total of `daily`, `length` days long: a shorter month carries its last value. */
export function cumulative(daily: readonly number[], length: number): number[] {
  const out: number[] = []
  let total = 0
  for (let i = 0; i < length; i++) {
    total += daily[i] ?? 0
    out.push(total)
  }
  return out
}

export type PaceRow = {
  day: number
  /** Spent so far this month; null after today. */
  current: number | null
  /** From today's total to the projected month end; null before today. */
  projected: number | null
  /** The previous month's total at the same day; null without bookings. */
  previous: number | null
  /** The mean of the months before it; null without any. */
  average: number | null
}

/**
 * The cumulative spend of a budget month by day against the month before and the mean of the
 * `history` months before it. `elapsed` = days up to and including today (`daysTotal` for a past
 * month, 0 for a future one); `projectedEnd` draws a straight run from today's total to it.
 */
export function paceRows(input: {
  rows: readonly TxRow[]
  month: Month
  elapsed: number
  projectedEnd: number | null
  history?: number
}): PaceRow[] {
  const { rows, month, elapsed, projectedEnd, history = 3 } = input
  const days = daysInMonth(month)
  const hasRows = (m: Month) => rows.some((r) => r.budget_month === m && isSpend(r))
  const curve = (m: Month) => cumulative(dailySpend(rows, m), days)

  const current = curve(month)
  const previousMonth = shiftMonth(month, -1)
  const previous = hasRows(previousMonth) ? curve(previousMonth) : null
  const earlier = Array.from({ length: history }, (_, i) => shiftMonth(month, -1 - i))
    .filter(hasRows)
    .map(curve)
  const todayTotal = elapsed > 0 ? (current[elapsed - 1] ?? 0) : 0

  return Array.from({ length: days }, (_, i) => {
    const day = i + 1
    const projected =
      projectedEnd === null || elapsed >= days || elapsed < 1 || day < elapsed
        ? null
        : Math.round(
            todayTotal + ((projectedEnd - todayTotal) * (day - elapsed)) / (days - elapsed),
          )
    return {
      day,
      current: day <= elapsed ? (current[i] ?? 0) : null,
      projected,
      previous: previous === null ? null : (previous[i] ?? 0),
      average:
        earlier.length === 0
          ? null
          : Math.round(earlier.reduce((sum, c) => sum + (c[i] ?? 0), 0) / earlier.length),
    }
  })
}

export type CategoryLine = {
  /** Top category id, `NONE` for the uncategorized group. */
  key: string
  /** Spent this month, positive cents. */
  current: number
  /** Mean of the earlier months that had spending, positive cents. */
  average: number
  delta: number
}

/**
 * Spending per top category in `month` against the mean of the `history` months before it, largest
 * first. Months without any spending are not part of the mean (a month before the first import).
 */
export function categoryLines(
  rows: readonly CategoryMonth[],
  month: Month,
  history = 3,
): CategoryLine[] {
  const earlier = new Set(Array.from({ length: history }, (_, i) => shiftMonth(month, -1 - i)))
  const current = new Map<string, number>()
  const past = new Map<string, number>()
  const pastMonths = new Set<Month>()
  for (const r of rows) {
    if (r.kind !== 'expense') continue
    const key = r.top_category ?? NONE
    const spent = -r.amount_cents
    if (r.month === month) current.set(key, (current.get(key) ?? 0) + spent)
    else if (earlier.has(r.month)) {
      past.set(key, (past.get(key) ?? 0) + spent)
      pastMonths.add(r.month)
    }
  }
  const months = Math.max(pastMonths.size, 1)
  return [...new Set([...current.keys(), ...past.keys()])]
    .map((key) => {
      const now = current.get(key) ?? 0
      const average = Math.round((past.get(key) ?? 0) / months)
      return { key, current: now, average, delta: now - average }
    })
    .filter((l) => l.current > 0 || l.average > 0)
    .toSorted((a, b) => Math.max(b.current, b.average) - Math.max(a.current, a.average))
}
