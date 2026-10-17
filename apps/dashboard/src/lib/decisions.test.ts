import { describe, expect, it } from 'bun:test'
import { deriveDecisions } from './decisions'
import { AWAITING_OWNER_STALE_DAYS } from '../features/warden/model'
import type { OverviewSnapshot } from './queries/agents'
import type { WardenRaw } from './queries/warden'

const NOW = Date.parse('2026-01-15T12:00:00Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR

const warden = (board: Record<string, unknown>) => ({ board }) as unknown as WardenRaw
const agents = (snapshot: Record<string, unknown>) => snapshot as unknown as OverviewSnapshot

const awaiting = (over: Record<string, unknown> = {}) => ({
  event_id: 1,
  repo: '{repo}',
  title: '{title}',
  state: 'needs_decision',
  pr_url: null,
  age_days: 1,
  reason: 'Ship {thing}? More detail follows.',
  revision_count: 0,
  failure_class: null,
  ...over,
})

const agent = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  state: 'needs_you',
  project: '{project}',
  title: 'Approve {action}',
  lastActivityAt: NOW - 2 * HOUR,
  ...over,
})

describe('deriveDecisions', () => {
  it('is empty with no sources', () => {
    expect(deriveDecisions({ warden: null, agents: undefined, now: NOW })).toEqual([])
  })

  it('merges warden, queue and agent items sorted by age, oldest first', () => {
    const list = deriveDecisions({
      warden: warden({ awaiting_owner: [awaiting({ event_id: 7, age_days: 1 })] }),
      agents: agents({
        humanQueue: [
          { id: 'q1', question: 'Run {cmd}?', askedAt: new Date(NOW - 3 * DAY).toISOString() },
        ],
        agents: [agent()],
      }),
      now: NOW,
    })
    expect(list.map((d) => d.id)).toEqual(['queue-q1', 'warden-7', 'agent-a1'])
    expect(list.map((d) => d.source)).toEqual(['queue', 'warden', 'agent'])
  })

  it('starts each facts line with its source and names the age', () => {
    const [w] = deriveDecisions({
      warden: warden({ awaiting_owner: [awaiting()] }),
      agents: null,
      now: NOW,
    })
    expect(w?.facts[0]).toBe('warden · {repo}')
    expect(w?.facts[1]).toBe('waiting 1.0 d')
    const [a] = deriveDecisions({ warden: null, agents: agents({ agents: [agent()] }), now: NOW })
    expect(a?.facts).toEqual(['agent · {project}', 'waiting 2h 0m'])
  })

  it('lists a failed item once even when it is both awaiting and on the board', () => {
    const list = deriveDecisions({
      warden: warden({
        awaiting_owner: [awaiting({ event_id: 3, state: 'failed' })],
        items: [
          { event_id: 3, state: 'failed', repo: '{repo}', title: '{title}' },
          {
            event_id: 4,
            state: 'failed',
            repo: '{repo}',
            title: '{other}',
            updated_at: new Date(NOW - DAY).toISOString(),
          },
          { event_id: 5, state: 'working', repo: '{repo}', title: '{busy}' },
        ],
      }),
      agents: null,
      now: NOW,
    })
    expect(list.map((d) => d.id).toSorted()).toEqual(['warden-3', 'warden-4'])
    expect(list.find((d) => d.id === 'warden-3')?.headline).toBe('Retry {title}?')
    expect(list.find((d) => d.id === 'warden-4')?.ageMs).toBe(DAY)
  })

  it('takes the first sentence of a decision as the headline', () => {
    const [d] = deriveDecisions({
      warden: warden({ awaiting_owner: [awaiting()] }),
      agents: null,
      now: NOW,
    })
    expect(d?.headline).toBe('Ship {thing}?')
  })

  it('ignores agents that are not waiting and sorts an unclocked item last', () => {
    const list = deriveDecisions({
      warden: warden({ awaiting_owner: [awaiting({ age_days: null })] }),
      agents: agents({
        agents: [agent({ id: 'a2', state: 'working' }), agent({ id: 'a3', lastActivityAt: null })],
      }),
      now: NOW,
    })
    expect(list.map((d) => d.id)).toEqual(['warden-1', 'agent-a3'])
    expect(list.every((d) => d.id !== 'agent-a2')).toBe(true)
    expect(list.map((d) => d.ageMs)).toEqual([null, null])
  })

  it('marks an agent wait past seven days abandoned', () => {
    const [d] = deriveDecisions({
      warden: null,
      agents: agents({ agents: [agent({ lastActivityAt: NOW - 8 * DAY })] }),
      now: NOW,
    })
    expect(d?.abandoned).toBe(true)
  })
})

const factsAt = (days: number) =>
  deriveDecisions({
    warden: warden({ awaiting_owner: [awaiting({ age_days: days })] }),
    agents: null,
    now: NOW,
  })[0]?.facts[1]

describe('deriveDecisions: one clock and one threshold', () => {
  it('warns on an age from Warden’s own stale threshold, inclusive', () => {
    expect(factsAt(AWAITING_OWNER_STALE_DAYS)).toEqual({ text: 'waiting 3.0 d', tone: 'warn' })
    expect(factsAt(AWAITING_OWNER_STALE_DAYS - 0.1)).toBe('waiting 2.9 d')
  })

  it('adds the time since the push to a Warden age so it sorts on the same clock as the rest', () => {
    const received = new Date(NOW - 2 * HOUR).toISOString()
    const list = deriveDecisions({
      warden: warden({ awaiting_owner: [awaiting({ event_id: 1, age_days: 1 })] }),
      agents: agents({ agents: [agent({ lastActivityAt: NOW - DAY - HOUR })] }),
      wardenReceivedAt: received,
      now: NOW,
    })
    expect(list.find((d) => d.id === 'warden-1')?.ageMs).toBe(DAY + 2 * HOUR)
    // 1 d + 2 h outranks the agent's 1 d + 1 h; without the push age the two would sort the other way.
    expect(list.map((d) => d.source)).toEqual(['warden', 'agent'])
  })
})

describe('deriveDecisions: no double counting', () => {
  it('drops the needs_you agent that raised a queue ask, keeping the ask', () => {
    const list = deriveDecisions({
      warden: null,
      agents: agents({
        humanQueue: [
          {
            id: 'q1',
            question: 'Run {cmd}?',
            askedAt: new Date(NOW - HOUR).toISOString(),
            agentId: 'a1',
          },
        ],
        agents: [agent({ id: 'a1' }), agent({ id: 'a2' })],
      }),
      now: NOW,
    })
    expect(list.map((d) => d.id).toSorted()).toEqual(['agent-a2', 'queue-q1'])
  })

  it('keeps the count, the cards and Show n more in step with an item in both awaiting_owner and failed', () => {
    const list = deriveDecisions({
      warden: warden({
        awaiting_owner: [
          awaiting({ event_id: 1 }),
          awaiting({ event_id: 2, state: 'failed' }),
          awaiting({ event_id: 3 }),
        ],
        items: [
          { event_id: 2, state: 'failed' },
          { event_id: 4, state: 'failed' },
        ],
      }),
      agents: agents({ agents: [agent()] }),
      now: NOW,
    })
    expect(list).toHaveLength(5)
    const cards = 3
    const rest = list.slice(cards)
    expect(cards + rest.length).toBe(list.length)
    expect(new Set(list.map((d) => d.id)).size).toBe(list.length)
  })
})
