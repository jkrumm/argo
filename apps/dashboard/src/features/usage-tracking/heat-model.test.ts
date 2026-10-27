import { describe, expect, it } from 'bun:test'
import { busiestCell, rhythmCells } from './heat-model'

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
