import { describe, expect, it } from 'bun:test'
import { dayTicks, quotaAccounts, quotaCoverage, quotaPeaks, quotaRows } from './quota-model'

const point = (at: string, sevenDayPct: number | null) => ({ at, sevenDayPct })
const series = [
  {
    account: 'iu',
    points: [
      point('2026-10-24T10:00:00Z', 20),
      point('2026-10-25T10:00:00Z', 95),
      point('2026-10-26T10:00:00Z', 4),
    ],
  },
  {
    account: 'me',
    points: [point('2026-10-25T10:00:00Z', 60), point('2026-10-26T10:00:00Z', null)],
  },
]
const since = Date.parse('2026-10-24T00:00:00Z')

describe('quotaPeaks', () => {
  it('is the highest weekly reading per account since the cut-off', () => {
    expect(quotaPeaks(series, since)).toEqual({ iu: 95, me: 60 })
    expect(quotaPeaks(series, Date.parse('2026-10-26T00:00:00Z'))).toEqual({ iu: 4, me: null })
  })

  it('is null for an account without a reading', () => {
    expect(quotaPeaks([{ account: 'me2', points: [] }], since)).toEqual({ me2: null })
  })
})

describe('quotaRows', () => {
  it('has one row per sample instant with each account that has one then, null elsewhere', () => {
    const rows = quotaRows(series, since)
    expect(rows.map((r) => r.at.toISOString())).toEqual([
      '2026-10-24T10:00:00.000Z',
      '2026-10-25T10:00:00.000Z',
      '2026-10-26T10:00:00.000Z',
    ])
    expect(rows[0]?.pct).toEqual({ iu: 20 })
    expect(rows[1]?.pct).toEqual({ iu: 95, me: 60 })
    expect(rows[2]?.pct).toEqual({ iu: 4, me: null })
  })

  it('drops samples before the cut-off', () => {
    expect(quotaRows(series, Date.parse('2026-10-26T00:00:00Z'))).toHaveLength(1)
  })
})

describe('coverage', () => {
  it('names the earliest sample and the accounts, null without samples', () => {
    expect(quotaCoverage(series)?.toISOString()).toBe('2026-10-24T10:00:00.000Z')
    expect(quotaCoverage([])).toBeNull()
    expect(quotaAccounts(series)).toEqual(['iu', 'me'])
  })
})

const rowsOver = (days: number) =>
  quotaRows(
    [
      {
        account: 'iu',
        points: Array.from({ length: days + 1 }, (_, i) => ({
          at: new Date(2026, 9, 1 + i, 6).toISOString(),
          sevenDayPct: 10,
        })),
      },
    ],
    0,
  )

describe('dayTicks', () => {
  it('has one tick per local midnight for a short history, none without rows', () => {
    const ticks = dayTicks(rowsOver(3), 6)
    expect(ticks.map((t) => [t.getDate(), t.getHours()])).toEqual([
      [2, 0],
      [3, 0],
      [4, 0],
    ])
    expect(dayTicks([], 6)).toEqual([])
  })

  it('thins a long history to at most the cap', () => {
    expect(dayTicks(rowsOver(29), 6).length).toBeLessThanOrEqual(6)
  })
})
