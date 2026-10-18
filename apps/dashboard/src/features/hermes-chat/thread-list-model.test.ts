import { describe, expect, it } from 'bun:test'

// thread-list-model.ts imports threads-store.ts, whose module chain reads `window.location` unless
// VITE_API_URL is set — same workaround as threads-store.test.ts.
process.env['VITE_API_URL'] = 'http://test.local/api'

const {
  buildView,
  factsParts,
  groupEntries,
  isUntitled,
  listTime,
  startedDate,
  summaryExcerpt,
  titleExcerpt,
  listEndNote,
  clampAtWord,
  summaryHeadline,
  emptyNote,
  untitledLabel,
} = await import('./thread-list-model')
const { NBSP } = await import('../../lib/format')
type ThreadEntry = import('./thread-list-model').ThreadEntry

// 2026-10-17 15:30 local.
const NOW = new Date(2026, 9, 17, 15, 30).getTime()
const HOUR = 3_600_000
const DAY = 24 * HOUR

function entry(over: Partial<ThreadEntry> & { id: string }): ThreadEntry {
  return {
    title: 'A title',
    summary: null,
    type: null,
    pinned: false,
    archived: false,
    streaming: false,
    persisted: true,
    createdAt: NOW - 30 * DAY,
    updatedAt: NOW - HOUR,
    ...over,
  }
}

describe('listTime', () => {
  it('prints HH:mm for today and D Mon for older days, in English', () => {
    expect(listTime(new Date(2026, 9, 17, 9, 5).getTime(), NOW)).toBe('09:05')
    expect(listTime(new Date(2026, 9, 3, 9, 5).getTime(), NOW)).toBe('3 Oct')
  })
})

describe('startedDate', () => {
  it('adds the year once it is not this year', () => {
    expect(startedDate(new Date(2026, 2, 4).getTime(), NOW)).toBe('4 Mar')
    expect(startedDate(new Date(2025, 11, 31).getTime(), NOW)).toBe('31 Dec 2025')
  })
})

describe('groupEntries', () => {
  it('groups Pinned / Today / This week / Earlier in order, dropping empty groups', () => {
    const groups = groupEntries(
      [
        entry({ id: 'e', updatedAt: NOW - 20 * DAY }),
        entry({ id: 'w', updatedAt: NOW - 3 * DAY }),
        entry({ id: 't', updatedAt: NOW - HOUR }),
        entry({ id: 'p', pinned: true, updatedAt: NOW - 40 * DAY }),
      ],
      NOW,
    )
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['Pinned', ['p']],
      ['Today', ['t']],
      ['This week', ['w']],
      ['Earlier', ['e']],
    ])
  })

  it('keeps the week boundary on calendar days across a DST change', () => {
    // 2026-10-25 is the EU clock change; six calendar days back from the 27th is the 21st.
    const now = new Date(2026, 9, 27, 12, 0).getTime()
    const edge = new Date(2026, 9, 21, 0, 30).getTime()
    const before = new Date(2026, 9, 20, 23, 30).getTime()
    const [g] = groupEntries([entry({ id: 'e', updatedAt: edge })], now)
    expect(g?.key).toBe('week')
    const [h] = groupEntries([entry({ id: 'b', updatedAt: before })], now)
    expect(h?.key).toBe('earlier')
  })

  it('marks a group live when any row streams', () => {
    const [group] = groupEntries([entry({ id: 'a', streaming: true })], NOW)
    expect(group?.live).toBe(true)
  })
})

