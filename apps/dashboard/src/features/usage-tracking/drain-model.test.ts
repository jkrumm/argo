import { describe, expect, it } from 'bun:test'
import {
  drainRows,
  drainTicks,
  keyDrain,
  placeResetLabel,
  risesOf,
  thinJumps,
  whenText,
  type DrainJump,
} from './drain-model'
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
    history: real.map((d) => ({ day: d.day, rollingUsd: 300 })),
    underCapOn: null as string | null,
    fetchedAt: '2026-11-06T08:00:00Z' as string | null,
  }
  const now = local(2026, 11, 7, 12)
  const input = (over: Partial<typeof budget> = {}) => ({
    id: 'personal',
    title: 'IU personal key',
    budget: { ...budget, ...over },
    now,
  })

  it('draws the recorded line from the rolling sum of each day, in dollars', () => {
    const { model: m } = keyDrain(input())
    expect(m.actual[0]).toEqual({ at: local(2026, 10, 9), left: 200 })
    expect(m.actual.at(-1)?.left).toBeCloseTo(200, 6)
    expect(m.yMax).toBe(500)
    expect(m.headline).toBe('$200 left')
    expect(m.leftText(200)).toBe('$200 of $500 left')
    expect(m.window.from).toBe(local(2026, 10, 9))
  })

  it('projects 30 days: each old day comes back while the last 7 days burn on', () => {
    const { model: m } = keyDrain(input())
    // Each day ahead one old $10 day returns and $10 of burn arrives: the tops stay at $210.
    expect(m.window.to).toBe(local(2026, 11, 7) + 30 * DAY)
    expect(m.projection[0]?.left).toBeCloseTo(200, 6)
    expect(m.projection.find((p) => p.at === local(2026, 11, 20))?.left).toBeCloseTo(210, 6)
    expect(m.runOut).toBeNull()
    expect(m.verdict).toContain('Stays under the cap')
  })

  it('keeps projecting past zero while the key is over its cap', () => {
    const { model: m } = keyDrain(
      input({ rolling30Usd: 513, burn7dUsdPerDay: 0, underCapOn: '2026-11-08' }),
    )
    expect(m.runOut).toBeNull()
    expect(m.projection.at(-1)?.left).toBeCloseTo(287, 6)
    expect(m.projection.filter((p) => p.left > 0).length).toBeGreaterThan(40)
    expect(m.verdict).toBe(`Over the cap, back under ${shortDay(new Date(local(2026, 11, 8)))}`)
  })

  it('labels what a day visibly gives back and lists the next returns', () => {
    const daily = budget.daily.map((d) => (d.day === '2026-10-09' ? { ...d, usd: 40 } : d))
    const { model: m, returns } = keyDrain(input({ daily, burn7dUsdPerDay: 0, rolling30Usd: 490 }))
    // The first old day came back at midnight, before `now`: it is not listed as still to come.
    expect(returns[0]).toMatchObject({ usd: 40, after: '$60 left' })
    expect(returns[0]?.when).toContain('tomorrow')
    expect(returns[1]).toMatchObject({ usd: 10, after: '$70 left' })
    expect(returns).toHaveLength(4)
    expect(m.jumps.find((j) => j.size === 40)?.label).toBe('+$40')
  })

  it('skips the days that give nothing back', () => {
    const daily = budget.daily.map((d) => (d.day < '2026-10-20' ? { ...d, usd: 0 } : d))
    const { returns } = keyDrain(input({ daily }))
    expect(returns[0]?.at).toBe(local(2026, 11, 7) + 12 * DAY)
    expect(returns[0]?.when).toContain('in 12 d')
  })

  it('marks the run-out when the burn outruns the drop-off', () => {
    const { model: m } = keyDrain(input({ burn7dUsdPerDay: 60 }))
    expect(m.runOut?.label).toMatch(/^empty /)
    expect(m.runOut?.at).toBeGreaterThan(now - DAY)
    expect(m.verdict).toMatch(/^Hits the cap /)
  })

  it('says how far over the cap it is, in the warn tone, instead of $0 left', () => {
    const { model: over } = keyDrain(input({ rolling30Usd: 548.43 }))
    expect(over.headline).toBe('$48 over cap')
    expect(over.headlineTone).toBe('warn')
    expect(keyDrain(input()).model.headlineTone).toBeUndefined()
  })

  it('is empty without a portal report', () => {
    expect(keyDrain(input({ fetchedAt: null })).model.empty).toBe('No portal report yet')
  })
})

describe('drainRows', () => {
  it('merges the lines by instant, absent lines as null', () => {
    const { model: m } = keyDrain({
      id: 'personal',
      title: 'IU personal key',
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
        history: [
          { day: '2026-11-01', rollingUsd: 10 },
          { day: '2026-11-02', rollingUsd: 20 },
        ],
        underCapOn: null,
        fetchedAt: '2026-11-03T00:00:00Z',
      },
      now: local(2026, 11, 2, 12),
    })
    const rows = drainRows(m)
    const times = rows.map((r) => r.at.getTime())
    expect(times).toEqual([...new Set(times)].toSorted((a, b) => a - b))
    expect(rows[0]).toMatchObject({ actual: 490, projection: null, even: null })
    const anchor = rows.find((r) => r.projection !== null && r.actual !== null)
    expect(anchor?.projection).toBeCloseTo(anchor?.actual ?? NaN, 5)
  })
})

describe('risesOf', () => {
  const at = (ms: number, left: number) => ({ at: ms, left })
  const label = (r: number) => `+${r}`

  it('labels one rising run at its top, however many samples it spans', () => {
    expect(risesOf([at(0, 10), at(1, 30), at(2, 50), at(3, 40)], 5, label)).toEqual([
      { at: 2, left: 50, label: '+40', size: 40 },
    ])
  })

  it('finds every run and drops the ones under the minimum', () => {
    const jumps = risesOf([at(0, 10), at(1, 12), at(2, 5), at(3, 50), at(4, 50)], 5, label)
    expect(jumps.map((j) => j.at)).toEqual([3])
  })

  it('catches a rise on the last point', () => {
    expect(risesOf([at(0, 0), at(1, 9)], 5, label).map((j) => j.at)).toEqual([1])
  })
})

describe('thinJumps', () => {
  const jump = (at: number, size: number): DrainJump => ({ at, left: 0, label: '', size })

  it('keeps the bigger of two jumps that would touch, in time order', () => {
    const kept = thinJumps([jump(0, 5), jump(10, 50), jump(100, 1)], (x) => x, 44)
    expect(kept.map((j) => j.at)).toEqual([10, 100])
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
