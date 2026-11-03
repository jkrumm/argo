import { describe, expect, it } from 'bun:test'
import type { CategoryMonth, TxRow } from '../api/types'
import { categoryLines, cumulative, daysInMonth, dailySpend, paceRows, elapsedDays } from './pace'

const tx = (day: string, cents: number, kind: TxRow['category_kind'] = 'expense', month?: string) =>
  ({
    booked_on: day,
    budget_month: month ?? day.slice(0, 7),
    amount_cents: cents,
    category_kind: kind,
  }) as TxRow

describe('daysInMonth', () => {
  it('knows leap years and month lengths', () => {
    expect(daysInMonth('2026-11')).toBe(30)
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2026-02')).toBe(28)
  })
})

describe('dailySpend', () => {
  it('counts expense and uncategorized rows, nets refunds, skips income and other budget months', () => {
    const daily = dailySpend(
      [
        tx('2026-11-02', -1000),
        tx('2026-11-02', -500, null),
        tx('2026-11-02', 300),
        tx('2026-11-03', 320000, 'income'),
        tx('2026-10-30', -999),
        tx('2026-10-28', 320000, 'income', '2026-11'),
      ],
      '2026-11',
    )
    expect(daily[1]).toBe(1200)
    expect(daily[2]).toBe(0)
    expect(daily).toHaveLength(30)
  })
})

describe('cumulative', () => {
  it('carries the last value when the month is shorter', () => {
    expect(cumulative([1, 2, 3], 5)).toEqual([1, 3, 6, 6, 6])
  })
})

describe('paceRows', () => {
  const rows = [
    tx('2026-08-10', -3000),
    tx('2026-09-10', -6000),
    tx('2026-10-05', -2000),
    tx('2026-10-20', -4000),
    tx('2026-11-02', -1000),
    tx('2026-11-04', -500),
  ]

  it('stops the actual curve at today and projects the rest in a straight run', () => {
    const out = paceRows({ rows, month: '2026-11', elapsed: 4, projectedEnd: -(-2500) })
    expect(out).toHaveLength(30)
    expect(out[0]).toMatchObject({ day: 1, current: 0 })
    expect(out[3]).toMatchObject({ day: 4, current: 1500, projected: 1500 })
    expect(out[4]).toMatchObject({ day: 5, current: null })
    expect(out[29]).toMatchObject({ day: 30, projected: 2500 })
  })

  it('compares with last month at the same day and with the mean of the months before', () => {
    const out = paceRows({ rows, month: '2026-11', elapsed: 4, projectedEnd: null })
    expect(out[4]?.previous).toBe(2000)
    expect(out[29]?.previous).toBe(6000)
    // August 3000, September 6000, October 6000 -> mean 5000 at the month end.
    expect(out[29]?.average).toBe(5000)
    expect(out[29]?.projected).toBeNull()
  })

  it('has no comparison without earlier bookings and draws a whole past month', () => {
    const out = paceRows({
      rows: [tx('2026-06-01', -100)],
      month: '2026-06',
      elapsed: 30,
      projectedEnd: null,
    })
    expect(out[0]?.previous).toBeNull()
    expect(out[0]?.average).toBeNull()
    expect(out[29]?.current).toBe(100)
  })

  it('draws no actual curve for a month that has not begun', () => {
    const out = paceRows({ rows, month: '2026-12', elapsed: 0, projectedEnd: 100 })
    expect(out.every((r) => r.current === null && r.projected === null)).toBe(true)
  })
})

describe('categoryLines', () => {
  const cat = (
    month: string,
    top: string | null,
    cents: number,
    kind: CategoryMonth['kind'] = 'expense',
  ) =>
    ({ month, top_category: top, amount_cents: cents, kind, category: top, n: 1 }) as CategoryMonth

  it('compares the month with the mean of the earlier months that had spending', () => {
    const lines = categoryLines(
      [
        cat('2026-11', 'food', -30000),
        cat('2026-10', 'food', -60000),
        cat('2026-09', 'food', -30000),
        cat('2026-10', 'fun', -9000),
        cat('2026-11', null, -1500),
        cat('2026-11', 'income', 320000, 'income'),
      ],
      '2026-11',
    )
    expect(lines[0]).toEqual({ key: 'food', current: 30000, average: 45000, delta: -15000 })
    expect(lines.find((l) => l.key === 'fun')).toEqual({
      key: 'fun',
      current: 0,
      average: 4500,
      delta: -4500,
    })
    expect(lines.find((l) => l.key === '__none__')?.current).toBe(1500)
    expect(lines.some((l) => l.key === 'income')).toBe(false)
  })
})

describe('elapsedDays', () => {
  const status = (today: string, days_left: number) => ({
    month: '2026-11',
    today,
    days_total: 30,
    days_left,
  })

  it('counts day 1 of the running month as one elapsed day (days_left equals days_total there too)', () => {
    expect(elapsedDays(status('2026-11-01', 30))).toBe(1)
    expect(elapsedDays(status('2026-11-03', 28))).toBe(3)
  })

  it('is none before the month starts and all of it once it is over', () => {
    expect(elapsedDays(status('2026-10-25', 30))).toBe(0)
    expect(elapsedDays(status('2026-12-04', 0))).toBe(30)
  })
})
