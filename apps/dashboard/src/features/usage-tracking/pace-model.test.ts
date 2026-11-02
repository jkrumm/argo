import { describe, expect, it } from 'bun:test'
import { PACE } from './flow-fixtures'
import { paceModel, paceRows, paceTicks, projectionLabel } from './pace-model'

const iso = (ms: number) => new Date(ms).toISOString()

describe('paceModel', () => {
  const model = paceModel(PACE)

  it('draws an actual, an even-pace and a projection line per enabled pool, none for the disabled one', () => {
    expect(model.lines.map((l) => l.key)).toEqual([
      'iu',
      'iu:even',
      'iu:projection',
      'me',
      'me:even',
      'me:projection',
    ])
  })

  it('the actual line runs from the grant to the credit left now', () => {
    const iu = model.lines.find((l) => l.key === 'iu')
    expect(iu?.points.at(0)).toEqual({ at: Date.parse('2026-10-21T00:00:00Z'), usd: 200 })
    expect(iu?.points.at(-1)).toEqual({ at: model.now, usd: 88.43 })
    // Today's burn-down entry is the credit left now, never a midnight that has not come.
    expect(iu?.points.some((p) => iso(p.at) === '2026-11-03T00:00:00.000Z')).toBe(false)
  })

  it('the even pace is the grant down to zero at expiry', () => {
    const even = model.lines.find((l) => l.key === 'iu:even')
    expect(even?.points.map((p) => p.usd)).toEqual([200, 0])
    expect(iso(even?.points.at(-1)?.at ?? 0)).toBe('2026-11-21T00:00:00.000Z')
  })

  it('a pool the router reaches later stays flat until it starts drawing, then drops to dry', () => {
    const me = model.lines.find((l) => l.key === 'me:projection')
    expect(me?.points.map((p) => [iso(p.at), p.usd])).toEqual([
      ['2026-11-02T16:00:00.000Z', 93.09],
      ['2026-11-03T17:00:00.000Z', 93.09],
      ['2026-11-04T19:00:00.000Z', 0],
    ])
  })

  it('a pool that outlasts its cycle projects to the credit left at expiry', () => {
    const pools = PACE.pools.map((p) =>
      p.account === 'iu'
        ? { ...p, projection: { ...p.projection, dryAt: null, unspentAtEndUsd: 40 } }
        : p,
    )
    const line = paceModel({ ...PACE, pools }).lines.find((l) => l.key === 'iu:projection')
    expect(line?.points.at(-1)).toEqual({ at: Date.parse('2026-11-21T00:00:00Z'), usd: 40 })
  })

  it('marks where each pool runs dry and when each expires', () => {
    expect(model.dry.map((d) => d.label)).toEqual(['iu dry 3 Nov', 'me dry 4 Nov'])
    expect(model.expiry.map((e) => e.label)).toEqual(['iu renews', 'me renews'])
  })

  it('shades the spill with its days and list dollars', () => {
    expect(model.spill?.label).toBe(
      'No pool left · Claude seats on GPT, IU personal key · 16 d · ≈ $1,380 of Claude work',
    )
    expect(paceModel({ ...PACE, spill: null }).spill).toBeNull()
  })

  it('the axis runs from the earliest cycle start to the latest expiry', () => {
    expect(iso(model.domain[0])).toBe('2026-10-21T00:00:00.000Z')
    expect(iso(model.domain[1])).toBe('2026-11-27T00:00:00.000Z')
    expect(model.maxUsd).toBe(200)
  })

  it('one pool alone adds the provider report as its own line', () => {
    const one = paceModel(PACE, { account: 'iu' })
    const report = one.lines.find((l) => l.key === 'iu:report')
    // The grant less the report's cumulative daily spend: 200 − 56.11 on 31 Oct, − 43.5 more on 2 Nov.
    expect(report?.points.at(-1)?.usd).toBeCloseTo(200 - 56.11 - 43.5, 2)
    expect(one.lines.every((l) => l.account === 'iu')).toBe(true)
  })

  it('no enabled pool draws nothing', () => {
    const none = paceModel({ ...PACE, pools: PACE.pools.filter((p) => !p.enabled) })
    expect(none.lines).toEqual([])
  })
})

describe('chart rows and labels', () => {
  it('one row per instant, a line absent where it has no point', () => {
    const rows = paceRows(paceModel(PACE))
    const times = rows.map((r) => r.at.getTime())
    expect(times).toEqual([...times].toSorted((a, b) => a - b))
    expect(new Set(times).size).toBe(times.length)
    const first = rows.at(0)
    expect(first?.values['iu']).toBe(200)
    expect(first?.values['me']).toBeNull()
  })

  it('labels the projection with the production rate', () => {
    expect(projectionLabel(PACE)).toBe('projection at $85/d')
  })

  it('ticks sit on UTC midnights across the domain', () => {
    const ticks = paceTicks([
      Date.parse('2026-10-21T00:00:00Z'),
      Date.parse('2026-11-27T00:00:00Z'),
    ])
    expect(ticks.length).toBeGreaterThanOrEqual(5)
    expect(ticks.every((t) => t.getTime() % 86_400_000 === 0)).toBe(true)
  })
})
