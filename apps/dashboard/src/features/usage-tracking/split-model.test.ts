import { describe, expect, it } from 'bun:test'
import type { SplitRow } from '../../lib/queries/usage'
import { cutList, mixSegments, mostlyOf, priorMeasureOf, totalOf, unsetShare } from './split-model'

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
