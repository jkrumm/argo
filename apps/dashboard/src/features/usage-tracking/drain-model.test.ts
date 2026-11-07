import { describe, expect, it } from 'bun:test'
import { drainRows, drainTicks, keyDrain, placeResetLabel, whenText } from './drain-model'
import { shortDay } from './model'

const DAY = 86_400_000
const local = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()

describe('keyDrain', () => {
  // 30 real days 2026-10-08 .. 2026-11-06 at $10 each, plus one day before the window.
  const real = Array.from({ length: 30 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 9, 8 + i)).toISOString().slice(0, 10),
    usd: 10,
  }))
  const budget = {
    limitUsd: 500,
    windowFrom: '2026-10-08',
    windowTo: '2026-11-06',
    rolling30Usd: 300,
    burn7dUsdPerDay: 10,
    daily: [{ day: '2026-10-07', usd: 999 }, ...real],
    underCapOn: null as string | null,
    fetchedAt: '2026-11-06T08:00:00Z' as string | null,
  }
  const now = local(2026, 11, 7, 12)
  const input = (over: Partial<typeof budget> = {}) => ({
    id: 'personal',
    title: 'IU personal key',
    payer: 'iu-api',
    budget: { ...budget, ...over },
    now,
  })

  it('counts the cumulative spend from the window start, ignoring days outside it', () => {
    const m = keyDrain(input())
    expect(m.actual[0]).toEqual({ at: local(2026, 10, 8), left: 100 })
    expect(m.actual[1]?.left).toBeCloseTo(98, 6)
    expect(m.actual.at(-1)?.left).toBeCloseTo(40, 6)
    expect(m.headline).toBe('$200 left')
    expect(m.leftText(40)).toBe('$200 of $500 left')
    expect(m.even).toEqual([])
    expect(m.subtitle).toBe('rolling 30 d window · no reset, old days drop off')
  })

  it('lets old days drop off in the projection while the last 7 days burn on', () => {
    const m = keyDrain(input())
    // Each day ahead one old $10 day drops and $10 of burn arrives: flat at 40 %.
    expect(m.projection.length).toBe(15)
    expect(m.projection.every((p) => Math.abs(p.left - 40) < 1e-6)).toBe(true)
    expect(m.runOut).toBeNull()
    expect(m.verdict).toContain('Stays under the cap')
    expect(m.window.to).toBe(local(2026, 11, 7) + 14 * DAY)
  })

  it('marks the run-out when the burn outruns the drop-off', () => {
    const m = keyDrain(input({ burn7dUsdPerDay: 60 }))
    // Net +50 $/d on $200 of headroom: empty after 4 days.
    const at = m.actual.at(-1)?.at ?? 0
    expect(m.runOut?.at).toBe(at + 4 * DAY)
    expect(m.projection.at(-1)).toEqual({ at: at + 4 * DAY, left: 0 })
    expect(m.verdict).toContain('Hits the cap')
  })

  it('names the day it is back under the cap', () => {
    const m = keyDrain(input({ rolling30Usd: 600, burn7dUsdPerDay: 0, underCapOn: '2026-11-12' }))
    expect(m.runOut?.at).toBe(m.actual.at(-1)?.at)
    expect(m.resets).toEqual([
      {
        at: local(2026, 11, 12),
        label: `back under cap ${shortDay(new Date(local(2026, 11, 12)))}`,
      },
    ])
    expect(m.verdict).toContain('Over the cap')
    expect(m.verdict).toContain(shortDay(new Date(local(2026, 11, 12))))
  })

  it('says how far over the cap it is, in the warn tone, instead of $0 left', () => {
    const over = keyDrain(input({ rolling30Usd: 548.43 }))
    expect(over.headline).toBe('$48 over cap')
    expect(over.headlineTone).toBe('warn')
    const under = keyDrain(input())
    expect(under.headline).toContain('left')
    expect(under.headlineTone).toBeUndefined()
  })

  it('is empty without a portal report', () => {
    expect(keyDrain(input({ fetchedAt: null })).empty).toBe('No portal report yet')
  })
})

describe('drainRows', () => {
  it('merges the lines by instant, absent lines as null', () => {
    const m = keyDrain({
      id: 'personal',
      title: 'IU personal key',
      payer: 'iu-api',
      budget: {
        limitUsd: 500,
        windowFrom: '2026-11-01',
        windowTo: '2026-11-02',
        rolling30Usd: 20,
        burn7dUsdPerDay: 10,
        daily: [
          { day: '2026-11-01', usd: 10 },
          { day: '2026-11-02', usd: 10 },
        ],
        underCapOn: null,
        fetchedAt: '2026-11-03T00:00:00Z',
      },
      now: local(2026, 11, 3, 12),
    })
    const rows = drainRows(m)
    const times = rows.map((r) => r.at.getTime())
    expect(times).toEqual([...new Set(times)].toSorted((a, b) => a - b))
    expect(rows[0]).toMatchObject({ actual: 100, projection: null, even: null })
    const anchor = rows.find((r) => r.projection !== null && r.actual !== null)
    expect(anchor?.projection).toBeCloseTo(anchor?.actual ?? NaN, 5)
  })
})

describe('drainTicks', () => {
  it('is local midnights inside the window, capped', () => {
    const window = { from: local(2026, 11, 1, 6), to: local(2026, 11, 15, 6) }
    const all = drainTicks(window, 100)
    expect(all.length).toBe(14)
    expect(all.every((t) => t.getHours() === 0)).toBe(true)
    expect(drainTicks(window, 4).length).toBeLessThanOrEqual(4)
  })
})

describe('whenText', () => {
  it('reads weekday and local time', () => {
    expect(whenText(local(2026, 11, 13, 14))).toBe('Fri 14:00')
  })
})

describe('placeResetLabel', () => {
  const base = { full: 'under cap 12 Nov', short: '12 Nov' }

  it('puts the full label right of the rule when it fits', () => {
    const p = placeResetLabel({ ...base, plotWidth: 680, nowFraction: 0.74, resetFraction: 0.8 })
    expect(p).toEqual({ text: 'under cap 12 Nov', anchor: 'start', row: 0 })
  })

  it('shortens it on a narrow plot where the rule sits close to now', () => {
    const p = placeResetLabel({ ...base, plotWidth: 280, nowFraction: 0.62, resetFraction: 0.72 })
    expect(p).toEqual({ text: '12 Nov', anchor: 'start', row: 0 })
  })

  it('drops to the row under now when neither side is clear', () => {
    const p = placeResetLabel({ ...base, plotWidth: 280, nowFraction: 0.9, resetFraction: 0.98 })
    expect(p.row).toBe(1)
  })

  it('never overlaps the now label when now is in the left half', () => {
    // now label sits right of its rule; a reset right behind it must clear it.
    const p = placeResetLabel({ ...base, plotWidth: 680, nowFraction: 0.3, resetFraction: 0.31 })
    expect(p).toEqual({ text: 'under cap 12 Nov', anchor: 'end', row: 0 })
  })
})
