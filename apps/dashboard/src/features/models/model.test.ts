import { describe, expect, it } from 'bun:test'
import type { EfficiencyRoute, EfficiencyVariant, Effort } from './api/types'
import { EFFICIENCY_FIXTURE } from './__fixtures__/efficiency'
import {
  attractiveQuadrant,
  creatorKey,
  groupSlots,
  intelligenceDomain,
  isVisible,
  lineageNameOf,
  lineageNames,
  lineageOfModel,
  variantLabel,
  ladders,
  lineageRows,
  paretoFrontier,
  routeUse,
  routedSlugs,
  scatterPoints,
  sortLineageRows,
  verdictOf,
  visibleVariants,
  type ModelFilters,
} from './model'

/** A variant with the real figures of a row of the 2026-11-06 Artificial Analysis dump. */
function variant(
  slug: string,
  lineage: string,
  effort: Effort,
  intelligence: number,
  costPerTask: number | null,
  extra: Partial<EfficiencyVariant> = {},
): EfficiencyVariant {
  return {
    slug,
    name: `${lineage} (${effort})`,
    lineage,
    effort,
    creator: 'OpenAI',
    releaseDate: '2026-10-26',
    intelligence,
    costPerTask,
    priceIn: null,
    priceOut: null,
    priceCacheRead: null,
    tokensPerTaskEst: null,
    timePerTaskEstSec: null,
    e2eSec: null,
    tps: null,
    ttfatSec: null,
    superseded: false,
    supersededBy: null,
    iu: { id: slug, listed: true, accessible: true, legs: ['openai'] },
    ...extra,
  }
}

const terraLow = variant('terra-low', 'GPT-6.1 Terra', 'low', 29.4, 0.0713)
const terraMedium = variant('terra-medium', 'GPT-6.1 Terra', 'medium', 38.2, 0.1688)
const terraHigh = variant('terra-high', 'GPT-6.1 Terra', 'high', 42.4, 0.2593)
const haikuHigh = variant('haiku-high', 'Claude Haiku 5.5', 'high', 29.9, 0.1586, {
  creator: 'Anthropic',
})
const haikuXhigh = variant('haiku-xhigh', 'Claude Haiku 5.5', 'xhigh', 34.6, 0.2484, {
  creator: 'Anthropic',
})
const deepseekHigh = variant('deepseek-high', 'DeepSeek V4.1 Flash 1017', 'high', 28.6, 0.4562, {
  creator: 'DeepSeek',
})
const solHigh = variant('sol-high', 'GPT-6.1 Sol', 'high', 50.3, 0.591)
const opusMedium = variant('opus-medium', 'Claude Opus 5.5', 'medium', 48.2, 2.4511, {
  creator: 'Anthropic',
})
const POOL = [
  terraLow,
  terraMedium,
  terraHigh,
  haikuHigh,
  haikuXhigh,
  deepseekHigh,
  solHigh,
  opusMedium,
]

const route = (model: string, effort: string | null, over: Partial<EfficiencyRoute> = {}) =>
  ({
    route: `${model}.${effort}`,
    wire: 'anthropic',
    model,
    effort,
    access: 'metered',
    variantSlug: null,
    reason: null,
    ...over,
  }) satisfies EfficiencyRoute

