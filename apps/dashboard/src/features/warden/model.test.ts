import { describe, expect, it } from 'bun:test'
import {
  AWAITING_OWNER_STALE_DAYS,
  BUCKET_ORDER,
  buildItemFacts,
  deriveAwaitingOwner,
  deriveBoard,
  deriveFunnel,
  deriveWardenPage,
  formatAgeDays,
  formatSourceLine,
  formatTileNumber,
  formatTileValue,
  formatVerdictLine,
  GITHUB_ISSUE_GROUPS,
  groupIssueItems,
  isDeferredItem,
  isSafeHttpUrl,
  isStale,
  issueRefLabel,
  PENDING_ACTION_TIMEOUT_MS,
  pluralize,
  reconcilePendingActions,
  resolveItemModal,
  stateColor,
  stateLabel,
  withPendingAction,
  type PendingActions,
  type Row,
} from './model'
import type {
  WardenAwaitingOwnerEntry,
  WardenBoardItem,
  WardenItems,
  WardenMetrics,
} from '../../lib/queries/warden'

const item = (overrides: Partial<WardenBoardItem> = {}): WardenBoardItem =>
  ({
    event_id: 1,
    state: 'new',
    ...overrides,
  }) as WardenBoardItem

describe('isStale', () => {
  const now = Date.parse('2026-09-11T12:00:00Z')

  it('is stale with no receivedAt', () => {
    expect(isStale(null, now)).toBe(true)
    expect(isStale(undefined, now)).toBe(true)
  })

  it('is stale with an unparsable receivedAt', () => {
    expect(isStale('not-a-date', now)).toBe(true)
  })

  it('is not stale within 30 minutes', () => {
    expect(isStale(new Date(now - 10 * 60_000).toISOString(), now)).toBe(false)
  })

  it('is stale past 30 minutes', () => {
    expect(isStale(new Date(now - 31 * 60_000).toISOString(), now)).toBe(true)
  })
})

describe('isDeferredItem', () => {
  it('is true only for a working item whose note starts with "deferred:"', () => {
    expect(isDeferredItem(item({ state: 'working', note: 'deferred: implement budget 5/5' }))).toBe(
      true,
    )
    expect(isDeferredItem(item({ state: 'working', note: 'something else' }))).toBe(false)
    expect(isDeferredItem(item({ state: 'new', note: 'deferred: x' }))).toBe(false)
    expect(isDeferredItem(item({ state: 'working' }))).toBe(false)
  })
})

describe('deriveWardenPage', () => {
  it('derives buckets, issue groups and a flat item list from raw, empty-safe', () => {
    const view = deriveWardenPage(undefined)
    expect(view.buckets.map((b) => b.key)).toEqual([...BUCKET_ORDER])
    expect(view.issueGroups.map((g) => g.key)).toEqual([...GITHUB_ISSUE_GROUPS])
    expect(view.boardItems).toEqual([])
  })

  it('threads board.items through to buckets, issue groups and boardItems consistently', () => {
    const items = [
      item({ event_id: 1, state: 'needs_decision', origin: 'github_issue' }),
      item({ event_id: 2, state: 'working' }),
    ]
    const view = deriveWardenPage({ board: { items } } as never)
    expect(view.boardItems).toBe(items)
    const byBucket = Object.fromEntries(view.buckets.map((b) => [b.key, b.items]))
    expect(byBucket['needs_decision']!.map((i) => i.event_id)).toEqual([1])
    expect(view.issueGroups.flatMap((g) => g.items)).toEqual([])
  })
})

