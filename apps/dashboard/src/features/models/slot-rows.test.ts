import { describe, expect, it } from 'bun:test'
import type { EfficiencyRoute } from './api/types'
import { EFFICIENCY_FIXTURE } from './__fixtures__/efficiency'
import { lineageNames } from './model'
import { slotRows, slotSummary } from './slot-rows'

const variants = EFFICIENCY_FIXTURE.variants
const readable = lineageNames(variants)
const display = (lineage: string) => readable.get(lineage) ?? lineage

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
    const bare = variants.find((v) => v.slug === 'gemini-prism-5')
    if (bare === undefined) throw new Error('fixture lacks gemini-prism-5')
    const [row] = slotRows([route('gemini-prism-5', null, bare.slug)], variants, variants, display)
    expect(row?.name).toBe(`Gemini Prism 5${bare.effort === 'default' ? '' : ` ${bare.effort}`}`)
    const [other] = slotRows(
      [route('gpt-9.1-vega', 'medium', 'gpt-9-1-vega')],
      variants,
      variants,
      display,
    )
    expect(other?.name).toBe('GPT-9.1 Vega max')
  })

  it('keeps a route with no variant, named by its model and effort', () => {
    const [row] = slotRows([route('claude-marlow-4', 'none', null)], variants, variants, display)
    expect(row?.variant).toBeNull()
    expect(row?.verdict).toBeNull()
    // The lineage's readable name, not the model id.
    expect(row?.name).toBe('Claude Marlow 4 none')
  })
})

describe('slots on the fixture routes', () => {
  it('names every slot readably and never by a slug', () => {
    const rows = slotRows(EFFICIENCY_FIXTURE.routes, variants, variants, display)
    expect(rows.map((r) => r.name).toSorted()).toEqual([
      'Claude Ember 4.2 medium',
      'Claude Marlow 4 high',
      'Claude Marlow 4 none',
      'GPT-9.1 Vega medium',
      'Gemini Prism 5 high',
    ])
  })
})

describe('slotSummary', () => {
  const rowsFor = (routes: EfficiencyRoute[]) => slotRows(routes, variants, variants, display)

  it('accounts for every slot and pluralises', () => {
    const rows = rowsFor(EFFICIENCY_FIXTURE.routes)
    const text = slotSummary(rows)
    expect(text.startsWith(`Of your ${rows.length} slots, `)).toBe(true)
    expect(text).toContain('has no benchmark row')
    expect(text).not.toContain('1 sit ')
    expect(text.endsWith('.')).toBe(true)
  })

  it('says sits for one and sit for several', () => {
    const one = slotSummary(rowsFor([route('claude-quill-4', 'max', 'claude-quill-4')]))
    expect(one).toBe('Of your 1 slot, 1 sits on the frontier.')
    const two = slotSummary(
      rowsFor([
        route('claude-quill-4', 'max', 'claude-quill-4'),
        route('gpt-9.1-lyra', 'max', 'gpt-9-1-lyra'),
      ]),
    )
    expect(two).toContain('2 sit on the frontier')
  })

  it('is empty without slots', () => {
    expect(slotSummary([])).toBe('')
  })
})
