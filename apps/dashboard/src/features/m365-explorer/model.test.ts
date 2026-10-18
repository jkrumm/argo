import { describe, expect, test } from 'bun:test'
import {
  chatKindCounts,
  groupByRecency,
  chipCounts,
  visibleChipCounts,
  coverageOf,
  formatTime,
  headlineOf,
  labeledCount,
  outsideNote,
  sourcesTitle,
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
      tags: [
        ['a', 2],
        ['b', 0],
      ],
    })
  })
  test('keeps an unloaded-team tag while the row set is incomplete', () => {
    const c = chipCounts(['a', 'b'], [{ label: 'a' }], null)
    expect(visibleChipCounts(c, '').tags).toEqual([
      ['a', 1],
      ['b', 0],
    ])
  })
  test('drops a zero non-active tag once settled, keeps a zero active one', () => {
    const c = chipCounts(['a', 'b', 'c'], [{ label: 'a' }], 1)
    expect(visibleChipCounts(c, '').tags).toEqual([['a', 1]])
    expect(visibleChipCounts(c, 'c').tags).toEqual([
      ['a', 1],
      ['c', 0],
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

describe('headlineOf', () => {
  test('leads with the week activity and keeps the facts to units', () => {
    expect(headlineOf({ activeWeek: 4, labeled: 12, tags: 3, latest: '17 Oct, 11:58' })).toEqual({
      sentence: '4 chats active in the last 7 days',
      facts: ['12 labeled', '3 tags in use', 'latest activity 17 Oct, 11:58'],
    })
    expect(headlineOf({ activeWeek: 1, labeled: 0, tags: 1, latest: null })).toEqual({
      sentence: '1 chat active in the last 7 days',
      facts: ['0 labeled', '1 tag in use'],
    })
  })
})

describe('labeled count, outside note and sources title', () => {
  const cov = { total: 5, labeled: 2, outside: 1, loading: 0, failed: 0 }
  test('one labeled count, unknown while a team loads', () => {
    expect(labeledCount(cov)).toBe(2)
    expect(labeledCount({ ...cov, loading: 1 })).toBeNull()
    expect(labeledCount({ ...cov, failed: 1 })).toBeNull()
    expect(headlineOf({ activeWeek: 1, labeled: null, tags: 1, latest: null }).facts).toEqual([
      '1 tag in use',
    ])
  })
  test('the outside note names the set', () => {
    expect(outsideNote(cov)).toBe('1 label on chats or channels not in this list')
    expect(outsideNote({ ...cov, outside: 0 })).toBeNull()
  })
  test('the sources title is a fact per view', () => {
    const base = { chats: 3, channels: 7, teams: 2, labeled: 1 }
    expect(sourcesTitle({ ...base, view: 'chats' })).toBe('3 chats')
    expect(sourcesTitle({ ...base, view: 'teams' })).toBe('7 channels in 2 teams')
    expect(sourcesTitle({ ...base, view: 'teams', channels: null })).toBe('2 teams')
    expect(sourcesTitle({ ...base, view: 'feed' })).toBe('1 labeled source')
  })
})
