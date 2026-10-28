import { describe, expect, it } from 'bun:test'
import { unglue } from '../../lib/format'
import type { IuReconcile } from '../../lib/queries/usage'
import {
  GAP_PRESENTATION,
  dayReading,
  fmtRatio,
  fmtSignedUsd,
  gapLine,
  reconDays,
  unpricedNote,
} from './reconcile-model'

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

  it('joins delta and ratio: the pricing reading (personal key) is the signed delta, unchanged', () => {
    expect(unglue(dayReading('pricing', { deltaUsd: -41.23, ratio: 0.42 }))).toBe('−$41 · 0.42×')
    expect(unglue(dayReading('pricing', { deltaUsd: 12.4, ratio: 1.3 }))).toBe('+$12 · 1.30×')
  })

  it('reads a team-key day with the portal above tracked as unseen, the other days as signed', () => {
    expect(unglue(dayReading('unseen', { deltaUsd: -41.23, ratio: 0.42 }))).toBe(
      '$41 unseen · 0.42×',
    )
    expect(unglue(dayReading('unseen', { deltaUsd: 12.4, ratio: 1.3 }))).toBe('+$12 · 1.30×')
    expect(unglue(dayReading('unseen', { deltaUsd: 0.2, ratio: 1 }))).toBe('$0 · 1.00×')
  })

  it('counts unpriced rows', () => {
    expect(unpricedNote(1631)).toBe('1631 IU rows unpriced (no cost recorded)')
    expect(unpricedNote(1)).toBe('1 IU row unpriced (no cost recorded)')
  })
})

describe('gapLine', () => {
  it('keeps the signed delta for the personal key, where a gap is mostly pricing', () => {
    expect(unglue(gapLine('pricing', 34, 10))).toBe('−$24')
    expect(unglue(gapLine('pricing', 10, 22))).toBe('+$12')
    expect(unglue(gapLine('pricing', 10, 10))).toBe('$0')
  })

  it('reads portal above tracked as spend by producers we do not see for the team key, not as an error', () => {
    // Athena team key, 2026-10-28: portal $33.85, tracked ~$10.06 (the build phase predates the DB rows).
    const line = unglue(gapLine('unseen', 34, 10))
    expect(line).toBe('$24 from producers we do not see')
    expect(line).not.toMatch(/off|error|wrong|missing/i)
  })

  it('keeps the signed excess for the team key when tracked is above the portal, and says so when they agree', () => {
    expect(unglue(gapLine('unseen', 10, 22))).toBe('+$12 tracked above portal')
    expect(gapLine('unseen', 10, 10)).toBe('no gap')
  })
})

describe('GAP_PRESENTATION', () => {
  const flaggedDay = reconDays([day({ flagged: true, partial: true })])[0]!
  const okDay = reconDays([day({})])[0]!

  it('flags a pricing gap as the amber Off by more state, as before', () => {
    const { states, bandOf } = GAP_PRESENTATION.pricing
    expect(states.map((s) => s.key)).toEqual(['ok', 'warn', 'partial'])
    expect(states[1]?.label).toBe('Off by more')
    expect(bandOf(flaggedDay)).toEqual({ state: 'warn', marker: { state: 'partial' } })
    expect(bandOf(okDay)).toEqual({ state: 'ok' })
  })

  it('marks an unseen gap as a neutral differ state, not a warning', () => {
    const { states, bandOf } = GAP_PRESENTATION.unseen
    expect(states.map((s) => s.key)).toEqual(['ok', 'differ', 'partial'])
    expect(states[1]?.label).toBe('Portal and tracked differ')
    expect(bandOf(flaggedDay).state).toBe('differ')
  })

  it('formats a day by its own reading, and keeps one reference per reading', () => {
    const d = { deltaUsd: -41.23, ratio: 0.42 }
    expect(unglue(GAP_PRESENTATION.pricing.states[1]!.formatValue(d as never))).toBe('−$41 · 0.42×')
    expect(unglue(GAP_PRESENTATION.unseen.states[1]!.formatValue(d as never))).toBe(
      '$41 unseen · 0.42×',
    )
    expect(GAP_PRESENTATION.unseen.states).toBe(GAP_PRESENTATION.unseen.states)
  })

  it('says it ignores the Range and Workspace filters, so no filtered tracked side meets an unfiltered portal', () => {
    for (const reading of ['pricing', 'unseen'] as const) {
      expect(GAP_PRESENTATION[reading].info).toContain('Range and Workspace filters do not apply')
    }
  })

  it('states the unseen reading only in the team key’s info', () => {
    expect(GAP_PRESENTATION.unseen.info).toContain('producers we do not see')
    expect(GAP_PRESENTATION.pricing.info).not.toContain('producers we do not see')
  })
})
