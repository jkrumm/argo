import { describe, expect, it } from 'bun:test'
import type { CreditCacheCaller, CreditPool } from './credit-queries'
import {
  burnRows,
  cacheRows,
  cycleLabel,
  fallbackShare,
  fmtCredit,
  fmtDaysLeft,
  overallHitRate,
  pickDays,
  poolTitle,
  previousNote,
  reasonLines,
  reportedNote,
  sortPools,
  sortTargets,
  targetLabel,
} from './credits-model'

const pool = (over: Partial<CreditPool> = {}): CreditPool => ({
  account: 'iu',
  grantUsd: 200,
  cycle: { known: true, start: '2026-10-29T14:00:00.000Z', end: '2026-11-05T14:00:00.000Z' },
  points: [
    { day: '2026-10-29', meteredUsd: 10, reportedUsd: 20, creditLeftUsd: 180 },
    { day: '2026-10-30', meteredUsd: 10, reportedUsd: null, creditLeftUsd: 190 },
    { day: '2026-10-31', meteredUsd: null, reportedUsd: null, creditLeftUsd: null },
  ],
  meteredUsd: 10,
  meteredEstimatedUsd: 0,
  meteredEstimatedRows: 0,
  reported: { available: true, usd: 20, refreshedAt: '2026-11-02T09:00:00.000Z' },
  spentUsd: 20,
  creditLeftUsd: 180,
  dailyRateUsd: 5,
  daysLeft: 3.5,
  projectedUnspentUsd: 150,
  previous: null,
  ...over,
})

describe('sortPools / poolTitle', () => {
  it('lists the pools in registry order and names them by their credit payer', () => {
    const sorted = sortPools([
      { account: 'me2' },
      { account: 'zz' },
      { account: 'iu' },
      { account: 'me' },
    ])
    expect(sorted.map((p) => p.account)).toEqual(['iu', 'me', 'me2', 'zz'])
    expect(sorted.map((p) => poolTitle(p.account))).toEqual([
      'IU credit',
      'Me credit',
      'Me2 credit',
      'zz',
    ])
  })
})

describe('burnRows', () => {
  it('counts the grant down by each source, leaving no figure null', () => {
    const rows = burnRows(pool())
    expect(rows.map((r) => [r.metered, r.reported])).toEqual([
      [190, 180],
      [190, null],
      [null, null],
    ])
    expect(rows[0]!.at.getDate()).toBe(29)
  })

  it('draws nothing without a grant', () => {
    expect(burnRows(pool({ grantUsd: null }))).toEqual([])
  })
})

describe('labels', () => {
  it('names a known cycle by its first and last day, and an unknown one as unknown', () => {
    expect(cycleLabel(pool())).toMatch(/29\s*Oct\s*–\s*5\s*Nov/)
    expect(cycleLabel(pool({ cycle: { known: false, start: null, end: null } }))).toBe(
      'cycle unknown · last 31 d',
    )
  })

  it('prints cents under ten dollars, whole dollars above, a dash for no figure', () => {
    expect([fmtCredit(4.5), fmtCredit(123.89), fmtCredit(null)]).toEqual(['$4.50', '$124', '—'])
  })

  it('prints the days left as days and hours', () => {
    expect([
      fmtDaysLeft(3.5),
      fmtDaysLeft(0.25),
      fmtDaysLeft(2),
      fmtDaysLeft(2.999),
      fmtDaysLeft(0.999),
      fmtDaysLeft(null),
    ]).toEqual(['3 d 12 h', '6 h', '2 d', '3 d', '1 d', '—'])
  })

  it('says why there is no provider figure, and when there is one', () => {
    expect(
      reportedNote(pool({ reported: { available: false, usd: null, refreshedAt: null } })),
    ).toBe('Provider report not available yet')
    expect(
      reportedNote(pool({ reported: { available: true, usd: null, refreshedAt: null } })),
    ).toBe('No provider report for this pool yet')
    expect(reportedNote(pool())).toMatch(/^Provider report refreshed .*, lags by hours$/)
  })

  it('writes the previous cycle with its reconciled and unspent figures, or says it is unreconciled', () => {
    const previous = {
      cycleStart: '2026-10-01T14:00:00.000Z',
      cycleEnd: '2026-10-29T14:00:00.000Z',
      grantUsd: 200,
      meteredUsd: 140,
      reconciledUsd: 150,
      unspentUsd: 50,
    }
    expect(previousNote(pool())).toBeNull()
    expect(previousNote(pool({ previous }))).toMatch(
      /Previous cycle \(ended 29\s*Oct\): \$150 reconciled, \$50 unspent/,
    )
    expect(
      previousNote(pool({ previous: { ...previous, reconciledUsd: null, unspentUsd: null } })),
    ).toMatch(/\$140 metered, not reconciled yet/)
  })
})

describe('picks', () => {
  it('orders the targets pools first, then the IU API, then refusals', () => {
    expect(sortTargets(['refused', 'iu-api', 'me', 'iu', 'me'])).toEqual([
      'iu',
      'me',
      'iu-api',
      'refused',
    ])
    expect([targetLabel('me2'), targetLabel('iu-api'), targetLabel('refused')]).toEqual([
      'Me2 credit',
      'IU API',
      'Refused',
    ])
  })

  it('folds the daily picks into one stacked row per day, oldest first, and flags fallbacks', () => {
    const days = pickDays([
      { day: '2026-11-02', picked: 'me', reason: 'a', count: 2 },
      { day: '2026-11-01', picked: 'iu-api', reason: 'drained', count: 1 },
      { day: '2026-11-02', picked: 'me', reason: 'b', count: 1 },
      { day: '2026-11-02', picked: 'iu-api', reason: 'forced', count: 4 },
    ])
    expect(days.map((d) => [d.at.getDate(), d.total, d.counts['me'] ?? 0])).toEqual([
      [1, 1, 0],
      [2, 7, 3],
    ])
    const lines = reasonLines([
      { picked: 'me', reason: 'a', count: 3, fallback: false },
      { picked: 'iu-api', reason: 'forced', count: 4, fallback: false },
      { picked: 'iu-api', reason: 'drained', count: 1, fallback: true },
    ])
    expect(lines.map((l) => [l.reason, l.fallback])).toEqual([
      ['forced', false],
      ['a', false],
      ['drained', true],
    ])
    expect(fallbackShare(1, 8)).toBe(0.125)
    expect(fallbackShare(0, 0)).toBeNull()
  })
})

describe('cache', () => {
  const caller = (
    name: string,
    requests: number,
    input: number,
    read: number,
    write: number,
    hitRate: number | null,
  ): CreditCacheCaller => ({
    caller: name,
    requests,
    input,
    cacheRead: read,
    cacheWrite: write,
    hitRate,
  })

  it('ranks measurable callers by hit rate and leaves the ones with no input last', () => {
    const rows = cacheRows([
      caller('(unset)', 1, 0, 0, 0, null),
      caller('hermes', 5, 300, 0, 100, 0),
      caller('agw', 2, 150, 800, 50, 0.8),
    ])
    expect(rows.map((r) => r.caller)).toEqual(['agw', 'hermes', '(unset)'])
  })

  it('weights the overall rate by tokens, not by caller', () => {
    expect(overallHitRate([caller('a', 1, 100, 900, 0, 0.9), caller('b', 1, 900, 0, 100, 0)])).toBe(
      0.45,
    )
    expect(overallHitRate([])).toBeNull()
  })
})
