import { describe, expect, it } from 'bun:test'
import type { EfficiencyRoute, EfficiencyVariant, Effort } from './api/types'
import { EFFICIENCY_FIXTURE } from './__fixtures__/efficiency'
import {
  attractiveQuadrant,
  creatorKey,
  efficiencyIndexes,
  groupSlots,
  intelligenceDomain,
  isVisible,
  ladders,
  leanestAlternative,
  lineageNameOf,
  lineageNames,
  lineageOfModel,
  MIN_SAVING,
  paretoFrontier,
  percentileRanks,
  routeUse,
  routedSlugs,
  scatterPoints,
  variantLabel,
  visibleVariants,
  Y_METRICS,
  Y_WEIGHTS,
  yDomain,
  yScores,
  type ModelFilters,
} from './model'

/** An invented variant: the shape of the contract with made-up figures. */
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

/** A variant with all three measures: `cost` dollars, `time` seconds, `tokens` tokens per task. */
const measured = (slug: string, cost: number, time: number, tokens: number, intelligence = 40) =>
  variant(slug, slug, 'high', intelligence, cost, {
    timePerTaskEstSec: time,
    tokensPerTaskEst: tokens,
  })

const quillLow = variant('quill-low', 'Quill 4', 'low', 20, 0.1)
const quillMedium = variant('quill-medium', 'Quill 4', 'medium', 30, 0.2)
const quillHigh = variant('quill-high', 'Quill 4', 'high', 40, 0.3)
const mireHigh = variant('mire-high', 'Mire 2', 'high', 24, 0.15, { creator: 'Anthropic' })
const mireXhigh = variant('mire-xhigh', 'Mire 2', 'xhigh', 33, 0.4, { creator: 'Anthropic' })
const POOL = [quillLow, quillMedium, quillHigh, mireHigh, mireXhigh]
const NO_INDEX = new Map<string, number>()

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

