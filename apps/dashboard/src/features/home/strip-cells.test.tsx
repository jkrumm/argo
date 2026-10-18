import { describe, expect, it } from 'bun:test'
import { acwrCell, agentsCell, budgetCell, meetingCell, recoveryCell } from './strip-cells'

const NOW = new Date(2026, 0, 15, 12, 0).getTime()

describe('strip cells with no reading', () => {
  it('shows an em dash and a reason, never 0', () => {
    expect(agentsCell(undefined, null, undefined, NOW)).toMatchObject({
      value: null,
      footer: 'no snapshot in 24 h',
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
      footer: 'none in 7 days',
    })
    expect(recoveryCell(null)).toMatchObject({
      value: null,
      footer: 'Garmin data not loaded; reload to retry',
    })
    expect(
      recoveryCell({
        score: null,
        mean: null,
        days: 0,
        ceiling: null,
        trend: [],
        date: null,
        isToday: false,
      }),
    ).toMatchObject({ value: null, footer: 'no reading yet · Garmin syncs every 6 h' })
    expect(recoveryCell(null, true)).toMatchObject({ footer: 'loading Garmin data' })
    expect(acwrCell(null, NOW)).toMatchObject({ value: null, footer: 'unavailable' })
  })

  it('labels a recovery that is not today’s with its own day and says when today fills', () => {
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
    expect(cell.footer).toBe('today fills after the next Garmin sync (every 6 h)')
  })

  it('names the reading day in the ACWR footer only when it is not today', () => {
    const reading = { acwr: 1.1, zone: 'optimal' as const }
    expect(acwrCell({ ...reading, date: '2026-01-15' }, NOW).footer).toBe('range 0.8–1.3')
    expect(acwrCell({ ...reading, date: '2026-01-14' }, NOW).footer).toBe(
      'range 0.8–1.3 · Wed 14 Jan',
    )
  })

  it('says which calendar is missing when the empty day is partial', () => {
    expect(
      meetingCell({ meetings: [], loaded: ['work'], unavailable: ['personal'] }, null, null, NOW),
    ).toMatchObject({ footer: 'none today · Personal unavailable' })
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