describe('deriveBoard', () => {
  it('returns every bucket, in fixed order, even when empty', () => {
    const buckets = deriveBoard(undefined)
    expect(buckets.map((b) => b.key)).toEqual([...BUCKET_ORDER])
    expect(buckets.every((b) => b.items.length === 0)).toBe(true)
  })

  it('carves deferred working items out of the working bucket', () => {
    const items = [
      item({ event_id: 1, state: 'working', note: 'deferred: implement budget 5/5 used today' }),
      item({ event_id: 2, state: 'working', note: 'investigating' }),
      item({ event_id: 3, state: 'needs_decision' }),
    ]
    const buckets = deriveBoard({ items })
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b.items]))
    expect(byKey['deferred']!.map((i) => i.event_id)).toEqual([1])
    expect(byKey['working']!.map((i) => i.event_id)).toEqual([2])
    expect(byKey['needs_decision']!.map((i) => i.event_id)).toEqual([3])
  })

  it('collects an item whose state is outside the vocabulary into unknown, never dropping it', () => {
    const items = [item({ event_id: 1, state: 'needs_human' }), item({ event_id: 2, state: 'new' })]
    const buckets = deriveBoard({ items })
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b.items]))
    expect(byKey['unknown']!.map((i) => i.event_id)).toEqual([1])
    expect(byKey['new']!.map((i) => i.event_id)).toEqual([2])
    const total = buckets.reduce((sum, b) => sum + b.items.length, 0)
    expect(total).toBe(items.length)
  })
})

describe('groupIssueItems', () => {
  it('returns every group, in fixed order, even when empty', () => {
    const groups = groupIssueItems([])
    expect(groups.map((g) => g.key)).toEqual([...GITHUB_ISSUE_GROUPS])
    expect(groups.every((g) => g.items.length === 0)).toBe(true)
  })

  it('ignores an item whose origin is not github_issue', () => {
    const groups = groupIssueItems([
      item({ event_id: 1, origin: 'alert', state: 'needs_decision' }),
    ])
    expect(groups.every((g) => g.items.length === 0)).toBe(true)
  })

  it('excludes needs_decision and failed — the dedicated queues own them', () => {
    const items = [
      item({ event_id: 1, origin: 'github_issue', state: 'needs_decision' }),
      item({ event_id: 2, origin: 'github_issue', state: 'failed' }),
      item({ event_id: 3, origin: 'github_issue', state: 'working' }),
    ]
    const groups = groupIssueItems(items)
    expect(groups.flatMap((g) => g.items.map((i) => i.event_id))).toEqual([3])
  })

  it('maps new, triaged and working to running', () => {
    const items = [
      item({ event_id: 1, origin: 'github_issue', state: 'new' }),
      item({ event_id: 2, origin: 'github_issue', state: 'triaged' }),
      item({ event_id: 3, origin: 'github_issue', state: 'working' }),
    ]
    const byKey = Object.fromEntries(groupIssueItems(items).map((g) => [g.key, g.items]))
    expect(byKey['running']!.map((i) => i.event_id)).toEqual([1, 2, 3])
  })

  it('maps merging and verifying to landing', () => {
    const items = [
      item({ event_id: 1, origin: 'github_issue', state: 'merging' }),
      item({ event_id: 2, origin: 'github_issue', state: 'verifying' }),
    ]
    const byKey = Object.fromEntries(groupIssueItems(items).map((g) => [g.key, g.items]))
    expect(byKey['landing']!.map((i) => i.event_id)).toEqual([1, 2])
  })

  it('maps the terminal states to done', () => {
    const items = [
      item({ event_id: 1, origin: 'github_issue', state: 'fixed' }),
      item({ event_id: 2, origin: 'github_issue', state: 'quiet' }),
      item({ event_id: 3, origin: 'github_issue', state: 'closed' }),
    ]
    const byKey = Object.fromEntries(groupIssueItems(items).map((g) => [g.key, g.items]))
    expect(byKey['done']!.map((i) => i.event_id)).toEqual([1, 2, 3])
  })

  it('falls back to running for a state outside the mapped vocabulary', () => {
    const items = [item({ event_id: 1, origin: 'github_issue', state: 'needs_human' })]
    const byKey = Object.fromEntries(groupIssueItems(items).map((g) => [g.key, g.items]))
    expect(byKey['running']!.map((i) => i.event_id)).toEqual([1])
  })
})

describe('issueRefLabel', () => {
  it('formats repo#number', () => {
    expect(issueRefLabel({ repo: 'argo', number: 42 } as never)).toBe('argo#42')
  })
})

