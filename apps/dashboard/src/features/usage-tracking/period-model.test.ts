import { describe, expect, it } from 'bun:test'
import { change } from './period-model'

describe('change', () => {
  it('is null without a prior window or without anything now', () => {
    expect(change(5, null)).toBeNull()
    expect(change(0, 5)).toBeNull()
  })

  it('reads a percentage, and `new` from a zero or tiny base', () => {
    expect(change(15, 10)).toEqual({ kind: 'pct', pct: 50 })
    expect(change(5, 0)).toEqual({ kind: 'new' })
    expect(change(100, 5)).toEqual({ kind: 'new' })
  })
})
