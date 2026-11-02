import { describe, it, expect } from 'bun:test'
import {
  cacheDrop,
  capNear,
  claudeOnIu,
  costPerRun,
  detectInsights,
  isThin,
  mover,
  periodWindows,
  poolSplit,
  topShare,
  usd,
  usdPerRun,
  type BudgetLike,
  type DemandLike,
  type DemandRowLike,
  type InsightDraft,
  type InsightInputs,
  type RouterLike,
} from './usage-insights.js'

const ASOF = new Date('2026-11-09T12:00:00Z')
const LONG_AGO = new Date('2026-10-01T00:00:00Z')

const row = (key: string, usdValue: number, over: Partial<DemandRowLike> = {}): DemandRowLike => ({
  key,
  usd: usdValue,
  runs: 0,
  byPayer: {},
  ...over,
})
const slice = (...rows: DemandRowLike[]): DemandLike => ({
  rows,
  totals: { usd: rows.reduce((acc, r) => acc + r.usd, 0) },
})
const router = (over: Partial<RouterLike> = {}): RouterLike => ({
  iu: [],
  cache: [],
  picksAvailable: true,
  routeFallbackMeasured: true,
  ...over,
})
const base = (over: Partial<InsightInputs> = {}): InsightInputs => ({
  asOf: ASOF,
  period: '7d',
  gatewaySince: LONG_AGO,
  demand: null,
  demandPrevious: null,
  productionCredit: null,
  evalCredit: null,
  demandByCaller: null,
  router: null,
  routerPrevious: null,
  budgets: {},
  ...over,
})
const only = (drafts: InsightDraft[]) => {
  expect(drafts).toHaveLength(1)
  return drafts[0]!
}

describe('money formatting', () => {
  it('follows the vocabulary: whole dollars, cents under $10, <$1', () => {
    expect(usd(0)).toBe('$0')
    expect(usd(0.4)).toBe('<$1')
    expect(usd(1)).toBe('$1.00')
    expect(usd(9.994)).toBe('$9.99')
    expect(usd(999.6)).toBe('$1,000')
    expect(usd(10)).toBe('$10')
    expect(usd(54.3)).toBe('$54')
    expect(usd(1380.4)).toBe('$1,380')
  })
  it('never prints $10.00: cents round before the whole-dollar cut', () => {
    for (const v of [9.995, 9.996, 9.997, 9.998, 9.999]) {
      expect(usd(v)).not.toBe('$10.00')
      expect(usdPerRun(v)).not.toBe('$10.00')
    }
    expect(usd(9.996)).toBe('$10')
    expect(usd(9.994)).toBe('$9.99')
    expect(usdPerRun(9.999)).toBe('$10')
  })
  it('a cost per run keeps its cents below one dollar', () => {
    expect(usdPerRun(0.78)).toBe('$0.78')
    expect(usdPerRun(0.162)).toBe('$0.16')
    expect(usdPerRun(0.001)).toBe('<$0.01')
    expect(usdPerRun(12.4)).toBe('$12')
  })
})

describe('thin', () => {
  const { current, previous } = periodWindows(ASOF, '7d')
  it('is true under 24 h of gateway data inside a window, or without a first row', () => {
    expect(isThin(null, current)).toBe(true)
    expect(isThin(new Date(ASOF.getTime() - 23 * 3_600_000), current)).toBe(true)
    expect(isThin(new Date(ASOF.getTime() - 25 * 3_600_000), current)).toBe(false)
  })
  it('judges the previous window too', () => {
    const since = new Date(ASOF.getTime() - 7.5 * 86_400_000)
    expect(isThin(since, current)).toBe(false)
    expect(isThin(since, current, previous)).toBe(true)
  })
  it('windows are two equal consecutive periods', () => {
    expect(current.from.getTime()).toBe(previous.to.getTime())
    expect(current.to.getTime() - current.from.getTime()).toBe(
      previous.to.getTime() - previous.from.getTime(),
    )
  })
})