describe('isSafeHttpUrl', () => {
  it('accepts http(s) URLs', () => {
    expect(isSafeHttpUrl('https://github.com/jkrumm/argo/issues/1')).toBe(true)
    expect(isSafeHttpUrl('http://example.com')).toBe(true)
  })

  it('rejects non-http(s) schemes and unparsable strings', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeHttpUrl('not a url')).toBe(false)
  })
})

describe('formatAgeDays', () => {
  it('renders an em dash for an unreported age', () => {
    expect(formatAgeDays(null)).toBe('—')
  })

  it('renders under a day as "< 1 d"', () => {
    expect(formatAgeDays(0.4)).toBe('< 1 d')
  })

  it('renders a day or more to one decimal with a "d" unit', () => {
    expect(formatAgeDays(5.14)).toBe('5.1 d')
    expect(formatAgeDays(1)).toBe('1.0 d')
  })
})

describe('stateColor / stateLabel', () => {
  it('colors every state in the vocabulary and falls back to gray for an unknown one', () => {
    expect(stateColor('needs_decision')).toBe('orange')
    expect(stateColor('failed')).toBe('red')
    expect(stateColor('working')).toBe('blue')
    expect(stateColor('fixed')).toBe('green')
    expect(stateColor('needs_human')).toBe('gray')
  })

  it('appends the close_reason to a closed state only', () => {
    expect(stateLabel('closed', 'duplicate')).toBe('closed · duplicate')
    expect(stateLabel('closed', null)).toBe('closed')
    expect(stateLabel('closed')).toBe('closed')
    expect(stateLabel('working', 'duplicate')).toBe('working')
  })
})

describe('deriveAwaitingOwner', () => {
  const entry = (overrides: Partial<WardenAwaitingOwnerEntry> = {}): WardenAwaitingOwnerEntry =>
    ({
      kind: 'item',
      event_id: 1,
      repo: 'argo',
      title: 'Something parked',
      state: 'needs_decision',
      pr_url: null,
      age_days: 5,
      reason: 'Revert the retry or fix the race?',
      revision_count: 0,
      availableActions: ['implement', 'dismiss'],
      ...overrides,
    }) as WardenAwaitingOwnerEntry

  it('reads two empty lists when the field is missing, never crashing', () => {
    expect(deriveAwaitingOwner(undefined)).toEqual({ needsDecision: [], failed: [], other: [] })
    expect(deriveAwaitingOwner({} as never)).toEqual({ needsDecision: [], failed: [], other: [] })
  })

  it('splits needs_decision from failed, preserving warden-supplied order', () => {
    const entries = [
      entry({ event_id: 1 }),
      entry({ event_id: 2, state: 'failed' }),
      entry({ event_id: 3 }),
      entry({ event_id: 4, state: 'failed' }),
    ]
    const view = deriveAwaitingOwner({ awaiting_owner: entries } as never)
    expect(view.needsDecision.map((r) => r.eventId)).toEqual([1, 3])
    expect(view.failed.map((r) => r.eventId)).toEqual([2, 4])
  })

  it('reads failure_class/redrives off the entry, else the board item, else null/0', () => {
    const view = deriveAwaitingOwner({
      awaiting_owner: [
        entry({ event_id: 1, state: 'failed', failure_class: 'infra', redrives: 2 }),
        entry({ event_id: 2, state: 'failed' }),
        entry({ event_id: 3, state: 'failed' }),
      ],
      items: [{ event_id: 2, state: 'failed', failure_class: 'work', redrives: 1 }],
    } as never)
    expect(view.failed.map((r) => [r.failureClass, r.redrives])).toEqual([
      ['infra', 2],
      ['work', 1],
      [null, 0],
    ])
  })

  it('carries the decision question as reason', () => {
    const view = deriveAwaitingOwner({ awaiting_owner: [entry()] } as never)
    expect(view.needsDecision[0]!.reason).toBe('Revert the retry or fix the race?')
  })

  it('routes an entry in any other state to other, dropping only one without an event id', () => {
    const entries = [
      entry({ event_id: 1, state: 'needs_human' }),
      entry({ event_id: null }),
      entry({ event_id: 3, state: null }),
    ]
    const view = deriveAwaitingOwner({ awaiting_owner: entries } as never)
    expect(view.needsDecision).toEqual([])
    expect(view.failed).toEqual([])
    expect(view.other.map((r) => [r.eventId, r.state])).toEqual([
      [1, 'needs_human'],
      [3, null],
    ])
  })

  it('reads strikes off the matching board item, 0 when it is not on the board', () => {
    const view = deriveAwaitingOwner({
      awaiting_owner: [
        entry({ event_id: 1, state: 'failed' }),
        entry({ event_id: 2, state: 'failed' }),
      ],
      items: [{ event_id: 1, state: 'failed', strikes: 3 }],
    } as never)
    expect(view.failed.map((r) => r.strikes)).toEqual([3, 0])
  })

  it('formats age and flags stale at the threshold, never below it', () => {
    const entries = [
      entry({ event_id: 1, age_days: AWAITING_OWNER_STALE_DAYS }),
      entry({ event_id: 2, age_days: AWAITING_OWNER_STALE_DAYS - 0.1 }),
      entry({ event_id: 3, age_days: null }),
    ]
    const rows = deriveAwaitingOwner({ awaiting_owner: entries } as never).needsDecision
    expect(rows[0]!.stale).toBe(true)
    expect(rows[0]!.ageLabel).toBe(`${AWAITING_OWNER_STALE_DAYS.toFixed(1)} d`)
    expect(rows[1]!.stale).toBe(false)
    expect(rows[2]!.stale).toBe(false)
    expect(rows[2]!.ageLabel).toBe('—')
  })

  it('defaults a missing availableActions to an empty array', () => {
    const view = deriveAwaitingOwner({
      awaiting_owner: [entry({ availableActions: undefined })],
    } as never)
    expect(view.needsDecision[0]!.availableActions).toEqual([])
  })
})