describe('verdictOf', () => {
  it('beats Haiku high with Terra medium: +8.3 points for about the same money', () => {
    const verdict = verdictOf(haikuHigh, POOL)
    expect(verdict.kind).toBe('beaten')
    if (verdict.kind !== 'beaten') return
    expect(verdict.by.slug).toBe('terra-medium')
    expect(verdict.points).toBeCloseTo(8.3, 5)
    expect(verdict.costRatio).toBeCloseTo(0.1688 / 0.1586, 5)
  })

  it('beats DeepSeek high with Terra medium: the cheapest variant that is clearly better', () => {
    const verdict = verdictOf(deepseekHigh, POOL)
    expect(verdict.kind).toBe('beaten')
    if (verdict.kind !== 'beaten') return
    // Terra low is cheaper still but only 0.8 points better: not a move anyone makes.
    expect(verdict.by.slug).toBe('terra-medium')
    expect(verdict.points).toBeCloseTo(9.6, 5)
    expect(verdict.costRatio).toBeCloseTo(0.37, 2)
  })

  it('beats Opus medium with Sol high: +2.1 points at a quarter of the price', () => {
    const verdict = verdictOf(opusMedium, POOL)
    expect(verdict.kind).toBe('beaten')
    if (verdict.kind !== 'beaten') return
    expect(verdict.by.slug).toBe('sol-high')
    expect(verdict.points).toBeCloseTo(2.1, 5)
    expect(verdict.costRatio).toBeCloseTo(0.241, 3)
  })

  it('calls the unbeaten variants frontier, and the dominated near it', () => {
    expect(verdictOf(solHigh, POOL).kind).toBe('frontier')
    expect(verdictOf(terraLow, POOL).kind).toBe('frontier')
    // Terra high is under Sol high on cost (0.2593 < 0.591) and over every cheaper one: frontier.
    expect(verdictOf(terraHigh, POOL).kind).toBe('frontier')
    // Dominated by Terra medium (+3.2 points, 11% cheaper), but not by enough to be "beaten".
    const middling = variant('middling', 'Middling', 'high', 35, 0.19)
    expect(verdictOf(middling, [...POOL, middling]).kind).toBe('near')
  })

  it('beats Haiku xhigh with Terra high', () => {
    const verdict = verdictOf(haikuXhigh, POOL)
    expect(verdict.kind === 'beaten' && verdict.by.slug).toBe('terra-high')
  })

  it('only counts variants the IU endpoint can call', () => {
    const uncallable = { ...terraMedium, iu: { ...terraMedium.iu, accessible: false } }
    expect(verdictOf(haikuHigh, [haikuHigh, uncallable]).kind).toBe('frontier')
  })

  it('has no verdict for a variant without a cost', () => {
    expect(verdictOf(variant('x', 'X', 'high', 20, null), POOL).kind).toBe('unscored')
  })
})

const xy = (x: number, y: number) => ({ x, y })

describe('paretoFrontier', () => {
  const get = { x: (p: { x: number }) => p.x, y: (p: { y: number }) => p.y }

  it('keeps the best y for each x or less, left to right', () => {
    const points = [xy(3, 5), xy(1, 1), xy(2, 4), xy(2.5, 3), xy(4, 5), xy(5, 9)]
    expect(paretoFrontier(points, get.x, get.y)).toEqual([xy(1, 1), xy(2, 4), xy(3, 5), xy(5, 9)])
  })

  it('takes the higher y of two points at one x', () => {
    expect(paretoFrontier([xy(1, 2), xy(1, 3)], get.x, get.y)).toEqual([xy(1, 3)])
  })

  it('on the real cost points keeps Terra low, medium, high and Sol high', () => {
    const frontier = paretoFrontier(
      POOL,
      (v) => v.costPerTask ?? 0,
      (v) => v.intelligence,
    )
    expect(frontier.map((v) => v.slug)).toEqual([
      'terra-low',
      'haiku-high',
      'terra-medium',
      'terra-high',
      'sol-high',
    ])
  })
})

describe('ladders', () => {
  it('orders a lineage none to max whatever the input order', () => {
    const max = variant('t-max', 'GPT-6.1 Terra', 'max', 47, 0.88)
    const none = variant('t-none', 'GPT-6.1 Terra', 'none', 27.5, 0.2)
    const { points } = scatterPoints([max, terraHigh, none, terraLow, terraMedium], 'cost')
    const [ladder] = ladders(points)
    expect(ladder?.points.map((p) => p.variant.effort)).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'max',
    ])
  })

  it('puts an effort-less model after the ladder and keeps one ladder per lineage', () => {
    const plain = variant('t-default', 'GPT-6.1 Terra', 'default', 40, 0.3)
    const result = ladders(scatterPoints([plain, terraLow, haikuHigh], 'cost').points)
    expect(result.map((l) => l.lineage).toSorted()).toEqual(['Claude Haiku 5.5', 'GPT-6.1 Terra'])
    const terra = result.find((l) => l.lineage === 'GPT-6.1 Terra')
    expect(terra?.points.map((p) => p.variant.effort)).toEqual(['low', 'default'])
  })
})

describe('scatterPoints', () => {
  it('drops variants the axis has no value for, and counts the free ones', () => {
    const free = variant('free', 'Free', 'default', 15, 0)
    const missing = variant('missing', 'Missing', 'default', 15, null)
    const { points, free: freeCount } = scatterPoints([terraLow, free, missing], 'cost')
    expect(points.map((p) => p.variant.slug)).toEqual(['terra-low'])
    expect(freeCount).toBe(1)
  })

  it('reads time in minutes and drops a variant without an estimate', () => {
    const timed = variant('timed', 'T', 'high', 40, 0.2, { timePerTaskEstSec: 660 })
    const { points } = scatterPoints([timed, terraLow], 'time')
    expect(points).toHaveLength(1)
    expect(points[0]?.x).toBe(11)
    expect(points[0]?.lx).toBeCloseTo(Math.log10(11), 10)
  })
})

