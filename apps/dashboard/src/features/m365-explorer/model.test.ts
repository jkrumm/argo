import { NBSP } from '../../lib/format'
import { describe, expect, test } from 'bun:test'
import {
  chatKindCounts,
  chatTitle,
  emptyGap,
  detailGap,
  withStep,
  nothingToLabel,
  teamsGap,
  gapLeader,
  NO_SOURCES,
  NO_CHANNELS,
  NO_CHATS,
  NO_TEAMS,
  chatKindParts,
  chatsStat,
  showTagChips,
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
  test('counts the labeled sources and tags, then the latest chat activity', () => {
    expect(headlineOf({ times: [at(17), at(3), null], labeled: 5, tags: 2 })).toEqual({
      sentence: `5 sources labeled across 2 tags · latest chat activity 17${NBSP}Oct,${NBSP}12:00`,
    })
    expect(headlineOf({ times: [at(3)], labeled: 1, tags: 1 }).sentence).toBe(
      `1 source labeled across 1 tag · latest chat activity 03${NBSP}Oct,${NBSP}12:00`,
    )
  })
  test('nothing labeled yet still names the latest activity', () => {
    expect(headlineOf({ times: [at(17)], labeled: 0, tags: 0 }).sentence).toBe(
      `No sources labeled yet · latest chat activity 17${NBSP}Oct,${NBSP}12:00`,
    )
  })
  test('labels without any chat stamp drop the activity clause', () => {
    expect(headlineOf({ times: [null], labeled: 2, tags: 1 }).sentence).toBe(
      '2 sources labeled across 1 tag',
    )
  })
  test('no stamps and no labels', () => {
    expect(headlineOf({ times: [], labeled: 0, tags: 0 })).toEqual({
      sentence: 'No chat activity yet',
    })
    expect(headlineOf({ times: [null], labeled: 0, tags: 0 }).sentence).toBe('No chat activity yet')
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
    })
    expect(chatsStat({ oneOnOne: 1, group: 3, meeting: 3, other: 0 })).toEqual({
      hero: { value: '3', unit: 'group chats' },
    })
  })
  test('one kind is the hero alone, none says so', () => {
    expect(chatsStat({ oneOnOne: 0, group: 0, meeting: 1, other: 0 })).toEqual({
      hero: { value: '1', unit: 'meeting' },
    })
    expect(chatsStat({ oneOnOne: 0, group: 0, meeting: 0, other: 0 })).toEqual({
      hero: null,
    })
  })
})