describe('pluralize', () => {
  it('pluralizes everything but exactly one', () => {
    expect(pluralize(0, 'strike')).toBe('0 strikes')
    expect(pluralize(1, 'strike')).toBe('1 strike')
    expect(pluralize(2, 'strike')).toBe('2 strikes')
  })
})

describe('withPendingAction', () => {
  it('adds an entry keyed by event id, carrying the verb and queuedAt', () => {
    const pending = withPendingAction({}, 1, 'implement', 1000)
    expect(pending).toEqual({ 1: { verb: 'implement', queuedAt: 1000 } })
  })

  it('overwrites an existing entry for the same event id rather than merging', () => {
    const first = withPendingAction({}, 1, 'implement', 1000)
    const second = withPendingAction(first, 1, 'dismiss', 2000)
    expect(second).toEqual({ 1: { verb: 'dismiss', queuedAt: 2000 } })
  })
})

describe('reconcilePendingActions', () => {
  const pendingFor = (eventId: number, verb: 'implement' | 'dismiss', queuedAt: number) =>
    ({ [eventId]: { verb, queuedAt } }) as PendingActions

  it('drops a pending entry once the item updated after it was queued', () => {
    const pending = pendingFor(1, 'implement', 1000)
    const items = [item({ event_id: 1, updated_at: new Date(2000).toISOString() })]
    expect(reconcilePendingActions(pending, items, 3000)).toEqual({})
  })

  it('keeps a pending entry when the item has not updated since it was queued', () => {
    const pending = pendingFor(1, 'implement', 2000)
    const items = [item({ event_id: 1, updated_at: new Date(1000).toISOString() })]
    expect(reconcilePendingActions(pending, items, 2500)).toEqual(pending)
  })

  it('keeps a pending entry for an item absent from the snapshot until it times out', () => {
    const pending = pendingFor(1, 'implement', 1000)
    expect(reconcilePendingActions(pending, [], 1000 + PENDING_ACTION_TIMEOUT_MS - 1)).toEqual(
      pending,
    )
  })

  it('drops a pending entry once it has been pending longer than the timeout', () => {
    const pending = pendingFor(1, 'implement', 1000)
    expect(reconcilePendingActions(pending, [], 1000 + PENDING_ACTION_TIMEOUT_MS + 1)).toEqual({})
  })

  it('returns the same reference when nothing was dropped, to avoid a needless re-render', () => {
    const pending = pendingFor(1, 'implement', 2000)
    const items = [item({ event_id: 1, updated_at: new Date(1000).toISOString() })]
    expect(reconcilePendingActions(pending, items, 2500)).toBe(pending)
  })
})

