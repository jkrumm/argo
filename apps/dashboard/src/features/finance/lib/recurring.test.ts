import { describe, expect, it } from 'bun:test'
import type { RecurringRow } from '../api/types'
import { recurringTotals, seatLabel, upcoming } from './recurring'

const row = (over: Partial<RecurringRow>): RecurringRow =>
  ({
    merchant: 'X',
    series: 1,
    series_count: 1,
    cadence: 'monthly',
    kind: 'subscription',
    status: 'active',
    current_cents: -1000,
    avg_cents: -1000,
    monthly_cents: -1000,
    next_expected_on: '2026-11-10',
    override: null,
    ...over,
  }) as RecurringRow

describe('recurringTotals', () => {
  it('counts live rows only and keeps bills apart from subscriptions', () => {
    const t = recurringTotals([
      row({}),
      row({ monthly_cents: -2000 }),
      row({ kind: 'bill', monthly_cents: -9000 }),
      row({ status: 'cancelled', monthly_cents: -5000 }),
      row({ monthly_cents: -700, override: { mode: 'exclude', cadence: null, note: null } }),
    ])
    expect(t).toEqual({
      subscriptionsMonthly: 3000,
      subscriptionsYearly: 36000,
      billsMonthly: 9000,
      subscriptionCount: 2,
      billCount: 1,
    })
  })
})

describe('upcoming', () => {
  it('keeps live charges inside the window, soonest first, and never in the past', () => {
    const rows = [
      row({ merchant: 'late', next_expected_on: '2026-12-01' }),
      row({ merchant: 'b', next_expected_on: '2026-11-20' }),
      row({ merchant: 'a', next_expected_on: '2026-11-02' }),
      row({ merchant: 'gone', status: 'cancelled', next_expected_on: null }),
    ]
    const out = upcoming(rows, '2026-11-03', '2026-12-03')
    expect(out.map((r) => r.merchant)).toEqual(['a', 'b', 'late'])
    expect(out[0]?.next_expected_on).toBe('2026-11-03')
  })
})

describe('seatLabel', () => {
  it('names a seat only for parallel series', () => {
    expect(seatLabel(row({}))).toBeNull()
    expect(seatLabel(row({ series: 2, series_count: 2 }))).toBe('Seat 2 of 2')
  })
})
