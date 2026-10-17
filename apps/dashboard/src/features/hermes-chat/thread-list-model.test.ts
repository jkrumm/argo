import { describe, expect, it } from 'bun:test'

// thread-list-model.ts imports threads-store.ts, whose module chain reads `window.location` unless
// VITE_API_URL is set — same workaround as threads-store.test.ts.
process.env['VITE_API_URL'] = 'http://test.local/api'

const {
  buildView,
  factsLine,
  groupEntries,
  isUntitled,
  listTime,
  startedDate,
  summarize,
  summaryLine,
  untitledLabel,
} = await import('./thread-list-model')
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
  ]

  it('folds only quiet persisted untitled threads', () => {
    expect(entries.filter(isUntitled).map((e) => e.id)).toEqual(['u1', 'u2'])
    const view = buildView(entries, { type: 'all', query: '' }, NOW)
    expect(view.untitled.map((e) => e.id)).toEqual(['u1', 'u2'])
    expect(view.groups.flatMap((g) => g.rows.map((r) => r.id)).toSorted()).toEqual([
      'infra',
      'live',
      'local',
      'todo',
    ])
    expect(view.total).toBe(6)
  })

  it('counts types over every thread and hides the fold while a filter narrows the list', () => {
    const view = buildView(entries, { type: 'todo', query: '' }, NOW)
    expect(view.typeCounts.todo).toBe(1)
    expect(view.typeCounts.infra).toBe(1)
    expect(view.untitled).toEqual([])
    expect(view.groups.flatMap((g) => g.rows.map((r) => r.id))).toEqual(['todo'])
  })

  it('shows only the fold under the Untitled filter and counts it for the chip', () => {
    const view = buildView(entries, { type: 'untitled', query: '' }, NOW)
    expect(view.groups).toEqual([])
    expect(view.untitled.map((e) => e.id)).toEqual(['u1', 'u2'])
    expect(view.untitledCount).toBe(2)
  })

  it('searches title and summary, case-insensitively', () => {
    const view = buildView(entries, { type: 'all', query: 'EGGS' }, NOW)
    expect(view.groups.flatMap((g) => g.rows.map((r) => r.id))).toEqual(['todo'])
  })
})

describe('summary', () => {
  it('derives the sentence from the loaded list', () => {
    const summary = summarize(
      [
        entry({ id: 'a', pinned: true, updatedAt: new Date(2026, 9, 17, 14, 5).getTime() }),
        entry({ id: 'b', updatedAt: NOW - 3 * DAY }),
      ],
      NOW,
    )
    expect(summaryLine(summary)).toBe('2 threads · 1 pinned · 1 today · last reply 14:05')
  })

  it('omits the last reply with no threads and pluralises', () => {
    expect(summaryLine(summarize([], NOW))).toBe('0 threads · 0 pinned · 0 today')
    expect(summaryLine(summarize([entry({ id: 'a' })], NOW)).startsWith('1 thread ·')).toBe(true)
  })

  it('words the untitled fold', () => {
    expect(untitledLabel(3, '2 months ago')).toBe('3 untitled chats · oldest 2 months ago')
    expect(untitledLabel(1, 'yesterday')).toBe('1 untitled chat · oldest yesterday')
  })
})

describe('factsLine', () => {
  it('drops the repeated date when the thread started and last replied on one day', () => {
    const e = entry({
      id: 'f',
      type: 'infra',
      createdAt: new Date(2026, 9, 3, 8, 0).getTime(),
      updatedAt: new Date(2026, 9, 3, 9, 41).getTime(),
    })
    expect(factsLine({ entry: e, now: NOW, compact: false })).toBe(
      'Started 3 Oct 08:00 · last reply 09:41',
    )
    expect(factsLine({ entry: e, now: NOW, compact: true })).toBe('3 Oct · Infra')
  })
})