describe('deriveFunnel', () => {
  it('returns the six tiles in fixed order', () => {
    const tiles = deriveFunnel(undefined)
    expect(tiles.map((t) => t.key)).toEqual([
      'verdicts_recorded_disposition',
      'verified_fixes_vs_silence',
      'median_needs_decision_to_decision_hours',
      'verified_unattended_fixes_per_week',
      'poller_ages',
      'reverts_and_reopens',
    ])
  })

  it('marks a missing metric as null value with an unavailable reason, never a bare 0', () => {
    const tiles = deriveFunnel(undefined)
    for (const tile of tiles) {
      expect(tile.value).toBeNull()
      expect(tile.unavailable).toBe('not reported')
    }
  })

  it('passes through a reported value and its own unavailable reason', () => {
    const metrics = {
      verdicts_recorded_disposition: {
        value: 0.72,
        unavailable: null,
        numerator: 13,
        denominator: 18,
      },
      median_needs_decision_to_decision_hours: {
        value: null,
        unavailable: 'window start predates history_since',
        pairs: 0,
      },
    } as unknown as WardenMetrics
    const tiles = deriveFunnel(metrics)
    const disposition = tiles.find((t) => t.key === 'verdicts_recorded_disposition')!
    expect(disposition.value).toBe(0.72)
    expect(disposition.unavailable).toBeNull()
    expect(disposition.detail).toBe('numerator: 13 · denominator: 18')

    const median = tiles.find((t) => t.key === 'median_needs_decision_to_decision_hours')!
    expect(median.value).toBeNull()
    expect(median.unavailable).toBe('window start predates history_since')
    expect(median.detail).toBe('pairs: 0')
  })

  it('reads a composite metric (reverts_and_reopens) with no top-level value from its children', () => {
    const metrics = {
      reverts_and_reopens: {
        reopen_after_fixed: {
          value: null,
          unavailable: 'window start predates history_since',
          windowed: true,
          window_days: 7,
        },
        reverts: { value: 0, unavailable: null, windowed: true, window_days: 7 },
      },
    } as unknown as WardenMetrics
    const tile = deriveFunnel(metrics).find((t) => t.key === 'reverts_and_reopens')!
    expect(tile.value).toBe(0)
    expect(tile.unavailable).toBeNull()
    expect(tile.detail).toBe(
      'reopen_after_fixed: n/a — window start predates history_since · reverts: 0',
    )
  })

  it("falls back to n/a with the first child's reason when no composite child has a value", () => {
    const metrics = {
      reverts_and_reopens: {
        reopen_after_fixed: { value: null, unavailable: 'reason A' },
        reverts: { value: null, unavailable: 'reason B' },
      },
    } as unknown as WardenMetrics
    const tile = deriveFunnel(metrics).find((t) => t.key === 'reverts_and_reopens')!
    expect(tile.value).toBeNull()
    expect(tile.unavailable).toBe('reason A')
  })

  it('renders only scalar fields as detail lines, flattens a nested object into one line, drops _note keys, and caps at 4 lines', () => {
    const metrics = {
      verdicts_recorded_disposition: {
        value: 0.72,
        unavailable: null,
        numerator: 13,
        denominator: 18,
        item_states: { closed: 4, fixed: 1, failed: 4, needs_decision: 8, quiet: 9 },
        item_states_note: '…',
        excluded_interactive: 11,
        excluded_interactive_note: '…',
        windowed: false,
      },
    } as unknown as WardenMetrics
    const tile = deriveFunnel(metrics).find((t) => t.key === 'verdicts_recorded_disposition')!
    expect(tile.detail).toBe(
      'numerator: 13 · denominator: 18 · item_states · closed 4 · fixed 1 · failed 4 · needs_decision 8 · quiet 9 · excluded_interactive: 11',
    )
    expect(tile.detail).not.toContain('windowed')
    expect(tile.detail).not.toContain('{')
    expect(tile.detail).not.toContain('_note')
  })
})

