import { describe, expect, it } from 'bun:test'
import type { Meta } from '../api/types'
import { monthsBetween, resolveRange, shiftMonth } from './months'

const meta = (first: string | null, last: string | null): Meta => ({
  first_month: first,
  last_month: last,
  accounts: [],
  categories: [],
})

describe('resolveRange', () => {
  const unset = { from: '', to: '' }

  it('defaults to the last 12 months of data', () => {
    expect(resolveRange(meta('2024-01', '2026-10'), unset)).toEqual({
      from: '2025-11',
      to: '2026-10',
    })
  })

  it('starts at the first month when the vault holds less than 12', () => {
    expect(resolveRange(meta('2026-06', '2026-10'), unset)).toEqual({
      from: '2026-06',
      to: '2026-10',
    })
  })

  it('honours explicit from/to and swaps a reversed pair', () => {
    expect(resolveRange(meta('2024-01', '2026-10'), { from: '2025-03', to: '2025-06' })).toEqual({
      from: '2025-03',
      to: '2025-06',
    })
    expect(resolveRange(meta('2024-01', '2026-10'), { from: '2025-06', to: '2025-03' })).toEqual({
      from: '2025-03',
      to: '2025-06',
    })
  })

  it('is null until meta arrives or when the vault has no bookings', () => {
    expect(resolveRange(undefined, unset)).toBeNull()
    expect(resolveRange(meta(null, null), unset)).toBeNull()
  })
})

describe('month helpers', () => {
  it('shifts across year boundaries and lists inclusive spans', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2025-12', 1)).toBe('2026-01')
    expect(monthsBetween('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
  })
})
