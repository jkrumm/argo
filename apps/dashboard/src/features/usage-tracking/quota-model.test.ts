import { describe, expect, it } from 'bun:test'
import {
  laneRows,
  orderAccounts,
  orderPicked,
  pickRows,
  quotaKey,
  quotaRows,
  rangeDomain,
  rangeHours,
} from './quota-model'

describe('quotaRows', () => {
  const data = {
    series: [
      {
        account: 'me',
        points: [{ at: '2026-10-01T10:15:00.000Z', fiveHourPct: 40, sevenDayPct: 55 }],
      },
      {
        account: 'iu',
        points: [
          { at: '2026-10-01T10:00:00.000Z', fiveHourPct: 10, sevenDayPct: 20 },
          { at: '2026-10-01T10:15:00.000Z', fiveHourPct: null, sevenDayPct: 21 },
        ],
      },
    ],
    resets: [
      { account: 'iu', window: 'five_hour' as const, at: '2026-10-01T10:15:00.000Z' },
      { account: 'iu', window: 'seven_day' as const, at: '2026-10-01T09:00:00.000Z' },
    ],
  }

  it('merges accounts onto one row per instant, registry order', () => {
    const { accounts, rows } = quotaRows(data)
    expect(accounts).toEqual(['iu', 'me'])
    expect(rows.map((r) => r.date.toISOString())).toEqual([
      '2026-10-01T10:00:00.000Z',
      '2026-10-01T10:15:00.000Z',
    ])
    expect(rows[0]?.values).toEqual({ 'iu:five': 10, 'iu:seven': 20 })
    expect(rows[1]?.values).toEqual({
      'iu:five': null,
      'iu:seven': 21,
      'me:five': 40,
      'me:seven': 55,
    })
  })

  it('marks a reset only where a sample sits at that instant', () => {
    const { rows } = quotaRows(data)
    expect(rows[1]?.resets.has(quotaKey('iu', 'five'))).toBe(true)
    expect(rows.some((r) => r.resets.has(quotaKey('iu', 'seven')))).toBe(false)
  })
})

describe('ordering', () => {
  it('puts registry accounts first and spill last', () => {
    expect(orderAccounts(['zz', 'me', 'iu'])).toEqual(['iu', 'me', 'zz'])
    expect(orderPicked(['spill', 'me', 'iu'])).toEqual(['iu', 'me', 'spill'])
  })
})

describe('laneRows', () => {
  it('sums per lane, busiest first, with reasons ranked', () => {
    const rows = laneRows([
      { lane: 'wave', picked: 'me', reason: 'home', count: 8 },
      { lane: 'wave', picked: 'iu', reason: 'other', count: 3 },
      { lane: 'wave', picked: 'me', reason: 'expiring', count: 4 },
      { lane: 'interactive', picked: 'iu', reason: 'home', count: 2 },
    ])
    expect(rows.map((r) => r.lane)).toEqual(['wave', 'interactive'])
    expect(rows[0]).toEqual({
      lane: 'wave',
      total: 15,
      byPicked: { me: 12, iu: 3 },
      reasons: [
        { reason: 'home', count: 8 },
        { reason: 'expiring', count: 4 },
        { reason: 'other', count: 3 },
      ],
    })
  })
})

describe('pickRows / range', () => {
  it('parses bucket instants', () => {
    const rows = pickRows({
      total: 1,
      bucketHours: 1,
      counts: [],
      pickedKeys: ['iu'],
      series: [{ at: '2026-10-01T10:00:00.000Z', picks: { iu: 1 } }],
    })
    expect(rows[0]?.date.toISOString()).toBe('2026-10-01T10:00:00.000Z')
  })

  it('maps ranges to hours and leaves "all" open-ended', () => {
    expect(rangeHours('7d')).toBe(168)
    expect(rangeDomain('all', Date.now())).toBeUndefined()
    const now = Date.parse('2026-10-10T12:00:00Z')
    expect(rangeDomain('7d', now)?.[1].getTime()).toBe(now)
  })
})
