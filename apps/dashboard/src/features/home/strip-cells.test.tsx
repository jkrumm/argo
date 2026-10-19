import { BUDGET_MISSING } from '../warden/page-model'
import { describe, expect, it } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import type { StatStripCell } from 'basalt-ui'
import { RECOVERY_VERDICT_NAME, allocateForms, recoveryVerdict } from '../garmin-health/model'
import { recoveryMeterProps } from '../garmin-health/recovery-meter'
import type { RecoveryReading } from './model'
import { recoveryFooter } from './model'
import {
  acwrCell,
  acwrCellGap,
  recoveryCellGap,
  agentsCell,
  budgetCell,
  budgetFooterEntries,
  meetingCell,
  recoveryCaption,
  recoveryCell,
  type SeriesState,
} from './strip-cells'

const NOW = new Date(2026, 0, 15, 12, 0).getTime()

/** The text a node renders, flattened through its elements. */
const textOf = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf((node as ReactElement<{ children?: ReactNode }>).props.children)
}

/** What a cell says without a reading: its empty-state reason, else its footer. */
const said = (cell: StatStripCell) =>
  cell.state?.kind === 'empty' ? cell.state.reason : textOf(cell.footer)

const SETTLED: SeriesState = { settled: true, failed: false }

const reading = (over: Partial<RecoveryReading> = {}): RecoveryReading => ({
  score: 55,
  mean: 60,
  days: 7,
  ceiling: null,
  trend: [55],
  date: '2026-01-15',
  isToday: true,
  last: null,
  ...over,
})

describe('budget cell gap per Warden feed', () => {
  const gap = (feed: Parameters<typeof budgetCell>[2]) =>
    (budgetCell(undefined, undefined, feed).state as { reason: string }).reason

  it('words each feed state once: no snapshot leads with the clause and the cadence, failed and pending never alias', () => {
    expect(gap('no-snapshot')).toBe('No snapshot yet — Warden pushes every 10\u00a0min')
    expect(gap('failed')).toBe('Warden failed to load — reload to retry')
  })

  it('keeps the pending read as a loading line, not an empty state', () => {
    const cell = budgetCell(undefined, undefined, 'loading')
    expect(cell.state).toBeUndefined()
    expect((cell.visual as ReactElement<{ children: string }>).props.children).toBe('Loading')
  })

  it('keeps a known count when the cap is missing: value stays, the footer names the gap', () => {
    const cell = budgetCell(
      { usedToday: 3 } as never,
      { name: 'loop', ageMin: 4, stale: false },
      'ready',
    )
    if (cell.value === null) throw new Error('expected the count to survive')
    expect(cell.value).toBe('3')
    expect(cell.state).toBeUndefined()
    expect(cell.visual).toBeUndefined()
    expect(textOf(cell.footer)).toContain(BUDGET_MISSING.short)
  })

  it('keeps the budget-missing wording for a snapshot that omits the budget', () => {
    expect(gap('ready')).toBe(BUDGET_MISSING.short)
  })
})

describe('agents cell without a fleet', () => {
  const emptyText = (feed: 'none' | 'failed' | null) =>
    (agentsCell(undefined, null, feed).state as { reason: string }).reason

  it('names the cause and the next step, one wording per feed state', () => {
    expect(emptyText('none')).toBe('No snapshot yet — agent-gateway pushes every 10\u00a0min')
    expect(emptyText('failed')).toBe('Agents failed to load — reload to retry')
    expect(emptyText(null)).toBe('No fleet counts in this snapshot')
  })
})

