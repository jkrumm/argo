import { describe, expect, it } from 'bun:test'
import { drawnSeries } from './volume-series'

type P = { work: number; amrap: number }
const series = [
  { key: 'work', getValue: (d: P) => (d.work > 0 ? d.work : null) },
  { key: 'amrap', getValue: (d: P) => (d.amrap > 0 ? d.amrap : null) },
]

describe('drawnSeries', () => {
  it('drops a series with no non-zero value in the window', () => {
    const points = [
      { work: 4, amrap: 0 },
      { work: 6, amrap: 0 },
    ]
    expect(drawnSeries(series, points).map((s) => s.key)).toEqual(['work'])
  })

  it('keeps a series drawn in any one week', () => {
    const points = [
      { work: 4, amrap: 0 },
      { work: 6, amrap: 2 },
    ]
    expect(drawnSeries(series, points).map((s) => s.key)).toEqual(['work', 'amrap'])
  })

  it('returns nothing when every series is empty', () => {
    expect(drawnSeries(series, [{ work: 0, amrap: 0 }])).toEqual([])
  })
})