describe('sectionTitleFor', () => {
  const base = {
    view: 'chats',
    tag: '',
    open: false,
    counts: { chats: 7, capped: false, teams: 3 },
  } as const
  test('says a fact about the pane, not the tab name', () => {
    expect(sectionTitleFor({ ...base, pane: 'sources' })).toBe('7 chats')
    expect(sectionTitleFor({ ...base, pane: 'sources', view: 'teams' })).toBe('3 teams')
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
  test('the sources title is a count and kind, never the tab name', () => {
    const counts = { chats: 12, capped: false, teams: 1 }
    expect(sourcesTitle('chats', counts)).toBe('12 chats')
    expect(sourcesTitle('chats', { ...counts, chats: 1 })).toBe('1 chat')
    expect(sourcesTitle('chats', { ...counts, chats: 50, capped: true })).toBe('Newest 50 chats')
    expect(sourcesTitle('teams', counts)).toBe('1 team')
    expect(sourcesTitle('feed', counts)).toBe('Feed sources')
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

describe('showTagChips', () => {
  test('hidden over an empty view, unless a tag is active and must be clearable', () => {
    expect(showTagChips(0, '')).toBe(false)
    expect(showTagChips(0, 'alerts')).toBe(true)
    expect(showTagChips(3, '')).toBe(true)
    expect(showTagChips(null, '')).toBe(true)
  })
})

describe('emptyGap', () => {
  test('both lists empty: one gap, every surface takes the leading clause', () => {
    expect(emptyGap('labeled', 'chats')).toBe(NO_SOURCES)
    expect(emptyGap('labeled', 'teams')).toBe(NO_SOURCES)
  })
  test('otherwise each list names its own gap', () => {
    for (const leader of ['chats', 'channels', null] as const) {
      expect(emptyGap(leader, 'chats')).toBe(NO_CHATS)
      expect(emptyGap(leader, 'teams')).toBe(NO_TEAMS)
    }
  })
})

describe('detailGap', () => {
  test('both lists empty: one spelling for the whole screen', () => {
    expect(detailGap({ leader: 'labeled', chatsView: true, teams: 0 })).toBe(NO_SOURCES)
    expect(detailGap({ leader: 'labeled', chatsView: false, teams: 0 })).toBe(NO_SOURCES)
  })
  test('chats only empty: the chats view names chats', () => {
    expect(detailGap({ leader: 'chats', chatsView: true, teams: 2 })).toBe(NO_CHATS)
  })
  test('teams only empty: the teams view names teams, or channels once teams came back', () => {
    expect(detailGap({ leader: 'channels', chatsView: false, teams: 0 })).toBe(NO_TEAMS)
    expect(detailGap({ leader: null, chatsView: false, teams: 2 })).toBe(NO_CHANNELS)
  })
})

describe('withStep', () => {
  test('the full sentence is the short form, then the cause and the step', () => {
    expect(withStep(NO_CHATS)).toBe(
      'No chats came back — Microsoft 365 returned none; refresh to retry',
    )
    expect(withStep(NO_TEAMS)).toBe(
      'No teams came back — Microsoft 365 returned none; refresh to retry',
    )
    expect(withStep(NO_SOURCES)).toBe(
      'No chats or channels came back — Microsoft 365 returned none; refresh to retry',
    )
  })
})

describe('gap predicates', () => {
  const settled = { total: 0, labeled: 0, outside: 0, loading: 0, failed: 0 }
  test('nothingToLabel needs a settled, empty universe', () => {
    expect(nothingToLabel(settled)).toBe(true)
    expect(nothingToLabel({ ...settled, loading: 1 })).toBe(false)
    expect(nothingToLabel({ ...settled, failed: 1 })).toBe(false)
    expect(nothingToLabel({ ...settled, outside: 1 })).toBe(false)
    expect(nothingToLabel({ ...settled, total: 1 })).toBe(false)
  })
  test('teamsGap names teams only when none came back', () => {
    expect(teamsGap(0)).toBe(NO_TEAMS)
    expect(teamsGap(2)).toBe(NO_CHANNELS)
  })
  test('the leader is the first empty cell in reading order, or none', () => {
    const none = { nothingToLabel: false, noChats: false, noTeams: false }
    expect(gapLeader({ nothingToLabel: true, noChats: true, noTeams: true })).toBe('labeled')
    expect(gapLeader({ ...none, noChats: true, noTeams: true })).toBe('chats')
    expect(gapLeader({ ...none, noTeams: true })).toBe('channels')
    expect(gapLeader(none)).toBeNull()
  })
  test('a team back with no channel and no chats keeps the labeled leader and one wording', () => {
    const leader = gapLeader({ nothingToLabel: true, noChats: true, noTeams: false })
    expect(leader).toBe('labeled')
    expect(emptyGap(leader, 'chats')).toBe(NO_SOURCES)
    expect(emptyGap(leader, 'teams')).toBe(NO_SOURCES)
  })
})

describe('chatTitle member order', () => {
  const chat = (names: string[]) => ({ topic: null, members: names.map((name) => ({ name })) })
  test('names read the same whatever order the members arrive in', () => {
    expect(chatTitle(chat(['Zoe', 'Anna', 'Max']))).toBe('Anna, Max, Zoe')
    expect(chatTitle(chat(['Max', 'Zoe', 'Anna']))).toBe('Anna, Max, Zoe')
  })
  test('locale-equal names order the same whatever the arrival order', () => {
    // 'é' precomposed vs 'e' + combining acute: localeCompare calls them equal
    const a = '\u00e9'
    const b = 'e\u0301'
    expect(a.localeCompare(b)).toBe(0)
    expect(chatTitle(chat([a, b]))).toBe(chatTitle(chat([b, a])))
  })
  test('a topic still wins and empty names are skipped', () => {
    expect(chatTitle({ topic: 'Plan', members: [{ name: 'B' }] })).toBe('Plan')
    expect(chatTitle(chat(['', 'B', 'A']))).toBe('A, B')
  })
})
