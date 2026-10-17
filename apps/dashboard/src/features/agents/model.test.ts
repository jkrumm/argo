import { describe, expect, it } from 'bun:test'
import {
  ABANDONED_AFTER_MS,
  formatWaitDuration,
  isAbandonedWait,
  oldestNeedsYouWait,
  trendSeries,
  fleetParts,
  peakNeedsYou,
  hourlyWorking,
  groupProjects,
  headlineOf,
  summarySentence,
  dayLabel,
  ageAgo,
  groupByDay,
} from './model'
import type { AgentRow } from './model'
import type { HistoryPoint } from '../../lib/queries/agents'

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
    const { parts, total } = fleetParts(summary)
    expect(parts.map((p) => p.key)).toEqual(['working', 'needs_you', 'idle', 'stale', 'done'])
    expect(parts.map((p) => p.value)).toEqual([5, 2, 3, 1, 4])
    expect(total).toBe(15)
  })

  it('is all zero without a summary', () => {
    expect(fleetParts(undefined).total).toBe(0)
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

// ── headlineOf ──────────────────────────────────────────────────────────────

describe('headlineOf', () => {
  it('takes the first sentence', () => {
    expect(headlineOf('Run the thing now. Then reply with the numbers.')).toBe('Run the thing now.')
  })

  it('caps long sentences at 90 characters with an ellipsis', () => {
    const out = headlineOf('word '.repeat(60))
    expect(out.length).toBeLessThanOrEqual(90)
    expect(out.endsWith('…')).toBe(true)
  })

  it('collapses newlines', () => {
    expect(headlineOf('line one\nline two')).toBe('line one line two')
  })
})

// ── summarySentence ─────────────────────────────────────────────────────────

describe('summarySentence', () => {
  it('names the count and the oldest wait as figures', () => {
    expect(
      summarySentence({
        items: 3,
        oldestWaitMs: 5 * 3_600_000,
        working: 4,
        total: 12,
        idleProjects: 2,
      }),
    ).toBe('3 items need you, oldest agent wait 5h 0m. 4 of 12 agents working, 2 projects idle.')
  })

  it('reads the zero case without a wait', () => {
    expect(
      summarySentence({ items: 0, oldestWaitMs: null, working: 1, total: 5, idleProjects: 0 }),
    ).toBe('Nothing needs you. 1 of 5 agents working.')
  })

  it('omits the wait clause when only human-queue items wait', () => {
    expect(
      summarySentence({ items: 1, oldestWaitMs: null, working: 0, total: 2, idleProjects: 1 }),
    ).toBe('1 item needs you. 0 of 2 agents working, 1 project idle.')
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

describe('ageAgo', () => {
  it('reads just now under a minute, else the wait format', () => {
    expect(ageAgo(30_000)).toBe('just now')
    expect(ageAgo(5 * 60_000)).toBe('5m ago')
    expect(ageAgo(-1)).toBe('—')
  })
})
