import { describe, it, expect } from 'bun:test'
import { foldSplit, type SplitCell } from './usage-split.js'

const cell = (over: Partial<SplitCell> & Pick<SplitCell, 'key' | 'payer'>): SplitCell => ({
  cost: 0,
  fresh: 0,
  cacheRead: 0,
  output: 0,
  calls: 1,
  priorCost: 0,
  priorFresh: 0,
  ...over,
})

describe('foldSplit', () => {
  const cells = [
    cell({ key: 'argo', payer: 'iu-sub', cost: 100, fresh: 10, priorCost: 50 }),
    cell({ key: 'argo', payer: 'iu-api', cost: 5, fresh: 40 }),
    cell({ key: 'basalt', payer: 'me-sub', cost: 60, fresh: 5, priorCost: 70 }),
    cell({ key: 'brain', payer: 'iu-sub', cost: 3, fresh: 1 }),
    cell({ key: 'dead', payer: 'iu-sub', cost: 0, fresh: 0, priorCost: 9 }),
  ]

  it('ranks by dollars with the per-payer split and the prior window', () => {
    const { rows } = foldSplit({ cells, lens: 'cost', top: 12, hasPrior: true })
    expect(rows.map((r) => r.key)).toEqual(['argo', 'basalt', 'brain'])
    expect(rows[0]).toMatchObject({ cost: 105, fresh: 50, calls: 2, prior: { cost: 50, fresh: 0 } })
    expect(rows[0]!.payers.map((p) => p.payer)).toEqual(['iu-sub', 'iu-api'])
  })

  it('ranks by fresh tokens under the tokens lens', () => {
    const { rows } = foldSplit({ cells, lens: 'tokens', top: 12, hasPrior: true })
    expect(rows.map((r) => r.key)).toEqual(['argo', 'basalt', 'brain'])
    expect(rows[0]!.payers[0]!.payer).toBe('iu-api')
  })

  it('folds the tail into one other row that keeps the totals whole', () => {
    const { rows, totals } = foldSplit({ cells, lens: 'cost', top: 2, hasPrior: true })
    expect(rows.map((r) => r.key)).toEqual(['argo', '(other)'])
    expect(rows[1]).toMatchObject({ cost: 63, prior: { cost: 70, fresh: 0 } })
    expect(rows[1]!.payers.map((p) => p.payer).toSorted()).toEqual(['iu-sub', 'me-sub'])
    const sum = (xs: { cost: number }[]) => xs.reduce((a, x) => a + x.cost, 0)
    expect(sum(rows)).toBe(sum(totals))
  })

  it('totals per payer include keys with nothing now, and null priors without a prior window', () => {
    const { totals } = foldSplit({ cells, lens: 'cost', top: 12, hasPrior: false })
    expect(totals.find((t) => t.payer === 'iu-sub')).toMatchObject({ cost: 103, prior: null })
  })
})

describe('foldSplit — a real key named other', () => {
  it('keeps it apart from the tail fold', () => {
    const { rows } = foldSplit({
      cells: [
        cell({ key: 'other', payer: 'iu-sub', cost: 50 }),
        cell({ key: 'a', payer: 'iu-sub', cost: 5 }),
        cell({ key: 'b', payer: 'iu-sub', cost: 4 }),
      ],
      lens: 'cost',
      top: 2,
      hasPrior: false,
    })
    expect(rows.map((r) => r.key)).toEqual(['other', '(other)'])
  })
})
