import { describe, expect, it } from 'bun:test'
import { acwrCell, agentsCell, budgetCell, meetingCell, recoveryCell } from './strip-cells'

const NOW = new Date(2026, 0, 15, 12, 0).getTime()

describe('strip cells with no reading', () => {
  it('shows an em dash and a reason, never 0', () => {
    expect(agentsCell(undefined, null, undefined, NOW)).toMatchObject({
      value: '—',
      footer: 'no snapshot in 24 h',
    })
    expect(budgetCell(undefined, undefined)).toMatchObject({ value: '—' })
    expect(meetingCell(null, null, NOW)).toMatchObject({
      value: '—',
      footer: 'calendar unavailable',
    })
    expect(meetingCell({ meetings: [] }, null, NOW)).toMatchObject({
      value: '—',
      footer: 'No meetings today.',
    })
    expect(recoveryCell(null)).toMatchObject({ value: '—', footer: 'unavailable' })
    expect(acwrCell(null)).toMatchObject({ value: '—', footer: 'unavailable' })
  })

  it('labels a recovery that is not today’s with its own day and says it is not scored yet', () => {
    const cell = recoveryCell({
      score: 70,
      mean: 65,
      days: 5,
      ceiling: null,
      trend: [60, 70],
      date: '2026-01-14',
      isToday: false,
    })
    expect(cell.caption).toBe('Recovery · Wed 14 Jan')
    expect(cell.footer).toBe('not scored yet today')
  })
})
