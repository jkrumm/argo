import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test'

// A zone with DST, so the day-boundary tests exercise a 23 h day whatever the machine's own zone.
process.env.TZ = 'Europe/Berlin'
import { lastScored } from '../garmin-health/model'
import {
  acwrReading,
  countdownLabel,
  laterMeeting,
  meetingState,
  weekdayTime,
  noMeetingsLabel,
  activityStream,
  nextMeeting,
  homeSummaryParts,
  recoveryReading,
  recoveryWindow,
  taskCounts,
  tasksLine,
  todayAgenda,
  type ActivityEvent,
  type Meeting,
  type RawCalendarEvent,
  calendarEvents,
} from './model'
import { meetingCell } from './strip-cells'

const NOW = new Date(2026, 0, 15, 12, 0).getTime()
const at = (h: number, m = 0) => new Date(2026, 0, 15, h, m).toISOString()
const MIN = 60_000

const todayAgendaOf = (lists: readonly (readonly RawCalendarEvent[])[], now: number) =>
  todayAgenda(
    lists.map((events) => ({ sourceClass: 'work' as const, events })),
    now,
  )

const event = (over: Partial<RawCalendarEvent> = {}): RawCalendarEvent => ({
  id: 'e1',
  title: '{meeting}',
  start: at(14),
  end: at(15),
  ...over,
})

describe('todayAgenda cancelled meetings', () => {
  it('leaves Outlook-cancelled meetings out of the agenda, the next meeting and the remaining count', () => {
    const NOW_T = Date.parse(at(9))
    const agenda = todayAgendaOf(
      [
        [
          event({ id: 'live', title: '{live}', start: at(14), end: at(15) }),
          event({ id: 'c1', title: 'Canceled: {meeting}', start: at(10), end: at(11) }),
          event({ id: 'c2', title: 'Abgesagt: {meeting}', start: at(11), end: at(12) }),
        ],
      ],
      NOW_T,
    )
    expect(agenda.meetings.map((m) => m.key)).toEqual(['live'])
    const next = nextMeeting(agenda.meetings, NOW_T)
    expect(next?.key).toBe('live')
    expect(meetingCell(agenda, next, null, NOW_T).footer).toBe(
      '{live}\u00a0·\u00a01\u00a0remaining',
    )
  })

  it('trusts the API flag over the title: isCancelled without a prefix is excluded, false with one stays', () => {
    const NOW_T = Date.parse(at(9))
    const agenda = todayAgendaOf(
      [
        [
          event({ id: 'flag', title: '{a}', start: at(10), end: at(11), isCancelled: true }),
          event({
            id: 'kept',
            title: 'Canceled: {b}',
            start: at(12),
            end: at(13),
            isCancelled: false,
          }),
        ],
      ],
      NOW_T,
    )
    expect(agenda.meetings.map((m) => m.key)).toEqual(['kept'])
  })

  it('drops a cancelled all-day event too', () => {
    const agenda = todayAgendaOf(
      [[event({ id: 'ad', title: 'Canceled: {x}', isAllDay: true, start: at(0), end: at(23) })]],
      Date.parse(at(9)),
    )
    expect(agenda.allDay).toEqual([])
  })

  it('skips a cancelled meeting as the next one after today', () => {
    const feeds = [
      {
        sourceClass: 'work' as const,
        events: [
          event({
            id: 'c',
            title: 'Cancelled: {meeting}',
            start: new Date(2026, 0, 16, 10).toISOString(),
            end: new Date(2026, 0, 16, 11).toISOString(),
          }),
        ],
      },
    ]
    expect(laterMeeting(feeds, Date.parse(at(9)))).toBeNull()
  })
})

