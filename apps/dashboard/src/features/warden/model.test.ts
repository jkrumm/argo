import { describe, expect, it } from 'bun:test'
import {
  BUCKET_ORDER,
  deriveBoard,
  deriveFunnel,
  formatTileNumber,
  formatTileValue,
  intentSummary,
  isDeferredItem,
  isStale,
} from './model'
import type { WardenBoardItem, WardenMetrics } from '../../lib/queries/warden'

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
  it('is true only for a verdict item whose note starts with "deferred:"', () => {
    expect(isDeferredItem(item({ state: 'verdict', note: 'deferred: implement budget 5/5' }))).toBe(
      true,
    )
    expect(isDeferredItem(item({ state: 'verdict', note: 'something else' }))).toBe(false)
    expect(isDeferredItem(item({ state: 'new', note: 'deferred: x' }))).toBe(false)
    expect(isDeferredItem(item({ state: 'verdict' }))).toBe(false)
  })
})

describe('deriveBoard', () => {
  it('returns every bucket, in fixed order, even when empty', () => {
    const buckets = deriveBoard(undefined)
    expect(buckets.map((b) => b.key)).toEqual([...BUCKET_ORDER])
    expect(buckets.every((b) => b.items.length === 0)).toBe(true)
  })

  it('carves deferred verdict items out of the verdict bucket', () => {
    const items = [
      item({ event_id: 1, state: 'verdict', note: 'deferred: implement budget 5/5 used today' }),
      item({ event_id: 2, state: 'verdict', note: 'ship it' }),
      item({ event_id: 3, state: 'needs_human' }),
    ]
    const buckets = deriveBoard({ items })
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b.items]))
    expect(byKey['deferred']!.map((i) => i.event_id)).toEqual([1])
    expect(byKey['verdict']!.map((i) => i.event_id)).toEqual([2])
    expect(byKey['needs_human']!.map((i) => i.event_id)).toEqual([3])
  })

  it('collects an item whose state is outside the vocabulary into unknown, never dropping it', () => {
    const items = [item({ event_id: 1, state: 'snoozed' }), item({ event_id: 2, state: 'new' })]
    const buckets = deriveBoard({ items })
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b.items]))
    expect(byKey['unknown']!.map((i) => i.event_id)).toEqual([1])
    expect(byKey['new']!.map((i) => i.event_id)).toEqual([2])
    const total = buckets.reduce((sum, b) => sum + b.items.length, 0)
    expect(total).toBe(items.length)
  })
})

describe('deriveFunnel', () => {
  it('returns the six tiles in fixed order', () => {
    const tiles = deriveFunnel(undefined)
    expect(tiles.map((t) => t.key)).toEqual([
      'verdicts_recorded_disposition',
      'verified_fixes_vs_silence',
      'median_needs_human_to_decision_hours',
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
      median_needs_human_to_decision_hours: {
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

    const median = tiles.find((t) => t.key === 'median_needs_human_to_decision_hours')!
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
        item_states: { closed: 4, fixed: 1, merge_blocked: 4, needs_human: 8, quiet: 9 },
        item_states_note: '…',
        excluded_interactive: 11,
        excluded_interactive_note: '…',
        windowed: false,
      },
    } as unknown as WardenMetrics
    const tile = deriveFunnel(metrics).find((t) => t.key === 'verdicts_recorded_disposition')!
    expect(tile.detail).toBe(
      'numerator: 13 · denominator: 18 · item_states · closed 4 · fixed 1 · merge_blocked 4 · needs_human 8 · quiet 9 · excluded_interactive: 11',
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

describe('intentSummary', () => {
  it('reads none recorded when intents is absent', () => {
    expect(intentSummary(undefined)).toEqual({ pending: 0, rejected: 0, entries: [] })
  })

  it('passes through the counts and entries', () => {
    const entries = [{ file: 'x', kind: 'approval_decision' }]
    expect(intentSummary({ pending: 1, rejected: 2, entries } as never)).toEqual({
      pending: 1,
      rejected: 2,
      entries,
    })
  })
})
