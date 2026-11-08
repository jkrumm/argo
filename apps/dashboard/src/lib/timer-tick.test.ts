import { describe, expect, test } from 'bun:test'
import type { Phase } from '../features/strength-tracker/components/timer-core'
import { advanceInterval, displayRemaining } from './timer-tick'

const phase = (type: Phase['type'], dur: number): Phase => ({ type, dur, rep: 1, totalReps: 2 })
const phases = [phase('lead', 5), phase('work', 10), phase('rest', 10), phase('work', 10)]

describe('displayRemaining', () => {
  test('rounds up to 100 ms', () => {
    expect(displayRemaining(1_000, 0)).toBe(1)
    expect(displayRemaining(1_001, 0)).toBe(1.1)
    expect(displayRemaining(1_099, 0)).toBe(1.1)
  })

  test('never goes negative', () => {
    expect(displayRemaining(0, 500)).toBe(0)
  })
})

describe('advanceInterval', () => {
  test('stays put while the phase runs', () => {
    expect(advanceInterval(phases, 0, 5_000, 4_999)).toEqual({
      phaseIndex: 0,
      endAt: 5_000,
      entered: 0,
      finished: false,
    })
  })

  test('re-bases the next phase on the previous end, not on the late tick', () => {
    const r = advanceInterval(phases, 0, 5_000, 5_700)
    expect(r).toEqual({ phaseIndex: 1, endAt: 15_000, entered: 1, finished: false })
  })

  test('catches up across several phases after a long stall', () => {
    const r = advanceInterval(phases, 0, 5_000, 27_000)
    expect(r).toEqual({ phaseIndex: 3, endAt: 35_000, entered: 3, finished: false })
  })

  test('finishes when the last phase has ended', () => {
    const r = advanceInterval(phases, 0, 5_000, 40_000)
    expect(r.finished).toBe(true)
    expect(r.phaseIndex).toBe(3)
  })
})