describe('top-share', () => {
  const fire = (review: number, other: number) =>
    topShare(base({ productionCredit: slice(row('review', review), row('digest', other)) }))
  it('fires at 50 % and names the workflow, the share and the node', () => {
    const insight = only(fire(50, 50))
    expect(insight.id).toBe('top-share')
    expect(insight.node).toBe('demand:review')
    expect(insight.sentence).toStartWith('review is 50 % of production credit')
    expect(insight.facts['share']).toBe(0.5)
    expect(insight.usdMoved).toBe(50)
    expect(insight.thin).toBe(false)
  })
  it('does not fire just under 50 %', () => {
    const slices = [
      slice(row('a', 49.99), row('b', 30), row('c', 20.01)),
      slice(row('a', 49), row('b', 48), row('c', 3)),
    ]
    for (const productionCredit of slices) expect(topShare(base({ productionCredit }))).toEqual([])
  })
  it('names whichever workflow holds the majority', () => {
    expect(only(fire(49.99, 50.01)).node).toBe('demand:digest')
  })
  it('reads 98 % from the spec example', () => {
    expect(only(fire(54.3, 1.15)).sentence).toContain('review is 98 % of production credit')
  })
  it('ignores an (unset) bucket as a subject and an unreadable or empty source', () => {
    expect(topShare(base({ productionCredit: slice(row('(unset)', 90), row('a', 10)) }))).toEqual(
      [],
    )
    expect(topShare(base())).toEqual([])
    expect(topShare(base({ productionCredit: slice() }))).toEqual([])
  })
  it('is thin on a young gateway', () => {
    const young = new Date(ASOF.getTime() - 3_600_000)
    expect(
      only(topShare(base({ gatewaySince: young, productionCredit: slice(row('a', 10)) }))).thin,
    ).toBe(true)
  })
})

describe('mover', () => {
  const run = (nowUsd: number, before: number) =>
    mover(
      base({ demand: slice(row('review', nowUsd)), demandPrevious: slice(row('review', before)) }),
    )
  it('fires at $5 and 30 %', () => {
    const insight = only(run(130, 100))
    expect(insight.id).toBe('mover')
    expect(insight.node).toBe('demand:review')
    expect(insight.usdMoved).toBe(30)
    expect(insight.sentence).toBe(
      'review spend rose 30 %, from $100 to $130, against the previous 7 days.',
    )
    expect(only(run(15, 10)).usdMoved).toBe(5)
  })
  it('does not fire under $5, under 30 %, or without earlier spend', () => {
    expect(run(14.99, 10)).toEqual([])
    expect(run(129, 100)).toEqual([])
    expect(run(100, 0)).toEqual([])
  })
  it('reads a fall, picks the biggest dollar move, and sees a workflow that stopped', () => {
    const insight = only(
      mover(
        base({
          demand: slice(row('a', 20), row('b', 200)),
          demandPrevious: slice(row('a', 10), row('b', 100), row('gone', 150)),
        }),
      ),
    )
    expect(insight.node).toBe('demand:gone')
    expect(insight.sentence).toBe(
      'gone spend fell 100 %, from $150 to $0, against the previous 7 days.',
    )
    expect(insight.usdMoved).toBe(150)
  })
  it('is thin when the previous window predates the gateway', () => {
    const since = new Date(ASOF.getTime() - 7.5 * 86_400_000)
    expect(
      only(
        mover(
          base({
            gatewaySince: since,
            demand: slice(row('r', 130)),
            demandPrevious: slice(row('r', 100)),
          }),
        ),
      ).thin,
    ).toBe(true)
  })
  it('stays silent while either period is unreadable', () => {
    expect(mover(base({ demand: slice(row('r', 130)) }))).toEqual([])
    expect(mover(base({ demandPrevious: slice(row('r', 130)) }))).toEqual([])
  })
})

describe('cost-per-run', () => {
  const run = (now: [number, number], before: [number, number]) =>
    costPerRun(
      base({
        demand: slice(row('review', now[0], { runs: now[1] })),
        demandPrevious: slice(row('review', before[0], { runs: before[1] })),
      }),
    )
  it('fires at 30 % with 5 runs in each period and prints cents', () => {
    const insight = only(run([16, 100], [78, 100]))
    expect(insight.id).toBe('cost-per-run')
    expect(insight.sentence).toBe(
      'the cost per review fell from $0.78 to $0.16 (100 runs before, 100 now).',
    )
    expect(insight.usdMoved).toBe(62)
    expect(only(run([13, 5], [50, 5])).facts['runs']).toBe(5)
    expect(only(run([130, 10], [100, 10])).sentence).toContain('rose')
  })
  it('does not fire under 30 %, or under 5 runs in either period', () => {
    expect(run([129, 10], [100, 10])).toEqual([])
    expect(run([13, 4], [50, 5])).toEqual([])
    expect(run([13, 5], [50, 4])).toEqual([])
  })
  it('does not fire without a previous period or earlier runs', () => {
    expect(costPerRun(base({ demand: slice(row('r', 10, { runs: 10 })) }))).toEqual([])
    expect(run([13, 5], [0, 5])).toEqual([])
  })
})

