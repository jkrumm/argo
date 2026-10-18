import { describe, expect, it } from 'bun:test'
import type { WardenBoardItem, WardenBudget, WardenMetrics } from '../../lib/queries/warden'
import type { AwaitingOwnerRow } from './model'
import {
  cardFacts,
  deferredNote,
  deriveBoardColumns,
  deriveBudget,
  derivePollers,
  deriveStrip,
  type StripModel,
  deriveSummary,
  formatNumber,
  formatSpan,
  oldestAgeDays,
  openCount,
  originKind,
  planActions,
  readLeaf,
  retryQuestion,
  pollerStaleLabel,
  deferralOf,
  splitReason,
  cardCategory,
  sentenceCase,
  deriveBudgetFooter,
  recentTransitions,
  dispatchOf,
  historySummary,
  splitBoardColumns,
  revertsFooter,
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
  const metrics: WardenMetrics = {
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
  }

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
    expect(strip.reverts.revertsUnavailable).toBe('not reported')
    expect(strip.reverts.reopensUnavailable).toBe('not reported')
  })

  it('keeps a zero-revert reading distinct from no data', () => {
    const { reverts } = deriveStrip(metrics, undefined)
    expect(reverts.revertsUnavailable).toBeNull()
    expect(reverts.reverts).toBe(0)
  })
})

describe('deriveStrip edge cases', () => {
  it('carries reverts and reopens reasons independently', () => {
    const metrics: WardenMetrics = {
      reverts_and_reopens: {
        reverts: { value: null, unavailable: 'no git history' },
        reopen_after_fixed: { value: 2, unavailable: null },
      },
    }
    const { reverts } = deriveStrip(metrics, undefined)
    expect(reverts).toMatchObject({
      reverts: null,
      revertsUnavailable: 'no git history',
      reopens: 2,
      reopensUnavailable: null,
    })
  })

  it('shows no headline share when neither fixed nor quiet is reported', () => {
    const metrics: WardenMetrics = {
      verified_fixes_vs_silence: { value: 0.6, closed: 4, unavailable: null },
    }
    const { fixes } = deriveStrip(metrics, undefined)
    expect(fixes.pct).toBeNull()
    expect(fixes.unavailable).toBe('counts not reported')
  })

  it('marks the oldest poller stale against its own threshold', () => {
    const metrics: WardenMetrics = {
      poller_ages: { pollers: { slow: { age_minutes: 12, threshold_minutes: 10 } } },
    }
    expect(deriveStrip(metrics, undefined).poller).toMatchObject({ stale: true, thresholdMin: 10 })
  })

  it('falls back to the 30 minute scale when a poller reports no threshold', () => {
    const metrics: WardenMetrics = {
      poller_ages: { pollers: { loop: { age_minutes: 31 }, fine: { age_minutes: 5 } } },
    }
    const pollers = derivePollers(metrics, undefined)
    expect(pollers.map((p) => p.stale)).toEqual([true, false])
  })
})

