import { describe, expect, it } from 'bun:test'
import { SUB_WALLETS } from './accounts'
import { comparedRows, proratedDays, valueMultiple } from './value-model'

const now = Date.parse('2026-10-27T12:00:00Z')

describe('valueMultiple', () => {
  it('is list value over the price prorated to the days', () => {
    expect(valueMultiple(600, 200, 30)).toBe(3)
    expect(valueMultiple(150, 200, 15)).toBe(1.5)
    expect(valueMultiple(1400, 200, 7)).toBeCloseTo(30, 5)
  })

  it('has no multiple without usage, a price or days', () => {
    expect(valueMultiple(0, 200, 30)).toBeNull()
    expect(valueMultiple(10, 0, 30)).toBeNull()
    expect(valueMultiple(10, 200, null)).toBeNull()
    expect(valueMultiple(10, 200, 0)).toBeNull()
  })
})

describe('proratedDays', () => {
  it('is the range length for a subscription held all of it', () => {
    expect(proratedDays('7d', '2026-10-01', now)).toBe(7)
    expect(proratedDays('30d', '2026-05-01', now)).toBe(30)
  })

  it('is the days held when the subscription started inside the range', () => {
    expect(proratedDays('30d', '2026-10-24', now)).toBe(4)
    expect(proratedDays('90d', '2026-10-01', now)).toBe(27)
    expect(proratedDays('7d', null, now)).toBeNull()
  })

  it('counts all time from the first row, the first day included, at least one day', () => {
    expect(proratedDays('all', '2026-10-17', now)).toBe(11)
    expect(proratedDays('all', '2026-10-27', now)).toBe(1)
    expect(proratedDays('all', null, now)).toBeNull()
  })
})

describe('comparedRows', () => {
  const iu = SUB_WALLETS.find((w) => w.id === 'iu-sub')!
  const me = SUB_WALLETS.find((w) => w.id === 'me-sub')!
  const totals = [
    { payer: 'iu-sub', cost: 3000, fresh: 4e9, cacheRead: 9e10 },
    { payer: 'me-sub', cost: 300, fresh: 5e8, cacheRead: 5e9 },
  ]
  // All-time days: IU Max is held since September (before the 30 d range), Me Max since 26 Oct.
  const daily = [
    { bucket: '2026-09-01', groups: { 'iu-sub': 50, 'me-sub': 0 } },
    { bucket: '2026-10-25', groups: { 'iu-sub': 100, 'me-sub': 0 } },
    { bucket: '2026-10-26', groups: { 'iu-sub': 200, 'me-sub': 50 } },
    { bucket: '2026-10-27', groups: { 'iu-sub': 0, 'me-sub': 0 } },
  ]

  it('prices a 20x at $200 and a 5x at $100, each prorated to the days held in the range', () => {
    const { rows } = comparedRows({
      subs: [iu, me],
      totals,
      daily,
      peaks: { iu: 88, me: null },
      range: '30d',
      now,
    })
    expect(rows.map((r) => [r.price, r.multiple])).toEqual([
      [200, 15],
      [100, 45],
    ])
    expect(rows.map((r) => r.activeDays)).toEqual([2, 1])
    expect(rows.map((r) => r.quotaPeak)).toEqual([88, null])
  })

  it('sums the table: prices and values add, the multiple is the pooled one, days are the union', () => {
    const { sum } = comparedRows({
      subs: [iu, me],
      totals,
      daily,
      peaks: { iu: 88, me: 40 },
      range: '30d',
      now,
    })
    expect(sum.price).toBe(300)
    expect(sum.listValue).toBe(3300)
    expect(sum.multiple).toBeCloseTo(3300 / (200 + (100 * 2) / 30), 5)
    expect(sum.activeDays).toBe(2)
    expect(sum.fresh).toBe(4.5e9)
    expect(sum.quotaPeak).toBe(88)
  })

  it('prorates all time per subscription from its own first row', () => {
    const { rows, sum } = comparedRows({
      subs: [iu, me],
      totals,
      daily,
      peaks: {},
      range: 'all',
      now,
    })
    expect(rows.map((r) => r.days)).toEqual([57, 2])
    expect(rows[0]?.multiple).toBeCloseTo(3000 / ((200 * 57) / 30), 5)
    expect(sum.multiple).toBeCloseTo(3300 / ((200 * 57 + 100 * 2) / 30), 5)
    expect(rows.map((r) => r.quotaPeak)).toEqual([null, null])
  })

  it('has no multiple for a subscription with no usage', () => {
    const { rows } = comparedRows({
      subs: [iu],
      totals: [],
      daily: [],
      peaks: {},
      range: 'all',
      now,
    })
    expect(rows[0]).toMatchObject({ listValue: 0, multiple: null, days: null, activeDays: 0 })
  })
})