describe('Garmin cadence on Home: once per screen', () => {
  const unscored = reading({ score: null, mean: null, days: 0, trend: [], isToday: false })
  const emptyLoad = { acwr: null, zone: null, date: null }
  const forms = (
    recovery: ReturnType<typeof recoveryCellGap>,
    load = acwrCellGap(emptyLoad, 'error', 30, false),
  ) => allocateForms([recovery, load])

  it('a recovery gap leads, so the ACWR cell takes the short form', () => {
    const gap = recoveryCellGap(unscored, false, { settled: true, failed: false, windowDays: 30 })
    expect(forms(gap)).toEqual(['full', 'short'])
  })
  it('a scored recovery leaves the cadence to the ACWR cell', () => {
    expect(forms(recoveryCellGap(reading(), false, SETTLED))).toEqual(['short', 'full'])
  })
  it('a failed or loading recovery line is not a data gap: the ACWR cell still carries it', () => {
    expect(forms(recoveryCellGap(unscored, false, { settled: true, failed: true }))).toEqual([
      'short',
      'full',
    ])
    expect(forms(recoveryCellGap(null, true, SETTLED))).toEqual(['short', 'full'])
  })
  it('the unsettled recovery footer is the cadence itself, so the ACWR cell repeats nothing', () => {
    const gap = recoveryCellGap(unscored, false, { settled: false, failed: false })
    expect(forms(gap)).toEqual(['full', 'short'])
  })
  it('a failed load never takes the slot either', () => {
    expect(
      forms(recoveryCellGap(reading(), false, SETTLED), acwrCellGap(null, 'error', 30, false)),
    ).toEqual(['short', 'short'])
  })
})

describe('recovery cell forms', () => {
  const unscored = reading({ score: null, mean: null, days: 0, trend: [], isToday: false })
  const series = { settled: true, failed: false, windowDays: 30 }
  it('prints the full sentence when it leads and its leading clause when it does not', () => {
    expect(said(recoveryCell(unscored, false, series, 'full'))).toBe(
      'No recovery score in this 30\u00a0d window — Garmin syncs every 6\u00a0h',
    )
    expect(said(recoveryCell(unscored, false, series, 'short'))).toBe(
      'No recovery score in this 30\u00a0d window',
    )
  })
  it('ACWR leads with the full sentence and trails with the short form', () => {
    const empty = { acwr: null, zone: null, date: null }
    expect(said(acwrCell(empty, NOW, 'error', 30, false, 'full'))).toBe(
      'No training load in this 30\u00a0d window — Garmin syncs every 6\u00a0h',
    )
    expect(said(acwrCell(empty, NOW, 'error', 30, false, 'short'))).toBe(
      'No training load in this 30\u00a0d window',
    )
  })
})

describe('recovery cell window wording', () => {
  it('states the window length with the shared Garmin wording', () => {
    const unscored = reading({ score: null, mean: null, days: 0, trend: [], isToday: false })
    expect(
      said(recoveryCell(unscored, false, { settled: true, failed: false, windowDays: 30 }, 'full')),
    ).toBe('No recovery score in this 30\u00a0d window — Garmin syncs every 6\u00a0h')
  })
})

describe('recovery footer breaks', () => {
  it('glues the footer dot to the following fact', () => {
    const footer = recoveryFooter(reading({ mean: 60, days: 5, isToday: true }))
    // Every regular space sits between phrases or words; no digit is stranded from its unit.
    expect(footer.split(' ')).toEqual(['7\u00a0d', 'mean\u00a060', '·\u00a05/7\u00a0d', 'observed'])
  })
})