describe('formatTileNumber', () => {
  it('rounds a long float to at most one decimal', () => {
    expect(formatTileNumber(4.695051216666667)).toBe('4.7')
  })

  it('prints a whole number with no decimal, never a trailing .0', () => {
    expect(formatTileNumber(0)).toBe('0')
    expect(formatTileNumber(5)).toBe('5')
  })

  it('keeps a single meaningful decimal', () => {
    expect(formatTileNumber(4.5)).toBe('4.5')
  })
})

describe('formatTileValue', () => {
  const tile = (overrides: Partial<Parameters<typeof formatTileValue>[0]>) =>
    ({
      key: 'poller_ages',
      label: 'Poller age (min)',
      description: 'Poller ages',
      value: null,
      unavailable: null,
      detail: '',
      ...overrides,
    }) as Parameters<typeof formatTileValue>[0]

  it('renders n/a for a null value', () => {
    expect(formatTileValue(tile({ value: null }))).toBe('n/a')
  })

  it('renders a ratio key as a whole percent', () => {
    expect(formatTileValue(tile({ key: 'verdicts_recorded_disposition', value: 0.72 }))).toBe('72%')
    expect(formatTileValue(tile({ key: 'verified_fixes_vs_silence', value: 0.0909 }))).toBe('9%')
  })

  it('renders every other metric rounded to at most one decimal', () => {
    expect(formatTileValue(tile({ key: 'poller_ages', value: 4.695051216666667 }))).toBe('4.7')
    expect(formatTileValue(tile({ key: 'reverts_and_reopens', value: 0 }))).toBe('0')
  })
})

describe('formatSourceLine', () => {
  it('defaults an absent source to an em dash', () => {
    expect(formatSourceLine(null, '42')).toBe('—:42')
  })

  it('suffixes the external id only when present', () => {
    expect(formatSourceLine('github', null)).toBe('github')
    expect(formatSourceLine('github', '42')).toBe('github:42')
  })
})

describe('formatVerdictLine', () => {
  it('falls back to an em dash with no summary or detail parts', () => {
    expect(formatVerdictLine({})).toBe('—')
  })

  it('joins the summary with whichever detail parts are present', () => {
    expect(
      formatVerdictLine({
        summary: 'looks fine',
        nextAction: 'merge',
        confidence: 'high',
        outcome: 'fixed',
      }),
    ).toBe('looks fine · next: merge · confidence: high · outcome: fixed')
  })

  it('drops an absent detail part rather than rendering an empty segment', () => {
    expect(formatVerdictLine({ summary: 'ok', outcome: 'fixed' })).toBe('ok · outcome: fixed')
  })
})

