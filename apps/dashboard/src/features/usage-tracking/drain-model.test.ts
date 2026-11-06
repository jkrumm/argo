import { describe, expect, it } from 'bun:test'
import {
  drainRows,
  drainTicks,
  keyDrain,
  poolDrain,
  subDrain,
  whenText,
  type SubDrainInput,
} from './drain-model'
import { PACE } from './flow-fixtures'

const DAY = 86_400_000
const HOUR = 3_600_000
const local = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

// Next reset Fri 13 Nov 14:00 local; "now" is 3 days before it, 4 days into the 7 d window.
const NEXT = local(2026, 11, 13, 14)
const NOW = NEXT - 3 * DAY
const START = NEXT - 7 * DAY

const sub = (over: Partial<SubDrainInput> = {}): SubDrainInput => ({
  id: 'me',
  title: 'me · Max 5x',
  payer: 'me-sub',
  points: [
    { at: iso(START + 10 * HOUR), sevenDayPct: 10 },
    { at: iso(START + 2 * DAY), sevenDayPct: null },
    { at: iso(START + 4 * DAY - HOUR), sevenDayPct: 40 },
  ],
  resets: [],
  nextResetAt: iso(NEXT),
  sevenDayPct: 40,
  now: NOW,
  ...over,
})

describe('subDrain', () => {
  it('shows two weeks ending at the next reset, left = 100 - used, nulls skipped', () => {
    const m = subDrain(sub())
    expect(m.window).toEqual({ from: NEXT - 14 * DAY, to: NEXT })
    expect(m.actual.map((p) => p.left)).toEqual([90, 60, 60])
    expect(m.actual.at(-1)?.at).toBe(NOW)
    expect(m.subtitle).toContain('last week + this week')
    expect(m.headline).toContain('60')
    expect(m.leftText(62)).toContain('62')
    expect(m.leftText(62)).toContain('38')
  })

  it('draws the even pace over the current window only', () => {
    expect(subDrain(sub()).even).toEqual([
      { at: START, left: 100 },
      { at: NEXT, left: 0 },
    ])
  })

  it('dedupes resets within 2 h and always ends with the next reset', () => {
    const prev = START - 10 * HOUR
    const m = subDrain(
      sub({ resets: [iso(prev), iso(prev + HOUR), iso(NEXT - 30 * 60_000), iso(NEXT)] }),
    )
    expect(m.resets.map((r) => r.at)).toEqual([prev, NEXT])
    expect(m.resets.at(-1)?.label).toBe(`resets ${whenText(NEXT)}`)
  })

  it('falls back to one week before the next reset when the API has none inside', () => {
    expect(subDrain(sub()).resets.map((r) => r.at)).toEqual([START, NEXT])
    expect(subDrain(sub({ resets: [iso(NEXT - 20 * DAY)] })).resets.map((r) => r.at)).toEqual([
      START,
      NEXT,
    ])
  })

  it('projects to empty before the reset when the burn is too fast', () => {
    const m = subDrain(sub({ sevenDayPct: 70 }))
    const emptyAt = NOW + 30 / (70 / (4 * DAY))
    expect(emptyAt).toBeLessThan(NEXT)
    expect(m.runOut?.at).toBeCloseTo(emptyAt, 0)
    expect(m.runOut?.label).toBe(`empty ${whenText(emptyAt)}`)
    expect(m.projection[0]).toEqual({ at: NOW, left: 30 })
    expect(m.projection.at(-1)?.left).toBe(0)
    expect(m.verdict).toContain('Runs out')
    expect(m.verdict).toContain('before the reset')
  })

  it('reaches the reset with leftover when the burn is slow', () => {
    const m = subDrain(sub({ sevenDayPct: 40 }))
    // 10 %/d for 3 more days leaves 60 - 30 = 30 %.
    expect(m.runOut).toBeNull()
    expect(m.projection.at(-1)?.at).toBe(NEXT)
    expect(m.projection.at(-1)?.left).toBeCloseTo(30, 5)
    expect(m.verdict).toContain('≈30')
  })

  it('has no projection when the window just started or the reading is missing', () => {
    const early = subDrain(sub({ now: START + HOUR }))
    expect(early.projection).toEqual([])
    expect(early.verdict).toContain('just started')
    const none = subDrain(sub({ sevenDayPct: null }))
    expect(none.projection).toEqual([])
    expect(none.verdict).toBe('No reading yet')
    expect(none.headline).toBe('—')
  })

  it('is empty without a window or without samples', () => {
    expect(subDrain(sub({ nextResetAt: null })).empty).toBe('No weekly window reported')
    expect(subDrain(sub({ nextResetAt: iso(NOW - HOUR) })).empty).toBe('No weekly window reported')
    expect(subDrain(sub({ points: [], sevenDayPct: null })).empty).toBe('No quota samples yet')
  })

  it('marks an exhausted limit as empty now', () => {
    const m = subDrain(sub({ sevenDayPct: 100 }))
    expect(m.runOut?.at).toBe(NOW)
    expect(m.projection).toEqual([])
  })
})

describe('poolDrain', () => {
  const now = Date.parse(PACE.asOf)
  const input = (account: string) => ({
    id: account,
    title: account,
    payer: `${account}-credit`,
    account,
    pace: PACE,
    now,
  })

  it('converts dollars to a share of the grant', () => {
    const m = poolDrain(input('iu'))
    expect(m.actual[0]).toEqual({ at: Date.parse('2026-10-21T00:00:00Z'), left: 100 })
    expect(m.actual.at(-1)?.left).toBeCloseTo(44.215, 3)
    expect(m.even.map((p) => p.left)).toEqual([100, 0])
    expect(m.leftText(50)).toBe('$100 of $200 left')
    expect(m.headline).toBe('$88 left')
  })

  it('runs out where the projection hits zero and renews at the cycle end', () => {
    const m = poolDrain(input('iu'))
    expect(m.runOut?.at).toBe(Date.parse('2026-11-03T17:00:00.000Z'))
    expect(m.projection.at(-1)?.left).toBe(0)
    expect(m.verdict).toContain('Runs out')
    expect(m.verdict).toContain('before the renewal')
    expect(m.resets.map((r) => r.at)).toEqual([Date.parse('2026-11-21T00:00:00Z')])
    expect(m.window.to).toBe(Date.parse('2026-11-21T00:00:00Z'))
    expect(m.subtitle).toContain('billing cycle')
    expect(m.subtitle).toContain('renews in')
  })

  it('is empty for a pool that is not enabled or unknown', () => {
    expect(poolDrain(input('me2')).empty).toBe('Pool not enabled')
    expect(poolDrain(input('zz')).empty).toBe('Pool not enabled')
  })
})

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
    expect(m.resets).toEqual([{ at: local(2026, 11, 12), label: 'back under cap 12 Nov' }])
    expect(m.verdict).toContain('Over the cap')
    expect(m.verdict).toContain('12 Nov')
  })

  it('is empty without a portal report', () => {
    expect(keyDrain(input({ fetchedAt: null })).empty).toBe('No portal report yet')
  })
})

describe('drainRows', () => {
  it('merges the lines by instant, absent lines as null', () => {
    const rows = drainRows(subDrain(sub()))
    const times = rows.map((r) => r.at.getTime())
    expect(times).toEqual([...new Set(times)].toSorted((a, b) => a - b))
    expect(rows.find((r) => r.at.getTime() === NOW)).toMatchObject({
      actual: 60,
      projection: 60,
      even: null,
    })
    expect(rows.find((r) => r.at.getTime() === START)).toMatchObject({ actual: null, even: 100 })
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
