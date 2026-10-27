import { describe, it, expect } from 'bun:test'
import { laneSpills, windowSummary, type QuotaWindow } from './routing.js'

describe('laneSpills', () => {
  it('counts picked=spill and reason=spill per lane', () => {
    const lanes = laneSpills([
      { lane: 'interactive', picked: 'me', reason: 'spill', count: 2 },
      { lane: 'interactive', picked: 'me', reason: 'home', count: 6 },
      { lane: 'wave', picked: 'spill', reason: 'no-eligible-account', count: 1 },
      { lane: 'wave', picked: 'me', reason: 'home', count: 9 },
    ])
    expect(lanes).toEqual([
      { lane: 'wave', total: 10, spills: 1, spillRate: 0.1 },
      { lane: 'interactive', total: 8, spills: 2, spillRate: 0.25 },
    ])
  })
})

describe('windowSummary', () => {
  const w = (over: Partial<QuotaWindow>): QuotaWindow => ({
    account: 'me',
    window: 'five_hour',
    resetAt: '2026-10-27T10:00:00Z',
    pctAtReset: null,
    unusedPct: null,
    lastSampleAt: null,
    firstPickAt: null,
    minutesToFirstPick: null,
    ...over,
  })
  it('summarises unused capacity and the wait to the next pick per account and window', () => {
    const [s] = windowSummary([
      w({ unusedPct: 10, minutesToFirstPick: 5, firstPickAt: 'x' }),
      w({ unusedPct: 30, minutesToFirstPick: 15, firstPickAt: 'x' }),
      w({ unusedPct: 50 }),
    ])
    expect(s).toMatchObject({
      account: 'me',
      window: 'five_hour',
      resets: 3,
      medianUnusedPct: 30,
      meanUnusedPct: 30,
      medianMinutesToFirstPick: 10,
      neverPickedAfter: 1,
    })
  })
})
