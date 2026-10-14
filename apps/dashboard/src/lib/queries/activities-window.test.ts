import { describe, expect, it } from 'bun:test'
import { activitiesRange, chunk, remainingPages } from './activities-window'

const now = new Date(2026, 9, 14, 12)

describe('activitiesRange', () => {
  it('derives dateFrom from a preset window', () => {
    expect(activitiesRange({ window: '7d' }, now)).toEqual({
      dateFrom: '2026-10-07',
      dateTo: undefined,
    })
    expect(activitiesRange({ window: '30d' }, now).dateFrom).toBe('2026-09-14')
    expect(activitiesRange({ window: '90d' }, now).dateFrom).toBe('2026-07-16')
  })

  it('leaves "all" unbounded', () => {
    expect(activitiesRange({ window: 'all' }, now)).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
    })
  })

  it('explicit from/to beat the preset', () => {
    expect(activitiesRange({ window: '7d', from: '2026-01-01', to: '2026-02-01' }, now)).toEqual({
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
    })
  })
})

describe('remainingPages', () => {
  it('needs nothing beyond page 1 when everything fits', () => {
    expect(remainingPages(0)).toEqual([])
    expect(remainingPages(200)).toEqual([])
  })

  it('lists every page after the first for a given total', () => {
    expect(remainingPages(201)).toEqual([2])
    expect(remainingPages(450)).toEqual([2, 3])
  })
})

describe('chunk', () => {
  it('splits into batches of at most the given size', () => {
    expect(chunk([2, 3, 4, 5, 6], 4)).toEqual([[2, 3, 4, 5], [6]])
    expect(chunk([], 4)).toEqual([])
  })
})
