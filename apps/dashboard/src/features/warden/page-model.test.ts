import { describe, expect, it } from 'bun:test'
import type { WardenBoardItem, WardenMetrics } from '../../lib/queries/warden'
import type { AwaitingOwnerRow } from './model'
import {
  cardFacts,
  deferredNote,
  deriveBoardColumns,
  deriveBudget,
  derivePollers,
  deriveStrip,
  deriveSummary,
  failureChip,
  formatNumber,
  formatSpan,
  oldestAgeDays,
  planActions,
  readLeaf,
  retryQuestion,
  splitReason,
} from './page-model'

const NOW = Date.parse('2026-01-01T12:00:00Z')

const item = (overrides: Partial<WardenBoardItem>): WardenBoardItem =>
  ({ event_id: 1, state: 'new', ...overrides }) as WardenBoardItem

const row = (overrides: Partial<AwaitingOwnerRow>): AwaitingOwnerRow => ({
  eventId: 1,
  repo: 'repo-a',
  title: 'Title',
  state: 'needs_decision',
  prUrl: null,
  ageDays: 2.4,
  ageLabel: '2.4 d',
  stale: false,
  reason: null,
  strikes: 0,
  revisionCount: 1,
  failureClass: null,
  redrives: 0,
  availableActions: [],
  ...overrides,
})

describe('readLeaf', () => {
  it('reads a numeric value', () => {
    expect(readLeaf({ value: 0.5, unavailable: null })).toEqual({ value: 0.5, unavailable: null })
  })

  it('keeps a real zero as zero', () => {
    expect(readLeaf({ value: 0 }).value).toBe(0)
  })

  it('pairs a null value with warden’s reason', () => {
    expect(readLeaf({ value: null, unavailable: 'window predates history' })).toEqual({
      value: null,
      unavailable: 'window predates history',
    })
  })

  it('pairs a missing metric with "not reported", never a zero', () => {
    expect(readLeaf(undefined)).toEqual({ value: null, unavailable: 'not reported' })
  })
})

describe('deriveStrip', () => {
  const metrics = {
    window_days: 7,
    verdicts_recorded_disposition: { value: 0.5, numerator: 4, denominator: 8, unavailable: null },
    verified_fixes_vs_silence: { value: 0.75, fixed: 3, quiet: 1, closed: 2, unavailable: null },
    median_needs_decision_to_decision_hours: { value: 4.695, pairs: 6, unavailable: null },
    verified_unattended_fixes_per_week: { value: 2, window_days: 7, unavailable: null },
    poller_ages: {
      value: 3,
      pollers: { loop: { age_minutes: 3, stale: false }, sweep: { age_minutes: 9, stale: false } },
      unavailable: null,
    },
    reverts_and_reopens: {
      reverts: { value: 0, unavailable: null },
      reopen_after_fixed: { value: 1, unavailable: null },
    },
  } as unknown as WardenMetrics

  it('derives every cell with its counts', () => {
    const strip = deriveStrip(metrics, undefined)
    expect(strip.verdicts).toMatchObject({ pct: 50, numerator: 4, denominator: 8 })
    expect(strip.fixes).toMatchObject({ pct: 75, fixed: 3, quiet: 1, closed: 2 })
    expect(strip.wait).toMatchObject({ hours: 4.695, pairs: 6, windowDays: 7 })
    expect(strip.unattended).toMatchObject({ fixes: 2, windowDays: 7 })
    expect(strip.reverts).toMatchObject({ reverts: 0, reopens: 1 })
  })

  it('takes the oldest poller from the per-poller ages', () => {
    expect(deriveStrip(metrics, undefined).poller.oldestMin).toBe(9)
  })

  it('reads a missing snapshot as null readings with a reason, never zeros', () => {
    const strip = deriveStrip(undefined, undefined)
    expect(strip.verdicts.pct).toBeNull()
    expect(strip.verdicts.unavailable).toBe('not reported')
    expect(strip.fixes.pct).toBeNull()
    expect(strip.wait.hours).toBeNull()
    expect(strip.unattended.fixes).toBeNull()
    expect(strip.poller.oldestMin).toBeNull()
    expect(strip.reverts.reverts).toBeNull()
    expect(strip.reverts.unavailable).toBe('not reported')
  })

  it('keeps a zero-revert reading distinct from no data', () => {
    expect(deriveStrip(metrics, undefined).reverts.unavailable).toBeNull()
  })
})

describe('derivePollers', () => {
  it('sorts oldest first and flags stale ones', () => {
    const metrics = {
      poller_ages: {
        pollers: {
          a: { age_minutes: 2, stale: false },
          b: { age_minutes: 40, stale: true, threshold_minutes: 30 },
        },
      },
    } as unknown as WardenMetrics
    const rows = derivePollers(metrics, undefined)
    expect(rows.map((r) => r.name)).toEqual(['b', 'a'])
    expect(rows[0]).toMatchObject({ stale: true, thresholdMin: 30 })
  })

  it('falls back to health.pollers', () => {
    const rows = derivePollers(undefined, {
      ok: true,
      pollers: { loop: { age_minutes: 1, ok: true } },
    })
    expect(rows).toHaveLength(1)
  })

  it('is empty with neither', () => {
    expect(derivePollers(undefined, undefined)).toEqual([])
  })
})