describe('pool-split', () => {
  const credit = (pool: string, value: number) =>
    row('w', value, { byPayer: { [`${pool}-credit`]: value } })
  const run = (evalPools: DemandRowLike[], prodPools: DemandRowLike[]) =>
    poolSplit(base({ evalCredit: slice(...evalPools), productionCredit: slice(...prodPools) }))
  it('fires when two pools each carry a 90 % share', () => {
    const insight = only(run([credit('me', 7)], [credit('iu', 55)]))
    expect(insight.sentence).toBe('`me` carries every eval, `iu` every production call.')
    expect(insight.node).toBe('pool:iu')
    expect(insight.usdMoved).toBe(62)
  })
  it('fires at exactly 90 % and words a share below "every"', () => {
    const insight = only(
      run([credit('me', 90), credit('iu', 10)], [credit('iu', 95), credit('me', 5)]),
    )
    expect(insight.sentence).toBe('`me` carries 90 % of eval spend, `iu` 95 % of production spend.')
  })
  it('does not fire under 90 %, on the same pool, or with nothing on one side', () => {
    expect(run([credit('me', 89), credit('iu', 11)], [credit('iu', 100)])).toEqual([])
    expect(run([credit('me', 100)], [credit('iu', 89), credit('me', 11)])).toEqual([])
    expect(run([credit('iu', 5)], [credit('iu', 50)])).toEqual([])
    expect(run([], [credit('iu', 50)])).toEqual([])
    expect(poolSplit(base())).toEqual([])
  })
  it('ignores non-credit payers in a row', () => {
    const mixed = row('w', 100, { byPayer: { 'iu-api': 60, 'iu-credit': 40 } })
    expect(run([credit('me', 5)], [mixed])).toHaveLength(1)
  })
})

describe('claude-on-iu', () => {
  const traffic = [{ caller: 'agw', target: 'iu', requests: 10, hitRate: 0.8 }]
  const run = (iu: RouterLike['iu'], over: Partial<RouterLike> = {}) =>
    claudeOnIu(base({ router: router({ iu, cache: traffic, ...over }) }))
  it('warns above $1 and lists the causes', () => {
    const insight = only(
      run([
        { cause: 'credit-fallback', usd: 1.5 },
        { cause: 'claude-code', usd: 0.51 },
        { cause: 'design', usd: 99 },
      ]),
    )
    expect(insight.node).toBe('router')
    expect(insight.sentence).toBe(
      'Claude work reached IU: $2.01 in the last 7 days (Claude Code <$1, credit fallback $1.50), in Claude list dollars.',
    )
    expect(insight.usdMoved).toBe(2.01)
    expect(insight.facts['routeFallbackUsd']).toBe(0)
  })
  it('does not warn at exactly $1 or under', () => {
    expect(
      run([
        { cause: 'forced', usd: 50 },
        { cause: 'credit-fallback', usd: 1 },
      ]),
    ).toEqual([])
    expect(run([{ cause: 'credit-fallback', usd: 0.3 }])).toEqual([])
  })
  it('reassures at $0 with gateway traffic and ranks last (usdMoved 0)', () => {
    const insight = only(run([{ cause: 'design', usd: 3 }]))
    expect(insight.sentence).toBe('no Claude work fell back to IU in the last 7 days.')
    expect(insight.usdMoved).toBe(0)
  })
  it('reads fractions of a cent as $0, and stops at half a cent', () => {
    expect(only(run([{ cause: 'claude-code', usd: 0.0038 }])).usdMoved).toBe(0)
    expect(run([{ cause: 'claude-code', usd: 0.005 }])).toEqual([])
  })
  it('says when the route fallback is not measured yet', () => {
    expect(only(run([], { routeFallbackMeasured: false })).sentence).toContain('not measured yet')
  })
  it('stays silent without traffic, without readable picks, or without the router', () => {
    expect(claudeOnIu(base({ router: router() }))).toEqual([])
    expect(run([], { picksAvailable: false })).toEqual([])
    expect(run([{ cause: 'credit-fallback', usd: 50 }], { picksAvailable: false })).toEqual([])
    expect(claudeOnIu(base())).toEqual([])
  })
})

