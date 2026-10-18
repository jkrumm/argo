import { NBSP } from '../../lib/format'
import { describe, expect, test } from 'bun:test'
import {
  chatKindCounts,
  chatKindParts,
  chatsStat,
  NO_CHATS,
  noTeamsSettled,
  chatsCapped,
  CHATS_TOP,
  sectionTitleFor,
  groupByRecency,
  chipCounts,
  visibleChipCounts,
  coverageOf,
  formatTime,
  headlineOf,
  labeledBasis,
  labeledSegmentCaption,
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
  const at = (day: number) => new Date(2026, 9, day, 12).toISOString()
  test('says how many days the loaded chats span', () => {
    expect(headlineOf({ times: [at(17), at(3), null], capped: false })).toEqual({
      sentence: `Chats span 14${NBSP}d, 3–17${NBSP}Oct`,
    })
  })
  test('a capped list says the span belongs to the newest slice', () => {
    expect(headlineOf({ times: [at(17), at(10)], capped: true })).toEqual({
      sentence: `Newest 2 chats span 7${NBSP}d, 10–17${NBSP}Oct`,
    })
  })
  test('across years both ends carry their year, even with the same month name', () => {
    const on = (y: number, mo: number, d: number) => new Date(y, mo, d, 12).toISOString()
    expect(headlineOf({ times: [on(2026, 9, 3), on(2025, 9, 17)], capped: false }).sentence).toBe(
      `Chats span 351${NBSP}d, 17${NBSP}Oct${NBSP}2025 – 3${NBSP}Oct${NBSP}2026`,
    )
    expect(headlineOf({ times: [on(2026, 0, 2), on(2025, 11, 30)], capped: false }).sentence).toBe(
      `Chats span 3${NBSP}d, 30${NBSP}Dec${NBSP}2025 – 2${NBSP}Jan${NBSP}2026`,
    )
  })
  test('across months the ends name their month', () => {
    const on = (mo: number, d: number) => new Date(2026, mo, d, 12).toISOString()
    expect(headlineOf({ times: [on(9, 3), on(8, 28)], capped: false }).sentence).toBe(
      `Chats span 5${NBSP}d, 28${NBSP}Sep – 3${NBSP}Oct`,
    )
  })
  test('one day and no stamps', () => {
    expect(headlineOf({ times: [at(17), at(17)], capped: false }).sentence).toBe(
      `Chats all from 17${NBSP}Oct`,
    )
    expect(headlineOf({ times: [], capped: false })).toEqual({ sentence: 'No chat activity yet' })
    expect(headlineOf({ times: [null], capped: false }).sentence).toBe('No chat activity yet')
  })
})

describe('chatsCapped', () => {
  test('a list of exactly the request size may be cut', () => {
    expect(chatsCapped(CHATS_TOP - 1)).toBe(false)
    expect(chatsCapped(CHATS_TOP)).toBe(true)
  })
})

describe('chatKindParts', () => {
  test('drops kinds with no chats, biggest first and counts the noun', () => {
    expect(chatKindParts({ oneOnOne: 4, group: 1, meeting: 2, other: 0 })).toEqual([
      { key: 'oneOnOne', label: 'direct', noun: 'direct chats', text: '4 direct chats', value: 4 },
      { key: 'meeting', label: 'meeting', noun: 'meetings', text: '2 meetings', value: 2 },
      { key: 'group', label: 'group', noun: 'group chat', text: '1 group chat', value: 1 },
    ])
    expect(chatKindParts({ oneOnOne: 0, group: 0, meeting: 1, other: 3 })[0]?.text).toBe(
      '3 other chats',
    )
    expect(chatKindParts({ oneOnOne: 0, group: 0, meeting: 0, other: 0 })).toEqual([])
  })

  test('every kind with chats is covered with its count, the value the bar caption prints', () => {
    const parts = chatKindParts({ oneOnOne: 5, group: 3, meeting: 2, other: 1 })
    expect(parts.map((p) => [p.key, p.value])).toEqual([
      ['oneOnOne', 5],
      ['group', 3],
      ['meeting', 2],
      ['other', 1],
    ])
  })

  test('a tie keeps reading order', () => {
    const parts = chatKindParts({ oneOnOne: 2, group: 2, meeting: 2, other: 2 })
    expect(parts.map((p) => p.key)).toEqual(['oneOnOne', 'group', 'meeting', 'other'])
  })
})

