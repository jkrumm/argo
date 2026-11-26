import type { BoardEntry, BoardFigures, ChartBar, MarketQuote } from '../api/types'
import type { SidebarItem } from './depot-nav'

/**
 * A row of the Board: the entry the board route describes, with the name the owner reads it by. `live` is the quote its
 * figures are read with while its day is running.
 */
export type BoardRow = BoardEntry & { label: string; live?: MarketQuote | undefined }

type Point = { day: string; value: number }

const dayOf = (time: number): string => new Date(time * 1000).toISOString().slice(0, 10)

const shiftDay = (day: string, days: number): string => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** `day` plus whole months, the day of the month cut to the length of the target month. */
function addMonths(day: string, months: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  const total = year * 12 + (month - 1) + months
  const targetYear = Math.floor(total / 12)
  const targetMonth = (total % 12) + 1
  const length = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate()
  return `${pad(targetYear, 4)}-${pad(targetMonth)}-${pad(Math.min(date, length))}`
}

const onOrBefore = (points: readonly Point[], day: string): Point | undefined =>
  points.findLast((point) => point.day <= day)

const round = (value: number): number => Math.round(value * 1e6) / 1e6

/**
 * The key figures of daily bars, as the service's board route computes them for a list entry (closes only; a change is
 * a fraction, null where the history starts later than the reference day). A held instrument that sits on no list has no
 * board route, so its row is read off its own bars. Null without a bar.
 */
export function figuresFromBars(bars: readonly ChartBar[]): BoardFigures | null {
  const points: Point[] = bars.map((bar) => ({ day: dayOf(bar.time), value: bar.close }))
  const last = points.at(-1)
  if (last === undefined) return null
  const against = (reference: Point | undefined): number | null =>
    reference !== undefined && reference.value !== 0
      ? round(last.value / reference.value - 1)
      : null
  let ath = points[0] ?? last
  for (const point of points) if (point.value > ath.value) ath = point
  const since = shiftDay(last.day, -364)
  const window = points.filter((point) => point.day >= since).map((point) => point.value)
  return {
    last_close: last.value,
    last_day: last.day,
    day_pct: against(points.at(-2)),
    week_pct: against(onOrBefore(points, shiftDay(last.day, -7))),
    month_pct: against(onOrBefore(points, addMonths(last.day, -1))),
    ytd_pct: against(onOrBefore(points, `${Number(last.day.slice(0, 4)) - 1}-12-31`)),
    year_pct: against(onOrBefore(points, addMonths(last.day, -12))),
    ath: { value: ath.value, day: ath.day },
    ath_pct: round(last.value / ath.value - 1),
    low_52w: Math.min(...window),
    high_52w: Math.max(...window),
  }
}

/** The rows of the items of a tab that no board route covers: they are charted from their own daily bars. */
export const unboarded = (
  items: readonly SidebarItem[],
  boarded: ReadonlyMap<string, BoardEntry>,
): SidebarItem[] => items.filter((item) => !boarded.has(item.symbol))

/**
 * The Board of a tab: one row per item of the tab, in the tab's order (a list in list order, In depot by value), each with
 * the figures its list's board route gave, else those read off its own bars (`computed`), else none yet.
 */
export function boardRows(
  items: readonly SidebarItem[],
  boarded: ReadonlyMap<string, BoardEntry>,
  computed: ReadonlyMap<string, BoardFigures | null>,
): BoardRow[] {
  return items.map((item) => {
    const entry = boarded.get(item.symbol)
    const { quote } = item
    return {
      symbol: item.symbol,
      display_name: item.entry?.display_name ?? entry?.display_name ?? null,
      name: quote.name,
      kind: item.kind,
      currency: entry?.currency ?? quote.currency,
      figures: entry === undefined ? (computed.get(item.symbol) ?? null) : entry.figures,
      cbbi: entry?.cbbi ?? null,
      label: item.label,
    }
  })
}
