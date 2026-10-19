import { describe, expect, it } from 'bun:test'
import {
  ABANDONED_AFTER_MS,
  isAbandonedWait,
  oldestNeedsYouWait,
  oldestWaitEmptyText,
  oldestWaitFooter,
  activityLegend,
  bandStateOf,
  fleetParts,
  hourlyWorking,
  peakWorking,
  countUnknownAgents,
  groupProjects,
  headlineOf,
  longestRunMs,
  clockTime,
  feedState,
  agentsSummaryParts,
  oldestWait,
  fleetFact,
  needsYouSplit,
  waitingProjects,
  clockMs,
  activityFact,
  noSnapshotCaption,
  previewOf,
  gapHours,
  feedAside,
  STALE_AFTER_MS,
  dayLabel,
  needsYouCards,
  oldestAskMs,
  groupByDay,
} from './model'
import type { AgentRow } from './model'
import type { HistoryPoint, OverviewSummary } from '../../lib/queries/agents'

const agent = (overrides: Partial<AgentRow> = {}): AgentRow => ({
  id: overrides.id ?? 'agent-1',
  state: 'idle',
  project: 'project-a',
  ...overrides,
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

describe('oldestWait', () => {
  const now = Date.parse('2026-01-10T12:00:00Z')
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString()
  const waiting = (id: string, project: string, h: number) =>
    agent({ id, state: 'needs_you', project, lastActivityAt: now - h * 3_600_000 })

  it('is the oldest waiting agent, named by its project', () => {
    const rows = [waiting('a', 'project-a', 2), waiting('b', 'project-b', 5)]
    expect(oldestWait([], rows, now)).toEqual({ ms: 5 * 3_600_000, project: 'project-b' })
  })
  it('is the oldest ask when no agent waits, and none for an empty queue or no clock', () => {
    const asks = [
      { id: 'q1', askedAt: hoursAgo(1) },
      { id: 'q2', askedAt: hoursAgo(3) },
    ]
    expect(oldestWait(asks, [], now)).toEqual({ ms: 3 * 3_600_000, project: 'the human queue' })
    expect(oldestWait([], [], now)).toBeNull()
    expect(oldestWait([{ id: 'q3' }], [], now)).toBeNull()
  })
  it('is the older of the two: an older ask beats a younger agent, an older agent beats an ask', () => {
    const rows = [waiting('a', 'project-a', 2)]
    expect(oldestWait([{ id: 'q1', askedAt: hoursAgo(9) }], rows, now)).toEqual({
      ms: 9 * 3_600_000,
      project: 'the human queue',
    })
    expect(oldestWait([{ id: 'q1', askedAt: hoursAgo(1) }], rows, now)?.project).toBe('project-a')
    // An exact tie names the agent.
    expect(oldestWait([{ id: 'q1', askedAt: hoursAgo(2) }], rows, now)?.project).toBe('project-a')
  })
})

describe('agentsSummaryParts', () => {
  it('carries the one figure the strip lacks: the projects the blocked agents sit in', () => {
    expect(agentsSummaryParts({ agentWaits: 2, asks: 1, projects: 2 }).sentence).toBe(
      'Agents in 2 projects and the human queue are waiting on you.',
    )
    expect(agentsSummaryParts({ agentWaits: 3, asks: 0, projects: 2 }).sentence).toBe(
      'Agents in 2 projects are waiting on you.',
    )
    expect(agentsSummaryParts({ agentWaits: 1, asks: 0, projects: 1 }).sentence).toBe(
      'An agent in 1 project is waiting on you.',
    )
  })

  it('adds the abandoned count and the ask hosts, figures no other part of the page prints', () => {
    expect(agentsSummaryParts({ agentWaits: 3, asks: 0, projects: 2, abandoned: 1 }).sentence).toBe(
      'Agents in 2 projects are waiting on you, 1 of them abandoned.',
    )
    // All abandoned is the most urgent case: it is said.
    expect(agentsSummaryParts({ agentWaits: 3, asks: 0, projects: 2, abandoned: 3 }).sentence).toBe(
      'Agents in 2 projects are waiting on you, all abandoned.',
    )
    expect(agentsSummaryParts({ agentWaits: 0, asks: 3, projects: 0, hosts: 2 }).sentence).toBe(
      'Requests from 2 hosts are waiting for your answer.',
    )
  })

  it('carries the oldest wait in the cards’ duration spelling, on every kind of wait', () => {
    const oldest = (3 * 60 + 5) * 60_000
    const tail = 'Oldest wait 3\u00a0h\u00a05\u00a0min.'
    expect(
      agentsSummaryParts({ agentWaits: 0, asks: 2, projects: 0, hosts: 1, oldestWaitMs: oldest })
        .sentence,
    ).toBe(`Requests from 1 host are waiting for your answer. ${tail}`)
    expect(
      agentsSummaryParts({
        agentWaits: 2,
        asks: 0,
        projects: 1,
        abandoned: 1,
        oldestWaitMs: oldest,
      }).sentence,
    ).toBe(`Agents in 1 project are waiting on you, 1 of them abandoned. ${tail}`)
    expect(
      agentsSummaryParts({ agentWaits: 1, asks: 1, projects: 1, oldestWaitMs: oldest }).sentence,
    ).toBe(`Agents in 1 project and the human queue are waiting on you. ${tail}`)
    // No clock, nothing waiting: no wait is invented.
    expect(
      agentsSummaryParts({ agentWaits: 1, asks: 0, projects: 0, oldestWaitMs: null }).sentence,
    ).toBe('An agent is waiting on you.')
    expect(
      agentsSummaryParts({ agentWaits: 0, asks: 0, projects: 0, oldestWaitMs: oldest }).sentence,
    ).toBe('Nothing needs you.')
  })

  it('says an ask alone waits, without a with-a-command sub-count', () => {
    expect(agentsSummaryParts({ agentWaits: 0, asks: 1, projects: 0 }).sentence).toBe(
      'A request is waiting for your answer.',
    )
    expect(agentsSummaryParts({ agentWaits: 0, asks: 3, projects: 0 }).sentence).toBe(
      'Requests are waiting for your answer.',
    )
    expect(agentsSummaryParts({ agentWaits: 0, asks: 0, projects: 0 })).toEqual({
      sentence: 'Nothing needs you.',
    })
  })
})

describe('needsYouSplit', () => {
  it('splits the tile count into agents and asks only when both exist', () => {
    expect(needsYouSplit(2, 1)).toBe('2 agents · 1 ask')
    expect(needsYouSplit(1, 3)).toBe('1 agent · 3 asks')
    // One kind alone is the tile's own count.
    expect(needsYouSplit(1, 0)).toBe('')
    expect(needsYouSplit(0, 3)).toBe('')
    expect(needsYouSplit(0, 0)).toBe('')
  })
})

describe('waitingProjects', () => {
  it('counts distinct named projects among needs-you agents only, never — or blank', () => {
    const rows = [
      agent({ id: 'a', state: 'needs_you', project: 'p1' }),
      agent({ id: 'b', state: 'needs_you', project: 'p1' }),
      agent({ id: 'c', state: 'needs_you', project: 'p2' }),
      agent({ id: 'e', state: 'needs_you', project: '—' }),
      agent({ id: 'f', state: 'needs_you', project: '' }),
      agent({ id: 'd', state: 'working', project: 'p3' }),
    ]
    expect(waitingProjects(rows)).toBe(2)
  })
})

describe('fleetFact', () => {
  it('names the longest run, or that nothing works', () => {
    expect(fleetFact(3 * 3_600_000 + 5 * 60_000, 2)).toBe('longest run 3\u00a0h\u00a05\u00a0min')
    expect(fleetFact(null, 0)).toBe('no agent working')
    expect(fleetFact(null, 3)).toBe('longest run not reported')
  })
})

describe('activityFact', () => {
  const hour = (h: number, working: number | null) => ({
    hourMs: Date.UTC(2026, 0, 10, h),
    working,
  })

  it('names the busiest hour and the measured hours with an agent working', () => {
    const buckets = [hour(1, 0), hour(2, 3), hour(3, 1), hour(4, 0)]
    expect(activityFact(buckets, peakWorking(buckets))).toMatch(
      /^busiest hour \d\d:\d\d · agents working in 2\u00a0of\u00a04\u00a0h$/,
    )
  })

  it('leaves unmeasured hours out of the denominator and says so', () => {
    const buckets = [hour(1, null), hour(2, 3), hour(3, 0), hour(4, null)]
    expect(activityFact(buckets, peakWorking(buckets))).toMatch(
      /agents working in 1\u00a0of\u00a02\u00a0h observed$/,
    )
    const quiet = [hour(1, null), hour(2, 0)]
    expect(activityFact(quiet, peakWorking(quiet))).toBe('no agent working in 1\u00a0h observed')
  })

  it('is null when nothing was measured', () => {
    const buckets = [hour(1, null)]
    expect(activityFact(buckets, peakWorking(buckets))).toBeNull()
  })
})

describe('evidence and preview', () => {
  it('previews the last reply paragraph only when it adds something', () => {
    const a = agent({ lastReply: 'First part.\n\nSecond   part\nwraps.' })
    expect(previewOf(a)).toBe('Second part wraps.')
    expect(previewOf(agent({ ...a, blocker: 'Second part wraps.' }))).toBeNull()
    expect(previewOf(agent())).toBeNull()
  })

  it('does not repeat an ellipsized or multi-line blocker as the preview', () => {
    const long = `${'word '.repeat(60)}end`
    expect(previewOf(agent({ blocker: long, lastReply: long }))).toBeNull()
    const multi = agent({ blocker: 'Pick one.\nDetails follow.', lastReply: 'Pick one.' })
    expect(previewOf(multi)).toBeNull()
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

describe('needsYouCards', () => {
  const now = Date.parse('2026-01-10T12:00:00Z')

  it('merges both queues, longest wait first, with up to two copy actions from payload fields', () => {
    const cards = needsYouCards(
      [
        {
          id: 'a',
          askedAt: '2026-01-10T11:00:00Z',
          question: 'Run the thing now? Then reply.',
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
      question: 'Unblock agent: Pick a branch?',
      entity: null,
      evidenceLine: 'dialog open',
      actions: [
        { label: 'Copy pane id', value: 'p1' },
        { label: 'Copy blocker', value: 'dialog open' },
      ],
    })
    expect(cards[1]).toMatchObject({
      facts: ['human queue', 'mini', 'asked 1\u00a0h ago'],
      question: 'Run the thing now?',
      evidenceLine: 'Then reply.',
      actions: [
        { label: 'Copy command', value: 'make go' },
        { label: 'Copy ask', value: 'Run the thing now? Then reply.' },
      ],
      disclosure: { label: 'Command', text: null, command: 'make go' },
    })
    expect(cards[2]?.facts).toEqual(['human queue'])
  })

  it('never restates its evidence in the title, and drops a stem every card repeats', () => {
    const asks = [
      { id: 'a', question: 'Deploy is blocked on the {service} migration. Check the logs.' },
      { id: 'b', question: 'Disk is full on {host}. Free some space.' },
    ]
    const cards = needsYouCards(asks, [], now)
    expect(cards.map((c) => c.question)).toEqual([
      'Copy ask: Deploy is blocked on the {service} migration?',
      'Copy ask: Disk is full on {host}?',
    ])
    // The sentence the title carries is not printed again as evidence.
    expect(cards.map((c) => c.evidenceLine)).toEqual(['Check the logs.', 'Free some space.'])
  })

  it('asks in the verb of its primary button: Copy command with a command, else Copy ask', () => {
    const cards = needsYouCards(
      [
        {
          id: 'a',
          question: 'Deploy is blocked on the {service} migration. Check.',
          cmd: 'make go',
        },
        { id: 'b', question: 'Disk is full on {host}. Free some space.' },
        { id: 'c', question: 'Alert {name} is down. Look.', kind: 'alert', cmd: ' ' },
      ],
      [],
      now,
    )
    expect(cards.map((c) => [c.actions[0]?.label, c.question])).toEqual([
      ['Copy command', 'Copy command: Deploy is blocked on the {service} migration?'],
      ['Copy ask', 'Copy ask: Disk is full on {host}?'],
      ['Copy ask', 'Copy ask on alert: Alert {name} is down?'],
    ])
    expect(cards.map((c) => c.question).join(' ')).not.toMatch(/Answer|Handle/)
  })

  it('strips shortcodes from a queue ask and reads blank or non-string asks as absent', () => {
    const cards = needsYouCards(
      [
        { id: 'a', question: ':rocket: Deploy now? Why not.' },
        { id: 'b', question: '   ' },
        { id: 'c', question: 7 as never },
      ],
      [],
      now,
    )
    expect(cards.map((c) => c.question)).toEqual([
      'Deploy now?',
      // No ask text, no subject: identical cards, so the ordinal is the honest last tie-break.
      'Copy ask for this request (1)?',
      'Copy ask for this request (2)?',
    ])
    for (const card of cards) expect(card.actions.length).toBeGreaterThanOrEqual(1)
  })

  it('shows a blocker that is itself a question as the evidence line', () => {
    const [card] = needsYouCards(
      [],
      [agent({ id: 'z', state: 'needs_you', title: 'Pick', blocker: 'Which branch?' })],
      now,
    )
    expect(card?.evidenceLine).toBe('Which branch?')
  })

  it('names no project for the placeholder project', () => {
    const [card] = needsYouCards(
      [],
      [agent({ id: 'z', state: 'needs_you', title: 'Pick', project: '—' })],
      now,
    )
    expect(card?.question).toBe('Unblock agent: Pick?')
    expect(card?.facts).not.toContain('—')
  })

  it('never has a card without an action', () => {
    const cards = needsYouCards(
      [{ id: 'q', question: 'Plain ask.' }],
      [agent({ id: 'z', state: 'needs_you', title: 'Pick a branch' })],
      now,
    )
    for (const card of cards) expect(card.actions.length).toBeGreaterThanOrEqual(1)
    expect(cards.find((c) => c.key === 'hq-q')?.actions).toEqual([
      { label: 'Copy ask', value: 'Plain ask.' },
    ])
  })

  it('uses an authored agent question verbatim', () => {
    const [card] = needsYouCards(
      [],
      [agent({ id: 'z', state: 'needs_you', title: 'raw_title_key', question: 'Pick a branch?' })],
      now,
    )
    expect(card).toMatchObject({ question: 'Pick a branch?', entity: 'raw_title_key' })
  })

  it('derives facts, evidence and the no-blocker line for agents', () => {
    const waiting = agent({
      id: 'z',
      state: 'needs_you',
      title: 'Pick a branch',
      lastActivityAt: now - 90 * 60_000,
    })
    const [card] = needsYouCards([], [waiting], now, { machine: 'mini' })
    expect(card).toMatchObject({
      facts: ['project-a', 'waiting\u00a01\u00a0h\u00a030\u00a0min', 'mini'],
      evidenceLine: 'No blocker reported.',
      preview: null,
    })
  })

  it('shows a host on an ask only when the ask carries one', () => {
    const [bare, hosted] = needsYouCards(
      [
        { id: 'a', question: 'Bare?', askedAt: '2026-01-10T11:00:00Z' },
        { id: 'b', question: 'Hosted?', askedAt: '2026-01-10T11:30:00Z', host: 'laptop' },
      ],
      [],
      now,
      { machine: 'mini' },
    )
    expect(bare?.facts).toEqual(['human queue', 'asked 1\u00a0h ago'])
    expect(hosted?.facts).toEqual(['human queue', 'laptop', 'asked 30\u00a0min ago'])
  })

  it('asks about a statement ask by its first sentence; the evidence takes the next one', () => {
    const [card] = needsYouCards(
      [{ id: 's', question: 'Short ask. Second sentence follows.', host: 'mini' }],
      [],
      now,
    )
    expect(card).toMatchObject({
      question: 'Copy ask: Short ask?',
      evidenceLine: 'Second sentence follows.',
      disclosure: null,
    })
  })

  it('offers the whole ask behind a disclosure only when the line shortened it', () => {
    const long = `Is this fine? ${'More detail follows here. '.repeat(10)}`
    const [card] = needsYouCards([{ id: 'l', question: long }], [], now)
    expect(card?.disclosure).toEqual({
      label: 'Full ask',
      text: 'More detail follows here. '.repeat(10).trim(),
      command: null,
    })
    expect(card?.disclosure?.label).not.toMatch(/\d/)
  })

  it('puts a command and the whole ask behind one disclosure', () => {
    const long = `Is this fine? ${'More detail follows here. '.repeat(10)}`
    const [card] = needsYouCards([{ id: 'l', question: long, cmd: 'make go' }], [], now)
    expect(card?.disclosure?.label).toBe('Command and full ask')
    expect(card?.disclosure?.command).toBe('make go')
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
  it('takes the longest age from startedAt; last activity is not a run', () => {
    const rows = [
      agent({ id: 'a', startedAt: 1_000 }),
      agent({ id: 'b', startedAt: 3_000, lastActivityAt: 0 }),
      agent({ id: 'c', lastActivityAt: 0 }),
    ]
    expect(longestRunMs(rows, 5_000)).toBe(4_000)
    expect(longestRunMs([agent({ id: 'c', lastActivityAt: 0 })], 5_000)).toBeNull()
  })
})

describe('unreadable data never throws or becomes zero', () => {
  const bad = (receivedAt: string, summary: unknown) =>
    ({ receivedAt, summary }) as unknown as HistoryPoint

  it('omits non-finite counts and unparseable times from hourly buckets', () => {
    const history = [
      bad('2026-01-01T12:10:00Z', { needsYou: 'x', working: undefined }),
      bad('not a date', { needsYou: 5, working: 5 }),
      bad('2026-01-01T12:20:00Z', { needsYou: 2, working: 3 }),
    ]
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

describe('needsYouCards: questions that tell items apart', () => {
  const now = Date.parse('2026-01-10T12:00:00Z')

  it('names every agent by its task, alone or beside a same-project sibling', () => {
    const waiting = (id: string, title: string) =>
      agent({ id, state: 'needs_you', title, project: 'project-a', lastActivityAt: now - 60_000 })
    const [lone] = needsYouCards([], [waiting('a', 'Pick a branch')], now)
    expect(lone!.question).toBe('Unblock agent: Pick a branch?')
    const pair = needsYouCards(
      [],
      [waiting('a', 'Pick a branch'), waiting('b', 'Choose a host')],
      now,
    )
    expect(pair.map((c) => c.question).toSorted()).toEqual([
      'Unblock agent: Choose a host?',
      'Unblock agent: Pick a branch?',
    ])
    expect(pair.map((c) => c.entity)).toEqual([null, null])
  })
})

describe('needsYouCards: loose wire values', () => {
  const now = Date.parse('2026-01-10T12:00:00Z')

  it('reads a non-string cmd, host, title, project or reply as absent, never throwing', () => {
    for (const junk of [42, {}, ['x'], true]) {
      const cards = needsYouCards(
        [
          {
            id: 'q',
            question: 'Run it?',
            cmd: junk,
            host: junk,
            title: junk,
            askedAt: junk,
          } as never,
        ],
        [
          agent({
            id: 'z',
            state: 'needs_you',
            title: junk as never,
            lastPrompt: junk as never,
            project: junk as never,
            lastReply: junk as never,
            blocker: junk as never,
            lastActivityAt: now - 60_000,
          }),
        ],
        now,
      )
      expect(cards).toHaveLength(2)
      const agentCard = cards.find((c) => c.kind === 'agent')
      expect(agentCard?.question).toBe('Unblock this agent?')
      expect(agentCard?.evidenceLine).toBe('No blocker reported.')
      expect(cards.find((c) => c.kind === 'human-queue')?.question).toBe('Run it?')
    }
  })

  it('tells two same-title-prefix agents apart by the rest of their subject', () => {
    const waiting = (id: string, title: string) =>
      agent({ id, state: 'needs_you', title, project: 'project-a', lastActivityAt: now - 60_000 })
    const cards = needsYouCards(
      [],
      [
        waiting('a', 'Pick a branch — host a'),
        waiting('b', 'Pick a branch — host b'),
        waiting('c', 'Same'),
      ],
      now,
    )
    expect(cards.map((c) => c.question).toSorted()).toEqual(
      [
        'Unblock agent: Pick a branch — host a?',
        'Unblock agent: Pick a branch — host b?',
        'Unblock agent: Same?',
      ].toSorted(),
    )
  })
})

describe('round 2 guards', () => {
  const now = Date.parse('2026-01-10T12:00:00Z')

  it('names no project figure when every project is blank or a dash', () => {
    const rows = [
      agent({ id: 'a', state: 'needs_you', project: '—' }),
      agent({ id: 'b', state: 'needs_you', project: '  ' }),
    ]
    expect(waitingProjects(rows)).toBe(0)
    expect(agentsSummaryParts({ agentWaits: 2, asks: 0, projects: 0 }).sentence).toBe(
      'Agents are waiting on you.',
    )
    expect(agentsSummaryParts({ agentWaits: 1, asks: 1, projects: 0 }).sentence).toBe(
      'Agents and the human queue are waiting on you.',
    )
  })

  it('reads a clock that is not a finite number as none, never NaN', () => {
    for (const junk of ['yesterday', NaN, Infinity, {}, null, undefined])
      expect(clockMs(junk)).toBeNull()
    expect(clockMs(5)).toBe(5)
    const [card] = needsYouCards(
      [],
      [agent({ id: 'z', state: 'needs_you', lastActivityAt: 'yesterday' as never })],
      now,
    )
    expect(card?.waitMs).toBe(-1)
    expect(card?.facts.join(' ')).not.toMatch(/NaN/)
    expect(oldestNeedsYouWait([agent({ state: 'needs_you', lastActivityAt: NaN })], now)).toBeNull()
    expect(isAbandonedWait(agent({ state: 'needs_you', lastActivityAt: 'x' as never }), now)).toBe(
      false,
    )
  })

  it('reads an ask time that is not an ISO string as none', () => {
    const [card] = needsYouCards([{ id: 'q', question: 'Run it?', askedAt: 42 } as never], [], now)
    expect(card?.waitMs).toBe(-1)
  })

  it('numbers sourceless asks by their id so the surface stays distinct', () => {
    const cards = needsYouCards(
      [{ id: 'a', question: '' } as never, { id: 'b', question: '' } as never],
      [],
      now,
    )
    expect(new Set(cards.map((c) => c.question)).size).toBe(2)
  })
})

describe('oldestWaitEmptyText', () => {
  it('says unknown, none, or waiting without a clock — never a false none', () => {
    expect(oldestWaitEmptyText(0)).toBe('No agent or ask is waiting')
    expect(oldestWaitEmptyText(2)).toBe('Waiting, but no wait time reported')
  })
})

describe('noSnapshotCaption', () => {
  it('uses the alert short form only when no snapshot ever arrived', () => {
    expect(noSnapshotCaption(false, 24)).toBe('No snapshot yet')
  })
  it('names the window when snapshots exist but none fall inside it', () => {
    expect(noSnapshotCaption(true, 24)).toBe('No snapshot in the last 24\u00a0h')
  })
})

describe('oldestWaitFooter', () => {
  it('names the project the wait is in', () => {
    expect(oldestWaitFooter(null)).toBeUndefined()
    expect(oldestWaitFooter({ ms: 1, project: 'alpha' })).toBe('in alpha')
  })
})

describe('activityLegend', () => {
  const labels = (peak: number) => activityLegend(peak).map((e) => e.label)
  it('names no working entry at a peak of 0', () => expect(labels(0)).toEqual([]))
  it('samples 1 for the range and the peak for the darkest', () =>
    expect(activityLegend(5).map((e) => e.sample)).toEqual([1, 5]))
  it('names only the peak at 1', () => expect(labels(1)).toEqual(['1 agent working']))
  it('collapses the range to 1 agent at a peak of 2', () =>
    expect(labels(2)).toEqual(['1 agent working', '2 agents working']))
  it('names the range below the peak above 2', () =>
    expect(labels(5)).toEqual(['1–4 agents working', '5 agents working']))
  it('puts only the peak hour in the peak state', () => {
    expect(bandStateOf(5, 5)).toBe('peak')
    expect(bandStateOf(3, 5)).toBe('working')
  })
})