describe('efficiencyIndexes', () => {
  const none = new Map<string, number>()

  it('is a weighted geometric mean against the median, 1 for the median variant', () => {
    const indexes = efficiencyIndexes([
      measured('a', 1, 10, 100),
      measured('b', 2, 20, 200),
      measured('c', 4, 40, 400),
    ])
    expect(indexes.get('a')).toBeCloseTo(0.5, 10)
    expect(indexes.get('b')).toBeCloseTo(1, 10)
    expect(indexes.get('c')).toBeCloseTo(2, 10)
  })

  it('weighs cost 0.6, time 0.3 and tokens 0.1', () => {
    // Two variants at the median and one four times over on a single measure.
    const spike = (cost: number, time: number, tokens: number) =>
      efficiencyIndexes([
        measured('m1', 1, 1, 1),
        measured('m2', 1, 1, 1),
        measured('hi', cost, time, tokens),
      ]).get('hi')
    expect(spike(4, 1, 1)).toBeCloseTo(4 ** 0.6, 10)
    expect(spike(1, 4, 1)).toBeCloseTo(4 ** 0.3, 10)
    expect(spike(1, 1, 4)).toBeCloseTo(4 ** 0.1, 10)
  })

  it('takes the medians over every variant it is given, so a subset would move them', () => {
    const all = [measured('a', 1, 10, 100), measured('b', 2, 20, 200), measured('c', 4, 40, 400)]
    const whole = efficiencyIndexes(all)
    // The page looks a filtered variant up in the whole map; computing over the subset gives another number.
    expect(whole.get('c')).toBeCloseTo(2, 10)
    expect(efficiencyIndexes([all[2]!]).get('c')).toBeCloseTo(1, 10)
  })

  it('has no index for a variant missing a value, and does not renormalise or move the medians', () => {
    const base = [measured('a', 1, 10, 100), measured('b', 2, 20, 200), measured('c', 4, 40, 400)]
    const noTime = variant('x', 'x', 'high', 40, 9, { tokensPerTaskEst: 900 })
    const free = measured('free', 0, 5, 50)
    const indexes = efficiencyIndexes([...base, noTime, free])
    expect(indexes.has('x')).toBe(false)
    expect(indexes.has('free')).toBe(false)
    expect(indexes.get('c')).toBeCloseTo(2, 10)
  })

  it('is empty when no variant has all three', () => {
    expect(efficiencyIndexes([variant('x', 'x', 'high', 40, 1)])).toEqual(none)
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

  it('on cost points keeps the variants nothing beats on both axes', () => {
    const frontier = paretoFrontier(
      POOL,
      (v) => v.costPerTask ?? 0,
      (v) => v.intelligence,
    )
    expect(frontier.map((v) => v.slug)).toEqual([
      'quill-low',
      'mire-high',
      'quill-medium',
      'quill-high',
    ])
  })
})

describe('ladders', () => {
  it('orders a lineage none to max whatever the input order', () => {
    const max = variant('q-max', 'Quill 4', 'max', 47, 0.88)
    const none = variant('q-none', 'Quill 4', 'none', 12, 0.05)
    const { points } = scatterPoints(
      [max, quillHigh, none, quillLow, quillMedium],
      'cost',
      NO_INDEX,
    )
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
    const plain = variant('q-default', 'Quill 4', 'default', 40, 0.3)
    const result = ladders(scatterPoints([plain, quillLow, mireHigh], 'cost', NO_INDEX).points)
    expect(result.map((l) => l.lineage).toSorted()).toEqual(['Mire 2', 'Quill 4'])
    const quill = result.find((l) => l.lineage === 'Quill 4')
    expect(quill?.points.map((p) => p.variant.effort)).toEqual(['low', 'default'])
  })
})

describe('scatterPoints', () => {
  it('drops variants the axis has no value for, counting the free and the missing', () => {
    const free = variant('free', 'Free', 'default', 15, 0)
    const missing = variant('missing', 'Missing', 'default', 15, null)
    const result = scatterPoints([quillLow, free, missing], 'cost', NO_INDEX)
    expect(result.points.map((p) => p.variant.slug)).toEqual(['quill-low'])
    expect(result.free).toBe(1)
    expect(result.missing).toBe(1)
  })

  it('reads time in minutes and drops a variant without an estimate', () => {
    const timed = variant('timed', 'T', 'high', 40, 0.2, { timePerTaskEstSec: 660 })
    const { points, missing } = scatterPoints([timed, quillLow], 'time', NO_INDEX)
    expect(points).toHaveLength(1)
    expect(missing).toBe(1)
    expect(points[0]?.x).toBe(11)
    expect(points[0]?.lx).toBeCloseTo(Math.log10(11), 10)
  })

  it('puts the index on the x axis and carries it on every point', () => {
    const a = measured('a', 1, 10, 100)
    const b = measured('b', 2, 20, 200)
    const c = measured('c', 4, 40, 400)
    const indexes = efficiencyIndexes([a, b, c])
    const { points, missing } = scatterPoints([a, b, c, quillLow], 'index', indexes)
    expect(points.map((p) => p.x)).toHaveLength(3)
    ;[0.5, 1, 2].forEach((value, i) => expect(points[i]?.x).toBeCloseTo(value, 10))
    expect(points.map((p) => p.index)).toEqual(points.map((p) => p.x))
    expect(missing).toBe(1)
    expect(scatterPoints([a], 'cost', indexes).points[0]?.index).toBeCloseTo(0.5, 10)
  })
})

describe('attractiveQuadrant', () => {
  it('is the median x and y of the points drawn', () => {
    const { points } = scatterPoints(POOL, 'cost', NO_INDEX)
    const quadrant = attractiveQuadrant(points)
    expect(quadrant?.xBelow).toBeCloseTo(0.2, 6)
    expect(quadrant?.yAbove).toBeCloseTo(30, 6)
  })

  it('needs enough points to mean anything', () => {
    expect(
      attractiveQuadrant(scatterPoints([quillLow, quillHigh], 'cost', NO_INDEX).points),
    ).toBeNull()
  })
})

describe('visibility', () => {
  const sable = EFFICIENCY_FIXTURE.variants.filter((v) => v.lineage === 'gpt-9-1-sable')
  const solOld = EFFICIENCY_FIXTURE.variants.filter((v) => v.lineage === 'gpt-9-sable')
  const defaults: ModelFilters = { callable: true, superseded: false, creators: [] }

  it('shows GPT-9.1 Sable and hides the GPT-9 Sable it replaced', () => {
    const visible = visibleVariants([...sable, ...solOld], defaults, [])
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
    route('gpt-9.1-vega', 'medium', { route: 'd', variantSlug: 'tm', access: 'metered' }),
    route('gpt-9.1-vega', 'medium', { route: 'e', variantSlug: 'tm', access: 'subscription' }),
  ]

  it('groups by model and effort and collapses the route ids, busiest first', () => {
    const groups = groupSlots(routes)
    expect(groups.map((g) => [g.model, g.effort, g.routes.length])).toEqual([
      ['claude-marlow-4', 'high', 2],
      ['gpt-9.1-vega', 'medium', 2],
      ['claude-marlow-4', 'none', 1],
    ])
  })

  it('keeps a route without a variant, with its reason', () => {
    const none = groupSlots(routes).find((g) => g.effort === 'none')
    expect(none?.variantSlug).toBeNull()
    expect(none?.reason).toBe('No Artificial Analysis row')
  })

  it('marks a group mixed when routes disagree on billing', () => {
    expect(groupSlots(routes).find((g) => g.model === 'gpt-9.1-vega')?.access).toBe('mixed')
  })

  it('is metered for a variant as soon as one route bills', () => {
    const use = routeUse(routes)
    expect(use.get('h')?.access).toBe('subscription')
    expect(use.get('tm')?.access).toBe('metered')
    expect(use.get('tm')?.routes).toHaveLength(2)
  })
})

describe('leanestAlternative', () => {
  const own = variant('own', 'Own', 'high', 40, 1)
  const pick = (candidates: readonly EfficiencyVariant[], index: Record<string, number>) =>
    leanestAlternative(own, candidates, new Map(Object.entries({ own: 1, ...index })))
  const cand = (slug: string, intelligence: number, extra: Partial<EfficiencyVariant> = {}) =>
    variant(slug, slug, 'high', intelligence, 1, extra)

  it('takes the lowest index at equal or better intelligence, equal included', () => {
    const found = pick([cand('same', 40), cand('better', 46), cand('lean-but-dumb', 30)], {
      same: 0.5,
      better: 0.6,
      'lean-but-dumb': 0.1,
    })
    expect(found?.by.slug).toBe('same')
    expect(found?.points).toBe(0)
    expect(found?.indexRatio).toBeCloseTo(0.5, 10)
  })

  it('reports the intelligence gained', () => {
    const found = pick([cand('better', 48.3)], { better: 0.4 })
    expect(found?.points).toBeCloseTo(8.3, 10)
  })

  it('is null unless it saves enough to matter', () => {
    expect(MIN_SAVING).toBe(0.9)
    expect(pick([cand('close', 41)], { close: 0.95 })).toBeNull()
    expect(pick([cand('edge', 41)], { edge: 0.9 })?.by.slug).toBe('edge')
  })

  it('skips superseded variants, itself, and variants without an index', () => {
    const old = cand('old', 50, { superseded: true })
    const unmeasured = cand('unmeasured', 50)
    expect(pick([old, own, unmeasured], { old: 0.1, own: 0.1 })).toBeNull()
  })

  it('is null for a variant that has no index of its own', () => {
    expect(leanestAlternative(own, [cand('x', 50)], new Map([['x', 0.1]]))).toBeNull()
  })
})

describe('intelligenceDomain', () => {
  it('pads the visible range and snaps it to 5', () => {
    expect(intelligenceDomain(POOL)).toEqual([15, 45])
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
    const vega = EFFICIENCY_FIXTURE.variants.find((v) => v.slug === 'gpt-9-1-vega-medium')
    if (vega === undefined) throw new Error('fixture lacks vega medium')
    expect(variantLabel(vega, (l) => names.get(l) ?? l)).toBe('GPT-9.1 Vega medium')
  })

  it('finds the lineage of a route model id through the IU id', () => {
    expect(lineageOfModel('gpt-9.1-vega', EFFICIENCY_FIXTURE.variants)).toBe('gpt-9-1-vega')
    expect(lineageOfModel('claude-marlow-4', EFFICIENCY_FIXTURE.variants)).toBe('claude-marlow-4')
    expect(lineageOfModel('no-such-model', EFFICIENCY_FIXTURE.variants)).toBeNull()
  })
})

// ── the y score: General, Coding, Combined ──────────────────────────────────

/** A variant with a coding score (null: Epoch measured it but fewer than two benchmarks counted). */
const withCoding = (v: EfficiencyVariant, score: number | null): EfficiencyVariant => ({
  ...v,
  coding: {
    score,
    components: [{ benchmark: 'cursorbench', score: 0.4, costPerTask: null, tokensPerTask: null }],
  },
})

describe('percentileRanks', () => {
  it('is the mid-rank percentile, ties counting the entry itself', () => {
    const ranks = percentileRanks([
      { slug: 'a', value: 1 },
      { slug: 'b', value: 2 },
      { slug: 'c', value: 2 },
      { slug: 'd', value: 3 },
    ])
    // below 0, equal 1 (itself): 12.5; b and c: (1 + 2 / 2) / 4; d: (3 + 1 / 2) / 4
    expect(ranks.get('a')).toBeCloseTo(12.5, 10)
    expect(ranks.get('b')).toBeCloseTo(50, 10)
    expect(ranks.get('c')).toBeCloseTo(50, 10)
    expect(ranks.get('d')).toBeCloseTo(87.5, 10)
  })
})

describe('yScores', () => {
  const lo = variant('lo', 'lo', 'high', 10, 1)
  const mid = variant('mid', 'mid', 'high', 20, 1)
  const hi = variant('hi', 'hi', 'high', 30, 1)
  const field = [withCoding(lo, 90), withCoding(mid, 10), hi]

  it('General is the raw intelligence of every variant', () => {
    const ys = yScores(field, 'general')
    expect([...ys].map(([slug, s]) => [slug, s.value, s.fallback])).toEqual([
      ['lo', 10, false],
      ['mid', 20, false],
      ['hi', 30, false],
    ])
  })

  it('Coding is the coding score, and has no entry for a variant without one', () => {
    const ys = yScores(
      [...field, withCoding(variant('thin', 'thin', 'high', 5, 1), null)],
      'coding',
    )
    expect(ys.get('lo')?.value).toBe(90)
    expect(ys.get('mid')?.value).toBe(10)
    expect(ys.has('hi')).toBe(false)
    expect(ys.has('thin')).toBe(false)
  })

  it('Combined is the weighted mean of the two percentile ranks', () => {
    expect(Y_WEIGHTS.general + Y_WEIGHTS.coding).toBe(1)
    const ys = yScores(field, 'combined')
    // intelligence ranks over all three: 1/6, 3/6, 5/6; coding ranks over the two scored: 3/4, 1/4.
    const general = (1 / 6) * 100
    expect(ys.get('lo')?.value).toBeCloseTo(Y_WEIGHTS.general * general + Y_WEIGHTS.coding * 75, 10)
    expect(ys.get('lo')?.fallback).toBe(false)
    expect(ys.get('mid')?.value).toBeCloseTo(Y_WEIGHTS.general * 50 + Y_WEIGHTS.coding * 25, 10)
  })

  it('Combined falls back to the General rank for a variant without a coding score: kept, flagged, not zero', () => {
    const ys = yScores(
      [...field, withCoding(variant('thin', 'thin', 'high', 25, 1), null)],
      'combined',
    )
    for (const slug of ['hi', 'thin']) {
      expect(ys.get(slug)?.fallback).toBe(true)
      expect(ys.get(slug)?.value).toBeGreaterThan(0)
    }
    // hi is first by intelligence among four: (3 + 1 / 2) / 4
    expect(ys.get('hi')?.value).toBeCloseTo(87.5, 10)
    expect(ys.get('lo')?.fallback).toBe(false)
  })

  it('reads a variant of an older contract (no coding key) as having none', () => {
    const old = variant('old', 'old', 'high', 15, 1)
    expect('coding' in old).toBe(false)
    expect(yScores([old], 'coding').size).toBe(0)
    expect(yScores([old, hi], 'combined').get('old')?.fallback).toBe(true)
    expect(yScores([old], 'general').get('old')?.value).toBe(15)
  })

  it('covers every metric', () => {
    expect(Y_METRICS).toEqual(['combined', 'general', 'coding'])
  })
})

describe('scatterPoints on a y score', () => {
  const a = variant('a', 'A', 'high', 10, 0.1)
  const b = withCoding(variant('b', 'B', 'high', 20, 0.2), 70)
  const c = withCoding(variant('c', 'C', 'high', 30, 0.3), 40)
  const field = [a, b, c]

  it('defaults to General and draws the intelligence, so a General chart is unchanged', () => {
    const { points, unscored } = scatterPoints(field, 'cost', NO_INDEX)
    expect(points.map((p) => p.y)).toEqual([10, 20, 30])
    expect(points.every((p) => !p.fallback)).toBe(true)
    expect(unscored).toBe(0)
  })

  it('Coding puts a point at the coding score and counts a variant without one apart', () => {
    const { points, unscored, missing } = scatterPoints(
      field,
      'cost',
      NO_INDEX,
      yScores(field, 'coding'),
    )
    expect(points.map((p) => [p.variant.slug, p.y])).toEqual([
      ['b', 70],
      ['c', 40],
    ])
    expect(unscored).toBe(1)
    expect(missing).toBe(0)
  })

  it('Combined keeps the variant without coding and marks it', () => {
    const { points } = scatterPoints(field, 'cost', NO_INDEX, yScores(field, 'combined'))
    expect(points.map((p) => [p.variant.slug, p.fallback])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
    ])
  })
})

describe('yDomain', () => {
  const a = variant('a', 'A', 'high', 10, 1)
  const b = withCoding(variant('b', 'B', 'high', 20, 1), 71)
  const c = withCoding(variant('c', 'C', 'high', 30, 1), 96)
  const field = [a, b, c]

  it('General is the intelligence domain, as before', () => {
    expect(yDomain(field, yScores(field, 'general'), 'general')).toEqual(intelligenceDomain(field))
    expect(yDomain(field, yScores(field, 'general'), 'general')).toEqual([5, 35])
  })

  it('Coding follows the coding scores of the variants that have one, capped at 100', () => {
    expect(yDomain(field, yScores(field, 'coding'), 'coding')).toEqual([65, 100])
    expect(yDomain([a, b], yScores(field, 'coding'), 'coding')).toEqual([65, 75])
  })

  it('Combined follows the blended ranks', () => {
    const [low, high] = yDomain(field, yScores(field, 'combined'), 'combined')
    expect(low).toBeLessThan(40)
    expect(high).toBeLessThanOrEqual(100)
    expect(yDomain([], new Map(), 'combined')).toEqual([0, 60])
  })
})

describe('leanestAlternative on a y score', () => {
  // own is mid on intelligence, top on coding; 'smart' beats it on intelligence only, 'coder' on neither.
  const own = withCoding(variant('own', 'own', 'high', 40, 1), 80)
  const smart = withCoding(variant('smart', 'smart', 'high', 50, 1), 30)
  const coder = withCoding(variant('coder', 'coder', 'high', 35, 1), 85)
  const uncoded = variant('uncoded', 'uncoded', 'high', 60, 1)
  const pool = [smart, coder, uncoded]
  const index = new Map([
    ['own', 1],
    ['smart', 0.5],
    ['coder', 0.4],
    ['uncoded', 0.3],
  ])
  const on = (metric: 'general' | 'coding' | 'combined') =>
    leanestAlternative(own, pool, index, yScores([own, ...pool], metric))

  it('General compares intelligence', () => {
    const found = on('general')
    expect(found?.by.slug).toBe('uncoded')
    expect(found?.points).toBe(20)
  })

  it('Coding compares the coding score and skips a candidate without one', () => {
    const found = on('coding')
    expect(found?.by.slug).toBe('coder')
    expect(found?.points).toBe(5)
  })

  it('Combined compares the blended rank, a candidate without coding on its General rank', () => {
    const found = on('combined')
    expect(found).not.toBeNull()
    expect(found?.points).toBeGreaterThanOrEqual(0)
  })

  it('is null for a variant with no score on the metric', () => {
    expect(
      leanestAlternative(
        uncoded,
        [own],
        new Map([
          ['uncoded', 1],
          ['own', 0.1],
        ]),
        yScores([own, uncoded], 'coding'),
      ),
    ).toBeNull()
  })

  it('defaults to General (intelligence), as before', () => {
    expect(leanestAlternative(own, pool, index)?.by.slug).toBe('uncoded')
  })
})
