import { describe, expect, it } from 'bun:test'
import { buildDecision, manualDefaults, suggestionsFrom, toMs } from './model'

const values = { split: '', kind: '', issuer: '', date: '', title: '' }

describe('buildDecision', () => {
  it('normalizes split points', () =>
    expect(buildDecision({ ...values, split: '9, 10  12' })).toEqual({
      body: { split: '9,10,12' },
    }))

  it('sends only the values given', () =>
    expect(buildDecision({ ...values, kind: ' invoice ', date: '2026-11-02' })).toEqual({
      body: { kind: 'invoice', date: '2026-11-02' },
    }))

  it('refuses split points together with values', () =>
    expect(buildDecision({ ...values, split: '9', kind: 'invoice' })).toHaveProperty('error'))

  it('refuses split points that do not ascend or start below 2', () => {
    expect(buildDecision({ ...values, split: '10, 9' })).toHaveProperty('error')
    expect(buildDecision({ ...values, split: '1, 5' })).toHaveProperty('error')
    expect(buildDecision({ ...values, split: 'x' })).toHaveProperty('error')
  })

  it('refuses a bad date, a leading hyphen and an empty form', () => {
    expect(buildDecision({ ...values, date: '2.11.2026' })).toHaveProperty('error')
    expect(buildDecision({ ...values, title: '--single' })).toHaveProperty('error')
    expect(buildDecision(values)).toHaveProperty('error')
  })
})

describe('manualDefaults', () => {
  const base = { name: 'x.pdf', mtime: 1, reason: null, sides: null, sideOf: null }
  it('prefills split points when the proposal splits', () =>
    expect(
      manualDefaults({
        ...base,
        proposal: {
          kind: 'invoice',
          date: null,
          split: { documents: 2, ranges: ['1-2', '3'], starts: [3] },
        },
      }),
    ).toEqual({ ...values, split: '3' }))
  it('keeps no values beside split points: the form would be refused', () =>
    expect(manualDefaults({ ...base, proposal: null })).toEqual(values))
})

describe('suggestionsFrom', () => {
  it('ranks the index values by use', () => {
    const doc = (kind: string | null, issuer: string | null) => ({
      id: '1',
      title: 't',
      kind,
      issuer,
      tags: [],
      summary: '',
      fileExists: true,
    })
    const result = suggestionsFrom({
      total: 3,
      count: 3,
      documents: [doc('invoice', 'A'), doc('letter', 'A'), doc('invoice', null)],
    })
    expect(result).toEqual({ kinds: ['invoice', 'letter'], issuers: ['A'] })
  })
})

describe('toMs', () => {
  it('lifts seconds, keeps milliseconds', () => {
    expect(toMs(1_700_000_000)).toBe(1_700_000_000_000)
    expect(toMs(1_700_000_000_000)).toBe(1_700_000_000_000)
  })
})