describe('buildItemFacts', () => {
  it('reads every field as absent when both item and event are null', () => {
    const facts = buildItemFacts(null, null)
    expect(facts).toEqual({
      title: null,
      source: null,
      externalId: null,
      state: null,
      origin: null,
      signature: null,
      lines: [],
      note: null,
      brief: null,
      payloadSummary: null,
      unmapped: false,
    })
  })

  it("prefers the event's title over the item's", () => {
    expect(buildItemFacts({ title: 'item title' }, { title: 'event title' }).title).toBe(
      'event title',
    )
    expect(buildItemFacts({ title: 'item title' }, null).title).toBe('item title')
  })

  it('reads a numeric external_id as a string', () => {
    expect(buildItemFacts(null, { external_id: 42 }).externalId).toBe('42')
    expect(buildItemFacts(null, { external_id: '42' }).externalId).toBe('42')
  })

  it('combines seen and occurrence facts into one line, in order', () => {
    const facts = buildItemFacts(
      { first_seen: '2026-09-01T00:00:00Z', last_seen: '2026-09-02T00:00:00Z', occurrences: 3 },
      null,
    )
    expect(facts.lines[0]).toContain('first seen')
    expect(facts.lines[0]).toContain('last seen')
    expect(facts.lines[0]).toContain('3 occurrences')
  })

  it('renders occurrences alone when neither seen timestamp is present', () => {
    const facts = buildItemFacts({ occurrences: 1 }, null)
    expect(facts.lines).toEqual(['1 occurrence'])
  })

  it('never renders a seen/occurrences line when none of the three are present', () => {
    expect(buildItemFacts({}, {}).lines).toEqual([])
  })

  it('reports resolved, the alert reminder count and strikes/retry as separate lines', () => {
    const facts = buildItemFacts(
      { strikes: 2, retry_at: '2026-09-05T00:00:00Z' },
      {
        resolved_at: '2026-09-04T00:00:00Z',
        reminder_count: 5,
        last_reminder_at: '2026-09-03T00:00:00Z',
      },
    )
    expect(facts.lines.some((line) => line.startsWith('resolved '))).toBe(true)
    expect(facts.lines.some((line) => line.startsWith('Alert reminders: 5'))).toBe(true)
    expect(facts.lines).toContain('2 strikes')
    expect(facts.lines.some((line) => line.startsWith('retry '))).toBe(true)
  })

  it('never renders a reminder or strike line for a zero or absent count', () => {
    const facts = buildItemFacts({ strikes: 0 }, { reminder_count: 0 })
    expect(facts.lines).toEqual([])
  })

  it("shows a closed item's close_reason on its state", () => {
    expect(buildItemFacts({ state: 'closed', close_reason: 'duplicate' }, null).state).toBe(
      'closed · duplicate',
    )
    expect(buildItemFacts({ state: 'working', close_reason: null }, null).state).toBe('working')
  })

  it('summarizes the event payload only for a brief-less alert-origin item', () => {
    const payload = { status: 'firing' }
    expect(buildItemFacts({ origin: 'alert' }, { payload }).payloadSummary).toBe('status: firing')
    expect(
      buildItemFacts({ origin: 'alert', brief: 'has a brief' }, { payload }).payloadSummary,
    ).toBeNull()
    expect(buildItemFacts({ origin: 'other' }, { payload }).payloadSummary).toBeNull()
  })

  it('flags an alert item unmapped only when it has neither a repo nor a verb', () => {
    expect(buildItemFacts({ origin: 'alert' }, null).unmapped).toBe(true)
    expect(buildItemFacts({ origin: 'alert', repo: 'argo' }, null).unmapped).toBe(false)
    expect(buildItemFacts({ origin: 'alert', verb: 'restart' }, null).unmapped).toBe(false)
    expect(buildItemFacts({ origin: 'other' }, null).unmapped).toBe(false)
  })
})

describe('resolveItemModal', () => {
  const items = {
    '1': { item: { state: 'new' }, event: { title: 'e1' }, transitions_total: 9 },
  } as unknown as WardenItems

  it('is closed with no title when eventId is null', () => {
    const modal = resolveItemModal(null, items)
    expect(modal.opened).toBe(false)
    expect(modal.title).toBe('')
    expect(modal.timeline).toBeUndefined()
  })

  it('says the timeline is missing when the event id is not in the snapshot', () => {
    const modal = resolveItemModal(2, items)
    expect(modal.opened).toBe(true)
    expect(modal.title).toBe('Item #2')
    expect(modal.timeline).toBeUndefined()
  })

  it('resolves the item/event pair and defaults every list to empty', () => {
    const modal = resolveItemModal(1, items)
    expect(modal.timeline).toBeDefined()
    expect((modal.facts.item as Row)['state']).toBe('new')
    expect((modal.facts.event as Row)['title']).toBe('e1')
    expect(modal.facts.transitionsTotal).toBe(9)
    expect(modal.facts.dispatches).toEqual([])
    expect(modal.facts.operations).toEqual([])
  })
})
