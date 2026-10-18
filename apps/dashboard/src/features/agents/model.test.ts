import { describe, expect, it } from 'bun:test'
import {
  needsYouCount,
  ABANDONED_AFTER_MS,
  formatWaitDuration,
  isAbandonedWait,
  oldestNeedsYouWait,
  trendSeries,
  fleetParts,
  peakNeedsYou,
  hourlyWorking,
  peakWorking,
  countUnknownAgents,
  groupProjects,
  headlineOf,
  longestRunMs,
  clockTime,
  feedState,
  summaryParts,
  fleetFact,
  hoursWithNeedsYou,
  needsYouWindowFact,
  activityFact,
  questionOf,
  evidenceLine,
  previewOf,
  gapHours,
  feedAside,
  STALE_AFTER_MS,
  dayLabel,
  ageAgo,
  needsYouCards,
  oldestAskMs,
  groupByDay,
} from './model'
import type { AgentRow } from './model'
import type { HistoryPoint, OverviewSummary } from '../../lib/queries/agents'

const agent = (overrides: Partial<AgentRow> = {}): AgentRow => ({
  id: overrides.id ?? 'agent-1',
  state: 'idle',
  project: 'argo',
  ...overrides,
})

// ── formatWaitDuration ──────────────────────────────────────────────────────

