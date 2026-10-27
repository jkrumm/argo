import { describe, expect, it } from 'bun:test'
import { busiestCell, rhythmCells, whenCells } from './heat-model'

const bucket = (b: string, groups: Record<string, number | null>) => ({ bucket: b, groups })

describe('whenCells', () => {
  const buckets = [
    bucket('2026-10-24', { 'iu-sub': 1000, 'iu-api': 1 }),
    bucket('2026-10-25', { 'iu-sub': 500, 'iu-api': 4 }),
    bucket('2026-10-26', { 'iu-sub': 0 }),
  ]

  it('scales each row to its own peak and keeps the real figure', () => {
    const cells = whenCells(buckets, ['iu-sub', 'iu-api'])
    const pick = (row: string, col: string) => cells.find((c) => c.row === row && c.col === col)
    expect(pick('iu-sub', '2026-10-24')).toMatchObject({ actual: 1000, scaled: 1 })
    expect(pick('iu-sub', '2026-10-25')?.scaled).toBe(0.5)
    expect(pick('iu-api', '2026-10-25')).toMatchObject({ actual: 4, scaled: 1 })
    expect(pick('iu-api', '2026-10-24')?.scaled).toBe(0.25)
  })

  it('treats a missing key as 0 and an all-zero row as 0, not NaN', () => {
    const cells = whenCells(buckets, ['iu-api', 'me-sub'])
    expect(cells.find((c) => c.row === 'iu-api' && c.col === '2026-10-26')).toMatchObject({
      actual: 0,
      scaled: 0,
    })
    expect(cells.filter((c) => c.row === 'me-sub').every((c) => c.scaled === 0)).toBe(true)
  })

  it('has one cell per row and bucket', () => {
    expect(whenCells(buckets, ['iu-sub', 'iu-api'])).toHaveLength(6)
  })
})

describe('rhythmCells and busiestCell', () => {
  const cells = rhythmCells([
    { dow: 0, hour: 9, value: 3 },
    { dow: 6, hour: 23, value: 7 },
    { dow: 2, hour: 0, value: 0 },
  ])

  it('names the weekday (0 = Monday) and zero-pads the hour', () => {
    expect(cells.map((c) => `${c.day} ${c.hour}`)).toEqual(['Mon 09', 'Sun 23', 'Wed 00'])
  })

  it('finds the busiest cell, null when nothing ran', () => {
    expect(busiestCell(cells)).toMatchObject({ day: 'Sun', hour: '23' })
    expect(busiestCell(cells.map((c) => ({ ...c, value: 0 })))).toBeNull()
  })
})