describe('todayAgenda', () => {
  it('keeps timed events starting today, sorted, with attendee count and duration', () => {
    const { meetings } = todayAgendaOf(
      [
        [
          event({ id: 'b', start: at(16), end: at(16, 30), attendees: [1, 2, 3] }),
          event({ id: 'a', start: at(9), end: at(10) }),
          event({ id: 'tomorrow', start: new Date(2026, 0, 16, 9).toISOString() }),
        ],
      ],
      NOW,
    )
    expect(meetings.map((m) => m.key)).toEqual(['a', 'b'])
    expect(meetings[1]?.attendees).toBe(3)
    expect(meetings[1]?.durationMin).toBe(30)
  })

  it('collects all-day events covering today, including a multi-day one', () => {
    const { allDay, meetings } = todayAgendaOf(
      [
        [
          event({
            id: 'x',
            title: '{one}',
            isAllDay: true,
            start: '2026-01-15',
            end: '2026-01-16',
          }),
          event({
            id: 'y',
            title: '{span}',
            isAllDay: true,
            start: '2026-01-13',
            end: '2026-01-17',
          }),
          event({
            id: 'z',
            title: '{later}',
            isAllDay: true,
            start: '2026-01-16',
            end: '2026-01-17',
          }),
        ],
      ],
      NOW,
    )
    expect(allDay).toEqual(['{one}', '{span}'])
    expect(meetings).toEqual([])
  })

  it('finds the next meeting strictly after now', () => {
    const { meetings } = todayAgendaOf(
      [[event({ id: 'a', start: at(11), end: at(13) }), event({ id: 'b' })]],
      NOW,
    )
    expect(nextMeeting(meetings, NOW)?.key).toBe('b')
    expect(nextMeeting(meetings, NOW + 5 * 60 * 60_000)).toBeNull()
  })
})

describe('countdownLabel', () => {
  it('uses the app duration spelling, always with a unit', () => {
    expect(countdownLabel(25 * MIN)).toBe('in 25\u00a0min')
    expect(countdownLabel(90 * MIN)).toBe('in 1\u00a0h\u00a030\u00a0min')
    expect(countdownLabel(120 * MIN)).toBe('in 2\u00a0h')
  })
})

describe('tasksLine', () => {
  it('words unknown tasks as loading or failed, never as zeros', () => {
    expect(tasksLine(null, 'loading').lead).toBe('Tasks: loading')
    expect(tasksLine(null, 'error').lead).toBe('Tasks: failed to load — reload to retry')
  })

  it('says no tasks in words and flags overdue only above zero', () => {
    expect(tasksLine({ overdue: 0, dueSoon: 0, open: 0 }, 'ready')).toEqual({
      lead: 'Tasks: none open',
      overdue: false,
    })
    expect(tasksLine({ overdue: 0, dueSoon: 2, open: 3 }, 'ready')).toMatchObject({
      lead: 'Tasks: 0 overdue',
      overdue: false,
    })
    expect(tasksLine({ overdue: 1, dueSoon: 0, open: 1 }, 'ready').overdue).toBe(true)
  })
})

describe('taskCounts', () => {
  it('counts open overdue and due-soon tasks by local day', () => {
    const counts = taskCounts(
      [
        { status: 0, dueDate: '2026-01-10T00:00:00+0000' },
        { status: 0, dueDate: '2026-01-15T00:00:00+0000' },
        { status: 0, dueDate: '2026-01-22T00:00:00+0000' },
        { status: 0, dueDate: '2026-01-23T00:00:00+0000' },
        { status: 2, dueDate: '2026-01-10T00:00:00+0000' },
        { status: 0, dueDate: null },
      ],
      NOW,
    )
    expect(counts).toEqual({ overdue: 1, dueSoon: 2, open: 5 })
  })
})

describe('recoveryWindow', () => {
  // The visibility filter reads the clock itself: noon is before the hide-today cutoff, 23:00 after.
  const REAL_NOW = Date.now()
  const EARLY = new Date(2026, 5, 15, 12, 0)
  const LATE = new Date(2026, 5, 15, 23, 0)
  const y = { date: '2026-06-14', recovery: 60 }
  const scored = { date: '2026-06-15', recovery: 70 }
  const unscored = { date: '2026-06-15', recovery: null }
  const early = EARLY.getTime()

  beforeEach(() => setSystemTime(EARLY))
  afterEach(() => setSystemTime(new Date(REAL_NOW)))

  it('appends a scored today the filter hid, last', () => {
    expect(recoveryWindow([y, scored], early)).toEqual([y, scored])
  })
  it('drops an unscored today', () => {
    expect(recoveryWindow([y, unscored], early)).toEqual([y])
    setSystemTime(LATE)
    expect(recoveryWindow([y, unscored], LATE.getTime())).toEqual([y])
  })
  it('keeps a visible scored today once', () => {
    setSystemTime(LATE)
    expect(recoveryWindow([y, scored], LATE.getTime())).toEqual([y, scored])
  })
  it('keeps a recovery of 0', () => {
    const zero = { date: '2026-06-15', recovery: 0 }
    expect(recoveryWindow([y, zero], early)).toEqual([y, zero])
  })
  it('returns [today] when only today is scored and hidden', () => {
    expect(recoveryWindow([scored], early)).toEqual([scored])
  })
  it('ends trend, mean and last scored day on the headline day', () => {
    const win = recoveryWindow([y, scored], early)
    const r = recoveryReading(
      { recovery: 70, ceiling: null, date: '2026-06-15' },
      win,
      early,
      lastScored(win),
    )
    expect(r.trend).toEqual([60, 70])
    expect(r.mean).toBe(65)
    expect(r.isToday).toBe(true)
    expect(r.last).toEqual({ value: 70, date: '2026-06-15' })
  })
})

