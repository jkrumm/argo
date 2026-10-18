import { describe, expect, test } from 'bun:test'
import {
  chatKindCounts,
  chatKindParts,
  sectionTitleFor,
  groupByRecency,
  chipCounts,
  visibleChipCounts,
  coverageOf,
  formatTime,
  headlineOf,
  labeledCount,
  labeledBasis,
  largestTeam,
  labeledPaneTitle,
  channelsFooter,
  sourceListName,
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
  test('counts the kinds; an unknown kind lands in other so they sum to the rows', () => {
    expect(
      chatKindCounts([
        { chatType: 'oneOnOne' },
        { chatType: 'group' },
        { chatType: 'group' },
        { chatType: 'meeting' },
        { chatType: 'unknownFutureValue' },
      ]),
    ).toEqual({ oneOnOne: 1, group: 2, meeting: 1, other: 1 })
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
  test('is the newest stamp only: no count the recency groups already print', () => {
    expect(headlineOf({ latest: '17 Oct, 11:58' })).toEqual({
      sentence: 'Latest activity 17 Oct, 11:58',
    })
    expect(headlineOf({ latest: null })).toEqual({ sentence: 'No chat activity yet' })
  })
})

describe('chatKindParts', () => {
  test('drops kinds with no chats, reads in order and counts the noun', () => {
    expect(chatKindParts({ oneOnOne: 4, group: 1, meeting: 2, other: 0 })).toEqual([
      { key: 'oneOnOne', label: '1:1', text: '4 1:1 chats', value: 4 },
      { key: 'group', label: 'group', text: '1 group chat', value: 1 },
      { key: 'meeting', label: 'meeting', text: '2 meetings', value: 2 },
    ])
    expect(chatKindParts({ oneOnOne: 0, group: 0, meeting: 1, other: 3 })[1]?.text).toBe(
      '3 other chats',
    )
    expect(chatKindParts({ oneOnOne: 0, group: 0, meeting: 0, other: 0 })).toEqual([])
  })
})

describe('sectionTitleFor', () => {
  const base = { tag: '', open: false, sources: '3 chats' }
  test('says a fact about the pane, not the tab name', () => {
    expect(sectionTitleFor({ ...base, pane: 'sources' })).toBe('3 chats')
    expect(sectionTitleFor({ ...base, pane: 'labeled' })).toBe('Grouped by tag')
    expect(sectionTitleFor({ ...base, pane: 'labeled', tag: LABELED_FILTER })).toBe(
      'Grouped by tag',
    )
    expect(sectionTitleFor({ ...base, pane: 'labeled', tag: 'alerts' })).toBe('alerts')
    expect(sectionTitleFor({ ...base, pane: 'detail', open: true })).toBe('Messages')
    expect(sectionTitleFor({ ...base, pane: 'detail' })).toBe('Nothing open')
  })
})

describe('largestTeam', () => {
  const team = (
    name: string,
    channels: number,
    state: 'loaded' | 'loading' | 'failed' = 'loaded',
  ) => ({
    name,
    channels,
    state,
  })
  test('picks the team with the most channels, first wins a tie', () => {
    expect(largestTeam([team('a', 2), team('b', 5), team('c', 5)])).toEqual({
      name: 'b',
      channels: 5,
    })
  })
  test('is null without channels or without teams', () => {
    expect(largestTeam([team('a', 0)])).toBeNull()
    expect(largestTeam([])).toBeNull()
  })
  test('is null while any team is loading or failed', () => {
    expect(largestTeam([team('a', 4), team('b', 0, 'loading')])).toBeNull()
    expect(largestTeam([team('a', 4), team('b', 0, 'failed')])).toBeNull()
  })
})

describe('labeledPaneTitle', () => {
  test('names the tag in view, or the whole set', () => {
    expect(labeledPaneTitle('')).toBe('Labeled sources')
    expect(labeledPaneTitle(LABELED_FILTER)).toBe('Labeled sources')
    expect(labeledPaneTitle('alerts')).toBe('Labeled sources · alerts')
  })
})

describe('labeled count, outside note and sources title', () => {
  const cov = { total: 5, labeled: 2, outside: 1, loading: 0, failed: 0 }
  test('one labeled count, unknown while a team loads', () => {
    expect(labeledCount(cov)).toBe(2)
    expect(labeledCount({ ...cov, loading: 1 })).toBeNull()
    expect(labeledCount({ ...cov, failed: 1 })).toBeNull()
  })
  test('the footer names the list the count ranges over', () => {
    const list = sourceListName(50, true)
    expect(list).toBe('newest 50 chats and channels')
    expect(sourceListName(12, false)).toBe('chats and channels')
    expect(labeledBasis(cov, list)).toBe(
      '1 more label on sources not in the newest 50 chats and channels',
    )
    expect(labeledBasis({ ...cov, outside: 0 }, list)).toBe(
      'across the newest 50 chats and channels',
    )
  })
  test('the sources title is a fact per view', () => {
    const base = { chats: 3, channels: 7, teams: 2, labeled: 1 }
    expect(sourcesTitle({ ...base, view: 'chats' })).toBe('3 chats')
    expect(sourcesTitle({ ...base, view: 'teams' })).toBe('7 channels in 2 teams')
    expect(sourcesTitle({ ...base, view: 'teams', channels: null })).toBe('2 teams')
    expect(sourcesTitle({ ...base, view: 'feed' })).toBe('1 labeled source')
  })
})

describe('channelsFooter', () => {
  const largest = { name: 'Team A', channels: 3 }
  test('a failure outranks everything and counts the teams', () => {
    expect(channelsFooter({ channels: null, largest: null, failed: 1 })).toBe(
      '1 team failed to load',
    )
    expect(channelsFooter({ channels: 5, largest, failed: 2 })).toBe('2 teams failed to load')
  })
  test('loading, empty and populated read differently', () => {
    expect(channelsFooter({ channels: null, largest: null, failed: 0 })).toBe('still loading')
    expect(channelsFooter({ channels: 0, largest: null, failed: 0 })).toBe('no channels')
    expect(channelsFooter({ channels: 5, largest, failed: 0 })).toBe('most in Team A, 3 channels')
    expect(channelsFooter({ channels: 1, largest: { name: 'T', channels: 1 }, failed: 0 })).toBe(
      'most in T, 1 channel',
    )
  })
})
