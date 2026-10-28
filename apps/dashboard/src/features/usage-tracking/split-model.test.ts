import { describe, expect, it } from 'bun:test'
import type { SplitRow } from '../../lib/queries/usage'
import {
  combinedTotal,
  cutList,
  mergeByLabel,
  mixSegments,
  mostlyOf,
  priorMeasureOf,
  totalOf,
  unsetShare,
} from './split-model'

const cell = (payer: string, cost: number, fresh = cost * 10) => ({
  payer,
  cost,
  fresh,
  cacheRead: 0,
  output: 0,
  calls: 1,
})

const row = (
  key: string,
  payers: ReturnType<typeof cell>[],
  prior = null as SplitRow['prior'],
): SplitRow => ({
  key,
  cost: payers.reduce((s, p) => s + p.cost, 0),
  fresh: payers.reduce((s, p) => s + p.fresh, 0),
  cacheRead: 0,
  output: 0,
  calls: payers.length,
  prior,
  payers,
})

describe('mixSegments', () => {
  it('has one segment per payer with something in it, in registry order, summing to the row', () => {
    const r = row('argo', [cell('iu-api', 3), cell('iu-sub', 90), cell('me-sub', 0)])
    const segments = mixSegments(r, 'cost')
    expect(segments.map((s) => s.label)).toEqual(['IU Max', 'IU API'])
    expect(segments.reduce((s, x) => s + x.value, 0)).toBe(r.cost)
  })

  it('names the team key as its own wallet next to the personal one', () => {
    const r = row('argo', [cell('iu-team-api', 2), cell('iu-api', 9)])
    expect(mixSegments(r, 'cost').map((s) => s.label)).toEqual(['IU API', 'Athena team'])
  })

  it('reads fresh tokens under the tokens measure', () => {
    const r = row('argo', [cell('iu-sub', 1, 500), cell('me-sub', 9, 5)])
    expect(mixSegments(r, 'tokens').map((s) => s.value)).toEqual([500, 5])
  })
})

describe('mostlyOf', () => {
  const rows = [
    row('basalt-ui', [cell('iu-sub', 15), cell('iu-api', 40)]),
    row('argo', [cell('iu-sub', 60)]),
    row('(unset)', [cell('iu-sub', 99)]),
    row('(other)', [cell('iu-sub', 99)]),
  ]

  it("picks the wallet's own top key as a share of the wallet total", () => {
    expect(mostlyOf(rows, 'iu-sub', 300, 'cost')).toEqual({ key: 'argo', share: 0.2 })
    expect(mostlyOf(rows, 'iu-api', 80, 'cost')).toEqual({ key: 'basalt-ui', share: 0.5 })
  })

  it('never picks the folded tail or the unset key, and is null without a total or any usage', () => {
    expect(mostlyOf(rows, 'iu-sub', 0, 'cost')).toBeNull()
    expect(mostlyOf(rows, 'me-sub', 10, 'cost')).toBeNull()
  })
})

describe('cutList', () => {
  const rows = ['a', 'b', 'c', '(other)'].map((k, i) => row(k, [cell('iu-sub', 10 - i)]))

  it('keeps the head and sums the tail with the folded row into one rest', () => {
    const cut = cutList(rows, 2)
    expect(cut.named.map((r) => r.key)).toEqual(['a', 'b'])
    expect(cut.rest).toMatchObject({ key: 'Other', cost: 8 + 7, rows: 2 })
  })

  it('has no rest when everything fits', () => {
    expect(cutList(rows.slice(0, 2), 5).rest).toBeNull()
  })
})

describe('priorMeasureOf and totalOf', () => {
  it('reads the measure of the prior window, null without one', () => {
    expect(priorMeasureOf({ prior: { cost: 4, fresh: 40 } }, 'tokens')).toBe(40)
    expect(priorMeasureOf({ prior: null }, 'cost')).toBeNull()
  })

  it('finds a payer total', () => {
    const totals = [{ payer: 'iu-sub', ...cell('iu-sub', 1), prior: null }]
    expect(totalOf(totals, 'iu-sub')?.cost).toBe(1)
    expect(totalOf(totals, 'me-sub')).toBeUndefined()
  })
})

