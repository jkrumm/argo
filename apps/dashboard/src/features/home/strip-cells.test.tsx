import { describe, expect, it } from 'bun:test'
import type { ReactElement } from 'react'
import { RECOVERY_VERDICT_NAME, recoveryVerdict } from '../garmin-health/model'
import { recoveryMeterProps } from '../garmin-health/recovery-meter'
import type { RecoveryReading } from './model'
import { recoveryFooter } from './model'
import { acwrCell, agentsCell, budgetCell, meetingCell, recoveryCell } from './strip-cells'

const NOW = new Date(2026, 0, 15, 12, 0).getTime()

const reading = (over: Partial<RecoveryReading> = {}): RecoveryReading => ({
  score: 55,
  mean: 60,
  days: 7,
  ceiling: null,
  trend: [55],
  date: '2026-01-15',
  isToday: true,
  ...over,
})

describe('strip cells with no reading', () => {
  it('shows an em dash and a reason, never 0', () => {
    expect(agentsCell(undefined, null)).toMatchObject({ value: null })
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
      recoveryCell(
        reading({ score: null, mean: null, days: 0, trend: [], date: null, isToday: false }),
      ),
    ).toMatchObject({ value: null, footer: 'no reading yet · Garmin syncs every 6\u00a0h' })
    expect(recoveryCell(null, true)).toMatchObject({ footer: 'loading Garmin data' })
    expect(acwrCell(null, NOW)).toMatchObject({ value: null, footer: 'unavailable' })
  })

  it('labels a recovery that is not today’s with its own day and says when today fills', () => {
    const cell = recoveryCell(
      reading({
        score: 70,
        mean: 65,
        days: 5,
        trend: [60, 70],
        date: '2026-01-14',
        isToday: false,
      }),
    )
    expect(cell.caption).toBe('Recovery · Wed 14 Jan')
    expect(cell.footer).toBe(
      '7\u00a0d mean 65 · today fills after the next Garmin sync (every 6\u00a0h)',
    )
  })

  it('names the reading day in the ACWR footer only when it is not today', () => {
    const reading = { acwr: 1.1, zone: 'optimal' as const }
    expect(
      acwrCell({ acwr: 0.5, zone: 'undertrained' as const, date: '2026-01-15' }, NOW).unit,
    ).toBe('Low')
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
    expect(cell.footer).toStartWith('{meeting} · in ')
  })

  it('names which meeting is next, in its shortest form', () => {
    const meeting = (title: string) => ({
      key: 'm',
      title,
      startMs: NOW + 30 * 60_000,
      endMs: NOW + 60 * 60_000,
      durationMin: 30,
      attendees: 1,
      videoLink: null,
      sourceClass: 'work' as const,
    })
    const cell = (title: string) => {
      const m = meeting(title)
      return meetingCell({ meetings: [m], loaded: ['work'], unavailable: [] }, m, null, NOW)
    }
    expect(cell('{meeting}').footer).toBe('{meeting} · 1 remaining')
    expect(cell('Sprint planning — team {name} and the whole extended crew').footer).toBe(
      'Sprint planning · 1 remaining',
    )
    expect(cell('A very long meeting name without any clause break at all').footer).toBe(
      'A very long meeting… · 1 remaining',
    )
  })
})

describe('agentsCell', () => {
  it('states one window, now: the caption says so and no 24 h footer contradicts it', () => {
    const cell = agentsCell({ working: 2 } as never, {
      total: 5,
      parts: [{ key: 'working', label: 'working', value: 2 }],
    })
    expect(cell).toMatchObject({ caption: 'Agents working · now', value: '2', unit: 'of 5 agents' })
    expect(cell.footer).toBeUndefined()
  })
})

describe('recovery agrees with Garmin', () => {
  it('draws the shared meter: same zones and a label naming the verdict', () => {
    for (const score of [0, 39, 40, 69, 70, 100]) {
      const cell = recoveryCell(reading({ score, trend: [score] }))
      expect(cell.value).toBe(String(score))
      const children = (cell.visual as ReactElement<{ children: ReactElement[] }>).props.children
      const meter = (children[0] as ReactElement<ReturnType<typeof recoveryMeterProps>>).props
      expect(meter).toMatchObject(recoveryMeterProps(score))
      expect(meter.label).toContain(RECOVERY_VERDICT_NAME[recoveryVerdict(score)])
    }
  })
})

describe('recoveryFooter', () => {
  const NB = '\u00a0'
  it('keeps the mean in every branch where there is one', () => {
    expect(recoveryFooter(reading({ isToday: true }))).toBe(
      `7${NB}d mean 60 · 7 observed days of 7`,
    )
    expect(recoveryFooter(reading({ isToday: false }))).toBe(
      `7${NB}d mean 60 · today fills after the next Garmin sync (every 6${NB}h)`,
    )
  })

  it('drops only the mean when there is none', () => {
    expect(recoveryFooter(reading({ mean: null, days: 0, isToday: true }))).toBe(
      '0 observed days of 7',
    )
    expect(recoveryFooter(reading({ mean: null, isToday: false }))).toBe(
      `today fills after the next Garmin sync (every 6${NB}h)`,
    )
  })

  it('singular day', () => {
    expect(recoveryFooter(reading({ days: 1 }))).toBe(`7${NB}d mean 60 · 1 observed day of 7`)
  })
})