describe('strip cells with no reading', () => {
  it('shows an em dash and a reason, never 0', () => {
    expect(agentsCell(undefined, null)).toMatchObject({ value: null })
    expect(budgetCell(undefined, undefined, 'ready')).toMatchObject({ value: null })
    expect(meetingCell(null, null, null, NOW)).toMatchObject({
      value: null,
      state: { kind: 'empty', reason: 'calendar unavailable' },
    })
    expect(
      meetingCell({ meetings: [], loaded: ['work', 'personal'], unavailable: [] }, null, null, NOW),
    ).toMatchObject({
      value: null,
      state: { kind: 'empty', reason: 'None in 7 days' },
    })
    expect(recoveryCell(null, false, SETTLED, 'full')).toMatchObject({
      value: null,
      state: { kind: 'empty', reason: 'Garmin data not loaded; reload to retry' },
    })
    expect(
      recoveryCell(
        reading({ score: null, mean: null, days: 0, trend: [], date: null, isToday: false }),
        false,
        SETTLED,
        'full',
      ),
    ).toMatchObject({
      value: null,
      state: {
        kind: 'empty',
        reason: 'No recovery score in this window — Garmin syncs every 6\u00a0h',
      },
    })
    // The pre-sync gap names the last score and its day, in Garmin Health's wording.
    expect(
      said(
        recoveryCell(
          reading({
            score: null,
            mean: null,
            days: 0,
            trend: [],
            date: '2026-01-15',
            isToday: false,
            last: { value: 62, date: '2026-01-13' },
          }),
          false,
          SETTLED,
          'full',
        ),
      ),
    ).toBe('No\u00a0score\u00a0for\u00a0today\u00a0yet — Garmin syncs every 6\u00a0h')
    // The gap waits for the series: unsettled names only the cadence, a failed read says so.
    const unscored = reading({ score: null, mean: null, days: 0, trend: [], isToday: false })
    expect(said(recoveryCell(unscored, false, { settled: false, failed: false }, 'full'))).toBe(
      'Garmin syncs every 6\u00a0h',
    )
    expect(said(recoveryCell(unscored, false, { settled: true, failed: true }, 'full'))).toBe(
      'The recovery score failed to load',
    )
    expect(recoveryCell(null, true, SETTLED, 'full')).toMatchObject({
      footer: 'Loading Garmin data',
    })
    expect(acwrCell(null, NOW, 'loading', 30, false, 'short')).toMatchObject({
      footer: 'loading training load',
    })
    expect(acwrCell(null, NOW, 'error', 30, false, 'short')).toMatchObject({
      value: null,
      state: { kind: 'empty', reason: 'training load failed to load; reload to retry' },
    })
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
      false,
      SETTLED,
      'full',
    )
    expect(cell.caption).toBe('Recovery · Wed 14 Jan')
    expect((cell.footer as ReactElement<{ children: string }>).props.children).toBe(
      '7\u00a0d mean\u00a065 ·\u00a0today fills after the next Garmin sync (every 6\u00a0h)',
    )
  })

  it('words a settled, empty training load in Garmin’s wording', () => {
    // The recovery cell leads with the cadence sentence; this cell takes its leading clause.
    expect(
      said(acwrCell({ acwr: null, zone: null, date: null }, NOW, 'error', 30, false, 'short')),
    ).toBe('No training load in this 30\u00a0d window')
    // Only when no earlier cell carries the cadence does this one print it.
    expect(
      said(acwrCell({ acwr: null, zone: null, date: null }, NOW, 'error', 30, false, 'full')),
    ).toBe('No training load in this 30\u00a0d window — Garmin syncs every 6\u00a0h')
    // The previous window's rows while this one loads: no gap to state yet.
    expect(
      said(acwrCell({ acwr: null, zone: null, date: null }, NOW, 'error', 30, true, 'short')),
    ).toBe('loading training load')
  })

  it('drops the poller line when there is no budget and no poller to date', () => {
    expect(budgetFooterEntries(undefined, undefined, 'ready')).toEqual([])
    expect(
      budgetFooterEntries(undefined, { name: 'loop', ageMin: 4, stale: false }, 'ready'),
    ).toHaveLength(1)
  })

  it('names the reading day in the ACWR footer only when it is not today', () => {
    const reading = { acwr: 1.1, zone: 'optimal' as const }
    expect(
      acwrCell(
        { acwr: 0.5, zone: 'undertrained' as const, date: '2026-01-15' },
        NOW,
        'error',
        30,
        false,
        'short',
      ).unit,
    ).toBe('Low')
    expect(
      said(acwrCell({ ...reading, date: '2026-01-15' }, NOW, 'error', 30, false, 'short')),
    ).toBe('range 0.8–1.3')
    expect(
      said(acwrCell({ ...reading, date: '2026-01-14' }, NOW, 'error', 30, false, 'short')),
    ).toBe('range 0.8–1.3 · Wed 14 Jan')
  })

  it('says which calendar is missing when the empty day is partial', () => {
    expect(
      meetingCell({ meetings: [], loaded: ['work'], unavailable: ['personal'] }, null, null, NOW),
    ).toMatchObject({ state: { reason: 'None today · Personal unavailable' } })
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
    expect(cell.footer).toStartWith('{meeting}\u00a0·\u00a0in ')
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
    expect(cell('{meeting}').footer).toBe('{meeting}\u00a0·\u00a01\u00a0remaining')
    expect(cell('Sprint planning — team {name} and the whole extended crew').footer).toBe(
      'Sprint planning\u00a0·\u00a01\u00a0remaining',
    )
    expect(cell('A very long meeting name without any clause break at all').footer).toBe(
      'A very long meeting…\u00a0·\u00a01\u00a0remaining',
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
      const cell = recoveryCell(reading({ score, trend: [score] }), false, SETTLED, 'full')
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
      `7${NB}d mean${NB}60 ·${NB}7/7${NB}d observed`,
    )
    expect(recoveryFooter(reading({ isToday: false }))).toBe(
      `7${NB}d mean${NB}60 ·${NB}today fills after the next Garmin sync (every 6${NB}h)`,
    )
  })

  it('drops only the mean when there is none', () => {
    expect(recoveryFooter(reading({ mean: null, days: 0, isToday: true }))).toBe(
      `0/7${NB}d observed`,
    )
    expect(recoveryFooter(reading({ mean: null, isToday: false }))).toBe(
      `today fills after the next Garmin sync (every 6${NB}h)`,
    )
  })

  it('singular day', () => {
    expect(recoveryFooter(reading({ days: 1 }))).toBe(
      `7${NB}d mean${NB}60 ·${NB}1/7${NB}d observed`,
    )
  })
})