describe('chatsStat', () => {
  test('the leading kind is the hero; the bar captions name the rest, so no empty line', () => {
    expect(chatsStat({ oneOnOne: 4, group: 1, meeting: 2, other: 0 })).toEqual({
      hero: { value: '4', unit: 'direct chats' },
      empty: null,
    })
    expect(chatsStat({ oneOnOne: 1, group: 3, meeting: 3, other: 0 })).toEqual({
      hero: { value: '3', unit: 'group chats' },
      empty: null,
    })
  })
  test('one kind is the hero alone, none says so', () => {
    expect(chatsStat({ oneOnOne: 0, group: 0, meeting: 1, other: 0 })).toEqual({
      hero: { value: '1', unit: 'meeting' },
      empty: null,
    })
    expect(chatsStat({ oneOnOne: 0, group: 0, meeting: 0, other: 0 })).toEqual({
      hero: null,
      empty: NO_CHATS,
    })
  })
})

describe('sectionTitleFor', () => {
  const base = { view: 'chats', tag: '', open: false } as const
  test('says a fact about the pane, not the tab name or a count', () => {
    expect(sectionTitleFor({ ...base, pane: 'sources' })).toBe('Chats')
    expect(sectionTitleFor({ ...base, pane: 'sources', view: 'teams' })).toBe('Teams')
    expect(sectionTitleFor({ ...base, pane: 'sources', view: 'feed' })).toBe('Feed sources')
    expect(sectionTitleFor({ ...base, pane: 'labeled' })).toBe('Chats and channels')
    expect(sectionTitleFor({ ...base, pane: 'labeled', tag: LABELED_FILTER })).toBe(
      'Chats and channels',
    )
    expect(sectionTitleFor({ ...base, pane: 'labeled', tag: 'alerts' })).toBe('alerts')
    expect(sectionTitleFor({ ...base, pane: 'detail', open: true })).toBe('Messages')
    expect(sectionTitleFor({ ...base, pane: 'detail' })).toBe('Nothing open')
    expect(sectionTitleFor({ ...base, pane: 'detail', view: 'feed' })).toBe('Agent feed')
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
  test('one labeled count, unknown while a team loads', () => {})
  test('the footer names the list the count ranges over', () => {
    const list = sourceListName(50, true)
    expect(list).toBe('newest 50 chats and all channels')
    expect(sourceListName(12, false)).toBe('chats and channels')
    expect(labeledBasis(cov, { chats: CHATS_TOP, capped: true })).toBe(
      '1 more label on chats outside the newest 50, or gone from the list',
    )
    expect(labeledBasis(cov, { chats: 12, capped: false })).toBe(
      '1 more label on sources gone from the chat and channel list',
    )
    expect(labeledBasis({ ...cov, outside: 0 }, { chats: CHATS_TOP, capped: true })).toBe(
      'across the newest 50 chats and all channels',
    )
  })
  test('a loading or failed team never reads as covered', () => {
    expect(
      labeledBasis({ ...cov, outside: 0, loading: 1 }, { chats: CHATS_TOP, capped: true }),
    ).toBe('across the newest 50 chats and channels')
    expect(
      labeledBasis({ ...cov, outside: 0, failed: 1 }, { chats: CHATS_TOP, capped: true }),
    ).toBe('across the newest 50 chats and channels')
  })
  test('the sources title is the pane name only', () => {
    expect(sourcesTitle('chats')).toBe('Chats')
    expect(sourcesTitle('teams')).toBe('Teams')
    expect(sourcesTitle('feed')).toBe('Feed sources')
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
    expect(channelsFooter({ channels: 0, largest: null, failed: 0 })).toBeNull()
    expect(channelsFooter({ channels: 5, largest, failed: 0 })).toBe('most in Team A, 3 channels')
    expect(channelsFooter({ channels: 1, largest: { name: 'T', channels: 1 }, failed: 0 })).toBe(
      'most in T, 1 channel',
    )
  })
})

describe('labeledSegmentCaption', () => {
  test('the labeled segment drops the count the hero prints', () => {
    expect(labeledSegmentCaption(2, 2, 7)).toBe('')
    expect(labeledSegmentCaption(7, 2, 7)).toBe('7')
  })
  test('a tie keeps both counts', () => {
    expect(labeledSegmentCaption(3, 3, 3)).toBe('3')
  })
  test('all labeled: the zero unlabeled segment keeps its count', () => {
    expect(labeledSegmentCaption(0, 5, 0)).toBe('0')
  })
})

describe('noTeamsSettled', () => {
  test('pending is never empty; settled with none is; a failed team is not', () => {
    expect(noTeamsSettled(null, 0)).toBe(false)
    expect(noTeamsSettled(0, 0)).toBe(true)
    expect(noTeamsSettled(0, 1)).toBe(false)
    expect(noTeamsSettled(2, 0)).toBe(false)
  })
})