describe('readings', () => {
  it('never turns an unmeasured recovery into 0', () => {
    const r = recoveryReading({ recovery: null, ceiling: null }, [{ recovery: null }], NOW)
    expect(r.score).toBeNull()
    expect(r.mean).toBeNull()
    expect(r.days).toBe(0)
  })

  it('averages only measured days', () => {
    const r = recoveryReading(
      { recovery: 60, ceiling: 500 },
      [{ recovery: 50 }, { recovery: null }, { recovery: 70 }],
      NOW,
    )
    expect(r.mean).toBe(60)
    expect(r.days).toBe(2)
  })

  it('takes the latest measured ACWR, not the last row', () => {
    const a = acwrReading([
      { date: '2026-01-13', acwr: 1.1, zone: 'optimal' },
      { date: '2026-01-14', acwr: null, zone: null },
    ])
    expect(a.acwr).toBe(1.1)
    expect(a.date).toBe('2026-01-13')
  })
})

const ev = (key: string, ms: number): ActivityEvent => ({
  key,
  ms,
  actor: 'calendar',
  title: '{t}',
})

describe('activityStream', () => {
  it('sorts newest first and drops what is outside the horizon or in the future', () => {
    const day = 24 * 60 * MIN
    const stream = activityStream(
      [
        ev('old', NOW - 3 * day),
        ev('y', NOW - day),
        ev('t2', NOW - 10 * MIN),
        ev('t1', NOW - 60 * MIN),
        ev('future', NOW + MIN),
      ],
      NOW,
    )
    expect(stream.events.map((e) => e.key)).toEqual(['t2', 't1', 'y'])
    expect(stream.total).toBe(3)
  })
})

describe('calendar activity rows', () => {
  it('a started meeting is one line, no outcome and no chip', () => {
    const [row] = calendarEvents(
      [{ key: 'm', title: '{meeting}', startMs: NOW - MIN }] as unknown as Parameters<
        typeof calendarEvents
      >[0],
      NOW,
    )
    expect(row?.title).toBe('started {meeting}')
    expect(row?.outcome).toBeUndefined()
    expect(row?.chip).toBeUndefined()
  })
})

describe('recovery date', () => {
  it('is today only when the scored day is the local today', () => {
    expect(
      recoveryReading({ recovery: 70, ceiling: null, date: '2026-01-15' }, [], NOW).isToday,
    ).toBe(true)
    const stale = recoveryReading({ recovery: 70, ceiling: null, date: '2026-01-14' }, [], NOW)
    expect(stale.isToday).toBe(false)
    expect(stale.date).toBe('2026-01-14')
    expect(recoveryReading({ recovery: 70, ceiling: null }, [], NOW).isToday).toBe(false)
  })
})

describe('day boundaries on a DST day', () => {
  // Berlin springs forward on 2026-03-29: that local day is 23 h long.
  const dst = new Date(2026, 2, 29, 12, 0).getTime()

  it('keeps a meeting just before the next local midnight and drops the one after', () => {
    const { meetings } = todayAgendaOf(
      [
        [
          event({
            id: 'late',
            start: new Date(2026, 2, 29, 23, 30).toISOString(),
            end: new Date(2026, 2, 30, 0, 30).toISOString(),
          }),
          event({
            id: 'next',
            start: new Date(2026, 2, 30, 0, 10).toISOString(),
            end: new Date(2026, 2, 30, 1, 0).toISOString(),
          }),
        ],
      ],
      dst,
    )
    expect(meetings.map((m) => m.key)).toEqual(['late'])
  })

  it('reads the activity horizon as the start of yesterday, not 24 h before today', () => {
    const stream = activityStream(
      [
        ev('yesterday-start', new Date(2026, 2, 28, 0, 5).getTime()),
        ev('before', new Date(2026, 2, 27, 23, 55).getTime()),
      ],
      dst,
    )
    expect(stream.events.map((e) => e.key)).toEqual(['yesterday-start'])
  })

  it('counts a task due in 7 calendar days as due soon across the change', () => {
    const counts = taskCounts(
      [
        { status: 0, dueDate: '2026-04-05T00:00:00+0000' },
        { status: 0, dueDate: '2026-04-06T00:00:00+0000' },
      ],
      dst,
    )
    expect(counts).toEqual({ overdue: 0, dueSoon: 1, open: 2 })
  })
})