describe('deriveBudget', () => {
  it('warns from 90 % of the cap', () => {
    const meters = deriveBudget({ usedToday: 9, max: 10, implementToday: 2, implementMax: 5 })
    expect(meters.map((m) => m.warn)).toEqual([true, false])
  })

  it('reports null (no zero) when the budget is missing', () => {
    expect(deriveBudget(undefined).every((m) => m.used === null && m.max === null && !m.warn)).toBe(
      true,
    )
  })
})

describe('formatSpan / formatNumber', () => {
  it('picks the unit by size', () => {
    expect(formatSpan(5 * 60_000)).toBe('5 min')
    expect(formatSpan(3.2 * 3_600_000)).toBe('3.2 h')
    expect(formatSpan(72 * 3_600_000)).toBe('3 d')
  })

  it('drops a trailing .0', () => {
    expect(formatNumber(5)).toBe('5')
    expect(formatNumber(4.695)).toBe('4.7')
  })
})

describe('deriveSummary', () => {
  const base = {
    needsCount: 3,
    oldestAgeDays: 5.1,
    receivedAt: new Date(NOW - 4 * 60_000).toISOString(),
    oldestPollerMin: 4.5,
    unattendedFixes: 2,
    windowDays: 7,
    stalePoller: null,
    now: NOW,
  }

  it('states the queue and a healthy loop', () => {
    expect(deriveSummary(base)).toBe(
      '3 items need you, oldest 5.1 d. Loop healthy: poller 4.5 min old, 2 fixes in 7 d.',
    )
  })

  it('uses the singular for one item and one fix', () => {
    expect(deriveSummary({ ...base, needsCount: 1, unattendedFixes: 1 })).toBe(
      '1 item needs you, oldest 5.1 d. Loop healthy: poller 4.5 min old, 1 fix in 7 d.',
    )
  })

  it('says nothing needs you at zero', () => {
    expect(deriveSummary({ ...base, needsCount: 0, oldestAgeDays: null })).toStartWith(
      'Nothing needs you. Loop healthy',
    )
  })

  it('omits loop facts that are not reported', () => {
    expect(deriveSummary({ ...base, oldestPollerMin: null, unattendedFixes: null })).toEndWith(
      'Loop healthy.',
    )
  })

  it('switches to the stalled variant past 30 minutes', () => {
    const stalled = deriveSummary({
      ...base,
      receivedAt: new Date(NOW - 2 * 3_600_000).toISOString(),
    })
    expect(stalled).toBe('3 items need you, oldest 5.1 d. Loop stalled — snapshot 2 h old.')
  })

  it('names a stale poller as degraded', () => {
    const text = deriveSummary({
      ...base,
      stalePoller: { name: 'loop', ageMin: 41, thresholdMin: 30, stale: true },
    })
    expect(text).toContain('Loop degraded: loop is 41 min old.')
  })
})

describe('planActions', () => {
  it('puts Implement first and Dismiss second for a decision', () => {
    expect(planActions(['note', 'dismiss', 'reinvestigate', 'implement'], 'decision')).toEqual({
      primary: 'implement',
      secondary: 'dismiss',
      menu: ['reinvestigate', 'note'],
    })
  })

  it('puts Retry first and Merge second for a failure', () => {
    expect(planActions(['dismiss', 'merge', 'retry', 'note'], 'failed')).toEqual({
      primary: 'retry',
      secondary: 'merge',
      menu: ['dismiss', 'note'],
    })
  })

  it('promotes the only offered verb to primary', () => {
    expect(planActions(['dismiss'], 'decision')).toEqual({
      primary: 'dismiss',
      secondary: null,
      menu: [],
    })
  })

  it('drops verbs the dashboard does not know and handles none', () => {
    expect(planActions(['teleport'], 'decision')).toEqual({
      primary: null,
      secondary: null,
      menu: [],
    })
    expect(planActions([], 'failed').primary).toBeNull()
  })

  it('never shows more than one primary and one secondary', () => {
    const plan = planActions(
      ['implement', 'merge', 'dismiss', 'retry', 'note', 'reinvestigate'],
      'decision',
    )
    expect([plan.primary, plan.secondary].filter(Boolean)).toHaveLength(2)
    expect(plan.menu).not.toContain(plan.primary)
    expect(plan.menu).not.toContain(plan.secondary)
  })
})