describe('derivePollers', () => {
  it('sorts oldest first and flags stale ones', () => {
    const metrics: WardenMetrics = {
      poller_ages: {
        pollers: {
          a: { age_minutes: 2, stale: false },
          b: { age_minutes: 40, stale: true, threshold_minutes: 30 },
        },
      },
    }
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
    dispatch: { used: 4, max: 10 },
    now: NOW,
  }

  it('states the queue as the sentence and the loop numbers as facts', () => {
    expect(deriveSummary(base)).toEqual({
      text: '3 items need you, oldest 5.1 d. Loop healthy.',
      facts: ['poller 4.5 min old', '2 fixes in 7 d', 'budget 4 of 10'],
      status: 'ok',
    })
  })

  it('uses the singular for one item and one fix', () => {
    const summary = deriveSummary({ ...base, needsCount: 1, unattendedFixes: 1 })
    expect(summary.text).toBe('1 item needs you, oldest 5.1 d. Loop healthy.')
    expect(summary.facts).toContain('1 fix in 7 d')
  })

  it('says nothing needs you at zero', () => {
    expect(
      deriveSummary({ ...base, needsCount: 0, oldestAgeDays: null }).text.startsWith(
        'Nothing needs you. Loop healthy',
      ),
    ).toBe(true)
  })

  it('omits facts that are not reported', () => {
    const summary = deriveSummary({
      ...base,
      oldestPollerMin: null,
      unattendedFixes: null,
      dispatch: null,
    })
    expect(summary.facts).toEqual([])
  })

  it('switches to the loud stalled variant past 30 minutes', () => {
    const stalled = deriveSummary({
      ...base,
      receivedAt: new Date(NOW - 2 * 3_600_000).toISOString(),
    })
    expect(stalled.text).toBe('3 items need you, oldest 5.1 d. Loop stalled — snapshot 2 h old.')
    expect(stalled.status).toBe('stalled')
  })

  it('reads a missing snapshot as stalled', () => {
    expect(deriveSummary({ ...base, receivedAt: null })).toMatchObject({ status: 'stalled' })
  })

  it('names a stale poller as degraded', () => {
    const summary = deriveSummary({
      ...base,
      stalePoller: { name: 'loop', ageMin: 41, thresholdMin: 30, stale: true },
    })
    expect(summary.status).toBe('degraded')
    expect(summary.text).toContain('Loop degraded: loop is 41 min old.')
    expect(summary.facts.some((fact) => fact.startsWith('poller'))).toBe(false)
  })
})

describe('dispatchOf', () => {
  it('needs both used and max', () => {
    expect(
      dispatchOf({ usedToday: 4, max: 10 } satisfies Partial<WardenBudget> as WardenBudget),
    ).toEqual({ used: 4, max: 10 })
    expect(dispatchOf({ usedToday: 4 } satisfies Partial<WardenBudget> as WardenBudget)).toBeNull()
    expect(dispatchOf(undefined)).toBeNull()
  })
})

describe('historySummary', () => {
  it('keeps the latest line and counts the earlier ones', () => {
    const lines = [
      { from: null, to: 'new', at: null },
      { from: 'new', to: 'working', at: null },
      { from: 'working', to: 'needs_decision', at: null },
    ]
    expect(historySummary(lines)).toEqual({ latest: lines[2], earlier: 2 })
    expect(historySummary([])).toBeNull()
  })

  it('counts earlier changes from the real total, not the shown lines', () => {
    const shown = [
      { from: 'a', to: 'b', at: null },
      { from: 'b', to: 'c', at: null },
      { from: 'c', to: 'd', at: null },
    ]
    expect(historySummary(shown, 7)?.earlier).toBe(6)
  })

  it('recentTransitions carries the full transition count', () => {
    const timeline = {
      transitions: Array.from({ length: 5 }, (_, i) => ({
        from_state: `s${i}`,
        to_state: `s${i + 1}`,
      })),
    }
    const history = recentTransitions(timeline)
    expect(history).toHaveLength(3)
    expect(history.total).toBe(5)
    expect(historySummary(history, history.total)?.earlier).toBe(4)
  })
})

describe('splitBoardColumns', () => {
  it('separates populated columns from the labels of empty ones', () => {
    const col = (key: 'new' | 'working', label: string, n: number) => ({
      key,
      label,
      items: Array.from({ length: n }, (_, i) => item({ event_id: i })),
    })
    const { populated, emptyLabels } = splitBoardColumns([
      col('new', 'New', 0),
      col('working', 'Working', 2),
    ])
    expect(populated.map((c) => c.key)).toEqual(['working'])
    expect(emptyLabels).toEqual(['New'])
  })
})

describe('revertsFooter', () => {
  const nd = (reason: string) => `no data: ${reason}`
  const strip = (reverts: number | null, reopens: number | null) =>
    ({
      reverts,
      revertsUnavailable: reverts === null ? 'x' : null,
      reopens,
      reopensUnavailable: reopens === null ? 'y' : null,
      windowDays: 7,
    }) satisfies Partial<StripModel['reverts']> as StripModel['reverts']
  it('defines a revert in plain words next to the reopen count', () => {
    expect(revertsFooter(strip(0, 1), nd)).toBe(
      'revert = a merged fix that was undone · 1 reopened after fixed · last\u00a07\u00a0d',
    )
  })
  it('reports missing readings as no data', () => {
    expect(revertsFooter(strip(null, null), nd)).toBe('reverts no data: x · reopens no data: y')
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
      tag: null,
      question: 'Ship the fix?',
      rest: 'It touches the loop. Tests pass.',
    })
  })

  it('keeps a single sentence whole, with no evidence', () => {
    expect(splitReason('Ship the fix or revert', 'x')).toEqual({
      tag: null,
      question: 'Ship the fix or revert',
      rest: null,
    })
  })

  it('never cuts a long first sentence', () => {
    const long = `${'word '.repeat(80)}end.`
    expect(splitReason(long, 'x').question).toBe(long)
  })

  it('falls back when there is no reason', () => {
    expect(splitReason(null, 'Fallback title')).toEqual({
      tag: null,
      question: 'Fallback title',
      rest: null,
    })
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

describe('deriveBoardColumns', () => {
  const none: ReadonlySet<number> = new Set()
  const columnOf = (columns: ReturnType<typeof deriveBoardColumns>, key: string) =>
    columns.find((c) => c.key === key)?.items.map((i) => i.event_id)

  it('places each open item exactly once and leaves claimed queue items to their cards', () => {
    const items = [
      item({ event_id: 1, state: 'new' }),
      item({ event_id: 2, state: 'working' }),
      item({ event_id: 3, state: 'needs_decision' }),
      item({ event_id: 4, state: 'failed' }),
      item({ event_id: 5, state: 'verifying' }),
    ]
    const columns = deriveBoardColumns({ items }, new Set([3, 4]))
    const ids = columns.flatMap((c) => c.items.map((i) => i.event_id))
    expect(ids.toSorted()).toEqual([1, 2, 5])
    expect(columns.map((c) => c.key)).toEqual(['new', 'triaged', 'working', 'merging', 'verifying'])
  })

  it('routes an unclaimed needs_decision or failed item to Other with its raw state', () => {
    const items = [
      item({ event_id: 3, state: 'needs_decision' }),
      item({ event_id: 4, state: 'failed' }),
    ]
    const columns = deriveBoardColumns({ items }, none)
    expect(columnOf(columns, 'other')).toEqual([3, 4])
    expect(columns.find((c) => c.key === 'other')?.items.map((i) => i.state)).toEqual([
      'needs_decision',
      'failed',
    ])
  })

  it('keeps terminal states off the board and out of the open count', () => {
    const items = [
      item({ event_id: 1, state: 'fixed' }),
      item({ event_id: 2, state: 'quiet' }),
      item({ event_id: 3, state: 'closed' }),
      item({ event_id: 4, state: 'working' }),
    ]
    const columns = deriveBoardColumns({ items }, none)
    expect(openCount(columns)).toBe(1)
    expect(columns.some((c) => c.key === 'other')).toBe(false)
  })

  it('lands an unknown state in Other and hides Other when empty', () => {
    const columns = deriveBoardColumns({ items: [item({ event_id: 9, state: 'parked' })] }, none)
    expect(columnOf(columns, 'other')).toEqual([9])
    expect(deriveBoardColumns({ items: [] }, none).some((c) => c.key === 'other')).toBe(false)
  })

  it('treats the literal state "other" as unknown, never as a column of its own', () => {
    const columns = deriveBoardColumns({ items: [item({ event_id: 1, state: 'other' })] }, none)
    expect(columnOf(columns, 'other')).toEqual([1])
  })

  it('keeps a deferred item in Working', () => {
    const columns = deriveBoardColumns(
      { items: [item({ event_id: 7, state: 'working', note: 'deferred: implement budget 5/5' })] },
      none,
    )
    expect(columnOf(columns, 'working')).toEqual([7])
  })

  it('leaves out only the ids a card claimed', () => {
    const items = [item({ event_id: 1, state: 'working' }), item({ event_id: 2, state: 'working' })]
    expect(columnOf(deriveBoardColumns({ items }, new Set([2])), 'working')).toEqual([1])
  })

  it('is empty-safe', () => {
    expect(deriveBoardColumns(undefined, none).every((c) => c.items.length === 0)).toBe(true)
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

describe('leading tag', () => {
  it('lifts a leading [tag] out of the question', () => {
    expect(splitReason('[blocker] Deploy now? It touches CI.', 'x')).toEqual({
      tag: 'blocker',
      question: 'Deploy now?',
      rest: 'It touches CI.',
    })
  })

  it('keeps a bracket that is not leading', () => {
    expect(splitReason('Deploy [now]?', 'x')).toMatchObject({
      tag: null,
      question: 'Deploy [now]?',
    })
  })

  it('falls back when the tag is all there is', () => {
    expect(splitReason('[no category]', 'Title')).toEqual({
      tag: 'no category',
      question: 'Title',
      rest: null,
    })
  })
})

describe('prototype-key safety', () => {
  it('treats Object.prototype names as unknown origins', () => {
    expect(originKind('constructor')).toBeNull()
    expect(originKind('toString')).toBeNull()
    expect(originKind('github_issue')).toBe('github_issue')
    expect(originKind(null)).toBeNull()
  })

  it('does not take Object.prototype names as action verbs', () => {
    expect(planActions(['constructor', 'implement'], 'decision').primary).toBe('implement')
  })
})

describe('deriveBudgetFooter', () => {
  it('collapses to one line when warden reports no budget', () => {
    expect(deriveBudgetFooter(undefined)).toEqual({ kind: 'not-reported' })
    expect(deriveBudgetFooter({})).toEqual({ kind: 'not-reported' })
  })

  it('keeps both meters when a budget is present', () => {
    const footer = deriveBudgetFooter({ usedToday: 2, max: 10, implementToday: 1, implementMax: 5 })
    expect(footer.kind).toBe('meters')
    if (footer.kind === 'meters') expect(footer.meters).toHaveLength(2)
  })

  it('still shows meters when only one budget is reported', () => {
    expect(deriveBudgetFooter({ usedToday: 2, max: 10 }).kind).toBe('meters')
  })
})

describe('recentTransitions', () => {
  const timeline = {
    transitions: [
      { to_state: 'new', synthetic: true, at: '2026-01-01T00:00:00Z' },
      { from_state: 'new', to_state: 'triaged', at: '2026-01-01T01:00:00Z' },
      { from_state: 'triaged', to_state: 'working', at: '2026-01-01T02:00:00Z' },
      { from_state: 'working', to_state: 'needs_decision', at: '2026-01-01T03:00:00Z' },
    ],
  }

  it('returns the last few state changes, oldest first', () => {
    expect(recentTransitions(timeline, 3).map((t) => t.to)).toEqual([
      'triaged',
      'working',
      'needs_decision',
    ])
  })

  it('reads a created row as — → state', () => {
    expect(recentTransitions(timeline, 4)[0]).toMatchObject({ from: null, to: 'new' })
  })

  it('is empty for missing or malformed timelines', () => {
    expect(recentTransitions(undefined)).toEqual([])
    expect(recentTransitions({ transitions: 'x' })).toEqual([])
    expect(recentTransitions({ transitions: [{ from_state: 'a' }] })).toEqual([])
  })
})

describe('pollerStaleLabel', () => {
  it('names the poller’s own threshold', () => {
    expect(pollerStaleLabel({ name: 'a', ageMin: 12, thresholdMin: 10, stale: true })).toBe(
      'stale at 10 min',
    )
  })

  it('falls back to the 30 minute scale without a threshold', () => {
    expect(pollerStaleLabel({ name: 'a', ageMin: 40, thresholdMin: null, stale: true })).toBe(
      'stale at 30 min',
    )
  })

  it('is null for a fresh poller, even past the scale end', () => {
    expect(pollerStaleLabel({ name: 'a', ageMin: 45, thresholdMin: 90, stale: false })).toBeNull()
  })
})

describe('deferralOf', () => {
  it('flags a deferred item even when its note carries no detail', () => {
    expect(deferralOf(item({ state: 'working', note: 'deferred:' }))).toEqual({
      deferred: true,
      detail: null,
    })
  })

  it('supplies the detail when there is one', () => {
    expect(deferralOf(item({ state: 'working', note: 'deferred: budget 5/5' }))).toEqual({
      deferred: true,
      detail: 'budget 5/5',
    })
  })

  it('is not deferred otherwise', () => {
    expect(deferralOf(item({ state: 'working', note: 'investigating' }))).toEqual({
      deferred: false,
      detail: null,
    })
  })
})

describe('deriveSummary health and window', () => {
  const base = {
    needsCount: 0,
    oldestAgeDays: null,
    receivedAt: new Date(NOW - 60_000).toISOString(),
    oldestPollerMin: 2,
    unattendedFixes: 1,
    windowDays: 7,
    stalePoller: null,
    now: NOW,
  }

  it('never calls a loop with health.ok = false healthy', () => {
    const summary = deriveSummary({ ...base, healthOk: false })
    expect(summary.status).toBe('degraded')
    expect(summary.text).toContain('health check is failing')
    expect(summary.text).not.toContain('healthy')
  })

  it('reads health.ok = true or absent as healthy', () => {
    expect(deriveSummary({ ...base, healthOk: true }).status).toBe('ok')
    expect(deriveSummary(base).status).toBe('ok')
  })

  it('uses the unattended metric’s own window, else 7 d', () => {
    const own: WardenMetrics = {
      window_days: 30,
      verified_unattended_fixes_per_week: { value: 2, window_days: 14 },
    }
    expect(deriveStrip(own, undefined).unattended.windowDays).toBe(14)
    const global: WardenMetrics = {
      window_days: 30,
      verified_unattended_fixes_per_week: { value: 2 },
    }
    expect(deriveStrip(global, undefined).unattended.windowDays).toBe(7)
  })
})

describe('sentenceCase', () => {
  it('turns enum-like values into a sentence', () => {
    expect(sentenceCase('BLOCKER')).toBe('Blocker')
    expect(sentenceCase('data_loss')).toBe('Data loss')
    expect(sentenceCase('DATA_LOSS')).toBe('Data loss')
    expect(sentenceCase(' needs_decision ')).toBe('Needs decision')
  })

  it('has no leading or doubled space from underscores', () => {
    expect(sentenceCase('_blocker')).toBe('Blocker')
    expect(sentenceCase('a__b')).toBe('A b')
  })

  it('leaves mixed-case tokens and short acronyms as written', () => {
    expect(sentenceCase('GitHub')).toBe('GitHub')
    expect(sentenceCase('OOMKilled')).toBe('OOMKilled')
    expect(sentenceCase('iOS')).toBe('iOS')
    expect(sentenceCase('OOM')).toBe('OOM')
    expect(sentenceCase('CI failed')).toBe('CI failed')
  })

  it('is null for blank or underscore-only input', () => {
    expect(sentenceCase('')).toBeNull()
    expect(sentenceCase('  ')).toBeNull()
    expect(sentenceCase('___')).toBeNull()
  })
})

describe('cardCategory', () => {
  it('uses the failure class for failed cards and the tag for decisions', () => {
    expect(cardCategory('failed', 'x', ' infra ')).toBe('infra')
    expect(cardCategory('decision', ' blocker ', 'infra')).toBe('blocker')
  })

  it('is null for blank, whitespace-only or missing text', () => {
    expect(cardCategory('failed', null, '   ')).toBeNull()
    expect(cardCategory('failed', null, null)).toBeNull()
    expect(cardCategory('decision', '   ', null)).toBeNull()
    expect(cardCategory('decision', null, null)).toBeNull()
  })
})
