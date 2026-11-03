import type { Meta, Month, RangeQuery } from '../api/types'

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const MONTH_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Every month the range controls can address; the data decides which of them are offered. */
const FIRST_YEAR = 2015
const LAST_YEAR = 2045

export const MONTH_UNIVERSE: readonly Month[] = Array.from(
  { length: (LAST_YEAR - FIRST_YEAR + 1) * 12 },
  (_, i) => `${FIRST_YEAR + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
)

export const YEAR_UNIVERSE: readonly string[] = Array.from(
  { length: LAST_YEAR - FIRST_YEAR + 1 },
  (_, i) => String(FIRST_YEAR + i),
)

export function monthLabel(month: Month): string {
  const [year, number] = month.split('-')
  return `${MONTH_NAMES[Number(number) - 1] ?? number} ${year}`
}

/** `Jun ’25`: the tick of a month axis. */
export function monthTick(month: Month): string {
  const [year = '', number = ''] = month.split('-')
  return `${MONTH_NAMES[Number(number) - 1] ?? number} ’${year.slice(2)}`
}

/** `June 2025`. */
export function monthName(month: Month): string {
  const [year = '', number = ''] = month.split('-')
  return `${MONTH_FULL[Number(number) - 1] ?? number} ${year}`
}

export const isMonth = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)

export function shiftMonth(month: Month, delta: number): Month {
  const [year = 0, number = 1] = month.split('-').map(Number)
  const index = year * 12 + (number - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** Every month from `first` to `last`, inclusive. */
export function monthsBetween(first: Month, last: Month): Month[] {
  const months: Month[] = []
  for (let m = first; m <= last; m = shiftMonth(m, 1)) months.push(m)
  return months
}

const DEFAULT_SPAN = 12

/**
 * The range a page asks for: the explicit `from`/`to` search params, else the last 12 months of
 * data. `null` while `/api/meta` is pending or the vault holds no bookings.
 */
export function resolveRange(
  meta: Meta | undefined,
  search: { from: string; to: string },
): RangeQuery | null {
  if (meta?.last_month == null || meta.first_month == null) return null
  const to = search.to === '' ? meta.last_month : search.to
  const fallbackFrom = shiftMonth(to, 1 - DEFAULT_SPAN)
  const from =
    search.from === ''
      ? fallbackFrom < meta.first_month
        ? meta.first_month
        : fallbackFrom
      : search.from
  return from <= to ? { from, to } : { from: to, to: from }
}

/** `30 Oct`: the tick of a day axis. */
export function dayMonth(iso: string): string {
  const [, number = '', day = ''] = iso.split('-')
  return `${Number(day)} ${MONTH_NAMES[Number(number) - 1] ?? number}`
}

/** Every `step`-th month, starting with the first: the ticks of a band axis that would otherwise crowd. */
export const everyNth = <T>(items: readonly T[], step: number): T[] =>
  items.filter((_, i) => i % step === 0)