describe('cache-drop', () => {
  const cacheRow = (hitRate: number | null, requests = 50, caller = 'agw', target = 'iu') => ({
    caller,
    target,
    requests,
    hitRate,
  })
  const run = (now: ReturnType<typeof cacheRow>, before: ReturnType<typeof cacheRow>) =>
    cacheDrop(
      base({
        router: router({ cache: [now] }),
        routerPrevious: router({ cache: [before] }),
        demandByCaller: slice(row('agw', 120)),
      }),
    )
  it('fires at 15 points on 50 requests in each period', () => {
    const insight = only(run(cacheRow(0.7), cacheRow(0.85)))
    expect(insight.id).toBe('cache-drop')
    expect(insight.node).toBe('router')
    expect(insight.sentence).toBe(
      "agw's cache hit rate on `iu` fell from 85 % to 70 % against the previous 7 days.",
    )
    expect(insight.usdMoved).toBe(120)
  })
  it('does not fire at 14.9 points, under 50 requests, or on a rise', () => {
    expect(run(cacheRow(0.701), cacheRow(0.85))).toEqual([])
    expect(run(cacheRow(0.7, 49), cacheRow(0.85))).toEqual([])
    expect(run(cacheRow(0.7), cacheRow(0.85, 49))).toEqual([])
    expect(run(cacheRow(0.9), cacheRow(0.7))).toEqual([])
  })
  it('needs a hit rate and the same caller × target in both periods', () => {
    expect(run(cacheRow(null), cacheRow(0.85))).toEqual([])
    expect(run(cacheRow(0.5, 50, 'agw', 'me'), cacheRow(0.85))).toEqual([])
    expect(cacheDrop(base({ router: router() }))).toEqual([])
  })
  it('names the IU key for the passthrough target and prefers the caller with more spend', () => {
    const insight = only(
      cacheDrop(
        base({
          router: router({
            cache: [cacheRow(0.5, 60, 'hermes', 'iu-api'), cacheRow(0.5, 60, 'agw', 'me')],
          }),
          routerPrevious: router({
            cache: [cacheRow(0.9, 60, 'hermes', 'iu-api'), cacheRow(0.9, 60, 'agw', 'me')],
          }),
          demandByCaller: slice(row('agw', 10), row('hermes', 40)),
        }),
      ),
    )
    expect(insight.facts['caller']).toBe('hermes')
    expect(insight.sentence).toContain('on the IU key')
  })
})