describe('attractiveQuadrant', () => {
  it('is the median x and y of the points drawn', () => {
    const { points } = scatterPoints(POOL, 'cost')
    const quadrant = attractiveQuadrant(points)
    expect(quadrant?.xBelow).toBeCloseTo((0.2484 + 0.2593) / 2, 6)
    expect(quadrant?.yAbove).toBeCloseTo((34.6 + 38.2) / 2, 6)
  })

  it('needs enough points to mean anything', () => {
    expect(attractiveQuadrant(scatterPoints([terraLow, terraHigh], 'cost').points)).toBeNull()
  })
})

describe('visibility', () => {
  const sol = EFFICIENCY_FIXTURE.variants.filter((v) => v.lineage === 'gpt-9-1-sable')
  const solOld = EFFICIENCY_FIXTURE.variants.filter((v) => v.lineage === 'gpt-9-sable')
  const defaults: ModelFilters = { callable: true, superseded: false, creators: [] }

  it('shows GPT-6.1 Sol and hides the GPT-6 Sol it replaced', () => {
    const visible = visibleVariants([...sol, ...solOld], defaults, [])
    expect(visible.map((v) => v.lineage)).toContain('gpt-9-1-sable')
    expect(visible.map((v) => v.lineage)).not.toContain('gpt-9-sable')
  })

  it('shows a superseded variant when a route uses it', () => {
    const [old] = solOld
    if (old === undefined) throw new Error('fixture has no gpt-9-sable')
    const routes = [route('gpt-9-sable', null, { variantSlug: old.slug })]
    expect(visibleVariants(solOld, defaults, routes)).toEqual(solOld)
    expect(isVisible(old, defaults, routedSlugs(routes))).toBe(true)
  })

  it('shows superseded models on request and hides uncallable ones by default', () => {
    expect(visibleVariants(solOld, { ...defaults, superseded: true }, [])).toHaveLength(1)
    const uncallable = EFFICIENCY_FIXTURE.variants.filter((v) => !v.iu.accessible)
    expect(uncallable.length).toBeGreaterThan(0)
    expect(visibleVariants(uncallable, defaults, [])).toEqual([])
    expect(visibleVariants(uncallable, { ...defaults, callable: false }, [])).not.toEqual([])
  })

  it('narrows to the chosen creators, routed or not', () => {
    const routes = [route('claude-marlow-4', 'high', { variantSlug: 'claude-marlow-4-high' })]
    const visible = visibleVariants(
      EFFICIENCY_FIXTURE.variants,
      { ...defaults, creators: ['openai'] },
      routes,
    )
    expect(new Set(visible.map((v) => creatorKey(v.creator)))).toEqual(new Set(['openai']))
  })

  it('maps creators to a closed key set', () => {
    expect(creatorKey('Z AI')).toBe('zai')
    expect(creatorKey('OpenAI')).toBe('openai')
    expect(creatorKey('Mistral')).toBe('other')
  })
})

describe('slots', () => {
  const routes = [
    route('claude-marlow-4', 'high', { route: 'a', variantSlug: 'h', access: 'subscription' }),
    route('claude-marlow-4', 'high', { route: 'b', variantSlug: 'h', access: 'subscription' }),
    route('claude-marlow-4', 'none', { route: 'c', reason: 'No Artificial Analysis row' }),
    route('gpt-6.1-terra', 'medium', { route: 'd', variantSlug: 'tm', access: 'metered' }),
    route('gpt-6.1-terra', 'medium', { route: 'e', variantSlug: 'tm', access: 'subscription' }),
  ]

  it('groups by model and effort and collapses the route ids, busiest first', () => {
    const groups = groupSlots(routes)
    expect(groups.map((g) => [g.model, g.effort, g.routes.length])).toEqual([
      ['claude-marlow-4', 'high', 2],
      ['gpt-6.1-terra', 'medium', 2],
      ['claude-marlow-4', 'none', 1],
    ])
  })

  it('keeps a route without a variant, with its reason', () => {
    const none = groupSlots(routes).find((g) => g.effort === 'none')
    expect(none?.variantSlug).toBeNull()
    expect(none?.reason).toBe('No Artificial Analysis row')
  })

  it('marks a group mixed when routes disagree on billing', () => {
    expect(groupSlots(routes).find((g) => g.model === 'gpt-6.1-terra')?.access).toBe('mixed')
  })

  it('is metered for a variant as soon as one route bills', () => {
    const use = routeUse(routes)
    expect(use.get('h')?.access).toBe('subscription')
    expect(use.get('tm')?.access).toBe('metered')
    expect(use.get('tm')?.routes).toHaveLength(2)
  })
})