describe('recovery cell in the pre-sync gap', () => {
  const preSync = reading({
    score: null,
    mean: 60,
    days: 5,
    trend: [58, 62, 60],
    date: '2026-01-15',
    isToday: false,
    last: { value: 62, date: '2026-01-13' },
  })

  it('keeps the previous score, its trend and the mean; the footer says today is unscored plus the cadence', () => {
    const cell = recoveryCell(preSync, false, SETTLED, 'full')
    expect(cell.state).toBeUndefined()
    expect(cell.caption).toBe('Recovery · Tue 13 Jan')
    expect(cell.value).toBe('62')
    expect(cell.visual).toBeDefined()
    expect(said(cell)).toBe(
      '7\u00a0d mean\u00a060 ·\u00a0No\u00a0score\u00a0for\u00a0today\u00a0yet — Garmin syncs every 6\u00a0h',
    )
    expect(said(recoveryCell(preSync, false, SETTLED, 'short'))).toBe(
      '7\u00a0d mean\u00a060 ·\u00a0No\u00a0score\u00a0for\u00a0today\u00a0yet — Garmin syncs every 6\u00a0h',
    )
  })

  it('takes the empty state with the gap line when only a trend and mean exist', () => {
    const cell = recoveryCell({ ...preSync, last: null }, false, SETTLED, 'short')
    expect(cell.value).toBeNull()
    expect(cell.visual).toBeUndefined()
    expect(cell.state).toEqual({ kind: 'empty', reason: 'No recovery score in this window' })
  })

  it('takes the empty state with nothing at all', () => {
    const none = reading({ score: null, mean: null, days: 0, trend: [], last: null })
    expect(recoveryCell(none, false, SETTLED, 'full').state).toMatchObject({ kind: 'empty' })
  })
})

describe('recoveryCaption', () => {
  const base = { score: 70, isToday: true, date: '2026-01-15', last: null }
  it('says today only for today’s own score', () => {
    expect(recoveryCaption(base)).toBe('Recovery · today')
    expect(recoveryCaption({ ...base, isToday: false, date: '2026-01-14' })).toBe(
      'Recovery · Wed 14 Jan',
    )
  })
  it('reads the last scored day form for an undated score', () => {
    expect(recoveryCaption({ ...base, isToday: false, date: null })).toBe(
      'Recovery · last scored day',
    )
  })
  it('names the previous score’s own day, else stays plain', () => {
    const noScore = { ...base, score: null, isToday: false }
    expect(recoveryCaption({ ...noScore, last: { value: 62, date: '2026-01-13' } })).toBe(
      'Recovery · Tue 13 Jan',
    )
    expect(recoveryCaption(noScore)).toBe('Recovery')
  })
})

describe('budget footer entries', () => {
  const poller = { name: 'loop', ageMin: 4, stale: false }

  it('keeps the poller fact under the budget cell while it shows its reason', () => {
    expect(budgetFooterEntries(undefined, poller, 'ready')).toMatchObject([
      { under: 'budget', shotAbsent: ['empty'] },
    ])
    expect(budgetCell(undefined, poller, 'ready').state).toMatchObject({ kind: 'empty' })
  })

  it('adds nothing when the cell draws its own footer or has no snapshot', () => {
    expect(budgetFooterEntries(undefined, poller, 'loading')).toEqual([])
    expect(budgetFooterEntries(undefined, undefined, 'no-snapshot')).toEqual([])
    expect(budgetFooterEntries(undefined, poller, 'no-snapshot')).toEqual([])
  })
})