describe('formatWaitDuration', () => {
  it('formats a multi-day wait as days + hours', () => {
    const ms = 21 * 24 * 60 * 60 * 1000
    expect(formatWaitDuration(ms)).toBe('21d 0h')
  })

  it('formats an hours+minutes wait once past an hour', () => {
    const ms = 5 * 3_600_000 + 12 * 60_000
    expect(formatWaitDuration(ms)).toBe('5h 12m')
  })

  it('formats a sub-hour wait as minutes only', () => {
    expect(formatWaitDuration(42 * 60_000)).toBe('42m')
  })

  it('prints "—" for a negative or non-finite value', () => {
    expect(formatWaitDuration(-1)).toBe('—')
    expect(formatWaitDuration(Number.NaN)).toBe('—')
    expect(formatWaitDuration(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

// ── oldestNeedsYouWait ───────────────────────────────────────────────────────

describe('oldestNeedsYouWait', () => {
  const now = Date.parse('2026-09-08T12:00:00Z')

  it('returns null with no agents', () => {
    expect(oldestNeedsYouWait([], now)).toBeNull()
  })

  it('ignores agents not in needs_you', () => {
    const rows = [
      agent({ id: 'a', state: 'working', lastActivityAt: now - 999_999, project: 'p1' }),
      agent({ id: 'b', state: 'done', lastActivityAt: now - 1, project: 'p2' }),
    ]
    expect(oldestNeedsYouWait(rows, now)).toBeNull()
  })

  it('ignores needs_you agents with no lastActivityAt', () => {
    const rows = [agent({ id: 'a', state: 'needs_you', project: 'p1' })]
    expect(oldestNeedsYouWait(rows, now)).toBeNull()
  })

  it('picks the longest-waiting needs_you agent, carrying its project', () => {
    const rows = [
      agent({ id: 'a', state: 'needs_you', lastActivityAt: now - 60_000, project: 'fresh' }),
      agent({
        id: 'b',
        state: 'needs_you',
        lastActivityAt: now - 21 * 24 * 60 * 60 * 1000,
        project: 'stuck',
      }),
      agent({ id: 'c', state: 'working', lastActivityAt: now - 1, project: 'busy' }),
    ]
    const result = oldestNeedsYouWait(rows, now)
    expect(result).not.toBeNull()
    expect(result?.project).toBe('stuck')
    expect(result?.ms).toBe(21 * 24 * 60 * 60 * 1000)
  })
})

// ── isAbandonedWait ──────────────────────────────────────────────────────────

describe('isAbandonedWait', () => {
  const now = Date.parse('2026-09-08T12:00:00Z')

  it('is false for a non-needs_you state regardless of age', () => {
    const stale = agent({ state: 'stale', lastActivityAt: now - ABANDONED_AFTER_MS * 10 })
    expect(isAbandonedWait(stale, now)).toBe(false)
  })

  it('is false with no lastActivityAt', () => {
    expect(isAbandonedWait(agent({ state: 'needs_you' }), now)).toBe(false)
  })

  it('is false at exactly the 7-day boundary', () => {
    const row = agent({ state: 'needs_you', lastActivityAt: now - ABANDONED_AFTER_MS })
    expect(isAbandonedWait(row, now)).toBe(false)
  })

  it('is true just past the 7-day boundary', () => {
    const row = agent({ state: 'needs_you', lastActivityAt: now - ABANDONED_AFTER_MS - 1 })
    expect(isAbandonedWait(row, now)).toBe(true)
  })
})

// ── trendSeries ─────────────────────────────────────────────────────────────

describe('trendSeries', () => {
  it('omits points without a summary instead of plotting them as 0', () => {
    const history = [
      { summary: { needsYou: 2, working: 1 } },
      { summary: null },
      { summary: { needsYou: 3, working: 0 } },
    ] as unknown as HistoryPoint[]
    expect(trendSeries(history, 'needsYou')).toEqual([2, 3])
  })

  it('is empty without history', () => {
    expect(trendSeries(undefined, 'working')).toEqual([])
  })
})

// ── fleetParts ──────────────────────────────────────────────────────────────

describe('fleetParts', () => {
  it('orders the five parts and totals exactly their sum, leaving dispatch out', () => {
    const summary = { needsYou: 2, working: 5, idle: 3, stale: 1, done: 4, dispatch: 9 }
    const fleet = fleetParts(summary)
    expect(fleet?.parts.map((p) => p.key)).toEqual([
      'working',
      'needs_you',
      'idle',
      'stale',
      'done',
    ])
    expect(fleet?.parts.map((p) => p.value)).toEqual([5, 2, 3, 1, 4])
    expect(fleet?.total).toBe(15)
  })

  it('adds unknown-state agents as a sixth part so the total matches the roster', () => {
    const summary = { needsYou: 0, working: 1, idle: 0, stale: 0, done: 0, dispatch: 0 }
    const fleet = fleetParts(summary, 2)
    expect(fleet?.parts.at(-1)).toEqual({ key: 'unknown', label: 'unknown', value: 2 })
    expect(fleet?.total).toBe(3)
  })

  it('is null, never a zero fleet, without a complete summary', () => {
    expect(fleetParts(undefined)).toBeNull()
    expect(fleetParts({ needsYou: 1, working: 2 } as unknown as OverviewSummary)).toBeNull()
  })
})

// ── peakNeedsYou ────────────────────────────────────────────────────────────

const point = (receivedAt: string, needsYou: number, working = 0) =>
  ({ receivedAt, summary: { needsYou, working } }) as unknown as HistoryPoint

describe('peakNeedsYou', () => {
  it('takes the highest value and the latest time among ties', () => {
    const peak = peakNeedsYou([
      point('2026-01-01T01:00:00Z', 3),
      point('2026-01-01T02:00:00Z', 1),
      point('2026-01-01T03:00:00Z', 3),
    ])
    expect(peak).toEqual({ value: 3, atMs: Date.parse('2026-01-01T03:00:00Z') })
  })

  it('keeps the latest of two equal peaks even when the history is out of order', () => {
    const peak = peakNeedsYou([
      point('2026-01-01T03:00:00Z', 3),
      point('2026-01-01T01:00:00Z', 3),
      point('2026-01-01T02:00:00Z', 1),
    ])
    expect(peak).toEqual({ value: 3, atMs: Date.parse('2026-01-01T03:00:00Z') })
  })

  it('is null without any summary', () => {
    expect(
      peakNeedsYou([{ receivedAt: '2026-01-01T01:00:00Z', summary: null } as HistoryPoint]),
    ).toBeNull()
    expect(peakNeedsYou(undefined)).toBeNull()
  })
})

// ── hourlyWorking ───────────────────────────────────────────────────────────

describe('hourlyWorking', () => {
  const now = Date.parse('2026-01-01T12:30:00Z')

  it('returns one bucket per hour ending with the current hour, null where no snapshot landed', () => {
    const buckets = hourlyWorking(
      [
        point('2026-01-01T12:10:00Z', 0, 2),
        point('2026-01-01T12:20:00Z', 0, 4),
        point('2026-01-01T10:05:00Z', 0, 1),
      ],
      4,
      now,
    )
    expect(buckets.map((b) => b.working)).toEqual([null, 1, null, 4])
    expect(buckets.at(-1)?.hourMs).toBe(Date.parse('2026-01-01T12:00:00Z'))
  })

  it('returns no buckets for a window shorter than an hour', () => {
    expect(hourlyWorking([point('2026-01-01T12:10:00Z', 0, 2)], 0, now)).toEqual([])
  })

  it('ignores points outside the window', () => {
    const buckets = hourlyWorking([point('2025-12-31T01:00:00Z', 0, 9)], 3, now)
    expect(buckets.every((b) => b.working === null)).toBe(true)
  })
})

// ── groupProjects ───────────────────────────────────────────────────────────

describe('groupProjects', () => {
  const snapshot = {
    projects: [
      { name: 'alpha', git: { branch: 'main', dirty: true, ahead: 1, behind: 0 }, agents: [] },
      { name: 'beta', git: null, agents: [] },
      { name: 'empty', git: null, agents: [] },
    ],
  } as unknown as Parameters<typeof groupProjects>[0]

  it('splits active from quiet, keeps every project and picks the worst state', () => {
    const agents = [
      agent({
        id: '1',
        project: 'alpha',
        state: 'working',
        title: 'ship it',
        lastActivityAt: 200,
        source: 'herdr',
      }),
      agent({
        id: '2',
        project: 'alpha',
        state: 'done',
        lastActivityAt: 100,
        source: 'dispatch · implement',
      }),
      agent({ id: '3', project: 'beta', state: 'stale', lastActivityAt: 50 }),
      agent({ id: '4', project: 'gamma', state: 'done', lastActivityAt: 10 }),
    ]
    const { active, quiet } = groupProjects(snapshot, agents)
    expect(active.map((g) => g.name)).toEqual(['alpha'])
    expect(quiet.map((g) => g.name)).toEqual(['beta', 'gamma', 'empty'])
    expect(active[0]?.now).toBe('ship it')
    expect(active[0]?.sources).toEqual({ herdr: 1, dispatch: 1 })
    expect(active[0]?.git?.ahead).toBe(1)
    expect(quiet[0]?.worst).toBe('stale')
    expect(quiet[2]?.lastActivityAt).toBeNull()
  })
})

describe('groupProjects with an unexpected state', () => {
  it('counts it as unknown instead of producing NaN', () => {
    const { quiet } = groupProjects(undefined, [
      agent({ id: 'p', project: 'solo', state: 'paused' as AgentRow['state'] }),
    ])
    expect(quiet[0]?.counts.unknown).toBe(1)
    expect(quiet[0]?.worst).toBe('unknown')
    expect(Object.values(quiet[0]?.counts ?? {}).every(Number.isFinite)).toBe(true)
  })
})

// ── headlineOf ──────────────────────────────────────────────────────────────

describe('headlineOf', () => {
  it('takes the first sentence', () => {
    expect(headlineOf('Run the thing now. Then reply with the numbers.')).toBe('Run the thing now.')
  })

  it('ends a long sentence at its last clause boundary, without an ellipsis', () => {
    const ask =
      'Wave 56 needs a free Marine account to download satellite wave heights (the licence allows any use with attribution, no cost). Steps follow.'
    expect(headlineOf(ask)).toBe(
      'Wave 56 needs a free Marine account to download satellite wave heights',
    )
  })

  it('keeps a clause-free sentence whole while it fits two lines', () => {
    const ask = 'word '.repeat(25).trim()
    expect(ask.length).toBeGreaterThan(90)
    expect(headlineOf(ask)).toBe(ask)
  })

  it('ellipsizes at a word boundary only when no clause boundary fits', () => {
    const out = headlineOf('word '.repeat(60))
    expect(out.length).toBeLessThanOrEqual(180)
    expect(out.endsWith('word…')).toBe(true)
  })

  it('collapses newlines', () => {
    expect(headlineOf('line one\nline two')).toBe('line one line two')
  })
})

// ── summaryParts ────────────────────────────────────────────────────────────

describe('summaryParts', () => {
  it('names the count and the oldest wait in the sentence, fleet and idle as facts', () => {
    expect(
      summaryParts({
        items: 3,
        oldestWaitMs: 5 * 3_600_000,
        fleet: { working: 4, total: 12 },
        idleProjects: 2,
      }),
    ).toEqual({
      sentence: '3 items need you, oldest agent wait 5h 0m.',
      facts: ['4 of 12 agents working', '2 projects idle'],
    })
  })

  it('carries the fleet in the sentence when nothing waits', () => {
    expect(
      summaryParts({
        items: 0,
        oldestWaitMs: null,
        fleet: { working: 1, total: 5 },
        idleProjects: 0,
      }),
    ).toEqual({ sentence: 'Nothing needs you; 1 of 5 agents working.', facts: ['0 projects idle'] })
  })

  it('omits the wait clause when nothing carries a clock', () => {
    expect(
      summaryParts({
        items: 1,
        oldestWaitMs: null,
        fleet: { working: 0, total: 2 },
        idleProjects: 1,
      }),
    ).toEqual({
      sentence: '1 item needs you.',
      facts: ['0 of 2 agents working', '1 project idle'],
    })
  })

  it('names the oldest ask when only the human queue waits', () => {
    expect(
      summaryParts({
        items: 1,
        oldestWaitMs: null,
        oldestAskMs: 90 * 60_000,
        fleet: null,
        idleProjects: 0,
      }),
    ).toEqual({ sentence: '1 item needs you, oldest ask 1h 30m.', facts: ['0 projects idle'] })
  })
})

describe('fleetFact', () => {
  it('names the longest run, nothing when no agent works', () => {
    expect(fleetFact(3 * 3_600_000 + 5 * 60_000)).toBe('longest run 3h 5m')
    expect(fleetFact(null)).toBeNull()
  })
})

describe('needs-you window facts', () => {
  const at = (iso: string, needsYou: number): HistoryPoint =>
    ({ receivedAt: iso, summary: { needsYou } }) as unknown as HistoryPoint
  const now = Date.parse('2026-01-10T12:30:00Z')

  it('counts the hours that had something waiting', () => {
    const history = [
      at('2026-01-10T09:10:00Z', 1),
      at('2026-01-10T09:40:00Z', 2),
      at('2026-01-10T10:10:00Z', 0),
      at('2025-12-01T10:10:00Z', 3),
    ]
    expect(hoursWithNeedsYou(history, 24, now)).toBe(1)
    expect(hoursWithNeedsYou([], 24, now)).toBeNull()
  })

  it('words the three cases with a unit', () => {
    expect(needsYouWindowFact(null, 24)).toBe('no data in 24 h')
    expect(needsYouWindowFact(0, 24)).toBe('none waiting in 24 h')
    expect(needsYouWindowFact(5, 24)).toBe('waiting in 5 of 24 h')
  })
})

describe('activityFact', () => {
  it('names the busiest hour and the active hours', () => {
    const hour = (h: number, working: number | null) => ({
      hourMs: Date.UTC(2026, 0, 10, h),
      working,
    })
    const fact = activityFact([hour(1, 0), hour(2, 3), hour(3, 1), hour(4, null)])
    expect(fact).toMatch(/^busiest hour \d\d:\d\d · agents working in 2 of 4 h$/)
    expect(activityFact([hour(1, null)])).toBeNull()
    expect(activityFact([hour(1, 0), hour(2, 0)])).toBe('no agent working in 2 h')
  })
})

describe('questionOf', () => {
  it('keeps a short sentence and strips markdown marks', () => {
    expect(questionOf('Which `branch` do we ship? More detail follows.')).toBe(
      'Which branch do we ship?',
    )
  })

  it('ends a long sentence at a clause, else at a word with an ellipsis', () => {
    const long =
      'Approve the migration of the nightly export job to the new queue, which also changes retries and alerting'
    expect(questionOf(long)).toBe(
      'Approve the migration of the nightly export job to the new queue',
    )
    const out = questionOf('word '.repeat(60))
    expect(out.length).toBeLessThanOrEqual(80)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('evidence and preview', () => {
  it('takes the first blocker line, falling back through waitingFor and standing', () => {
    expect(evidenceLine(agent({ blocker: '\n  dialog open\nmore' }))).toBe('dialog open')
    expect(evidenceLine(agent({ waitingFor: 'a permission prompt' }))).toBe('a permission prompt')
    expect(evidenceLine(agent())).toBeNull()
  })

  it('previews the last reply paragraph only when it adds something', () => {
    const a = agent({ lastReply: 'First part.\n\nSecond   part\nwraps.' })
    expect(previewOf(a, null)).toBe('Second part wraps.')
    expect(previewOf(a, 'Second part wraps.')).toBeNull()
    expect(previewOf(agent(), null)).toBeNull()
  })
})

describe('gapHours', () => {
  it('counts completed hours without a snapshot, never the hour in progress', () => {
    const hours = [null, 2, null, null].map((working, i) => ({ hourMs: i * 3_600_000, working }))
    expect(gapHours(hours, 3 * 3_600_000 + 60_000)).toBe(2)
  })
})

// ── groupByDay ──────────────────────────────────────────────────────────────

const at = (day: number, hour: number) => new Date(2026, 0, day, hour).toISOString()

describe('groupByDay', () => {
  const now = new Date(2026, 0, 10, 12, 0).getTime()

  it('labels days and sorts newest first', () => {
    expect(dayLabel(new Date(2026, 0, 10, 1).getTime(), now)).toBe('Today')
    expect(dayLabel(new Date(2026, 0, 9, 23).getTime(), now)).toBe('Yesterday')
    const groups = groupByDay(
      [
        { revisedAt: at(9, 8), id: 'b' },
        { revisedAt: at(10, 9), id: 'a' },
        { revisedAt: at(10, 11), id: 'c' },
        { revisedAt: at(3, 8), id: 'd' },
      ],
      now,
    )
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['Today', ['c', 'a']],
      ['Yesterday', ['b']],
      [groups[2]!.label, ['d']],
    ])
    expect(groups[2]!.label).toMatch(/^Sat 3 Jan$/)
  })
})

describe('summaryParts without a fleet', () => {
  it('leaves the fleet fact out instead of zeroing it', () => {
    expect(summaryParts({ items: 2, oldestWaitMs: null, fleet: null, idleProjects: 1 })).toEqual({
      sentence: '2 items need you.',
      facts: ['1 project idle'],
    })
    expect(summaryParts({ items: 0, oldestWaitMs: null, fleet: null, idleProjects: 0 })).toEqual({
      sentence: 'Nothing needs you.',
      facts: ['0 projects idle'],
    })
  })
})

describe('peakWorking', () => {
  it('is null when no hour was measured, else the busiest measured hour', () => {
    expect(peakWorking([{ hourMs: 1, working: null }])).toBeNull()
    expect(
      peakWorking([
        { hourMs: 1, working: 2 },
        { hourMs: 2, working: null },
        { hourMs: 3, working: 5 },
      ]),
    ).toEqual({ value: 5, hourMs: 3 })
  })
})

describe('countUnknownAgents', () => {
  it('counts unknown and unexpected states', () => {
    const rows = [
      agent({ state: 'working' }),
      agent({ state: 'unknown' }),
      agent({ state: 'paused' as AgentRow['state'] }),
    ]
    expect(countUnknownAgents(rows)).toBe(2)
  })
})

describe('ageAgo', () => {
  it('reads just now under a minute, else the wait format', () => {
    expect(ageAgo(30_000)).toBe('just now')
    expect(ageAgo(5 * 60_000)).toBe('5m ago')
    expect(ageAgo(-1)).toBe('—')
  })
})

describe('needsYouCards', () => {
  const now = Date.parse('2026-01-10T12:00:00Z')

  it('merges both queues, longest wait first, with one copy action each from payload fields', () => {
    const cards = needsYouCards(
      [
        {
          id: 'a',
          askedAt: '2026-01-10T11:00:00Z',
          question: 'Run the thing. Then reply.',
          cmd: ' make go ',
          host: 'mini',
        },
        { id: 'b', askedAt: null, question: 'No clock' },
      ],
      [
        agent({
          id: 'x',
          state: 'needs_you',
          title: 'Pick a branch',
          blocker: 'dialog open',
          paneId: 'p1',
          lastActivityAt: now - 8 * 86_400_000,
        }),
        agent({ id: 'y', state: 'working' }),
      ],
      now,
    )
    expect(cards.map((c) => c.key)).toEqual(['agent-x', 'hq-a', 'hq-b'])
    expect(cards[0]).toMatchObject({
      abandoned: true,
      copy: { label: 'Copy pane id', value: 'p1' },
      inset: 'dialog open',
    })
    expect(cards[1]).toMatchObject({
      facts: ['human queue', 'mini', 'asked 1h 0m ago'],
      headline: 'Run the thing.',
      inset: 'make go',
      copy: { label: 'Copy command', value: 'make go' },
    })
    expect(cards[2]?.copy).toBeNull()
    expect(cards[2]?.facts).toEqual(['human queue'])
  })

  it('derives facts, evidence and a snapshot-age fallback for agents', () => {
    const waiting = agent({
      id: 'z',
      state: 'needs_you',
      title: 'Pick a branch',
      lastActivityAt: now - 90 * 60_000,
    })
    const [card] = needsYouCards([], [waiting], now, { machine: 'mini', snapshotAgeMs: 120_000 })
    expect(card).toMatchObject({
      facts: ['argo', 'waiting 1h 30m', 'mini'],
      inset: 'no blocker reported · snapshot 2m ago',
      preview: null,
    })
  })

  it('offers the full ask only when the headline cut something', () => {
    const [short] = needsYouCards([{ id: 's', question: 'Short ask.' }], [], now)
    expect(short?.fullAsk).toBeNull()
    const [long] = needsYouCards(
      [{ id: 'l', question: 'First. Second sentence follows.' }],
      [],
      now,
    )
    expect(long?.fullAsk).toEqual({
      label: 'Full ask · 31 chars',
      text: 'First. Second sentence follows.',
    })
  })
})

describe('needsYouCount', () => {
  it('is the length of the list the Needs-you section renders', () => {
    const queue = [{ id: 'q1', question: 'Ship it?' }]
    const agents = [
      agent({ state: 'needs_you' }),
      agent({ id: 'agent-2', state: 'needs_you' }),
      agent({ id: 'agent-3', state: 'idle' }),
    ]
    const now = Date.now()
    expect(needsYouCount(queue, agents, now)).toBe(3)
    expect(needsYouCount(queue, agents, now)).toBe(needsYouCards(queue, agents, now).length)
    expect(needsYouCount([], [], now)).toBe(0)
  })
})

describe('oldestAskMs', () => {
  it('takes the longest ask age, null without a clock', () => {
    const now = Date.parse('2026-01-10T12:00:00Z')
    const asks = [{ askedAt: '2026-01-10T11:00:00Z' }, { askedAt: '2026-01-10T09:00:00Z' }, {}]
    expect(oldestAskMs(asks, now)).toBe(3 * 3_600_000)
    expect(oldestAskMs([{}], now)).toBeNull()
  })
})

describe('longestRunMs', () => {
  it('takes the longest age from startedAt, falling back to last activity', () => {
    const rows = [
      agent({ id: 'a', startedAt: 1_000 }),
      agent({ id: 'b', lastActivityAt: 4_000 }),
      agent({ id: 'c' }),
    ]
    expect(longestRunMs(rows, 5_000)).toBe(4_000)
    expect(longestRunMs([agent({ id: 'c' })], 5_000)).toBeNull()
  })
})

describe('unreadable data never throws or becomes zero', () => {
  const bad = (receivedAt: string, summary: unknown) =>
    ({ receivedAt, summary }) as unknown as HistoryPoint

  it('omits non-finite counts and unparseable times from trend, peak and hourly buckets', () => {
    const history = [
      bad('2026-01-01T12:10:00Z', { needsYou: 'x', working: undefined }),
      bad('not a date', { needsYou: 5, working: 5 }),
      bad('2026-01-01T12:20:00Z', { needsYou: 2, working: 3 }),
    ]
    expect(trendSeries(history, 'needsYou')).toEqual([5, 2])
    expect(peakNeedsYou(history)).toEqual({ value: 2, atMs: Date.parse('2026-01-01T12:20:00Z') })
    const buckets = hourlyWorking(history, 2, Date.parse('2026-01-01T12:30:00Z'))
    expect(buckets.map((b) => b.working)).toEqual([null, 3])
  })

  it('puts unparseable narratives in a trailing dash group', () => {
    const now = new Date(2026, 0, 10, 12).getTime()
    const groups = groupByDay(
      [
        { revisedAt: 'garbage', id: 'x' },
        { revisedAt: new Date(2026, 0, 10, 9).toISOString(), id: 'a' },
      ],
      now,
    )
    expect(groups.map((g) => g.label)).toEqual(['Today', '—'])
    expect(clockTime('garbage')).toBe('—')
  })

  it('treats an unparseable ask time as no clock', () => {
    const [card] = needsYouCards([{ id: 'q', askedAt: 'garbage', question: 'Do it.' }], [], 1_000)
    expect(card?.facts).toEqual(['human queue'])
    expect(card?.waitMs).toBe(-1)
    expect(oldestAskMs([{ askedAt: 'garbage' }], 1_000)).toBeNull()
  })

  it('does not treat a prototype key as a known state', () => {
    const { quiet } = groupProjects(undefined, [
      agent({ id: 'p', project: 'solo', state: 'toString' as AgentRow['state'] }),
    ])
    expect(quiet[0]?.counts.unknown).toBe(1)
  })
})

describe('feedState', () => {
  it('separates pending, failed, stale-after-error and ok', () => {
    expect(feedState({ hasData: false, isPending: true, isError: false })).toBe('pending')
    expect(feedState({ hasData: false, isPending: false, isError: true })).toBe('failed')
    expect(feedState({ hasData: true, isPending: false, isError: true })).toBe('stale')
    expect(feedState({ hasData: true, isPending: false, isError: false })).toBe('ok')
    expect(feedState({ hasData: false, isPending: false, isError: false })).toBe('ok')
  })
})

describe('feedAside', () => {
  it('reads Live just under the stale threshold and Stale at it', () => {
    expect(feedAside('ok', STALE_AFTER_MS - 1)?.tone).toBe('live')
    expect(feedAside('ok', STALE_AFTER_MS)?.tone).toBe('warn')
    expect(feedAside('ok', STALE_AFTER_MS)?.text.startsWith('Stale')).toBe(true)
  })

  it('never says Live for a feed whose last fetch failed', () => {
    expect(feedAside('stale', 60_000)?.text.startsWith('Stale')).toBe(true)
    expect(feedAside('stale', 60_000)?.tone).toBe('warn')
  })

  it('has nothing to say without data or while failed or pending', () => {
    expect(feedAside('ok', null)).toBeNull()
    expect(feedAside('failed', 60_000)).toBeNull()
    expect(feedAside('pending', null)).toBeNull()
  })
})
