import { describe, expect, it } from 'bun:test'
import type { EfficiencyRoute, EfficiencyVariant } from './api/types'
import { EFFICIENCY_FIXTURE } from './__fixtures__/efficiency'
import { slotRows, slotSummary } from './slot-rows'

const variants = EFFICIENCY_FIXTURE.variants
const name = (v: EfficiencyVariant) => `${v.lineage} ${v.effort}`

const route = (
  model: string,
  effort: string | null,
  variantSlug: string | null,
): EfficiencyRoute => ({
  route: `${model}.${effort}`,
  wire: 'anthropic',
  model,
  effort,
  access: 'metered',
  variantSlug,
  reason: variantSlug === null ? 'No Artificial Analysis row' : null,
})

describe('slotRows', () => {
  it('names a slot by the variant effort, not the route effort', () => {
    // A route with no effort setting resolves to the bare slug, whatever AA calls its effort.
    const bare = variants.find((v) => v.slug === 'gemini-3-8-flash')
    if (bare === undefined) throw new Error('fixture lacks gemini-3-8-flash')
    const [row] = slotRows([route('gemini-3.8-flash', null, bare.slug)], variants, variants, name)
    expect(row?.name).toBe(`Gemini 3.8 Flash ${bare.effort}`)
    const [other] = slotRows(
      [route('gpt-6.1-terra', 'medium', 'gpt-6-1-terra')],
      variants,
      variants,
      name,
    )
    expect(other?.name).toBe('GPT-6.1 Terra max')
  })

  it('keeps a route with no variant, named by its model and effort', () => {
    const [row] = slotRows([route('claude-haiku-5-5', 'none', null)], variants, variants, name)
    expect(row?.variant).toBeNull()
    expect(row?.verdict).toBeNull()
    expect(row?.name).toBe('claude-haiku-5-5 none')
  })
})

describe('slotSummary', () => {
  const rowsFor = (routes: EfficiencyRoute[]) => slotRows(routes, variants, variants, name)

  it('accounts for every slot and pluralises', () => {
    const rows = rowsFor(EFFICIENCY_FIXTURE.routes)
    const text = slotSummary(rows)
    expect(text.startsWith(`Of your ${rows.length} slots, `)).toBe(true)
    expect(text).toContain('has no benchmark row')
    expect(text).not.toContain('1 sit ')
    expect(text.endsWith('.')).toBe(true)
  })

  it('says sits for one and sit for several', () => {
    const one = slotSummary(rowsFor([route('gpt-6.1-sol', 'high', 'gpt-6-1-sol-high')]))
    expect(one).toBe('Of your 1 slot, 1 sits on the frontier.')
    const two = slotSummary(
      rowsFor([
        route('gpt-6.1-sol', 'high', 'gpt-6-1-sol-high'),
        route('gpt-6.1-sol', 'max', 'gpt-6-1-sol'),
      ]),
    )
    expect(two).toContain('2 sit on the frontier')
  })

  it('is empty without slots', () => {
    expect(slotSummary([])).toBe('')
  })
})