describe('buildView', () => {
  const entries = [
    entry({ id: 'infra', type: 'infra', title: 'Deploy notes' }),
    entry({ id: 'todo', type: 'todo', title: 'Groceries', summary: 'milk and eggs' }),
    entry({ id: 'u1', title: null, updatedAt: NOW - 5 * DAY }),
    entry({ id: 'u2', title: null, updatedAt: NOW - 9 * DAY }),
    entry({ id: 'live', title: null, streaming: true }),
    entry({ id: 'local', title: null, persisted: false }),
    entry({ id: 'pinned', title: null, pinned: true, updatedAt: NOW - 5 * DAY }),
    entry({ id: 'fresh', title: null, updatedAt: NOW - 10_000 }),
  ]
  const archived = [entry({ id: 'old', title: 'Old chat', archived: true, pinned: true })]
  const view = (type: Parameters<typeof buildView>[0]['filter']['type'], query = '') =>
    buildView({ entries, archived, filter: { type, query }, now: NOW })
  const ids = (v: ReturnType<typeof view>) =>
    v.groups.flatMap((g) => g.rows.map((r) => r.id)).toSorted()

  it('folds only quiet, persisted, unpinned, settled untitled threads', () => {
    expect(entries.filter((e) => isUntitled(e, NOW)).map((e) => e.id)).toEqual(['u1', 'u2'])
    const v = view('all')
    expect(v.untitled.map((e) => e.id)).toEqual(['u1', 'u2'])
    expect(ids(v)).toEqual(['fresh', 'infra', 'live', 'local', 'pinned', 'todo'])
    expect(v.groups[0]?.key).toBe('pinned')
    expect(v.total).toBe(8)
  })

  it('counts type chips over the rows they reveal and hides the fold while filtered', () => {
    const v = view('todo')
    expect(v.typeCounts.todo).toBe(1)
    expect(v.typeCounts.infra).toBe(1)
    expect(v.untitled).toEqual([])
    expect(ids(v)).toEqual(['todo'])
  })

  it('does not count a folded untitled thread toward a type chip', () => {
    const withType = [
      ...entries,
      entry({ id: 'ut', title: null, type: 'infra', updatedAt: NOW - DAY }),
    ]
    const v = buildView({
      entries: withType,
      archived,
      filter: { type: 'infra', query: '' },
      now: NOW,
    })
    expect(v.typeCounts.infra).toBe(1)
    expect(ids(v)).toEqual(['infra'])
  })

  it('shows only the fold under the Untitled filter', () => {
    const v = view('untitled')
    expect(v.groups).toEqual([])
    expect(v.untitled.map((e) => e.id)).toEqual(['u1', 'u2'])
    expect(v.untitledCount).toBe(2)
  })

  it('lists archived threads under the Archived filter, never as Pinned', () => {
    const v = view('archived')
    expect(v.archivedCount).toBe(1)
    expect(v.groups.map((g) => g.key)).toEqual(['today'])
    expect(v.untitled).toEqual([])
  })

  it('searches title and summary, case-insensitively, and chips follow the query', () => {
    const v = view('all', 'EGGS')
    expect(ids(v)).toEqual(['todo'])
    expect(v.allCount).toBe(1)
    expect(v.untitledCount).toBe(0)
    expect(v.typeCounts.infra).toBe(0)
    expect(v.archivedCount).toBe(0)
  })

  it('searches the fold and the archive too', () => {
    const withSummary = [
      ...entries,
      entry({ id: 'us', title: null, summary: 'tax return', updatedAt: NOW - 3 * DAY }),
    ]
    const v = buildView({
      entries: withSummary,
      archived,
      filter: { type: 'all', query: 'tax' },
      now: NOW,
    })
    expect(v.untitled.map((e) => e.id)).toEqual(['us'])
    expect(v.untitledCount).toBe(1)
    expect(v.allCount).toBe(1)
    const a = buildView({ entries, archived, filter: { type: 'archived', query: 'old' }, now: NOW })
    expect(a.archivedCount).toBe(1)
  })
})

describe('summary', () => {
  it('carries the figure it rests on: what is running, of every thread', () => {
    expect(summaryHeadline([entry({ id: 'a' }), entry({ id: 'b', streaming: true })])).toEqual({
      sentence: 'Hermes is replying in 1 of 2 threads',
    })
    expect(summaryHeadline([entry({ id: 'a' })])).toEqual({
      sentence: 'Nothing running in 1 thread',
    })
  })

  it('counts archived threads, and has no headline with none at all', () => {
    expect(summaryHeadline([entry({ id: 'a', archived: true })])).toEqual({
      sentence: 'Nothing running in 1 thread',
    })
    expect(summaryHeadline([])).toBeNull()
  })

  it('words the untitled fold without the count (the chip prints it)', () => {
    expect(untitledLabel('2 months ago')).toBe(`Untitled · oldest 2${NBSP}months${NBSP}ago`)
    expect(untitledLabel('yesterday')).toBe('Untitled · oldest yesterday')
    expect(untitledLabel('3 days ago')).toBe(`Untitled · oldest 3${NBSP}days${NBSP}ago`)
  })
})

