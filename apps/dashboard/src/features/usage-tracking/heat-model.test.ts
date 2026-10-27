import { describe, expect, it } from 'bun:test'
import { busiestSlot, hourTotals, rhythmCells, weekdayTotals } from './heat-model'

describe('rhythm slots', () => {
  const cells = rhythmCells([
    { dow: 0, hour: 9, value: 3 },
    { dow: 6, hour: 23, value: 7 },
    { dow: 2, hour: 0, value: 0 },
  ])

  it('names the weekday (0 = Monday) and zero-pads the hour', () => {
    expect(cells.map((c) => `${c.day} ${c.hour}`)).toEqual(['Mon 09', 'Sun 23', 'Wed 00'])
  })

  it('sums by hour of day and by weekday, and finds the busiest slot', () => {
    const hours = hourTotals(cells)
    expect(hours).toHaveLength(24)
    expect(busiestSlot(hours)).toEqual({ label: '23', value: 7 })
    expect(busiestSlot(weekdayTotals(cells))).toEqual({ label: 'Sun', value: 7 })
    expect(busiestSlot(hourTotals([]))).toBeNull()
  })
})
