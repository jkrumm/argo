import { describe, expect, it } from 'bun:test'
import type { WardenBoardItem, WardenMetrics } from '../../lib/queries/warden'
import { capFacts } from '../../components/upstream/decision-card-model'
import { waitingOnOwner, type AwaitingOwnerRow, type AwaitingOwnerView } from './model'
import { formatDuration } from '../../lib/format'
import {
  cardFacts,
  resolveWaitMs,
  latestHistoryAgeMs,
  sinceSnapshotMs,
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
  pollerStaleLabel,
  deferralOf,
  splitReason,
  cardCategory,
  sentenceCase,
  deriveBudgetFooter,
  recentTransitions,
  historySummary,
  splitBoardColumns,
  revertsFooter,
  REVERTS_INFO,
  wardenAsk,
  deriveBoard,
  pollerAgeText,
  BUDGET_MISSING,
  emptyBoardText,
  emptyColumnText,
  resolveQueueAsks,
  fixesLegend,
  historyView,
  historyAge,
  historyLineWithAge,
  wardenAskInput,
  pollerFooter,
  transitionText,
  verdictsFooter,
} from './page-model'

const NOW = Date.parse('2026-01-01T12:00:00Z')

const item = (overrides: Partial<WardenBoardItem>): WardenBoardItem =>
  ({ event_id: 1, state: 'new', ...overrides }) as WardenBoardItem

