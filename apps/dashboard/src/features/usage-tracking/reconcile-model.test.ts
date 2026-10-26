import { describe, expect, it } from 'bun:test'
import { unglue } from '../../lib/format'
import type { IuReconcile } from '../../lib/queries/usage'
import { dayReading, fmtRatio, fmtSignedUsd, reconDays, unpricedNote } from './reconcile-model'

const day = (over: Partial<IuReconcile['days'][number]>): IuReconcile['days'][number] => ({
  day: '2026-10-21',
  portalUsd: 10,
  trackedUsd: 10,
  deltaUsd: 0,
  ratio: 1,
  flagged: false,
  partial: false,
  ...over,
})

describe('reconDays', () => {
  it('keeps the API verdicts and parses each day as a local date', () => {
    const [d] = reconDays([
      day({
        day: '2026-10-22',
        portalUsd: 71.44,
        trackedUsd: 30.21,
        deltaUsd: -41.23,
        ratio: 0.42,
        flagged: true,
      }),
    ])
    expect(d?.flagged).toBe(true)
    expect(d?.partial).toBe(false)
    expect([d?.date.getFullYear(), d?.date.getMonth(), d?.date.getDate()]).toEqual([2026, 9, 22])
  })

  it('carries the partial newest day through', () => {
    expect(reconDays([day({ partial: true })])[0]?.partial).toBe(true)
  })
})

describe('readings', () => {
  it('signs the delta and calls a sub-dollar gap zero', () => {
    expect(unglue(fmtSignedUsd(-41.23))).toBe('−$41')
    expect(unglue(fmtSignedUsd(12.4))).toBe('+$12')
    expect(unglue(fmtSignedUsd(0.3))).toBe('$0')
  })

  it('prints the ratio, a dash without a portal figure', () => {
    expect(fmtRatio(0.42)).toBe('0.42×')
    expect(fmtRatio(null)).toBe('—')
  })

  it('joins delta and ratio', () => {
    expect(unglue(dayReading({ deltaUsd: -41.23, ratio: 0.42 }))).toBe('−$41 · 0.42×')
  })

  it('counts unpriced rows', () => {
    expect(unpricedNote(1631)).toBe('1631 IU rows unpriced (no cost recorded)')
    expect(unpricedNote(1)).toBe('1 IU row unpriced (no cost recorded)')
  })
})
