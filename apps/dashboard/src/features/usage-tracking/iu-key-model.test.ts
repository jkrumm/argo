import { describe, expect, test } from 'bun:test'
import { iuKeyLimitInfo, underCapLine } from './iu-key-model'

const budget = (over: Partial<Parameters<typeof underCapLine>[0]> = {}) => ({
  underCapOn: null,
  rolling30Usd: 578,
  limitUsd: 500,
  fetchedAt: '2026-11-02T06:00:00Z',
  ...over,
})

describe('underCapLine', () => {
  test('names the date a key over its cap falls under it', () => {
    expect(underCapLine(budget({ underCapOn: '2026-11-12' }))).toMatch(
      /^Under the cap around 12.Nov$/,
    )
  })

  test('says so when the projection never gets under within the horizon', () => {
    expect(underCapLine(budget())).toBe('Not under the cap within 60 days at the last 7 days’ burn')
  })

  test('is silent for a key already under its cap', () => {
    expect(underCapLine(budget({ rolling30Usd: 465 }))).toBeNull()
  })

  test('is silent without a portal report, whatever the zeros say', () => {
    expect(underCapLine(budget({ fetchedAt: null, rolling30Usd: 0 }))).toBeNull()
  })
})

describe('iuKeyLimitInfo', () => {
  test('explains the meter once the portal reported, the gap before', () => {
    expect(iuKeyLimitInfo('Personal', true)).toContain('rolling 30 days')
    expect(iuKeyLimitInfo('Athena team', false)).toContain('has not arrived yet')
  })
})
