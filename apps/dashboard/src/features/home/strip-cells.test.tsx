import { describe, expect, it } from 'bun:test'
import { acwrCell, agentsCell, budgetCell, meetingCell, recoveryCell } from './strip-cells'

const NOW = new Date(2026, 0, 15, 12, 0).getTime()

describe('strip cells with no reading', () => {
  it('shows an em dash and a reason, never 0', () => {
    expect(agentsCell(undefined, null, undefined, NOW)).toMatchObject({
      value: null,
      footer: 'no snapshot in 24 h',
    })
    expect(budgetCell(undefined, undefined)).toMatchObject({ value: null })
    expect(meetingCell(null, null, null, NOW)).toMatchObject({
      value: null,
      footer: 'calendar unavailable',
    })
    expect(
      meetingCell({ meetings: [], loaded: ['work', 'personal'], unavailable: [] }, null, null, NOW),
    ).toMatchObject({
      value: null,
      footer: 'none in the next 7 days',
    })
    expect(recoveryCell(null)).toMatchObject({ value: null, footer: 'unavailable' })
    expect(acwrCell(null)).toMatchObject({ value: null, footer: 'unavailable' })
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

  it('says which calendar is missing when the empty day is partial', () => {
    expect(
      meetingCell({ meetings: [], loaded: ['work'], unavailable: ['personal'] }, null, null, NOW),
    ).toMatchObject({ footer: 'No Work meetings today · Personal unavailable.' })
  })

  it('names the next meeting after today when today is empty', () => {
    const later = { title: '{meeting}', startMs: new Date(2026, 0, 19, 9, 30).getTime() }
    const cell = meetingCell(
      { meetings: [], loaded: ['work', 'personal'], unavailable: [] },
      null,
      later,
      NOW,
    )
    expect(cell.value).toBe('Mon 09:30')
  })
})