describe('ended meetings', () => {
  const morning = todayAgendaOf(
    [
      [
        event({ id: 'done', start: at(9), end: at(10) }),
        event({ id: 'live', start: at(11, 30), end: at(12, 30) }),
        event({ id: 'later', start: at(15), end: at(16) }),
      ],
    ],
    NOW,
  ).meetings

  it('keeps this morning’s meeting, marks it past, and counts the whole day', () => {
    expect(morning.map((m) => m.key)).toEqual(['done', 'live', 'later'])
    expect(morning.map((m) => meetingState(m, NOW))).toEqual(['past', 'now', 'upcoming'])
    expect(nextMeeting(morning, NOW)?.key).toBe('later')
  })

  it('says no more meetings only after the last one ended, and names the one in progress before that', () => {
    const agenda = { meetings: morning, loaded: ['work' as const], unavailable: [] }
    const ended = { ...agenda, meetings: [morning[0]!] }
    expect(meetingCell(ended, null, null, NOW).footer).toBe('no more meetings today')
    const live = { ...agenda, meetings: [morning[1]!] }
    expect(meetingCell(live, null, null, NOW).footer).toBe('in a meeting until 12:30')
    expect(morning[0]!.endMs).toBeLessThan(NOW)
  })
})

describe('a partial agenda', () => {
  it('names the calendar that answered and the one that did not instead of saying free', () => {
    const agenda = todayAgenda([{ sourceClass: 'work', events: [] }], NOW, ['personal'])
    expect(noMeetingsLabel(agenda)).toBe('No Work meetings today · Personal unavailable')
  })

  it('is plainly free only when every calendar answered', () => {
    const agenda = todayAgenda(
      [
        { sourceClass: 'work', events: [] },
        { sourceClass: 'personal', events: [] },
      ],
      NOW,
    )
    expect(noMeetingsLabel(agenda)).toBe('No meetings today')
  })
})

describe('laterMeeting', () => {
  const feeds = [
    {
      sourceClass: 'work' as const,
      events: [
        event({ id: 'today', start: at(15), end: at(16) }),
        event({ id: 'all', isAllDay: true, start: '2026-01-16', end: '2026-01-17' }),
        event({
          id: 'mon',
          title: '{later}',
          start: new Date(2026, 0, 19, 9, 30).toISOString(),
          end: new Date(2026, 0, 19, 10).toISOString(),
        }),
        event({
          id: 'tue',
          start: new Date(2026, 0, 20, 8).toISOString(),
          end: new Date(2026, 0, 20, 9).toISOString(),
        }),
      ],
    },
  ]

  it('is the first timed meeting after today, ignoring today and all-day events', () => {
    const later = laterMeeting(feeds, NOW)
    expect(later?.title).toBe('{later}')
    expect(weekdayTime(later!.startMs)).toBe('Mon 09:30')
  })

  it('is null when nothing follows today', () => {
    expect(laterMeeting([{ sourceClass: 'work', events: [] }], NOW)).toBeNull()
  })
})

describe('homeSummaryParts', () => {
  const meeting = (startMs: number) => ({ startMs }) as unknown as Meeting
  const agendaOf = (meetings: Meeting[], unavailable: ('work' | 'personal')[] = []) => ({
    meetings,
    unavailable,
  })

  it('says the calendar is unavailable when none answered', () => {
    expect(homeSummaryParts(null, NOW)).toEqual({ sentence: 'Calendar unavailable.', facts: [] })
  })
  it('reads an empty day', () => {
    expect(homeSummaryParts(agendaOf([]), NOW).sentence).toBe('No meetings today.')
  })
  it('counts the meetings still ahead of the whole day', () => {
    const day = agendaOf([
      meeting(NOW - 60 * MIN),
      meeting(NOW + 60 * MIN),
      meeting(NOW + 90 * MIN),
    ])
    expect(homeSummaryParts(day, NOW).sentence).toBe('2 of 3 meetings still ahead today.')
  })
  it('says none are left once the last one started', () => {
    expect(homeSummaryParts(agendaOf([meeting(NOW - MIN)]), NOW).sentence).toBe(
      '1 meeting today, none left.',
    )
  })
  it('names the calendar that could not be read as the one fact', () => {
    expect(homeSummaryParts(agendaOf([], ['personal']), NOW).facts).toEqual([
      'Personal unavailable',
    ])
  })
})
