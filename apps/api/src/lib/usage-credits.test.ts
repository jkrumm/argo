import { describe, it, expect } from 'bun:test'
import {
  addDays,
  burndown,
  cacheHitRate,
  cycleWindow,
  isFallback,
  projectUnspent,
  utcDay,
} from '../routes/usage-credits-math.js'

const at = (iso: string) => new Date(iso)

describe('cycleWindow', () => {
  it('runs a cycle across a month end, the last day being the one before the cycle end', () => {
    const w = cycleWindow(
      { start: at('2026-10-29T14:00:00Z'), end: at('2026-11-02T14:00:00Z') },
      at('2026-10-31T00:00:00Z'),
    )
    expect(w.known).toBe(true)
    expect(w.days).toEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(w.toTs).toEqual(at('2026-11-02T14:00:00Z'))
  })

  it('ends on the previous day when the cycle ends at midnight', () => {
    const w = cycleWindow(
      { start: at('2026-10-01T00:00:00Z'), end: at('2026-11-01T00:00:00Z') },
      at('2026-10-15T00:00:00Z'),
    )
    expect(w.days).toHaveLength(31)
    expect(w.days.at(-1)).toBe('2026-10-31')
  })

  it('falls back to the last 31 days when the cycle end is null', () => {
    const w = cycleWindow(
      { start: at('2026-09-01T00:00:00Z'), end: null },
      at('2026-11-02T10:00:00Z'),
    )
    expect(w.known).toBe(false)
    expect(w.days).toHaveLength(31)
    expect([w.days[0], w.days.at(-1)]).toEqual(['2026-10-03', '2026-11-02'])
    expect(w.fromTs).toEqual(at('2026-10-03T00:00:00Z'))
    expect(w.toTs).toBeNull()
  })

  it('counts rows from the cycle start when that is inside the 31 days, and with no cycle row at all', () => {
    const now = at('2026-11-02T10:00:00Z')
    expect(cycleWindow({ start: at('2026-10-20T08:00:00Z'), end: null }, now).fromTs).toEqual(
      at('2026-10-20T08:00:00Z'),
    )
    expect(cycleWindow(null, now).known).toBe(false)
  })
})

describe('burndown', () => {
  const days = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']
  const base = { days, today: '2026-11-01', grantUsd: 200 }

  it('accumulates both series, leaves the days after today empty and takes the larger as spent', () => {
    const points = burndown({
      ...base,
      metered: [
        { day: '2026-10-30', usd: 10 },
        { day: '2026-11-01', usd: 5 },
      ],
      // The provider also saw $56.11 spent outside the gateway on the 31st.
      reported: [
        { day: '2026-10-30', usd: 10 },
        { day: '2026-10-31', usd: 56.11 },
      ],
    })
    expect(points).toEqual([
      { day: '2026-10-30', meteredUsd: 10, reportedUsd: 10, creditLeftUsd: 190 },
      { day: '2026-10-31', meteredUsd: 10, reportedUsd: 66.11, creditLeftUsd: 133.89 },
      { day: '2026-11-01', meteredUsd: 15, reportedUsd: 66.11, creditLeftUsd: 133.89 },
      { day: '2026-11-02', meteredUsd: null, reportedUsd: null, creditLeftUsd: null },
    ])
  })

  it('keeps the reported series null without a platform_cost figure, and credit left null without a grant', () => {
    const points = burndown({
      ...base,
      grantUsd: null,
      metered: [{ day: '2026-10-30', usd: 3 }],
      reported: null,
    })
    expect(points[1]).toEqual({
      day: '2026-10-31',
      meteredUsd: 3,
      reportedUsd: null,
      creditLeftUsd: null,
    })
  })
})

describe('projectUnspent', () => {
  const now = at('2026-11-02T12:00:00Z')
  const axis = Array.from({ length: 30 }, (_, i) => addDays('2026-10-04', i)) // Oct 4 .. Nov 2
  const spend = (perDay: number) => axis.map((day) => ({ day, usd: perDay }))
  const points = (perDay: number) =>
    burndown({
      days: axis,
      today: utcDay(now),
      grantUsd: 200,
      metered: spend(perDay),
      reported: null,
    })

  it('projects the last seven days forward over the days left, floored at 0', () => {
    // $2/day: 30 days = $60 spent, rate $2, 12 h left = $1 more: 200 − 60 − 1.
    const p = projectUnspent({
      points: points(2),
      today: utcDay(now),
      grantUsd: 200,
      cycleEnd: at('2026-11-03T00:00:00Z'),
      now,
    })
    expect(p).toMatchObject({
      spentUsd: 60,
      dailyRateUsd: 2,
      daysLeft: 0.5,
      projectedUnspentUsd: 139,
    })
    // $20/day overshoots the grant: the projection never goes below zero.
    const over = projectUnspent({
      points: points(20),
      today: utcDay(now),
      grantUsd: 200,
      cycleEnd: at('2026-11-03T00:00:00Z'),
      now,
    })
    expect(over.projectedUnspentUsd).toBe(0)
  })

  it('uses the days elapsed when the axis is younger than a week', () => {
    const young = ['2026-10-31', '2026-11-01', '2026-11-02']
    const pts = burndown({
      days: young,
      today: '2026-11-02',
      grantUsd: 100,
      metered: [{ day: '2026-10-31', usd: 30 }],
      reported: null,
    })
    const p = projectUnspent({
      points: pts,
      today: '2026-11-02',
      grantUsd: 100,
      cycleEnd: at('2026-11-12T12:00:00Z'),
      now,
    })
    expect(p.dailyRateUsd).toBe(10)
    expect(p.projectedUnspentUsd).toBe(0)
  })

  it('has no projection without a grant or a known cycle end', () => {
    const pts = points(2)
    expect(
      projectUnspent({
        points: pts,
        today: utcDay(now),
        grantUsd: null,
        cycleEnd: at('2026-11-03T00:00:00Z'),
        now,
      }).projectedUnspentUsd,
    ).toBeNull()
    const open = projectUnspent({
      points: pts,
      today: utcDay(now),
      grantUsd: 200,
      cycleEnd: null,
      now,
    })
    expect([open.daysLeft, open.projectedUnspentUsd]).toEqual([null, null])
  })
})

describe('isFallback', () => {
  it('counts iu-api for any reason but forced; a pool named iu and a refusal are not fallbacks', () => {
    expect(isFallback('iu-api', 'claude-code')).toBe(true)
    expect(isFallback('iu-api', 'drained')).toBe(true)
    expect(isFallback('iu-api', 'no-pool')).toBe(true)
    expect(isFallback('iu-api', 'forced')).toBe(false)
    expect(isFallback('iu', 'drained')).toBe(false)
    expect(isFallback('me', 'soonest-expiry')).toBe(false)
    expect(isFallback('refused', 'balance')).toBe(false)
  })
})

describe('cacheHitRate', () => {
  it('is cache-read over input + cache-read + cache-write, null without tokens', () => {
    expect(cacheHitRate({ input: 100, cacheRead: 800, cacheWrite: 100 })).toBe(0.8)
    expect(cacheHitRate({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull()
  })
})