describe('catalog', () => {
  const visible = visibleVariants(
    EFFICIENCY_FIXTURE.variants,
    { callable: true, superseded: false, creators: [] },
    EFFICIENCY_FIXTURE.routes,
  )
  const rows = lineageRows(visible, EFFICIENCY_FIXTURE.routes)

  it('has one row per lineage, the ladder in effort order and the best variant', () => {
    expect(new Set(rows.map((r) => r.lineage)).size).toBe(rows.length)
    const terra = rows.find((r) => r.lineage === 'gpt-9-1-vega')
    expect(terra?.best.effort).toBe('max')
    const efforts = terra?.variants.map((v) => v.effort) ?? []
    expect(efforts.slice(0, 3)).toEqual(['none', 'low', 'medium'])
    expect(terra?.slots).toBeGreaterThan(0)
  })

  it('sorts by a column, rows without the value last', () => {
    const byCost = sortLineageRows(rows, 'cost', 'asc').map((r) => r.best.costPerTask)
    expect(byCost).toEqual(byCost.toSorted((a, b) => (a ?? Infinity) - (b ?? Infinity)))
    const down = sortLineageRows(rows, 'intelligence', 'desc')
    expect(down[0]?.best.intelligence).toBe(Math.max(...rows.map((r) => r.best.intelligence)))
  })
})

describe('sortLineageRows by name', () => {
  it('sorts the Model column on the name it shows, the slug breaking ties', () => {
    const [a, b, c] = ['gpt-6-1-sol', 'gpt-6-astra', 'gpt-6-sol'].map((lineage) => ({
      lineage,
      creator: 'OpenAI',
      releaseDate: null,
      variants: [],
      best: variant(lineage, lineage, 'max', 40, 1),
      callable: true,
      legs: [],
      slots: 0,
      superseded: false,
    }))
    if (a === undefined || b === undefined || c === undefined) return
    const display: Record<string, string> = {
      'gpt-6-1-sol': 'GPT-6.1 Sol',
      'gpt-6-astra': 'GPT-6 Astra',
      'gpt-6-sol': 'GPT-6 Sol',
    }
    const shown = (l: string) => display[l] ?? l
    const names = (rows: (typeof a)[]) =>
      sortLineageRows(rows, 'lineage', 'asc', shown).map((r) => shown(r.lineage))
    // By slug "gpt-6-1-sol" sorts first; by name "GPT-6 Astra" does.
    expect(names([a, b, c])).toEqual(['GPT-6 Astra', 'GPT-6 Sol', 'GPT-6.1 Sol'])
    expect(
      sortLineageRows([a, b, c], 'lineage', 'desc', shown).map((r) => shown(r.lineage)),
    ).toEqual(['GPT-6.1 Sol', 'GPT-6 Sol', 'GPT-6 Astra'])
  })
})

describe('intelligenceDomain', () => {
  it('pads the visible range and snaps it to 5', () => {
    expect(intelligenceDomain(POOL)).toEqual([25, 55])
  })
})

describe('names', () => {
  it('strips the trailing effort parenthetical from a variant name', () => {
    expect(lineageNameOf('GPT-9.1 Vega (Medium)')).toBe('GPT-9.1 Vega')
    expect(lineageNameOf('Claude Ember 4.2 (Medium, Default Fallback)')).toBe('Claude Ember 4.2')
    expect(lineageNameOf('Fathom 3')).toBe('Fathom 3')
  })

  it('names every lineage readably, never by its slug', () => {
    const names = lineageNames(EFFICIENCY_FIXTURE.variants)
    expect(names.get('gpt-9-1-vega')).toBe('GPT-9.1 Vega')
    expect(names.get('claude-marlow-4')).toBe('Claude Marlow 4')
    expect(names.get('gpt-9-1-sable')).toBe('GPT-9.1 Sable')
    const terra = EFFICIENCY_FIXTURE.variants.find((v) => v.slug === 'gpt-9-1-vega-medium')
    if (terra === undefined) throw new Error('fixture lacks terra medium')
    expect(variantLabel(terra, (l) => names.get(l) ?? l)).toBe('GPT-9.1 Vega medium')
  })

  it('finds the lineage of a route model id through the IU id', () => {
    expect(lineageOfModel('gpt-9.1-vega', EFFICIENCY_FIXTURE.variants)).toBe('gpt-9-1-vega')
    expect(lineageOfModel('claude-marlow-4', EFFICIENCY_FIXTURE.variants)).toBe('claude-marlow-4')
    expect(lineageOfModel('no-such-model', EFFICIENCY_FIXTURE.variants)).toBeNull()
  })
})