const row = (overrides: Partial<AwaitingOwnerRow>): AwaitingOwnerRow => ({
  eventId: 1,
  repo: 'repo-a',
  title: 'Title',
  origin: null,
  state: 'needs_decision',
  prUrl: null,
  ageDays: 2.4,
  stale: false,
  reason: null,
  strikes: 0,
  revisionCount: 1,
  failureClass: null,
  redrives: 0,
  failedFrom: null,
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
    expect(formatSpan(5 * 60_000)).toBe('5\u00a0min')
    expect(formatSpan(3.2 * 3_600_000)).toBe('3.2\u00a0h')
    expect(formatSpan(72 * 3_600_000)).toBe('3\u00a0d')
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
    stalePoller: null,
    now: NOW,
  }

  it('states the queue and the loop verdict, with no fact line repeating the strip', () => {
    expect(deriveSummary(base)).toEqual({
      text: 'Oldest wait on you 5\u00a0d\u00a02\u00a0h. Loop healthy.',
      status: 'ok',
    })
  })

  it('reads an unreported age as waiting, without a figure', () => {
    expect(deriveSummary({ ...base, oldestAgeDays: null }).text).toBe(
      'Items are waiting on you. Loop healthy.',
    )
  })

  it('says nothing needs you at zero', () => {
    expect(
      deriveSummary({ ...base, needsCount: 0, oldestAgeDays: null }).text.startsWith(
        'Nothing needs you. Loop healthy',
      ),
    ).toBe(true)
  })

  it('switches to the loud stalled variant past 30 minutes', () => {
    const stalled = deriveSummary({
      ...base,
      receivedAt: new Date(NOW - 2 * 3_600_000).toISOString(),
    })
    expect(stalled.text).toBe(
      'Oldest wait on you 5\u00a0d\u00a02\u00a0h. Loop stalled — snapshot 2\u00a0h old.',
    )
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
    expect(summary.text).toContain('Loop degraded: loop is 41\u00a0min old.')
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
  const strip = (reverts: number | null, reopens: number | null): StripModel['reverts'] => ({
    reverts,
    revertsUnavailable: reverts === null ? 'x' : null,
    reopens,
    reopensUnavailable: reopens === null ? 'y' : null,
    windowDays: 7,
  })
  it('states the reopen count and window; the definition lives in the tooltip', () => {
    expect(revertsFooter(strip(0, 1), nd)).toBe('1 reopened after fixed · last\u00a07\u00a0d')
    expect(REVERTS_INFO).toContain('A revert is a merged fix that was undone')
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

  it('never offers Merge on a failed verification', () => {
    const plan = planActions(['dismiss', 'merge', 'retry', 'note'], 'failed', 'verifying')
    expect(plan).toEqual({ primary: 'retry', secondary: 'dismiss', menu: ['note'] })
    expect(planActions(['merge', 'retry'], 'failed', 'working').secondary).toBe('merge')
    expect(planActions(['merge', 'retry'], 'decision', 'verifying').primary).toBe('merge')
  })

  it('never offers Merge on a failed CI, wherever the reason says so', () => {
    const offered = ['dismiss', 'merge', 'retry', 'note']
    for (const reason of [
      'CI failed on {sha}: {why}',
      '[:warning: CI failed on {sha}]',
      'GitHub Actions: CI failed on {sha}',
      'Verification failed — CI failed on {sha}',
    ]) {
      const plan = planActions(offered, 'failed', 'merging', reason)
      expect(plan).toEqual({ primary: 'retry', secondary: 'dismiss', menu: ['note'] })
    }
    expect(planActions(offered, 'failed', 'merging', 'Merge conflict').secondary).toBe('merge')
    expect(planActions(['merge', 'retry'], 'decision', null, 'CI failed on {sha}').primary).toBe(
      'merge',
    )
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
    expect(splitReason('Ship the fix? It touches the loop. Tests pass.')).toEqual({
      tag: null,
      question: 'Ship the fix?',
      rest: 'It touches the loop. Tests pass.',
    })
  })

  it('keeps a single sentence whole, with no evidence', () => {
    expect(splitReason('Ship the fix or revert')).toEqual({
      tag: null,
      question: 'Ship the fix or revert',
      rest: null,
    })
  })

  it('never cuts a long first sentence', () => {
    const long = `${'word '.repeat(80)}end.`
    expect(splitReason(long).question).toBe(long)
  })

  it('has an empty question when there is no reason', () => {
    expect(splitReason(null)).toEqual({ tag: null, question: '', rest: null })
    expect(splitReason('  ').question).toBe('')
  })
})

describe('cardFacts glue', () => {
  it('the count never leaves its word in the history fact', () => {
    expect(cardFacts(row({ redrives: 2, revisionCount: 3, ageDays: 1.2 }))[2]).toBe(
      'retried\u00a02\u00a0times, revised\u00a03\u00a0times',
    )
    expect(cardFacts(row({ redrives: 0, revisionCount: 1, ageDays: 1.2 }))[2]).toBe(
      'revised\u00a01\u00a0time',
    )
  })
  it('the waiting fact and the history age share one duration spelling', () => {
    const waiting = cardFacts(row({ ageDays: 0.1 }))[1]
    expect(waiting).toBe(`waiting ${formatDuration(0.1 * 86_400_000)}`)
    expect(historyAge(new Date(0).toISOString(), 0.1 * 86_400_000)).toBe(
      `${formatDuration(0.1 * 86_400_000)}\u00a0ago`,
    )
  })
})

describe('cardFacts waiting boundaries', () => {
  const MIN = 60_000
  const DAY = 86_400_000
  const waitingAt = (ageDays: number, elapsedMs = 0, historyAgeMs = 0) =>
    cardFacts(row({ ageDays }), 'repo-a', { elapsedMs, historyAgeMs })[1]
  it('never reads a zero: under a minute is `<1 min`', () => {
    expect(waitingAt(0)).toBe('waiting <\u00a01\u00a0min')
    expect(waitingAt(0, 59_000)).toBe('waiting <\u00a01\u00a0min')
  })
  it('a minute and past reads the duration', () => {
    expect(waitingAt(0, MIN)).toBe('waiting 1\u00a0min')
    expect(waitingAt(0, 5 * MIN)).toBe('waiting 5\u00a0min')
  })
  it('ageDays 0 carried by the time since the push', () => {
    const receivedAt = new Date(1_000_000).toISOString()
    expect(waitingAt(0, sinceSnapshotMs(receivedAt, 1_000_000 + 3 * MIN))).toBe(
      'waiting 3\u00a0min',
    )
  })
  it('is never shorter than the history line beside it', () => {
    const transitionAt = new Date(1_000_000).toISOString()
    const now = 1_000_000 + 3 * MIN
    const historyAgeMs = latestHistoryAgeMs(
      [{ from: null, to: 'needs_decision', at: transitionAt }],
      now,
    )
    // The push arrived after the transition: age_days 0, elapsed 10 s, yet the history says 3 min.
    expect(waitingAt(0, 10_000, historyAgeMs)).toBe('waiting 3\u00a0min')
    expect(historyAge(transitionAt, now)).toBe('3\u00a0min\u00a0ago')
  })
  it('a wait within age_days rounding of the history line prints the duration of the history line', () => {
    const historyAgeMs = 22 * 60 * MIN + 53 * MIN
    expect(waitingAt(1, 0, historyAgeMs)).toBe('waiting 22\u00a0h\u00a053\u00a0min')
    expect(formatDuration(historyAgeMs)).toBe('22\u00a0h\u00a053\u00a0min')
  })
  it('a history line far from age_days leaves the longer wait standing', () => {
    expect(waitingAt(3, 0, 2 * 60 * MIN)).toEqual({ text: 'waiting 3\u00a0d', tone: 'warn' })
  })
  it('resolveWaitMs: no history keeps the age_days wait', () => {
    expect(resolveWaitMs(0.04, 0, 0)).toBe(0.04 * DAY)
  })
  it('resolveWaitMs: agreement within the resolution takes the history age', () => {
    expect(resolveWaitMs(1, 0, DAY - 70 * MIN)).toBe(DAY - 70 * MIN)
    expect(resolveWaitMs(0, 0, 3 * MIN)).toBe(3 * MIN)
  })
  it('resolveWaitMs: disagreement beyond the resolution keeps the longer', () => {
    expect(resolveWaitMs(1, 0, DAY - 90 * MIN)).toBe(DAY)
  })
  it('the history floor is 0 without a readable line', () => {
    expect(latestHistoryAgeMs([], 10)).toBe(0)
    expect(latestHistoryAgeMs([{ from: null, to: 'new', at: 'nope' }], 10)).toBe(0)
  })
  it('the warn tone follows the displayed wait', () => {
    expect(waitingAt(2)).toBe('waiting 2\u00a0d')
    expect(waitingAt(2, 0, 2 * DAY + 60 * MIN)).toEqual({
      text: 'waiting 2\u00a0d\u00a01\u00a0h',
      tone: 'warn',
    })
    expect(waitingAt(2, 60 * MIN)).toEqual({ text: 'waiting 2\u00a0d\u00a01\u00a0h', tone: 'warn' })
  })
  it('sinceSnapshotMs is 0 for an unknown or future receipt', () => {
    expect(sinceSnapshotMs(null, 10)).toBe(0)
    expect(sinceSnapshotMs('nope', 10)).toBe(0)
    expect(sinceSnapshotMs(new Date(20).toISOString(), 10)).toBe(0)
  })
})

describe('cardFacts', () => {
  it('leads with repo, then age, then how often the item was retried and revised', () => {
    expect(cardFacts(row({ redrives: 2, ageDays: 1.2 }))).toEqual([
      'repo-a',
      'waiting 1\u00a0d\u00a04\u00a0h',
      'retried\u00a02\u00a0times, revised\u00a01\u00a0time',
    ])
  })

  it('says revised alone when nothing was retried, and never `revision 0`', () => {
    expect(cardFacts(row({ redrives: 0, revisionCount: 1, ageDays: 1.2 }))[2]).toBe(
      'revised\u00a01\u00a0time',
    )
    expect(cardFacts(row({ redrives: 0, revisionCount: 0, ageDays: 1.2 }))).toEqual([
      'repo-a',
      'waiting 1\u00a0d\u00a04\u00a0h',
    ])
  })

  it('tones a wait past two days as a warning', () => {
    expect(cardFacts(row({ ageDays: 2.4 }))[1]).toEqual({
      text: 'waiting 2\u00a0d\u00a09\u00a0h',
      tone: 'warn',
    })
    expect(cardFacts(row({ ageDays: 1.5 }))[1]).toBe('waiting 1\u00a0d\u00a012\u00a0h')
  })

  it('omits what warden did not report', () => {
    expect(cardFacts(row({ repo: null, ageDays: null, redrives: 0, revisionCount: 0 }))).toEqual([])
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

describe('leading tag', () => {
  it('lifts a leading [tag] out of the question', () => {
    expect(splitReason('[blocker] Deploy now? It touches CI.')).toEqual({
      tag: 'blocker',
      question: 'Deploy now?',
      rest: 'It touches CI.',
    })
  })

  it('keeps a bracket that is not leading', () => {
    expect(splitReason('Deploy [now]?')).toMatchObject({
      tag: null,
      question: 'Deploy [now]?',
    })
  })

  it('has an empty question when the tag is all there is', () => {
    expect(splitReason('[no category]')).toEqual({ tag: 'no category', question: '', rest: null })
  })

  it('shows no category chip for a placeholder tag', () => {
    expect(cardCategory('decision', 'no category', null)).toBeNull()
    expect(cardCategory('decision', 'None', null)).toBeNull()
    expect(cardCategory('failed', null, 'unknown')).toBe('unknown')
    expect(cardCategory('decision', 'blocker', null)).toBe('blocker')
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
      'stale at 10\u00a0min',
    )
  })

  it('falls back to the 30 minute scale without a threshold', () => {
    expect(pollerStaleLabel({ name: 'a', ageMin: 40, thresholdMin: null, stale: true })).toBe(
      'stale at 30\u00a0min',
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

describe('wardenAsk', () => {
  const source = (over: Partial<Parameters<typeof wardenAsk>[0]> = {}) => ({
    eventId: 1,
    repo: '{repo}',
    title: 'fix(loop): raw subject',
    reason: null,
    question: null,
    availableActions: [],
    ...over,
  })

  it('strips shortcodes, keeps a question the reason asks, lifts the tag', () => {
    const ask = wardenAsk(
      source({
        title: ':rotating_light: {title}',
        reason: '[blocker] Ship {thing}? It touches the loop.',
      }),
      'decision',
    )
    expect(ask.tag).toBe('blocker')
    expect(ask.copy).toMatchObject({
      question: 'Ship {thing}?',
      entity: '{title}',
      evidenceLine: 'It touches the loop.',
      source: 'ask',
    })
  })

  it('prefers the producer-authored question over the reason', () => {
    const ask = wardenAsk(
      source({ reason: 'Ship {thing}? Why.', question: 'Merge the loop fix?' }),
      'decision',
    )
    expect(ask.copy).toMatchObject({
      question: 'Merge the loop fix?',
      source: 'authored',
      entity: 'fix(loop): raw subject',
    })
  })

  it('reads a junk authored question as none', () => {
    for (const junk of [3, {}, ['x'], '  ']) {
      expect(wardenAsk(source({ question: junk }), 'decision').copy.source).toBe('plain')
    }
  })

  it('asks in the card’s primary verb about the title’s subject; the repo stays a fact', () => {
    const sentence = `Warden ${'merged the change and then redeployed the loop '.repeat(3)}now.`
    const ask = wardenAsk(
      source({ reason: `${sentence} Tests pass.`, availableActions: ['merge', 'dismiss'] }),
      'decision',
    )
    expect(ask.plan).toMatchObject({ primary: 'merge', secondary: 'dismiss' })
    // The commit label is not the subject; the whole title stays behind the disclosure.
    expect(ask.copy.question).toBe('Merge PR: raw subject?')
    expect(ask.copy.entity).toBeNull()
    expect(ask.copy.detail).toBe(`fix(loop): raw subject ${sentence} Tests pass.`)
  })

  it('keeps the repo as the first fact on every card, even when the subject mentions it', () => {
    const ask = wardenAsk(source({ title: 'Audit of the {repo} vault' }), 'decision')
    expect(ask.copy.question).toBe('Decide on item: Audit of the {repo} vault?')
    const facts = capFacts(cardFacts(row({ redrives: 3, revisionCount: 2, ageDays: 9 }), ask.repo))
    // capFacts keeps the first three: the repo leads, so it is never the one dropped.
    expect(facts[0]).toBe('{repo}')
  })

  it('asks to retry a failed run only when retry is the primary verb', () => {
    const retry = wardenAsk(
      source({ reason: 'Exit code 1.', availableActions: ['retry', 'dismiss'] }),
      'failed',
    )
    expect(retry.copy.question).toBe('Retry failed run: raw subject?')
    expect(retry.copy.entity).toBeNull()
    expect(retry.copy.evidenceLine).toBe('Exit code 1.')
    expect(wardenAsk(source({ availableActions: ['dismiss'] }), 'failed').copy.question).toBe(
      'Decide on item: raw subject?',
    )
  })

  it('falls back to the item number when the title is only a shortcode', () => {
    expect(wardenAsk(source({ title: ':warning:' }), 'failed').copy.question).toBe(
      'Decide on item: Item #1?',
    )
    expect(wardenAsk(source({ title: null, eventId: 7 }), 'failed').copy.question).toBe(
      'Decide on item: Item #7?',
    )
  })
})

describe('wardenAskInput: a loose reason', () => {
  const source = (reason: unknown) =>
    ({
      eventId: 9,
      repo: '{r}',
      title: '{title}',
      reason,
      question: null,
      availableActions: ['merge', 'retry', 'dismiss'],
    }) as unknown as Parameters<typeof wardenAskInput>[0]

  it('reads a number, object or array reason as none, without throwing', () => {
    for (const reason of [7, { a: 1 }, ['CI failed'], null, undefined]) {
      const ask = wardenAskInput(source(reason), 'failed')
      expect(ask.plan.secondary).toBe('merge')
    }
  })
  it('plans from the normalised reason: a shortcode-wrapped CI failure never offers Merge', () => {
    const ask = wardenAskInput(source('[:warning: CI failed on {sha}]'), 'failed')
    expect(ask.plan).toMatchObject({ primary: 'retry', secondary: 'dismiss' })
  })
})

describe('historyLineWithAge', () => {
  const NOW = Date.parse('2026-01-10T12:00:00Z')
  const ago = (ms: number) => new Date(NOW - ms).toISOString()

  it('keeps the whole age, ago included, in one unbreakable unit after a glued dot', () => {
    const line = historyLineWithAge('{a} → {b}', ago((5 * 60 + 12) * 60_000), NOW)
    expect(line).toBe('{a} → {b}\u00a0·\u00a05\u00a0h\u00a012\u00a0min\u00a0ago')
    // Nothing after the dot can break: not between the parts, and not before `ago`.
    expect(line.slice(line.indexOf('·'))).not.toContain(' ')
  })
  it('leaves a recent or missing time as it is', () => {
    expect(historyLineWithAge('{a} → {b}', ago(10_000), NOW)).toBe('{a} → {b}\u00a0·\u00a0just now')
    expect(historyLineWithAge('{a} → {b}', null, NOW)).toBe('{a} → {b}')
    expect(historyLineWithAge('{a} → {b}', 'nope', NOW)).toBe('{a} → {b}\u00a0·\u00a0—')
  })
})

describe('transitionText and historyView', () => {
  it('names a creation row and a move whole', () => {
    expect(transitionText({ from: null, to: 'new', at: null })).toBe('Created')
    expect(transitionText({ from: 'needs_decision', to: 'working', at: null })).toBe(
      'Needs decision\u00a0→\u00a0Working',
    )
  })

  it('is inline for one transition and a well for more, newest first', () => {
    const one = Object.assign([{ from: null, to: 'new', at: 't1' }], { total: 1 })
    expect(historyView(one)).toEqual({
      layout: 'inline',
      lines: [{ text: 'Created', at: 't1' }],
      earlier: 0,
    })
    const many = Object.assign(
      [
        { from: 'new', to: 'triaged', at: 't1' },
        { from: 'triaged', to: 'working', at: 't2' },
      ],
      { total: 5 },
    )
    const view = historyView(many)
    expect(view?.layout).toBe('well')
    expect(view?.lines.map((l) => l.text)).toEqual([
      'Triaged\u00a0→\u00a0Working',
      'New\u00a0→\u00a0Triaged',
    ])
    expect(view?.earlier).toBe(3)
  })

  it('is null without history', () => {
    expect(historyView([])).toBeNull()
  })
})

describe('strip footers', () => {
  const fixes = (fixed: number | null, quiet: number | null, closed: number | null) =>
    ({ pct: 50, fixed, quiet, closed, unavailable: null }) as StripModel['fixes']

  it('writes the fixes legend as a sum', () => {
    expect(fixesLegend(fixes(3, 2, 1))).toBe(
      '3\u00a0fixed +\u00a02\u00a0quiet +\u00a01\u00a0closed =\u00a06\u00a0items',
    )
  })
  it('shows a dash and no total for an unreported count', () => {
    expect(fixesLegend(fixes(3, null, 1))).toBe(
      '3\u00a0fixed +\u00a0—\u00a0quiet +\u00a01\u00a0closed',
    )
  })

  it('gives the verdicts cell a fact instead of a bare share', () => {
    const v = { pct: 50, numerator: 5, denominator: 10, unavailable: null }
    expect(verdictsFooter(v)).toBe('5 of 10 tracked items · all time')
    expect(verdictsFooter({ ...v, numerator: null })).toBe('all time')
  })

  it('names the oldest poller instead of repeating the tick', () => {
    const poller = { oldestMin: 4, thresholdMin: 30, stale: false, unavailable: null }
    expect(pollerFooter({ ...poller, name: 'merge_poller', count: 3 })).toBe(
      'merge poller · oldest of 3',
    )
    expect(pollerFooter({ ...poller, name: 'merge_poller', count: 1 })).toBe('merge poller')
    expect(pollerFooter({ ...poller, name: null, count: 0 })).toBe('stale at 30\u00a0min')
  })

  it('carries the oldest poller name through the strip', () => {
    const strip = deriveStrip(undefined, {
      pollers: { a_poller: { age_minutes: 9 }, b_poller: { age_minutes: 3 } },
    } as never)
    expect(strip.poller).toMatchObject({ name: 'a_poller', count: 2 })
  })

  it('tells a missing budget when it arrives', () => {
    expect(BUDGET_MISSING.both).toContain('about every 10\u00a0min')
    expect(BUDGET_MISSING.one('Dispatch')).toContain('Dispatch budget')
    expect(REVERTS_INFO).toContain('reopen')
  })
})

describe('pollerAgeText', () => {
  it('names the poller once, without a second `poller`', () => {
    expect(pollerAgeText({ name: 'merge_poller', ageMin: 3.6 })).toBe(
      'merge poller · 4\u00a0min old',
    )
  })
})

describe('board empty copy', () => {
  it('describes what an empty column would hold', () => {
    expect(emptyColumnText('working')).toBe('No item being worked on.')
  })
  it('never says No open items while items wait on the owner', () => {
    expect(emptyBoardText(0)).toBe('No open items.')
    expect(emptyBoardText(1)).toBe(
      'No other open items. The one open item is waiting on you, above.',
    )
    expect(emptyBoardText(4)).toBe(
      'No other open items. The 4 open items are waiting on you, above.',
    )
    expect(emptyBoardText(2, 1)).toBe(
      'No other open items. The 2 open items are waiting on you and 1 failed, above.',
    )
    expect(emptyBoardText(0, 3)).toBe('No other open items. 3 failed, above.')
  })
})

describe('wardenAsk repo', () => {
  const src = (repo: string, question: string) => ({
    eventId: 1,
    repo,
    title: 't',
    reason: null,
    question,
    availableActions: [],
  })
  it('returns the cleaned repo once', () => {
    expect(wardenAsk(src(':warning: service', 'Ship?'), 'decision').repo).toBe('service')
  })
})

describe('waitingOnOwner', () => {
  it('is decisions, unknown states, then failed, in one list', () => {
    const r = (eventId: number) => ({ eventId }) as never
    expect(
      waitingOnOwner({ needsDecision: [r(1)], other: [r(2)], failed: [r(3)] }).map(
        (x) => x.eventId,
      ),
    ).toEqual([1, 2, 3])
  })
})

describe('deriveBoard', () => {
  const item = (event_id: number, state = 'working') =>
    ({ event_id, state, repo: 'r', title: 't' }) as WardenBoardItem
  const board = (items: WardenBoardItem[]) => ({ items }) as never
  const owner = (needs: number[], failed: number[] = []) =>
    ({
      needsDecision: needs.map((eventId) => ({ eventId })),
      other: [],
      failed: failed.map((eventId) => ({ eventId })),
    }) as unknown as AwaitingOwnerView

  it('counts the board and names only the items that actually left it', () => {
    const view = deriveBoard(board([item(1, 'needs_decision'), item(2)]), owner([1, 99]))
    expect(view.open).toBe(1)
    expect(view.columns.flatMap((c) => c.items.map((i) => i.event_id))).toEqual([2])
    expect(view.emptyText).toBe('No other open items. The one open item is waiting on you, above.')
  })

  it('says every open item waits on the owner when all are claimed', () => {
    const view = deriveBoard(board([item(1, 'needs_decision'), item(2, 'failed')]), owner([1], [2]))
    expect(view.open).toBe(0)
    // The count is the `Needs you` badge's: the failed item is named apart, never added to it.
    expect(view.emptyText).toBe(
      'No other open items. The one open item is waiting on you and 1 failed, above.',
    )
  })

  it('says nothing is open when nothing was claimed either', () => {
    expect(deriveBoard(board([]), owner([])).emptyText).toBe('No open items.')
  })
})

describe('wardenAsk across one surface', () => {
  type Entry = { kind: 'decision' | 'failed'; row: AwaitingOwnerRow }
  const entry = (eventId: number, title: unknown, over: Partial<AwaitingOwnerRow> = {}): Entry => ({
    kind: 'decision',
    row: row({
      eventId,
      repo: '{repo}',
      title: title as string,
      reason: 'Evidence only.',
      availableActions: ['implement'],
      ...over,
    }),
  })
  const resolve = (entries: Entry[]) => resolveQueueAsks(entries)

  it('names every item by its subject across needs-you and failed', () => {
    const asks = resolve([
      entry(1, 'Disk filling up'),
      { ...entry(2, 'Cache cold'), kind: 'failed' },
      entry(3, 'Latency high', { availableActions: ['reinvestigate'] }),
    ])
    expect(asks.map((a) => a.copy.question)).toEqual([
      'Implement change: Disk filling up?',
      'Implement change: Cache cold?',
      'Re-investigate item: Latency high?',
    ])
    expect(asks.map((a) => a.copy.entity)).toEqual([null, null, null])
  })

  it('frames a bracket-tagged alert as an alert whatever its origin, with a whole handle', () => {
    const asks = resolve([
      entry(1, '[alert] {key-a} disk full', { origin: 'job' }),
      entry(2, '[ALERT] {key-b} disk full', { origin: null }),
    ])
    expect(asks.map((a) => a.copy.question)).toEqual([
      'Implement fix for alert: {key-a} disk full?',
      'Implement fix for alert: {key-b} disk full?',
    ])
  })

  it('asks the verb its primary button carries', () => {
    const { copy, plan } = wardenAsk(
      { ...entry(1, '[alert] {key}').row, availableActions: ['implement', 'dismiss'] },
      'decision',
    )
    expect(plan.primary).toBe('implement')
    expect(copy.question).toStartWith('Implement ')
  })

  it('keeps an id that sits in both lists apart by kind', () => {
    const asks = resolve([
      entry(1, 'Disk filling up'),
      { ...entry(1, 'Disk filling up'), kind: 'failed' },
    ])
    expect(asks.map((a) => a.copy.question)).toEqual([
      'Implement change: Disk filling up (1)?',
      'Implement change: Disk filling up (2)?',
    ])
  })

  it('frames an alert origin as an alert in the verb its button carries', () => {
    const [handle, dismiss, none] = resolve([
      entry(1, 'Latency high', { origin: 'alert' }),
      entry(2, 'Queue deep', { origin: 'alert', availableActions: ['dismiss'] }),
      entry(3, 'Disk full', { origin: 'alert', availableActions: [] }),
    ])
    expect(handle!.copy.question).toBe('Implement fix for alert: Latency high?')
    expect(dismiss!.copy.question).toBe('Dismiss alert: Queue deep?')
    expect(none!.copy.question).toBe('Decide on alert: Disk full?')
  })

  it('does not take an issue about alerts for an alert', () => {
    const [ask] = resolve([entry(1, 'Add incident-response runbook')])
    expect(ask!.copy.question).toBe('Implement change: Add incident-response runbook?')
  })

  it('names untitled items by their id, never by an ordinal', () => {
    const asks = resolve([entry(1, null), entry(2, ':fire:'), entry(3, '')])
    expect(asks.map((a) => a.copy.question)).toEqual([
      'Implement change: Item #1?',
      'Implement change: Item #2?',
      'Implement change: Item #3?',
    ])
  })

  it('reads non-string wire values as absent, never throwing', () => {
    for (const junk of [42, {}, ['x'], true]) {
      const [ask] = resolve([entry(1, junk, { repo: junk as never, reason: junk as never })])
      expect(ask!.copy.question).toBe('Implement change: Item #1?')
      expect(ask!.copy.entity).toBeNull()
    }
  })
})

describe('resolveQueueAsks', () => {
  const entry = (eventId: number, title: string, reason: string) => ({
    kind: 'decision' as const,
    row: {
      eventId,
      repo: '{repo}',
      title,
      reason,
      question: null,
      availableActions: ['implement'],
    } as unknown as AwaitingOwnerRow,
  })

  it('keeps a line several cards share word for word on the first card only', () => {
    const asks = resolveQueueAsks([
      entry(1, 'Disk full', 'Same note.'),
      entry(2, 'Cache cold', 'same note.'),
      entry(3, 'Queue deep', 'Own fact.'),
    ])
    expect(asks.map((a) => a.copy.evidenceLine)).toEqual(['Same note.', null, 'Own fact.'])
    // The dropped line is still behind the card's disclosure.
    expect(asks[1]!.copy.detail).toBe('same note.')
  })

  it('leaves a lone line alone', () => {
    expect(resolveQueueAsks([entry(1, 'Disk full', 'Note.')])[0]!.copy.evidenceLine).toBe('Note.')
  })
})
