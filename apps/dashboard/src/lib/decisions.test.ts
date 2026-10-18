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
    expect(w?.facts[1]).toBe('waiting 1d 0h')
    const [a] = deriveDecisions({ warden: null, agents: agents({ agents: [agent()] }), now: NOW })
    expect(a?.facts).toEqual(['agent · {project}', 'waiting 2h 0m'])
  })

  it('lists a failed item once even when it is both awaiting and on the board', () => {
    const list = deriveDecisions({
      warden: warden({
        awaiting_owner: [awaiting({ event_id: 3, state: 'failed', availableActions: ['retry'] })],
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
    expect(list.find((d) => d.id === 'warden-3')?.headline).toBe('Retry failed {repo} run?')
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

  it('builds a short question, at most three facts and one evidence line', () => {
    const prose = `Should warden ${'merge the change and then redeploy the loop '.repeat(3)}now?`
    const [d] = deriveDecisions({
      warden: warden({ awaiting_owner: [awaiting({ reason: `${prose} Tests pass.` })] }),
      agents: null,
      now: NOW,
    })
    expect(d?.headline).toBe('Decide on {repo} item?')
    expect(d?.entity).toBe('{title}')
    expect(d?.facts.length).toBeLessThanOrEqual(3)
    expect(d?.evidenceLine).toBe('Tests pass.')
    expect(d?.detail).toBe(`${prose} Tests pass.`)
  })

  it('names the item when the question does not, and strips emoji shortcodes', () => {
    const [d] = deriveDecisions({
      warden: warden({
        awaiting_owner: [
          awaiting({ title: ':warning: {title}', reason: 'Ship {thing}? Why: tests.' }),
        ],
      }),
      agents: null,
      now: NOW,
    })
    expect(d?.entity).toBe('{title}')
    expect(d?.evidenceLine).toBe('Why: tests.')
    expect(d?.detail).toBeNull()
  })

  it('strips shortcodes from the repo in the facts line', () => {
    const [d] = deriveDecisions({
      warden: warden({ awaiting_owner: [awaiting({ repo: ':warning: service' })] }),
      agents: null,
      now: NOW,
    })
    expect(d?.facts[0]).toBe('warden · service')
  })

  it('asks a plain question for a failed item and keeps its raw title as the entity', () => {
    const [d] = deriveDecisions({
      warden: warden({
        awaiting_owner: [awaiting({ state: 'failed', availableActions: ['retry'] })],
      }),
      agents: null,
      now: NOW,
    })
    expect(d?.headline).toBe('Retry failed {repo} run?')
    expect(d?.entity).toBe('{title}')
  })

  it('uses the question warden authored, verbatim', () => {
    const [d] = deriveDecisions({
      warden: warden({ awaiting_owner: [awaiting({ question: 'Merge the {repo} fix?' })] }),
      agents: null,
      now: NOW,
    })
    expect(d?.headline).toBe('Merge the {repo} fix?')
  })

  it('never glues a verb onto an agent title', () => {
    const title = 'word '.repeat(60)
    const [d] = deriveDecisions({
      warden: null,
      agents: agents({ agents: [agent({ title })] }),
      now: NOW,
    })
    expect(d?.headline).toBe('Unblock {project} agent?')
    expect(d?.detail).toContain(title.trim())
  })

  it('reads a producer question that is not a string as none, on every path', () => {
    for (const junk of [7, {}, ['Merge?'], '   ']) {
      const list = deriveDecisions({
        warden: warden({ awaiting_owner: [awaiting({ question: junk })] }),
        agents: agents({ agents: [agent({ question: junk })] }),
        now: NOW,
      })
      expect(list).toHaveLength(2)
      for (const d of list) expect(d.headline.endsWith('?')).toBe(true)
    }
  })

  it('does not throw on a human-queue ask whose question is not a string', () => {
    const list = deriveDecisions({
      warden: null,
      agents: agents({ humanQueue: [{ id: 'q', question: 5 }] }),
      now: NOW,
    })
    expect(list[0]?.headline).toBe('Answer this request?')
  })

  it('uses the question an agent authored, verbatim', () => {
    const [d] = deriveDecisions({
      warden: null,
      agents: agents({ agents: [agent({ question: 'Pick a branch?' })] }),
      now: NOW,
    })
    expect(d?.headline).toBe('Pick a branch?')
  })

  it('keeps the item identity on a queue ask with a short question', () => {
    const [d] = deriveDecisions({
      warden: null,
      agents: agents({
        humanQueue: [
          { id: 'q1', question: 'Proceed?', title: '{task}', askedAt: new Date(NOW).toISOString() },
        ],
      }),
      now: NOW,
    })
    expect(d?.headline).toBe('Proceed?')
    expect(d?.entity).toBe('{task}')
  })

  it('shows a short title even when the question contains it', () => {
    const [d] = deriveDecisions({
      warden: warden({ awaiting_owner: [awaiting({ title: 'Fix', reason: 'Should we fix it?' })] }),
      agents: null,
      now: NOW,
    })
    expect(d?.entity).toBe('Fix')
  })

  it('leads an agent decision with its blocker as the evidence line', () => {
    const [d] = deriveDecisions({
      warden: null,
      agents: agents({ agents: [agent({ blocker: 'Waiting on {thing}' })] }),
      now: NOW,
    })
    expect(d?.evidenceLine).toBe('Waiting on {thing}')
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
    expect(factsAt(AWAITING_OWNER_STALE_DAYS)).toEqual({
      text: 'waiting 3d 0h · stale at 3 d',
      tone: 'warn',
    })
    expect(factsAt(AWAITING_OWNER_STALE_DAYS - 0.1)).toBe('waiting 2d 21h')
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

describe('deriveDecisions: one entry per item', () => {
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