describe('mergeByLabel', () => {
  const plainLabel = (key: string) => key.replace(/^[^/]+\//, '')
  const prior = (cost: number) => ({ cost, fresh: cost * 10 })

  it('sums rows that read the same, prior and payer cells included, named by the largest', () => {
    // Prod: the team key reports the routed name, the personal key the plain one.
    const rows = [
      row('deepseek-v4.1-flash', [cell('iu-api', 6)], prior(2)),
      row('gpt-5.6-terra', [cell('iu-api', 5)], prior(5)),
      row('deepseek/deepseek-v4.1-flash', [cell('iu-team-api', 3)], prior(1)),
    ]
    const merged = mergeByLabel(rows, 'cost', plainLabel)
    expect(merged.map((r) => r.key)).toEqual(['deepseek-v4.1-flash', 'gpt-5.6-terra'])
    expect(merged[0]).toMatchObject({ cost: 9, fresh: 90, calls: 2, prior: { cost: 3, fresh: 30 } })
    expect(merged[0]?.payers.map((p) => [p.payer, p.cost])).toEqual([
      ['iu-api', 6],
      ['iu-team-api', 3],
    ])
  })

  it('re-ranks by the lens once rows merged, and has no prior when one side has none', () => {
    const rows = [
      row('a', [cell('iu-api', 5)], prior(1)),
      row('b', [cell('iu-api', 3)], null),
      row('x/b', [cell('iu-team-api', 4)], prior(1)),
    ]
    const merged = mergeByLabel(rows, 'cost', plainLabel)
    expect(merged.map((r) => [r.key, r.cost])).toEqual([
      ['b', 7],
      ['a', 5],
    ])
    expect(merged[0]?.prior).toBeNull()
  })

  it('hands back a list with nothing to merge as it was, and never merges the folded (other) row', () => {
    const rows = [row('a', [cell('iu-api', 2)]), row('b', [cell('iu-api', 5)]), row('(other)', [])]
    expect(mergeByLabel(rows, 'cost', plainLabel).map((r) => r.key)).toEqual(['a', 'b', '(other)'])
    const withFold = [...rows, row('x/a', [cell('iu-api', 9)])]
    expect(mergeByLabel(withFold, 'cost', plainLabel).map((r) => r.key)).toEqual([
      'a',
      'b',
      '(other)',
    ])
  })
})

describe('combinedTotal', () => {
  const total = (payer: string, cost: number, prior: { cost: number; fresh: number } | null) => ({
    ...cell(payer, cost),
    prior,
  })

  it('sums the payers of a scope, prior included', () => {
    const totals = [
      total('iu-api', 10, { cost: 4, fresh: 40 }),
      total('iu-team-api', 3, { cost: 1, fresh: 10 }),
      total('iu-sub', 500, null),
    ]
    expect(combinedTotal(totals, ['iu-api', 'iu-team-api'])).toMatchObject({
      cost: 13,
      fresh: 130,
      calls: 2,
      prior: { cost: 5, fresh: 50 },
    })
  })

  it('has no prior as soon as one payer has none, and is the lone total for one payer', () => {
    const totals = [total('iu-api', 10, { cost: 4, fresh: 40 }), total('iu-team-api', 3, null)]
    expect(combinedTotal(totals, ['iu-api', 'iu-team-api'])?.prior).toBeNull()
    expect(combinedTotal(totals, ['iu-api'])).toMatchObject({ cost: 10, prior: { cost: 4 } })
  })

  it('reads a payer without a row as absent, and no payer at all as undefined', () => {
    const totals = [total('iu-api', 10, null)]
    expect(combinedTotal(totals, ['iu-api', 'iu-team-api'])?.cost).toBe(10)
    expect(combinedTotal(totals, ['iu-team-api'])).toBeUndefined()
  })
})

describe('unsetShare', () => {
  const rows = [row('argo', [cell('iu-api', 75)]), row('(unset)', [cell('iu-api', 25)])]

  it('is the (unset) row over the payer total', () => {
    expect(unsetShare(rows, { cost: 100 })).toEqual({ share: 0.25, cost: 25 })
  })

  it('is zero when every row has a project, null without a total', () => {
    expect(unsetShare([rows[0]!], { cost: 75 })).toEqual({ share: 0, cost: 0 })
    expect(unsetShare(rows, undefined)).toBeNull()
    expect(unsetShare(rows, { cost: 0 })).toBeNull()
  })
})