describe('cap-near', () => {
  const budget = (rolling30Usd: number, over: Partial<BudgetLike> = {}): BudgetLike => ({
    limitUsd: 500,
    rolling30Usd,
    underCapOn: null,
    fetchedAt: '2026-11-09T08:00:00Z',
    ...over,
  })
  it('fires at 80 % of the cap with the headroom and the portal age', () => {
    const insight = only(capNear(base({ budgets: { 'athena-team': budget(465) } })))
    expect(insight.node).toBe('key:athena-team')
    expect(insight.sentence).toBe('the Athena key has $35 of headroom.')
    expect(insight.facts['fetchedAt']).toBe('2026-11-09T08:00:00Z')
    expect(insight.facts['freshness']).toBe('fresh')
    expect(insight.facts['headroomUsd']).toBe(35)
    expect(insight.thin).toBe(false)
  })
  it('ranks by urgency: usdMoved is the rolling 30-day spend, so 99 % outranks 81 %', () => {
    const drafts = capNear(base({ budgets: { personal: budget(405), 'athena-team': budget(495) } }))
    expect(drafts.map((d) => d.usdMoved)).toEqual([405, 495])
    const ranked = detectInsights(
      base({ budgets: { personal: budget(405), 'athena-team': budget(495) } }),
    )
    expect(ranked.map((i) => i.node)).toEqual(['key:athena-team', 'key:personal'])
  })
  it('is thin and says how old a stale portal report is (> 8 h), and calls > 48 h dead', () => {
    const at = (hoursAgo: number) => new Date(ASOF.getTime() - hoursAgo * 3_600_000).toISOString()
    const eight = only(capNear(base({ budgets: { personal: budget(450, { fetchedAt: at(8) }) } })))
    expect(eight.thin).toBe(false)
    const stale = only(capNear(base({ budgets: { personal: budget(450, { fetchedAt: at(12) }) } })))
    expect(stale.thin).toBe(true)
    expect(stale.facts['freshness']).toBe('stale')
    expect(stale.facts['fetchedAt']).toBe(at(12))
    expect(stale.sentence).toBe('the personal key has $50 of headroom (portal report 12 h old).')
    const dead = only(capNear(base({ budgets: { personal: budget(450, { fetchedAt: at(72) }) } })))
    expect(dead.facts['freshness']).toBe('dead')
    expect(dead.sentence).toContain('(portal report 3 d old)')
    expect(dead.thin).toBe(true)
  })
  it('does not trust a portal report with an unreadable fetch time', () => {
    expect(capNear(base({ budgets: { personal: budget(450, { fetchedAt: 'x' }) } }))).toEqual([])
  })
  it('does not fire just under 80 %, without a portal report, or for an unreadable key', () => {
    expect(capNear(base({ budgets: { personal: budget(399.99) } }))).toEqual([])
    expect(capNear(base({ budgets: { personal: budget(480, { fetchedAt: null }) } }))).toEqual([])
    expect(capNear(base({ budgets: { personal: null } }))).toEqual([])
  })
  it('names the day the cap is met again for a key over it', () => {
    const insight = only(
      capNear(base({ budgets: { personal: budget(577.57, { underCapOn: '2026-11-12' }) } })),
    )
    expect(insight.sentence).toBe('the personal key is $78 over its cap until 12 Nov.')
    expect(insight.facts['underCapOn']).toBe('2026-11-12')
    expect(only(capNear(base({ budgets: { personal: budget(600) } }))).sentence).toContain(
      'not back under within 60 days',
    )
    expect(insight.usdMoved).toBe(577.57)
  })
  it('keeps the two keys in their own sentences', () => {
    const drafts = capNear(base({ budgets: { personal: budget(450), 'athena-team': budget(465) } }))
    expect(drafts.map((d) => d.node)).toEqual(['key:personal', 'key:athena-team'])
    expect(drafts[1]!.sentence).toContain('Athena')
    expect(drafts[0]!.sentence).not.toContain('Athena')
  })
})

describe('detectInsights', () => {
  const firing = (): InsightInputs =>
    base({
      productionCredit: slice(row('review', 54.3, { byPayer: { 'iu-credit': 54.3 } }), row('d', 1)),
      evalCredit: slice(row('review', 6.9, { byPayer: { 'me-credit': 6.9 } })),
      demand: slice(row('review', 190, { runs: 10 })),
      demandPrevious: slice(row('review', 100, { runs: 10 })),
      router: router({ cache: [{ caller: 'agw', target: 'iu', requests: 5, hitRate: 0.8 }] }),
      budgets: {
        'athena-team': {
          limitUsd: 500,
          rolling30Usd: 465,
          underCapOn: null,
          fetchedAt: '2026-11-09T08:00:00Z',
        },
      },
    })
  it('ranks by money moved, ties by id, and numbers the ranks from 1', () => {
    const items = detectInsights(firing())
    // cap-near ($465 rolling) leads; mover and cost-per-run both move $90: the tie goes to the id.
    expect(items.map((i) => i.id)).toEqual([
      'cap-near',
      'cost-per-run',
      'mover',
      'pool-split',
      'top-share',
    ])
    expect(items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5])
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1]!.usdMoved).toBeGreaterThanOrEqual(items[i]!.usdMoved)
    }
  })
  it('keeps the top five: the reassurance, ranking last, is the one dropped', () => {
    const all = detectInsights(firing())
    expect(all).toHaveLength(5)
    expect(all.some((i) => i.id === 'claude-on-iu')).toBe(false)
  })
  it('breaks a tie on money by id', () => {
    const items = detectInsights(
      base({
        router: router({ cache: [{ caller: 'agw', target: 'iu', requests: 5, hitRate: 0.8 }] }),
        budgets: {
          personal: {
            limitUsd: 500,
            rolling30Usd: 450,
            underCapOn: null,
            fetchedAt: '2026-11-09T08:00:00Z',
          },
        },
      }),
    )
    expect(items.map((i) => [i.id, i.usdMoved])).toEqual([
      ['cap-near', 450],
      ['claude-on-iu', 0],
    ])
  })
  it('is empty when nothing stands out', () => {
    expect(detectInsights(base())).toEqual([])
  })
  it('never throws on a half-readable world', () => {
    expect(detectInsights(base({ router: router(), demand: slice() }))).toEqual([])
  })
})
