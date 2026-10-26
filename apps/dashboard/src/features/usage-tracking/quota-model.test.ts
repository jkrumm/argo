import { describe, expect, it } from 'bun:test'
import { coverageLine, laneRows, orderAccounts, orderPicked, rangeHours } from './quota-model'

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

describe('coverageLine', () => {
  it('names the first bucket and the pick count', () => {
    expect(
      coverageLine({
        total: 89,
        series: [
          { at: '2026-10-25T00:00:00.000Z', picks: { iu: 4 } },
          { at: '2026-10-24T12:00:00.000Z', picks: { iu: 85 } },
        ],
      }),
    ).toBe('since 24 Oct · 89 picks')
  })

  it('is absent without picks, singular for one', () => {
    expect(coverageLine({ total: 0, series: [] })).toBeNull()
    expect(
      coverageLine({ total: 1, series: [{ at: '2026-10-24T12:00:00.000Z', picks: { iu: 1 } }] }),
    ).toBe('since 24 Oct · 1 pick')
  })
})

describe('rangeHours', () => {
  it('maps ranges to hours', () => {
    expect(rangeHours('7d')).toBe(168)
    expect(rangeHours('all')).toBe(8760)
  })
})
