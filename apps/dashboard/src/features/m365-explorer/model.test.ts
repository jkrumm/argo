import { describe, expect, test } from 'bun:test'
import {
  chatKindCounts,
  groupByRecency,
  labelableTotal,
  matchesTag,
  parseChannelId,
  tagCountsOf,
  LABELED_FILTER,
  type ChatRow,
} from './model'

const NOW = new Date('2026-10-17T12:00:00')
const row = (id: string, iso: string | null, chatType: ChatRow['chatType'] = 'group'): ChatRow => ({
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
      ['This week', 1],
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

describe('labelableTotal', () => {
  test('sums chats and channels, null while a team is loading', () => {
    expect(labelableTotal(3, [2, 0, 4])).toBe(9)
    expect(labelableTotal(3, [2, null])).toBeNull()
    expect(labelableTotal(3, [])).toBe(3)
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
