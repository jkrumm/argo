import { describe, expect, it } from 'bun:test'

// A zone with DST, so the day-boundary tests exercise a 23 h day whatever the machine's own zone.
process.env.TZ = 'Europe/Berlin'
import {
  acwrReading,
  countdownLabel,
  laterMeeting,
  meetingState,
  weekdayTime,
  noMeetingsLabel,
  activityStream,
  wardenEvents,
  nextMeeting,
  recoveryReading,
  restLabel,
  staleFeeds,
  homeSummaryParts,
  taskCounts,
  tasksLine,
  todayAgenda,
  type ActivityEvent,
  type RawCalendarEvent,
  narrativeEvents,
} from './model'
import type { Decision } from '../../lib/decisions'
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

const decision = (ageMs: number | null): Decision => ({
  source: 'warden',
  id: `d-${ageMs}`,
  headline: '{q}',
  entity: null,
  facts: [],
  evidenceLine: null,
  detail: null,
  ageMs,
  href: '/warden',
  evidence: null,
  history: [],
  abandoned: false,
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

describe('homeSummaryParts', () => {
  const base = { unavailable: [], loading: [] }
  const agentDecision = (): Decision => ({
    ...decision(60 * MIN),
    source: 'agent',
    href: '/agents',
  })

  it('names the oldest wait in the sentence, the count only in the heading, and the split across sources as the one fact', () => {
    expect(
      homeSummaryParts({
        ...base,
        decisions: [
          decision(2 * 60 * MIN),
          decision(30 * MIN),
          agentDecision(),
          { ...agentDecision(), source: 'queue' },
        ],
      }),
    ).toEqual({
      sentence: 'Oldest wait on you 2\u00a0h.',
      facts: ['2 in Warden', '1 with agents', '1 in the human queue'],
    })
  })

  it('never repeats the fleet, the next meeting or recovery from the strip', () => {
    const { facts } = homeSummaryParts({ ...base, decisions: [decision(MIN)] })
    expect(facts.join(' ')).not.toMatch(/agents working|meeting|recovery/i)
  })

  it('reads an empty inbox without a fact', () => {
    expect(homeSummaryParts({ ...base, decisions: [] })).toEqual({
      sentence: 'Nothing needs you.',
      facts: [],
    })
  })

  it('names an unavailable source instead of implying an empty inbox', () => {
    expect(homeSummaryParts({ unavailable: ['Warden'], loading: [], decisions: [] }).sentence).toBe(
      'Nothing needs you (Warden failed to load).',
    )
  })

  it('states nothing else when neither source loaded', () => {
    expect(
      homeSummaryParts({ unavailable: ['Warden', 'Agents'], loading: [], decisions: [] }),
    ).toEqual({
      sentence: "Can't tell — Warden and Agents failed to load.",
      facts: [],
    })
  })

  it('says loading, never an empty inbox, while a source is pending', () => {
    expect(homeSummaryParts({ unavailable: [], loading: ['Warden'], decisions: [] }).sentence).toBe(
      'Nothing needs you (Warden loading).',
    )
    expect(
      homeSummaryParts({ unavailable: [], loading: ['Warden', 'Agents'], decisions: [] }),
    ).toEqual({ sentence: 'Loading Warden and Agents.', facts: [] })
    expect(
      homeSummaryParts({ unavailable: ['Agents'], loading: ['Warden'], decisions: [] }).sentence,
    ).toBe("Can't tell — Agents failed to load, Warden loading.")
  })

  it('omits an unknown age rather than printing a figure it lacks', () => {
    expect(homeSummaryParts({ ...base, decisions: [decision(null)] }).sentence).toBe(
      'An item is waiting on you.',
    )
  })

  it('leaves the split out when one source holds every item', () => {
    expect(homeSummaryParts({ ...base, decisions: [decision(MIN), decision(MIN)] }).facts).toEqual(
      [],
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
    expect(burst?.title).toBe('moved {repo} item')
    expect(burst?.outcome).toBe('new\u00a0→\u00a0working\u00a0· investigate\u00a0done')
    expect(burst?.detail).toBe('{item title}')
  })

  it("drops a monitor's [prefix] from the item title, as the Warden cards do", () => {
    const monitored = {
      board: { items: [{ event_id: 7, repo: '{repo}', title: '[{monitor}] Down {reason}' }] },
      items: { '7': { transitions: [{ from_state: 'new', to_state: 'triaged', at: ago(5) }] } },
    } as unknown as Parameters<typeof wardenEvents>[0]
    expect(wardenEvents(monitored)[0]?.detail).toBe('{monitor} Down {reason}')
  })

  it("drops a commit-style label from the item title (the cards' subject rule)", () => {
    const commit = {
      board: { items: [{ event_id: 7, repo: '{repo}', title: 'fix({scope}): {change}' }] },
      items: { '7': { transitions: [{ from_state: 'new', to_state: 'triaged', at: ago(5) }] } },
    } as unknown as Parameters<typeof wardenEvents>[0]
    expect(wardenEvents(commit)[0]?.detail).toBe('{change}')
  })

  it('words the show-more buttons as the remainder, per page', () => {
    expect(restLabel('/warden', 3)).toBe('3 more in Warden')
    expect(restLabel('/agents', 1)).toBe('1 more on Agents')
  })

  it('starts a new row after a gap and times each row at its last step', () => {
    const later = wardenEvents(raw).find((r) => r.ms === NOW - 5 * MIN)
    expect(later?.title).toBe('moved {repo} item')
    expect(later?.outcome).toBe('working\u00a0→\u00a0needs\u00a0decision')
  })
})

describe('names in the feed', () => {
  it('keeps a long repo whole: the row wraps at its spaces, a name is never cut', () => {
    const repo = 'a-very-long-repository-name-indeed'
    const long = {
      board: { items: [{ event_id: 9, repo, title: '{t}' }] },
      items: { '9': { transitions: [{ from_state: 'new', to_state: 'triaged', at: ago(5) }] } },
    } as unknown as Parameters<typeof wardenEvents>[0]
    const [row] = wardenEvents(long)
    expect(row?.title).toBe(`moved ${repo} item`)
  })

  it('strips a shortcode from the repo and the item title', () => {
    const [row] = wardenEvents({
      board: { items: [{ event_id: 9, repo: ':warning: service', title: ':fire: {t}' }] },
      items: { '9': { transitions: [{ from_state: 'new', to_state: 'triaged', at: ago(5) }] } },
    } as unknown as Parameters<typeof wardenEvents>[0])
    expect(row?.title).toBe('moved service item')
    expect(row?.detail).toBe('{t}')
  })

  it('names a short repo whole', () => {
    const [row] = wardenEvents({
      board: { items: [{ event_id: 9, repo: '{repo}', title: '{t}' }] },
      items: { '9': { transitions: [{ from_state: 'new', to_state: 'triaged', at: ago(5) }] } },
    } as unknown as Parameters<typeof wardenEvents>[0])
    expect(row?.title).toBe('moved {repo} item')
  })

  it('keeps a long project chip whole', () => {
    const [row] = narrativeEvents([
      { project: 'an-extremely-long-project-name', summary: '{s}', revisedAt: ago(5) },
    ] as unknown as Parameters<typeof narrativeEvents>[0])
    expect(row?.chip).toBe('an-extremely-long-project-name')
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
    expect(counts).toEqual({ overdue: 0, dueSoon: 1, open: 2 })
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
    ).toEqual(['Agents 45\u00a0min old'])
    expect(staleFeeds([{ name: 'Warden', receivedAt: agoIso(29) }], NOW)).toEqual([])
  })

  const base = { decisions: [], loading: [], fleet: null, meetings: null, recovery: null, now: NOW }

  it('does not say nothing needs you when neither source loaded', () => {
    expect(homeSummaryParts({ ...base, unavailable: ['Warden', 'Agents'] }).sentence).toBe(
      "Can't tell — Warden and Agents failed to load.",
    )
  })

  it('names the one source that is down', () => {
    expect(homeSummaryParts({ ...base, unavailable: ['Agents'] }).sentence).toBe(
      'Nothing needs you (Agents failed to load).',
    )
  })
})

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

describe('wardenEvents burst boundary', () => {
  it('joins steps exactly 10 minutes apart and splits at 10 minutes 1 s', () => {
    expect(wardenEvents(timeline(10))).toHaveLength(1)
    const split = timeline(10) as { items: { '1': { transitions: { at: string }[] } } }
    split.items['1'].transitions[1]!.at = new Date(NOW - 60 * MIN + 10 * MIN + 1000).toISOString()
    expect(wardenEvents(split as unknown as Parameters<typeof wardenEvents>[0])).toHaveLength(2)
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
