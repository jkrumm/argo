import { describe, expect, it } from 'bun:test'
import type { EfficiencyRoute, EfficiencyVariant } from './api/types'
import { EFFICIENCY_FIXTURE } from './__fixtures__/efficiency'
import { efficiencyIndexes, lineageNames } from './model'
import { slotRows, slotSummary } from './slot-rows'

const fixture = EFFICIENCY_FIXTURE.variants
const readable = lineageNames(fixture)
const display = (lineage: string) => readable.get(lineage) ?? lineage

const route = (
  model: string,
  effort: string | null,
  variantSlug: string | null,
  access: EfficiencyRoute['access'] = 'metered',
): EfficiencyRoute => ({
  route: `${model}.${effort}`,
  wire: 'anthropic',
  model,
  effort,
  access,
  variantSlug,
  reason: variantSlug === null ? 'No Artificial Analysis row' : null,
})

/** An invented variant whose time and tokens follow its cost, so the index orders by cost. */
const make = (
  slug: string,
  creator: string,
  intelligence: number,
  cost: number,
  extra: Partial<EfficiencyVariant> = {},
): EfficiencyVariant => ({
  slug,
  name: `${slug} (High)`,
  lineage: slug,
  effort: 'high',
  creator,
  releaseDate: null,
  intelligence,
  costPerTask: cost,
  priceIn: null,
  priceOut: null,
  priceCacheRead: null,
  tokensPerTaskEst: cost * 1000,
  timePerTaskEstSec: cost * 100,
  e2eSec: null,
  tps: null,
  ttfatSec: null,
  superseded: false,
  supersededBy: null,
  iu: { id: slug, listed: true, accessible: true, legs: ['openai'] },
  ...extra,
})

const field = [
  make('claude-big', 'Anthropic', 50, 8),
  make('claude-ace', 'Anthropic', 55, 0.8),
  make('claude-dim', 'Anthropic', 30, 0.5),
  make('gpt-big', 'OpenAI', 50, 6),
  make('gpt-lean', 'OpenAI', 51, 1),
  make('gem-mid', 'Google', 49, 4),
  make('gpt-locked', 'OpenAI', 60, 0.1, {
    iu: { id: null, listed: false, accessible: false, legs: [] },
  }),
]
const indexes = efficiencyIndexes(field)
const rowsFor = (routes: EfficiencyRoute[]) => slotRows(routes, field, indexes, (l) => l)

