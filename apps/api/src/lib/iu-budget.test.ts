import { describe, expect, it } from 'bun:test'
import { computeBudget, isOff, mergeModels, reconcileDays, type PortalCell } from './iu-budget.js'

// Portal days of the 2026-10-26 fetch (`make budget` in usage-tracker): rolling30 $588.14,
// can spend today -$65.59, first drop-off 2026-09-27 frees $4.78 -> headroom -$83.36.
const DAILY: Record<string, number> = {
  '2026-09-26': 5.43,
  '2026-09-27': 4.78,
  '2026-09-28': 19.2,
  '2026-09-29': 10.86,
  '2026-09-30': 7.73,
  '2026-10-01': 17.72,
  '2026-10-02': 3.54,
  '2026-10-03': 0.04,
  '2026-10-04': 4.07,
  '2026-10-05': 12.11,
  '2026-10-06': 9.37,
  '2026-10-07': 18.45,
  '2026-10-08': 10.57,
  '2026-10-09': 12.32,
  '2026-10-10': 15.35,
  '2026-10-11': 7.44,
  '2026-10-12': 4.64,
  '2026-10-13': 21.5,
  '2026-10-14': 42.72,
  '2026-10-15': 28.7,
  '2026-10-16': 41.06,
  '2026-10-17': 38.9,
  '2026-10-18': 40.77,
  '2026-10-19': 43.12,
  '2026-10-20': 5.75,
  '2026-10-21': 10.08,
  '2026-10-22': 71.44,
  '2026-10-23': 17.91,
  '2026-10-24': 18.58,
  '2026-10-25': 26.87,
  '2026-10-26': 22.55,
}
const cells: PortalCell[] = Object.entries(DAILY).map(([day, usd]) => ({ day, label: 'M', usd }))

describe('computeBudget', () => {
  const b = computeBudget(cells, '2026-10-26')

  it('matches make budget for the 2026-10-26 fetch', () => {
    expect(b.windowFrom).toBe('2026-09-27')
    expect(b.rolling30Usd).toBe(588.14)
    expect(b.canSpendTodayUsd).toBe(-65.59)
    expect(b.burn7dUsdPerDay).toBe(24.74)
    expect(b.projected7dUsd).toBe(697.45)
  })

  it('drops off the oldest 7 days of the window, cumulatively', () => {
    expect(b.dropoffNext7).toHaveLength(7)
    expect(b.dropoffNext7[0]).toEqual({ day: '2026-09-27', freesUsd: 4.78, headroomUsd: -83.36 })
    expect(b.dropoffNext7[6]).toEqual({ day: '2026-10-03', freesUsd: 0.04, headroomUsd: -24.27 })
  })

  it('excludes days outside the window from the total but keeps 31 daily points', () => {
    expect(b.daily).toHaveLength(31)
    expect(b.daily[0]).toEqual({ day: '2026-09-26', usd: 5.43 })
  })

  it('sums labels inside the window only, largest first', () => {
    const two = computeBudget(
      [
        { day: '2026-10-26', label: 'A', usd: 3 },
        { day: '2026-10-25', label: 'B', usd: 7 },
        { day: '2026-09-01', label: 'B', usd: 100 },
      ],
      '2026-10-26',
    )
    expect(two.topModels).toEqual([
      { label: 'B', usd: 7 },
      { label: 'A', usd: 3 },
    ])
  })

  it('is all zeros with full headroom on no data', () => {
    const empty = computeBudget([], '2026-10-26')
    expect(empty.rolling30Usd).toBe(0)
    expect(empty.canSpendTodayUsd).toBe(500)
    expect(empty.topModels).toEqual([])
  })
})

describe('isOff', () => {
  it('flags beyond max($1, 20 % of portal)', () => {
    expect(isOff(4.78, 6.07)).toBe(true)
    expect(isOff(10.86, 11.75)).toBe(false)
    expect(isOff(71.44, 30.21)).toBe(true)
  })
})

describe('mergeModels', () => {
  it('joins prettified labels with model_norm on alphanumerics and keeps one-sided models', () => {
    const rows = mergeModels(
      new Map([
        ['GPT 5.6 Terra', 86],
        ['Claude Opus 5.5', 33],
      ]),
      new Map([
        ['gpt-5.6-terra', 80],
        ['deepseek-v4.1-flash', 197],
      ]),
    )
    expect(rows).toEqual([
      { label: 'deepseek-v4.1-flash', portalUsd: 0, trackedUsd: 197 },
      { label: 'GPT 5.6 Terra', portalUsd: 86, trackedUsd: 80 },
      { label: 'Claude Opus 5.5', portalUsd: 33, trackedUsd: 0 },
    ])
  })
})

describe('reconcileDays', () => {
  it('flags the 2026-10-22 gap and marks the newest day partial', () => {
    const days = reconcileDays(
      new Map([
        ['2026-10-22', 71.44],
        ['2026-10-23', 17.91],
      ]),
      new Map([
        ['2026-10-22', 30.21],
        ['2026-10-23', 17.5],
      ]),
      '2026-10-23',
      3,
    )
    expect(days.map((d) => d.day)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23'])
    expect(days[1]).toMatchObject({ flagged: true, deltaUsd: -41.23, ratio: 0.42, partial: false })
    expect(days[2]).toMatchObject({ flagged: false, partial: true })
    expect(days[0]).toMatchObject({ portalUsd: 0, ratio: null, flagged: false })
  })
})

describe('computeBudget — per-key limit', () => {
  it('measures headroom against the limit it is given, default unchanged', () => {
    const small = computeBudget(cells, '2026-10-26', 700)
    const base = computeBudget(cells, '2026-10-26')
    expect(small.limitUsd).toBe(700)
    expect(small.canSpendTodayUsd - base.canSpendTodayUsd).toBe(200)
    expect(small.rolling30Usd).toBe(base.rolling30Usd)
  })
})
