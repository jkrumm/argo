import { describe, expect, it } from 'bun:test'

// A zone with DST, so the day-boundary tests exercise a 23 h day whatever the machine's own zone.
process.env.TZ = 'Europe/Berlin'
import {
  acwrReading,
  activityStream,
  wardenEvents,
  nextMeeting,
  recoveryReading,
  staleFeeds,
  summarySentence,
  taskCounts,
  todayAgenda,
  untilLabel,
  type ActivityEvent,
  type RawCalendarEvent,
} from './model'
import type { Decision } from '../../lib/decisions'

const NOW = new Date(2026, 0, 15, 12, 0).getTime()
const at = (h: number, m = 0) => new Date(2026, 0, 15, h, m).toISOString()
const MIN = 60_000

const event = (over: Partial<RawCalendarEvent> = {}): RawCalendarEvent => ({
  id: 'e1',
  title: '{meeting}',
  start: at(14),
  end: at(15),
  ...over,
})

const decision = (ageMs: number | null): Decision => ({
  source: 'warden',
  id: `d-${ageMs}`,
  headline: '{q}',
  facts: [],
  ageMs,
  href: '/warden',
  evidence: null,
  history: [],
  abandoned: false,
})

describe('todayAgenda', () => {
  it('keeps timed events starting today, sorted, with attendee count and duration', () => {
    const { meetings } = todayAgenda(
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
    const { allDay, meetings } = todayAgenda(
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
    const { meetings } = todayAgenda(
      [[event({ id: 'a', start: at(11), end: at(13) }), event({ id: 'b' })]],
      NOW,
    )
    expect(nextMeeting(meetings, NOW)?.key).toBe('b')
    expect(nextMeeting(meetings, NOW + 5 * 60 * 60_000)).toBeNull()
  })
})

describe('untilLabel', () => {
  it('always carries a unit', () => {
    expect(untilLabel(25 * MIN)).toBe('25 min')
    expect(untilLabel(80 * MIN)).toBe('1 h 20 min')
    expect(untilLabel(120 * MIN)).toBe('2 h')
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
    expect(counts).toEqual({ overdue: 1, dueSoon: 2 })
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
  actor: 'warden',
  title: '{t}',
})

describe('activityStream', () => {
  it('sorts newest first, groups by day and drops what is outside the horizon or in the future', () => {
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
    expect(stream.groups.map((g) => g.label)).toEqual(['Today', 'Yesterday'])
    expect(stream.groups[0]?.events.map((e) => e.key)).toEqual(['t2', 't1'])
    expect(stream.total).toBe(3)
  })
})

describe('summarySentence', () => {
  const base = {
    unavailable: [],
    fleet: { working: 2, total: 5 },
    meetings: null,
    recovery: null,
    now: NOW,
  }

  it('states count, oldest wait, next meeting and recovery from one list', () => {
    const next = todayAgenda([[event({ start: at(12, 25) })]], NOW).meetings[0] ?? null
    const text = summarySentence({
      ...base,
      decisions: [decision(2 * 60 * MIN), decision(30 * MIN)],
      meetings: { next, total: 1 },
      recovery: 72.4,
    })
    expect(text).toBe(
      '2 items need you, oldest 2h 0m. Next meeting in 25 min, recovery today 72/100.',
    )
  })

  it('reads the fleet when nothing needs the owner', () => {
    expect(summarySentence({ ...base, decisions: [], meetings: { next: null, total: 0 } })).toBe(
      'Nothing needs you. 2 of 5 agents working. No meetings today.',
    )
  })

  it('names an unavailable source instead of implying an empty inbox', () => {
    expect(summarySentence({ ...base, decisions: [], unavailable: ['Warden'], fleet: null })).toBe(
      'Nothing needs you (Warden unavailable).',
    )
  })

  it('uses singular for one item and omits an unknown age', () => {
    expect(summarySentence({ ...base, decisions: [decision(null)], fleet: null })).toBe(
      '1 item needs you.',
    )
  })
})

const ago = (min: number) => new Date(NOW - min * MIN).toISOString()

describe('wardenEvents', () => {
  const raw = {
    board: { items: [{ event_id: 7, repo: '{repo}', title: '{item title}' }] },
    items: {
      '7': {
        transitions: [
          { from_state: null, to_state: 'new', at: ago(60), synthetic: true },
          { from_state: 'new', to_state: 'triaged', at: ago(58) },
          { from_state: 'triaged', to_state: 'working', at: ago(57) },
          { from_state: 'working', to_state: 'needs_decision', at: ago(5) },
        ],
        dispatches: [{ tier: 'investigate', status: 'done', created_at: ago(57.5) }],
      },
    },
  } as unknown as Parameters<typeof wardenEvents>[0]

  it('collapses a burst on one item into one row with its path and dispatch', () => {
    const rows = wardenEvents(raw)
    expect(rows).toHaveLength(2)
    const burst = rows.find((r) => r.ms === NOW - 57 * MIN)
    expect(burst?.title).toBe('moved {repo} item · new → triaged → working · investigate done')
    expect(burst?.detail).toBe('{item title}')
  })

  it('starts a new row after a gap and times each row at its last step', () => {
    const later = wardenEvents(raw).find((r) => r.ms === NOW - 5 * MIN)
    expect(later?.title).toBe('moved {repo} item · working → needs decision')
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
    const { meetings } = todayAgenda(
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
    expect(stream.groups.flatMap((g) => g.events.map((e) => e.key))).toEqual(['yesterday-start'])
  })

  it('counts a task due in 7 calendar days as due soon across the change', () => {
    const counts = taskCounts(
      [
        { status: 0, dueDate: '2026-04-05T00:00:00+0000' },
        { status: 0, dueDate: '2026-04-06T00:00:00+0000' },
      ],
      dst,
    )
    expect(counts).toEqual({ overdue: 0, dueSoon: 1 })
  })
})

const agoIso = (m: number) => new Date(NOW - m * MIN).toISOString()

describe('staleFeeds and unavailable sources', () => {
  it('names only the loaded feeds past 30 minutes', () => {
    expect(
      staleFeeds(
        [
          { name: 'Warden', receivedAt: agoIso(5) },
          { name: 'Agents', receivedAt: agoIso(45) },
        ],
        NOW,
      ),
    ).toEqual(['Agents 45m old'])
    expect(staleFeeds([{ name: 'Warden', receivedAt: agoIso(29) }], NOW)).toEqual([])
  })

  const base = { decisions: [], fleet: null, meetings: null, recovery: null, now: NOW }

  it('does not say nothing needs you when neither source loaded', () => {
    expect(summarySentence({ ...base, unavailable: ['Warden', 'Agents'] })).toBe(
      "Can't tell — Warden and Agents unavailable.",
    )
  })

  it('names the one source that is down', () => {
    expect(summarySentence({ ...base, unavailable: ['Agents'] })).toBe(
      'Nothing needs you (Agents unavailable).',
    )
  })
})

describe('wardenEvents burst boundary', () => {
  const timeline = (gapMin: number) =>
    ({
      board: { items: [{ event_id: 1, repo: '{repo}' }] },
      items: {
        '1': {
          transitions: [
            { from_state: 'new', to_state: 'triaged', at: agoIso(60) },
            { from_state: 'triaged', to_state: 'working', at: agoIso(60 - gapMin) },
          ],
        },
      },
    }) as unknown as Parameters<typeof wardenEvents>[0]

  it('joins steps exactly 10 minutes apart and splits at 10 minutes 1 s', () => {
    expect(wardenEvents(timeline(10))).toHaveLength(1)
    const split = timeline(10) as { items: { '1': { transitions: { at: string }[] } } }
    split.items['1'].transitions[1]!.at = new Date(NOW - 60 * MIN + 10 * MIN + 1000).toISOString()
    expect(wardenEvents(split as unknown as Parameters<typeof wardenEvents>[0])).toHaveLength(2)
  })
})
