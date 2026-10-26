import { describe, expect, it } from 'bun:test'
import { change, periodSums, rankRows, sumOf } from './period-model'

const NOW = new Date('2026-10-26T12:00:00').getTime()
const day = (d: string, groups: Record<string, number | null>) => ({ bucket: d, groups })

/** 15 dense days 2026-10-12..26 (26 is today), 1 each for `a` and 2 each for `b`. */
const dense = Array.from({ length: 15 }, (_, i) =>
  day(`2026-10-${String(12 + i).padStart(2, '0')}`, { a: 1, b: 2 }),
)

describe('periodSums', () => {
  it('splits the last N complete days from the N before, the running day left out', () => {
    const { current, prior } = periodSums(dense, '7d', NOW)
    expect(current.get('a')).toBe(7)
    expect(prior?.get('b')).toBe(14)
  })

  it('has no prior when the series does not reach back two windows', () => {
    expect(periodSums(dense.slice(4), '7d', NOW).prior).toBeNull()
  })

  it('has no prior for the all range', () => {
    expect(periodSums(dense, 'all', NOW).prior).toBeNull()
    expect(sumOf(periodSums(dense, 'all', NOW).current)).toBe(45)
  })
})

describe('change', () => {
  it('is null without a prior window or without anything now', () => {
    expect(change(5, null)).toBeNull()
    expect(change(0, 5)).toBeNull()
  })

  it('reads a percentage, and `new` from a zero or tiny base', () => {
    expect(change(15, 10)).toEqual({ kind: 'pct', pct: 50 })
    expect(change(5, 0)).toEqual({ kind: 'new' })
    expect(change(100, 5)).toEqual({ kind: 'new' })
  })
})

describe('rankRows', () => {
  it('has no prior figure for a key the prior series folded away, and no total for a mixed Other', () => {
    const wide = [day('2026-09-01', { a: 4 }), day('2026-10-20', { a: 5, b: 3 })]
    const c = periodSums(wide, '7d', NOW)
    const rows = rankRows({ cost: c, tokens: c, lens: 'spend', limit: 5 })
    expect(rows.find((r) => r.key === 'b')?.costPrior).toBeNull()
    const lopsided = periodSums([day('2026-10-20', { a: 1, b: 2 })], 'all', NOW)
    const other = rankRows({
      cost: lopsided,
      tokens: periodSums([day('2026-10-20', { b: 1 })], 'all', NOW),
      lens: 'spend',
      limit: 1,
    }).at(-1)
    expect(other?.key).toBe('Other')
    expect(other?.tokens).toBeNull()
  })

  const cost = periodSums(
    [
      day('2026-10-01', { a: 1, b: 1, c: 1, other: 4 }),
      day('2026-10-20', { a: 5, b: 3, c: 1, other: 2 }),
    ],
    '7d',
    NOW,
  )
  const tokens = periodSums([day('2026-10-20', { a: 100, b: 400, c: 50, other: 10 })], 'all', NOW)

  it('ranks by the lens, keeps `limit` rows and folds the rest into Other', () => {
    const rows = rankRows({ cost, tokens, lens: 'spend', limit: 2 })
    expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'Other'])
    expect(rows[2]?.cost).toBe(3)
    expect(
      rankRows({ cost, tokens: periodSums([], 'all', NOW), lens: 'spend', limit: 3 })[0]?.tokens,
    ).toBeNull()
  })

  it('ranks by tokens when the lens says so', () => {
    expect(rankRows({ cost, tokens, lens: 'tokens', limit: 1 })[0]?.key).toBe('b')
  })
})
