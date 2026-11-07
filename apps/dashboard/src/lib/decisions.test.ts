import { describe, expect, it } from 'bun:test'
import { deriveDecisions } from './decisions'
import type { OverviewSnapshot } from './queries/agents'

const NOW = Date.parse('2026-01-15T12:00:00Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR

const agents = (snapshot: Record<string, unknown>) => snapshot as unknown as OverviewSnapshot

const agent = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  state: 'needs_you',
  project: '{project}',
  title: 'Approve {action}',
  lastActivityAt: NOW - 2 * HOUR,
  ...over,
})

describe('deriveDecisions', () => {
  it('is empty with no source', () => {
    expect(deriveDecisions({ agents: undefined, now: NOW })).toEqual([])
  })

  it('merges queue and agent items sorted by age, oldest first', () => {
    const list = deriveDecisions({
      agents: agents({
        humanQueue: [
          { id: 'q1', question: 'Run {cmd}?', askedAt: new Date(NOW - 3 * DAY).toISOString() },
        ],
        agents: [agent()],
      }),
      now: NOW,
    })
    expect(list.map((d) => d.id)).toEqual(['queue-q1', 'agent-a1'])
    expect(list.map((d) => d.source)).toEqual(['queue', 'agent'])
  })

  it('starts each facts line with its source and names the age', () => {
    const [a] = deriveDecisions({ agents: agents({ agents: [agent()] }), now: NOW })
    expect(a?.facts).toEqual(['agent · {project}', 'waiting 2 h'])
    const [q] = deriveDecisions({
      agents: agents({
        humanQueue: [
          {
            id: 'q1',
            question: 'Run it?',
            host: '{host}',
            askedAt: new Date(NOW - HOUR).toISOString(),
          },
        ],
      }),
      now: NOW,
    })
    expect(q?.facts[0]).toBe('queue · {host}')
  })

  it('never glues a verb onto an agent title', () => {
    const title = 'word '.repeat(60)
    const [d] = deriveDecisions({ agents: agents({ agents: [agent({ title })] }), now: NOW })
    expect(d?.headline).toBe(`Decide on agent: ${'word '.repeat(12).trim()}?`)
    expect(d?.detail).toContain(title.trim())
  })

  it('reads a producer question that is not a string as none, on every path', () => {
    for (const junk of [7, {}, ['Merge?'], '   ']) {
      const list = deriveDecisions({
        agents: agents({
          humanQueue: [{ id: 'q', question: junk }],
          agents: [agent({ question: junk })],
        }),
        now: NOW,
      })
      expect(list).toHaveLength(2)
      for (const d of list) expect(d.headline.endsWith('?')).toBe(true)
    }
  })

  it('strips shortcodes from a human-queue ask and reads a blank one as absent', () => {
    const [d] = deriveDecisions({
      agents: agents({ humanQueue: [{ id: 'q', question: ':rocket: Deploy now? Why not.' }] }),
      now: NOW,
    })
    expect(d?.headline).toBe('Deploy now?')
    const [blank] = deriveDecisions({
      agents: agents({ humanQueue: [{ id: 'q', question: '  \n ' }] }),
      now: NOW,
    })
    expect(blank?.headline).toBe('Decide on this request?')
  })

  it('does not throw on a human-queue ask whose question is not a string', () => {
    const list = deriveDecisions({
      agents: agents({ humanQueue: [{ id: 'q', question: 5 }] }),
      now: NOW,
    })
    expect(list[0]?.headline).toBe('Decide on this request?')
  })

  it('uses the question an agent authored, verbatim', () => {
    const [d] = deriveDecisions({
      agents: agents({ agents: [agent({ question: 'Pick a branch?' })] }),
      now: NOW,
    })
    expect(d?.headline).toBe('Pick a branch?')
  })

  it('keeps the item identity on a queue ask with a short question', () => {
    const [d] = deriveDecisions({
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

  it('leads an agent decision with its blocker as the evidence line', () => {
    const [d] = deriveDecisions({
      agents: agents({ agents: [agent({ blocker: 'Waiting on {thing}' })] }),
      now: NOW,
    })
    expect(d?.evidenceLine).toBe('Waiting on {thing}')
  })

  it('ignores agents that are not waiting and sorts an unclocked item last', () => {
    const list = deriveDecisions({
      agents: agents({
        agents: [
          agent({ id: 'a2', state: 'working' }),
          agent({ id: 'a3', lastActivityAt: null }),
          agent({ id: 'a4' }),
        ],
      }),
      now: NOW,
    })
    expect(list.map((d) => d.id)).toEqual(['agent-a4', 'agent-a3'])
    expect(list.map((d) => d.ageMs)).toEqual([2 * HOUR, null])
  })

  it('marks an agent wait past seven days abandoned', () => {
    const [d] = deriveDecisions({
      agents: agents({ agents: [agent({ lastActivityAt: NOW - 8 * DAY })] }),
      now: NOW,
    })
    expect(d?.abandoned).toBe(true)
  })
})

describe('deriveDecisions: questions that tell items apart', () => {
  it('counts collisions across sources of one surface', () => {
    const list = deriveDecisions({
      agents: agents({
        humanQueue: [
          { id: 'q1', title: 'Rotate keys', askedAt: new Date(NOW - 3 * DAY).toISOString() },
          { id: 'q2', title: 'Renew domain', askedAt: new Date(NOW - 2 * DAY).toISOString() },
        ],
        agents: [agent({ id: 'a1', title: 'Approve {action}' })],
      }),
      now: NOW,
    })
    expect(list.map((d) => d.headline)).toEqual([
      'Decide on request: Rotate keys?',
      'Decide on request: Renew domain?',
      'Decide on agent: Approve {action}?',
    ])
  })
})

describe('deriveDecisions: evidence', () => {
  it('gives an agent with a blank blocker its next evidence source, or states there is none', () => {
    const [withStanding, bare] = deriveDecisions({
      agents: agents({
        agents: [
          agent({
            id: 'a',
            blocker: '',
            standing: 'Waiting on {thing}.',
            lastActivityAt: NOW - 2 * HOUR,
          }),
          agent({ id: 'b', blocker: '   ', lastActivityAt: NOW - HOUR }),
        ],
      }),
      now: NOW,
    })
    expect(withStanding?.evidenceLine).toBe('Waiting on {thing}.')
    expect(withStanding?.evidence).toBe('Waiting on {thing}.')
    expect(bare?.evidenceLine).toBe('No blocker reported.')
    expect(bare?.evidence).toBeNull()
  })
})

describe('deriveDecisions: loose wire values', () => {
  it('reads non-string cmd, host, title and project as absent, never throwing', () => {
    for (const junk of [42, {}, ['x'], true]) {
      const list = deriveDecisions({
        agents: agents({
          humanQueue: [{ id: 'q', question: 'Run it?', cmd: junk, host: junk, title: junk }],
          agents: [agent({ title: junk, project: junk, blocker: junk })],
        }),
        now: NOW,
      })
      expect(list).toHaveLength(2)
      expect(list.every((d) => d.headline.endsWith('?') && d.evidence === null)).toBe(true)
    }
  })

  it('tells sourceless asks apart by id', () => {
    const list = deriveDecisions({
      agents: agents({
        humanQueue: [
          { id: 'a', question: '' },
          { id: 'b', question: '' },
        ],
      }),
      now: NOW,
    })
    expect(list).toHaveLength(2)
    expect(new Set(list.map((d) => d.headline)).size).toBe(2)
  })

  it('reads a non-number agent clock and a non-string ask time as no age', () => {
    const list = deriveDecisions({
      agents: agents({
        humanQueue: [{ id: 'q', question: 'Run it?', askedAt: 'yesterday' }],
        agents: [agent({ lastActivityAt: 'yesterday' })],
      }),
      now: NOW,
    })
    expect(list.map((d) => d.ageMs)).toEqual([null, null])
    expect(JSON.stringify(list)).not.toContain('NaN')
  })
})
