import { describe, expect, it } from 'bun:test'
import { WindowQuerySchema, parseDateWindow, parseWindow, windowEnd } from './window.js'

// 2026-07-10 22:30 UTC is already 2026-07-11 00:30 in Berlin (CEST).
const NOW = new Date('2026-07-10T22:30:00Z')

describe('windowEnd', () => {
  it('is the window end, capped at today', () => {
    expect(windowEnd('2026-01-31', '2026-11-09')).toBe('2026-01-31')
    expect(windowEnd('2026-12-31', '2026-11-09')).toBe('2026-11-09')
  })
})

describe('parseDateWindow', () => {
  it('7d spans exactly 7 local dates ending today', () => {
    expect(parseDateWindow({ window: '7d' }, NOW)).toEqual({ from: '2026-07-05', to: '2026-07-11' })
  })
  it('defaults to 30d', () => {
    expect(parseDateWindow({}, NOW)).toEqual({ from: '2026-06-12', to: '2026-07-11' })
  })
  it('from without to ends today', () => {
    expect(parseDateWindow({ from: '2026-07-01' }, NOW)).toEqual({
      from: '2026-07-01',
      to: '2026-07-11',
    })
  })
  it('to without from ends at `to`', () => {
    expect(parseDateWindow({ window: '7d', to: '2026-07-03' }, NOW)).toEqual({
      from: '2026-06-27',
      to: '2026-07-03',
    })
  })
  it('explicit from and to pass through', () => {
    expect(parseDateWindow({ from: '2026-01-01', to: '2026-01-31' }, NOW)).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    })
  })
})

describe('parseWindow (instants)', () => {
  it('from without to ends now', () => {
    const w = parseWindow({ from: '2026-07-01' }, NOW)
    expect(w.to).toEqual(NOW)
    expect(w.from.toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })
})

describe('WindowQuerySchema', () => {
  it('rejects garbage and impossible dates', () => {
    expect(WindowQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false)
    expect(WindowQuerySchema.safeParse({ to: '2026-02-31' }).success).toBe(false)
    expect(WindowQuerySchema.safeParse({ from: '2026-02-03', to: '2026-02-05' }).success).toBe(true)
  })
})
