import { isValidElement } from 'react'
import { describe, expect, it } from 'bun:test'
import type { WeightSummary, WeightWindowStats } from '../types'
import { GoalPopover } from './goal-popover'
import { weightCell, weightFooterEntries } from './strip-cells'

const none = { current: null } as unknown as WeightSummary
const noStats = { mean7: null, mean30: null } as unknown as WeightWindowStats
const input = (goal: number | null) => ({ summary: none, stats: noStats, goal })

describe('weight cell with no entries', () => {
  it('shows the empty reason and, with no goal, keeps Set a goal in the strip footer under it', () => {
    const cell = weightCell({
      ...input(null),
      startWeight: null,
      startDate: null,
      latestDate: null,
      range: null,
      entries: 0,
    })
    expect(cell.state).toEqual({
      kind: 'empty',
      reason: 'No entries in this window \u2014 log a weight',
    })
    const entries = weightFooterEntries(input(null))
    expect(entries).toHaveLength(1)
    const [entry] = entries
    expect(entry?.under).toBe('weight')
    expect(isValidElement(entry?.content) && entry.content.type).toBe(GoalPopover)
  })

  it('has no goal action once a goal is set', () => {
    expect(weightFooterEntries(input(80))).toEqual([])
  })
})
