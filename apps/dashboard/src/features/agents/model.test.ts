import { describe, expect, it } from 'bun:test'
import {
  ABANDONED_AFTER_MS,
  breakdownLine,
  formatWaitDuration,
  isAbandonedWait,
  oldestNeedsYouWait,
  sortAgentsForCards,
} from './model'
import type { AgentRow } from './model'
import type { OverviewSummary } from '../../lib/queries/agents'

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

// ── sortAgentsForCards ───────────────────────────────────────────────────────

describe('sortAgentsForCards', () => {
  it('puts needs_you first, working second, everything else after', () => {
    const rows = [
      agent({ id: 'a', state: 'done' }),
      agent({ id: 'b', state: 'working' }),
      agent({ id: 'c', state: 'needs_you' }),
      agent({ id: 'd', state: 'idle' }),
    ]
    expect(sortAgentsForCards(rows).map((r) => r.id)).toEqual(['c', 'b', 'a', 'd'])
  })

  it('is stable within the same priority bucket', () => {
    const rows = [
      agent({ id: 'a', state: 'idle' }),
      agent({ id: 'b', state: 'stale' }),
      agent({ id: 'c', state: 'done' }),
    ]
    expect(sortAgentsForCards(rows).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input array', () => {
    const rows = [agent({ id: 'a', state: 'idle' }), agent({ id: 'b', state: 'needs_you' })]
    sortAgentsForCards(rows)
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
  })
})

// ── breakdownLine ────────────────────────────────────────────────────────────

const summary = (overrides: Partial<OverviewSummary> = {}): OverviewSummary => ({
  needsYou: 0,
  working: 0,
  idle: 0,
  stale: 0,
  done: 0,
  dispatch: 0,
  ...overrides,
})

describe('breakdownLine', () => {
  it('renders the non-zero low-priority buckets', () => {
    expect(breakdownLine(summary({ idle: 3, done: 4, stale: 2 }))).toBe('3 idle · 4 done · 2 stale')
  })

  it('omits zero buckets', () => {
    expect(breakdownLine(summary({ idle: 1 }))).toBe('1 idle')
  })

  it('is empty when every bucket is zero', () => {
    expect(breakdownLine(summary())).toBe('')
  })

  it('is empty with no summary', () => {
    expect(breakdownLine(undefined)).toBe('')
  })
})