describe('splitReason', () => {
  it('takes the first complete sentence as the question and the rest as evidence', () => {
    expect(splitReason('Ship the fix? It touches the loop. Tests pass.', 'x')).toEqual({
      question: 'Ship the fix?',
      rest: 'It touches the loop. Tests pass.',
    })
  })

  it('keeps a single sentence whole, with no evidence', () => {
    expect(splitReason('Ship the fix or revert', 'x')).toEqual({
      question: 'Ship the fix or revert',
      rest: null,
    })
  })

  it('never cuts a long first sentence', () => {
    const long = `${'word '.repeat(80)}end.`
    expect(splitReason(long, 'x').question).toBe(long)
  })

  it('falls back when there is no reason', () => {
    expect(splitReason(null, 'Fallback title')).toEqual({ question: 'Fallback title', rest: null })
    expect(splitReason('  ', 'F').question).toBe('F')
  })
})

describe('cardFacts', () => {
  it('leads with repo, then age, revision and re-drives when present', () => {
    expect(cardFacts(row({ redrives: 2, ageDays: 1.2 }))).toEqual([
      'repo-a',
      'waiting 1.2 d',
      'revision 1',
      '2 redrives',
    ])
  })

  it('tones a wait past two days as a warning', () => {
    expect(cardFacts(row({ ageDays: 2.4 }))[1]).toEqual({ text: 'waiting 2.4 d', tone: 'warn' })
    expect(cardFacts(row({ ageDays: 1.5 }))[1]).toBe('waiting 1.5 d')
  })

  it('omits what warden did not report', () => {
    expect(cardFacts(row({ repo: null, ageDays: null, redrives: 0 }))).toEqual(['revision 1'])
  })
})

describe('oldestAgeDays', () => {
  it('is the max age, null when none is reported', () => {
    expect(oldestAgeDays([row({ ageDays: 1 }), row({ ageDays: 6 }), row({ ageDays: null })])).toBe(
      6,
    )
    expect(oldestAgeDays([row({ ageDays: null })])).toBeNull()
    expect(oldestAgeDays([])).toBeNull()
  })
})

describe('failureChip', () => {
  it('gives the three known classes a fixed tone', () => {
    expect(failureChip('work')).toEqual({ tone: 'work', label: 'work' })
    expect(failureChip('infra')).toEqual({ tone: 'infra', label: 'infra' })
    expect(failureChip('policy')).toEqual({ tone: 'policy', label: 'policy' })
  })

  it('renders an unknown class neutral with its raw label', () => {
    expect(failureChip('quota')).toEqual({ tone: 'neutral', label: 'quota' })
  })

  it('renders nothing for null', () => {
    expect(failureChip(null)).toBeNull()
  })
})

describe('deriveBoardColumns', () => {
  const columnOf = (columns: ReturnType<typeof deriveBoardColumns>, key: string) =>
    columns.find((c) => c.key === key)?.items.map((i) => i.event_id)

  it('places each open item exactly once and keeps needs-decision and failed out', () => {
    const items = [
      item({ event_id: 1, state: 'new' }),
      item({ event_id: 2, state: 'working' }),
      item({ event_id: 3, state: 'needs_decision' }),
      item({ event_id: 4, state: 'failed' }),
      item({ event_id: 5, state: 'verifying' }),
    ]
    const columns = deriveBoardColumns({ items })
    const ids = columns.flatMap((c) => c.items.map((i) => i.event_id))
    expect(ids.toSorted()).toEqual([1, 2, 5])
    expect(columns.map((c) => c.key)).toEqual(['new', 'triaged', 'working', 'merging', 'verifying'])
  })

  it('lands an unknown state in Other and hides Other when empty', () => {
    const columns = deriveBoardColumns({ items: [item({ event_id: 9, state: 'parked' })] })
    expect(columnOf(columns, 'other')).toEqual([9])
    expect(deriveBoardColumns({ items: [] }).some((c) => c.key === 'other')).toBe(false)
  })

  it('keeps a deferred item in Working', () => {
    const columns = deriveBoardColumns({
      items: [item({ event_id: 7, state: 'working', note: 'deferred: implement budget 5/5' })],
    })
    expect(columnOf(columns, 'working')).toEqual([7])
  })

  it('leaves out an item already on a decision card by awaiting_owner id', () => {
    const columns = deriveBoardColumns({
      items: [item({ event_id: 1, state: 'working' }), item({ event_id: 2, state: 'working' })],
      awaiting_owner: [{ event_id: 2, state: 'working' }],
    } as never)
    expect(columnOf(columns, 'working')).toEqual([1])
  })

  it('is empty-safe', () => {
    expect(deriveBoardColumns(undefined).every((c) => c.items.length === 0)).toBe(true)
  })
})

describe('deferredNote', () => {
  it('strips the prefix for a deferred item only', () => {
    expect(deferredNote(item({ state: 'working', note: 'deferred: implement budget 5/5' }))).toBe(
      'implement budget 5/5',
    )
    expect(deferredNote(item({ state: 'working', note: 'investigating' }))).toBeNull()
  })
})

describe('retryQuestion', () => {
  it('asks to retry the title', () => {
    expect(retryQuestion('Push to the mini')).toBe('Retry Push to the mini?')
  })

  it('does not stack punctuation', () => {
    expect(retryQuestion('fails mid-read.')).toBe('Retry fails mid-read?')
    expect(retryQuestion('is it flaky?')).toBe('Retry is it flaky?')
  })
})