describe('summaryExcerpt', () => {
  const long =
    'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho'
  it('cuts the phone shorter than the desktop, always at a word', () => {
    expect(summaryExcerpt(long, true).length).toBeLessThanOrEqual(53)
    expect(summaryExcerpt(long, true).endsWith('…')).toBe(true)
    expect(summaryExcerpt(long, false)).toBe(long)
  })
})

describe('titleExcerpt', () => {
  it('cuts a phone title at a word, leaves a wide one whole', () => {
    const title = 'Quarterly planning notes for the platform migration'
    expect(titleExcerpt(title, true)).toBe('Quarterly planning notes…')
    expect(titleExcerpt(title, false)).toBe(title)
  })
})

describe('factsParts', () => {
  it('drops the repeated date when the thread started and last replied on one day', () => {
    const e = entry({
      id: 'f',
      type: 'infra',
      createdAt: new Date(2026, 9, 3, 8, 0).getTime(),
      updatedAt: new Date(2026, 9, 3, 9, 41).getTime(),
    })
    expect(factsParts({ entry: e, now: NOW, compact: false })).toEqual([
      'Started 3 Oct 08:00',
      'last reply 09:41',
    ])
    expect(factsParts({ entry: e, now: NOW, compact: true })).toEqual(['last reply 3 Oct', 'Infra'])
  })
})

describe('listEndNote', () => {
  const entry = (createdAt: number): ThreadEntry => ({
    id: String(createdAt),
    title: 't',
    summary: null,
    type: null,
    pinned: false,
    archived: false,
    streaming: false,
    persisted: true,
    createdAt,
    updatedAt: createdAt,
  })
  it('is null without threads', () => {
    expect(listEndNote([], 0, NOW, 0)).toBeNull()
  })
  it('is null once the server total is covered: the fold and the rows say how far back it reaches', () => {
    expect(listEndNote([entry(NOW), entry(NOW - 1000)], 2, NOW, 4)).toBeNull()
    expect(listEndNote([entry(NOW)], 0, NOW, 1)).toBeNull()
    expect(listEndNote([entry(NOW)], 0, NOW, null, 5)).toBeNull()
  })
  it('says how far back a capped list reaches', () => {
    expect(listEndNote([entry(NOW), entry(NOW - 1000)], 0, NOW, 9)).toMatch(
      /^2 of 9 threads, back to /,
    )
    expect(listEndNote([entry(NOW), entry(NOW - 1000)], 0, NOW, null, 2)).toMatch(
      /^The newest 2 threads, back to /,
    )
  })
})

describe('clampAtWord', () => {
  it('passes short text through, collapsing whitespace', () => {
    expect(clampAtWord('one  two\nthree', 40)).toBe('one two three')
  })
  it('cuts at a word boundary and never mid-word', () => {
    expect(clampAtWord('alpha beta gamma delta', 13)).toBe('alpha beta…')
    expect(clampAtWord('alpha beta gamma delta', 10)).toBe('alpha beta…')
  })
  it('drops trailing punctuation before the ellipsis', () => {
    expect(clampAtWord('alpha, beta gamma', 7)).toBe('alpha…')
  })
  it('hard-cuts a single token longer than the limit', () => {
    expect(clampAtWord('abcdefghijkl', 5)).toBe('abcde…')
  })
})

describe('emptyNote', () => {
  it('says the fact that emptied the list', () => {
    expect(emptyNote({ threads: 0, active: 0, filtered: false })).toBe(
      'No threads yet. Type below to start.',
    )
    expect(emptyNote({ threads: 3, active: 0, filtered: false })).toBe('All threads archived')
    expect(emptyNote({ threads: 3, active: 0, filtered: true })).toBe(
      'No thread matches this filter.',
    )
    expect(emptyNote({ threads: 3, active: 2, filtered: true })).toBe(
      'No thread matches this filter.',
    )
  })
})
