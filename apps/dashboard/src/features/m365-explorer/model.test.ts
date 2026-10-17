import { describe, expect, test } from 'bun:test'
import {
  chatKindCounts,
  groupByRecency,
  chipCounts,
  coverageOf,
  formatTime,
  validTag,
  matchesTag,
  parseChannelId,
  tagCountsOf,
  LABELED_FILTER,
  type ChatRow,
} from './model'

const NOW = new Date('2026-10-17T12:00:00')
const row = (id: string, iso: string | null, chatType: ChatRow['chatType'] = 'group'): ChatRow => ({
  searchText: id,
  ref: { kind: 'chat', chatId: id, displayName: id },
  chatType,
  memberCount: 2,
  lastUpdatedAt: iso,
  webUrl: null,
})

describe('groupByRecency', () => {
  test('buckets today / this week / earlier and drops empty groups', () => {
    const groups = groupByRecency(
      [
        row('a', '2026-10-17T08:00:00'),
        row('b', '2026-10-14T08:00:00'),
        row('c', '2026-09-01T08:00:00'),
        row('d', null),
      ],
      NOW,
    )
    expect(groups.map((g) => [g.group, g.rows.length])).toEqual([
      ['Today', 1],
      ['Last 7 days', 1],
      ['Earlier', 2],
    ])
    expect(groupByRecency([row('c', '2026-09-01T08:00:00')], NOW).map((g) => g.group)).toEqual([
      'Earlier',
    ])
  })
})

describe('groupByRecency order', () => {
  test('sorts each group newest first whatever the input order', () => {
    const [g] = groupByRecency(
      [row('old', '2026-10-13T08:00:00'), row('new', '2026-10-16T08:00:00')],
      NOW,
    )
    expect(g?.rows.map((r) => r.ref.chatId)).toEqual(['new', 'old'])
  })
})

describe('chatKindCounts', () => {
  test('counts the three kinds and ignores unknown values', () => {
    expect(
      chatKindCounts([
        { chatType: 'oneOnOne' },
        { chatType: 'group' },
        { chatType: 'group' },
        { chatType: 'meeting' },
        { chatType: 'unknownFutureValue' },
      ]),
    ).toEqual({ oneOnOne: 1, group: 2, meeting: 1 })
  })
})

const lab = (sourceId: string) => ({
  sourceId,
  kind: 'chat' as const,
  label: 'x',
  displayName: null,
  notes: null,
})

describe('coverageOf', () => {
  test('counts labeled over the loaded ids only, never more than the total', () => {
    const c = coverageOf({
      chatIds: ['a', 'b'],
      channels: [{ teamId: 'T', state: 'loaded', ids: ['c1'] }],
      labels: [lab('chat:a'), lab('channel:T:c1'), lab('chat:gone'), lab('channel:T:removed')],
    })
    expect(c).toMatchObject({ total: 3, labeled: 2, outside: 2, loading: 0, failed: 0 })
  })
  test('a loading or failed team makes the total a lower bound and hides "outside"', () => {
    const c = coverageOf({
      chatIds: ['a'],
      channels: [
        { teamId: 'T', state: 'failed', ids: [] },
        { teamId: 'U', state: 'loading', ids: [] },
      ],
      labels: [lab('channel:T:c1')],
    })
    expect(c).toMatchObject({ total: 1, labeled: 0, outside: 0, loading: 1, failed: 1 })
  })
})

const l = (sourceId: string, label: string) => ({
  sourceId,
  kind: 'chat' as const,
  label,
  displayName: null,
  notes: null,
})

describe('tags', () => {
  test('counts by tag, biggest first then by name', () => {
    expect(tagCountsOf([l('1', 'b'), l('2', 'a'), l('3', 'a'), l('4', 'c')])).toEqual([
      ['a', 2],
      ['b', 1],
      ['c', 1],
    ])
  })
  test('matchesTag', () => {
    expect(matchesTag('', undefined)).toBe(true)
    expect(matchesTag(LABELED_FILTER, undefined)).toBe(false)
    expect(matchesTag(LABELED_FILTER, { label: 'x' })).toBe(true)
    expect(matchesTag('x', { label: 'y' })).toBe(false)
  })
})

describe('parseChannelId', () => {
  test('splits a channel source id, rejects chats', () => {
    expect(parseChannelId('channel:T:C')).toEqual({ teamId: 'T', channelId: 'C' })
    expect(parseChannelId('channel:T:19:abc@thread.tacv2')).toEqual({
      teamId: 'T',
      channelId: '19:abc@thread.tacv2',
    })
    expect(parseChannelId('chat:X')).toBeNull()
  })
})

describe('chipCounts / validTag', () => {
  test('counts the rows of the view, per tag', () => {
    const c = chipCounts(['a', 'b'], [{ label: 'a' }, { label: 'a' }, { label: undefined }], 3)
    expect(c).toEqual({
      all: 3,
      labeled: 2,
      tags: [['a', 2]],
    })
  })
  test('keeps a zero-count tag only while it is the active filter', () => {
    const rows = [{ label: 'a' }]
    expect(chipCounts(['a', 'b'], rows, 1, 'b').tags).toEqual([
      ['a', 1],
      ['b', 0],
    ])
  })
  test('validTag drops a tag that no longer exists', () => {
    expect(validTag('gone', ['a'])).toBe('')
    expect(validTag('a', ['a'])).toBe('a')
    expect(validTag(LABELED_FILTER, [])).toBe(LABELED_FILTER)
  })
})

describe('formatTime', () => {
  test('uses the passed reference day, not the system clock', () => {
    expect(formatTime('2026-10-17T08:05:00', NOW)).toMatch(/08:05/)
    expect(formatTime('2026-10-14T08:05:00', NOW)).not.toMatch(/08:05/)
    expect(formatTime(null, NOW)).toBe('')
  })
})