describe('slotRows', () => {
  it('names a slot by the variant effort, not the route effort', () => {
    const real = efficiencyIndexes(fixture)
    const bare = fixture.find((v) => v.slug === 'gemini-prism-5')
    if (bare === undefined) throw new Error('fixture lacks gemini-prism-5')
    const [row] = slotRows([route('gemini-prism-5', null, bare.slug)], fixture, real, display)
    expect(row?.name).toBe(`Gemini Prism 5${bare.effort === 'default' ? '' : ` ${bare.effort}`}`)
    const [other] = slotRows(
      [route('gpt-9.1-vega', 'medium', 'gpt-9-1-vega')],
      fixture,
      real,
      display,
    )
    expect(other?.name).toBe('GPT-9.1 Vega max')
  })

  it('keeps a route with no variant, named by its model and effort, with nothing recommended', () => {
    const real = efficiencyIndexes(fixture)
    const [row] = slotRows([route('claude-marlow-4', 'none', null)], fixture, real, display)
    expect(row?.variant).toBeNull()
    expect(row?.index).toBeNull()
    expect(row?.onMax).toEqual({ kind: 'na' })
    expect(row?.anywhere).toEqual({ kind: 'na' })
    expect(row?.name).toBe('Claude Marlow 4 none')
  })

  it('names every fixture slot readably and never by a slug', () => {
    const rows = slotRows(EFFICIENCY_FIXTURE.routes, fixture, efficiencyIndexes(fixture), display)
    expect(rows.map((r) => r.name).toSorted()).toEqual([
      'Claude Ember 4.2 medium',
      'Claude Marlow 4 high',
      'Claude Marlow 4 none',
      'GPT-9.1 Vega medium',
      'Gemini Prism 5 high',
    ])
  })

  it('offers a quota slot the leanest Claude on Max and the leanest callable anywhere', () => {
    const [row] = rowsFor([route('claude-big', 'high', 'claude-big', 'subscription')])
    expect(row?.billed).toBe(false)
    expect(row?.onMax.kind === 'better' && row.onMax.by.slug).toBe('claude-ace')
    // Anywhere includes Claude; the uncallable model never counts, however lean.
    expect(row?.anywhere.kind === 'better' && row.anywhere.by.slug).toBe('claude-ace')
  })

  it('excludes Anthropic from a billed slot and gives it no Max cell', () => {
    const [row] = rowsFor([route('gpt-big', 'high', 'gpt-big', 'metered')])
    expect(row?.billed).toBe(true)
    expect(row?.onMax).toEqual({ kind: 'na' })
    // claude-ace would win on index; a billed seat is cross-lab, so gpt-lean it is.
    expect(row?.anywhere.kind === 'better' && row.anywhere.by.slug).toBe('gpt-lean')
  })

  it('treats a mixed slot as billed', () => {
    const [row] = rowsFor([
      route('gpt-big', 'high', 'gpt-big', 'metered'),
      { ...route('gpt-big', 'high', 'gpt-big', 'subscription'), route: 'other' },
    ])
    expect(row?.group.access).toBe('mixed')
    expect(row?.billed).toBe(true)
    expect(row?.onMax).toEqual({ kind: 'na' })
  })

  it('says already leanest when nothing at equal intelligence is leaner', () => {
    const [row] = rowsFor([route('claude-ace', 'high', 'claude-ace', 'subscription')])
    expect(row?.onMax).toEqual({ kind: 'leanest' })
    expect(row?.anywhere).toEqual({ kind: 'leanest' })
  })

  it('lists billed slots first, then the busiest', () => {
    const rows = rowsFor([
      route('claude-big', 'high', 'claude-big', 'subscription'),
      { ...route('claude-big', 'high', 'claude-big', 'subscription'), route: 'more' },
      route('gem-mid', 'high', 'gem-mid', 'metered'),
      route('gpt-big', 'high', 'gpt-big', 'metered'),
      { ...route('gpt-big', 'high', 'gpt-big', 'metered'), route: 'more' },
    ])
    expect(rows.map((r) => r.name)).toEqual(['gpt-big high', 'gem-mid high', 'claude-big high'])
  })
})

describe('a slot whose variant has no index', () => {
  const unmeasured = make('claude-unmeasured', 'Anthropic', 30, 1, { timePerTaskEstSec: null })
  const pool = [...field, unmeasured]
  const rows = slotRows(
    [route('claude-unmeasured', 'high', 'claude-unmeasured', 'subscription')],
    pool,
    efficiencyIndexes(pool),
    (l) => l,
  )

  it('compares nothing instead of reading as already leanest', () => {
    expect(rows[0]?.index).toBeNull()
    expect(rows[0]?.onMax.kind).toBe('na')
    expect(rows[0]?.anywhere.kind).toBe('na')
  })

  it('is counted, with nothing claimed about it', () => {
    expect(slotSummary(rows)).toBe('Your 1 slot: 1 on Max quota. 1 has no efficiency data.')
  })
})

describe('slotSummary', () => {
  it('counts quota and billed slots, the leaner options and the unmeasured', () => {
    const text = slotSummary(
      rowsFor([
        route('claude-big', 'high', 'claude-big', 'subscription'),
        route('gpt-big', 'high', 'gpt-big', 'metered'),
        route('claude-marlow-4', 'none', null, 'subscription'),
      ]),
    )
    expect(text).toBe(
      'Your 3 slots: 2 on Max quota, 1 billed. 1 billed slot has a leaner option; 1 quota slot could go leaner on Max. 1 has no efficiency data.',
    )
  })

  it('pluralises the billed clause and drops zero clauses', () => {
    const text = slotSummary(
      rowsFor([route('gpt-big', 'high', 'gpt-big'), route('gem-mid', 'high', 'gem-mid')]),
    )
    expect(text).toBe('Your 2 slots: 2 billed. 2 billed slots have a leaner option.')
  })

  it('says nothing is leaner when no slot has an option', () => {
    expect(slotSummary(rowsFor([route('claude-ace', 'high', 'claude-ace', 'subscription')]))).toBe(
      'Your 1 slot: 1 on Max quota. Nothing leaner to move to.',
    )
  })

  it('claims nothing when no slot has efficiency data', () => {
    expect(slotSummary(rowsFor([route('mystery', null, null, 'subscription')]))).toBe(
      'Your 1 slot: 1 on Max quota. 1 has no efficiency data.',
    )
  })

  it('is empty without slots', () => {
    expect(slotSummary([])).toBe('')
  })
})
