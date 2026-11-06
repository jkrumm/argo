import { describe, expect, it } from 'bun:test'
import { EFFICIENCY_FIXTURE } from './__fixtures__/efficiency'
import { shortLineage } from './format'
import {
  efficiencyIndexes,
  lineageNames,
  routeUse,
  scatterPoints,
  intelligenceDomain,
  visibleVariants,
  type Axis,
} from './model'
import { labelPass } from './scatter-labels'

const { variants, routes } = EFFICIENCY_FIXTURE
const visible = visibleVariants(
  variants,
  { callable: true, superseded: false, creators: [] },
  routes,
)
const use = routeUse(routes)
const readable = lineageNames(variants)
const names = (lineage: string) => shortLineage(readable.get(lineage) ?? lineage)
const yDomain = intelligenceDomain(visible)
const indexes = efficiencyIndexes(variants)

/** The chart's own x domain: the points' log range, padded. */
function pass(axis: Axis, width: number, height: number, selected = '') {
  const { points } = scatterPoints(visible, axis, indexes)
  const lx = points.map((p) => p.lx)
  const xDomain = [Math.min(...lx) - 0.14, Math.max(...lx) + 0.14] as const
  return {
    points,
    ...labelPass({ points, use, selected, names, plot: { width, height }, xDomain, yDomain }),
  }
}

const WIDTHS = [
  ['desktop', 520, 300],
  ['phone', 330, 260],
] as const

describe('labelPass on the fixture routes', () => {
  for (const axis of ['index', 'cost', 'time', 'tokens'] as const) {
    for (const [device, width, height] of WIDTHS) {
      it(`labels every ringed variant on the ${axis} chart, ${device}`, () => {
        const { points, placed } = pass(axis, width, height)
        const ringed = points.filter((p) => use.has(p.variant.slug))
        expect(ringed.length).toBeGreaterThan(0)
        const labelled = new Set(placed.map((l) => l.id))
        expect(
          ringed.filter((p) => !labelled.has(p.variant.slug)).map((p) => p.variant.slug),
        ).toEqual([])
      })
    }
  }

  it('words a ring label with the readable name, effort and route count', () => {
    const { placed } = pass('cost', 520, 300)
    const texts = new Map(placed.map((l) => [l.id, l.text]))
    expect(texts.get('gpt-9-1-vega-medium')).toBe('Vega medium · 4 routes')
    expect(texts.get('claude-marlow-4-high')).toBe('Marlow 4 high · 12 routes')
    expect(texts.get('claude-ember-4-2-medium')).toBe('Ember 4.2 medium · 10 routes')
  })

  it('shortens the count on a phone', () => {
    const { placed } = pass('cost', 330, 260)
    expect(placed.find((l) => l.id === 'gpt-9-1-vega-medium')?.text).toBe('Vega medium · 4')
  })

  it('keeps the ring labels when a lineage is highlighted', () => {
    const { points, placed } = pass('time', 330, 260, 'gpt-9-1-vega')
    const labelled = new Set(placed.map((l) => l.id))
    for (const p of points.filter((q) => use.has(q.variant.slug))) {
      expect(labelled.has(p.variant.slug)).toBe(true)
    }
  })
})
