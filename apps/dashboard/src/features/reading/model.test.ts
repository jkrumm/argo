import { describe, expect, test } from 'bun:test'
import {
  backlog,
  daysToFinish,
  finishedGroups,
  finishedInYear,
  genreCounts,
  hoursLabel,
  hoursLeft,
  median,
  parseTimestamp,
  ratingShape,
  readingPace,
  shelfParts,
  summarySentence,
  timeRead,
  type ShelfItem,
  type Summary,
} from './model'

let nextId = 1
const book = (over: Partial<ShelfItem> = {}): ShelfItem => ({
  hardcoverBookId: nextId++,
  title: '{title}',
  subtitle: null,
  authors: ['{author}'],
  genres: [],
  pages: null,
  releaseYear: null,
  coverUrl: null,
  statusId: 1,
  status: '',
  rating: null,
  hasReview: false,
  startedDate: null,
  readDate: null,
  lastReadDate: null,
  dateAdded: null,
  slug: null,
  communityRating: null,
  ratingsCount: null,
  stats: null,
  ...over,
})

const stats = (pagesRead: number, hours: number, pct = 50) => ({
  totalReadSeconds: hours * 3600,
  pagesRead,
  currentPercent: pct,
  sessions: 3,
  lastReadAt: null,
})

describe('median', () => {
  test('odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('readingPace', () => {
  test('median over the cohort with pages and time only', () => {
    const shelf = [
      book({ statusId: 2, stats: stats(100, 2) }), // 50
      book({ statusId: 2, stats: stats(300, 2) }), // 150
      book({ statusId: 2, stats: stats(0, 5) }), // excluded: no pages
      book({ statusId: 2, stats: stats(40, 0) }), // excluded: no time
      book({ statusId: 2 }), // excluded: no stats
    ]
    expect(readingPace(shelf)).toEqual({ median: 100, paces: [50, 150] })
  })

  test('no qualifying book → null median', () => {
    expect(readingPace([book(), book({ stats: stats(0, 1) })]).median).toBeNull()
  })
})

describe('hoursLeft', () => {
  test('remaining pages over the shared pace', () => {
    const b = book({ statusId: 2, pages: 400, stats: stats(100, 1, 25) })
    expect(hoursLeft(b, 100)).toBe(3)
  })

  test('unknown inputs are null, not 0', () => {
    expect(hoursLeft(book({ statusId: 2, pages: 400 }), 100)).toBeNull()
    expect(hoursLeft(book({ statusId: 2, stats: stats(1, 1) }), 100)).toBeNull()
    expect(hoursLeft(book({ statusId: 2, pages: 400, stats: stats(1, 1) }), null)).toBeNull()
  })
})

describe('hoursLabel', () => {
  test('rounds and floors at < 1 h', () => {
    expect(hoursLabel(0.4)).toBe('< 1 h')
    expect(hoursLabel(2.6)).toBe('3 h')
  })
})

describe('dates', () => {
  test('parseTimestamp reads the Postgres and ISO forms', () => {
    expect(parseTimestamp('2026-09-11 02:37:03+00')).toBe(Date.UTC(2026, 8, 11, 2, 37, 3))
    expect(parseTimestamp('2026-09-11T02:37:03Z')).toBe(Date.UTC(2026, 8, 11, 2, 37, 3))
    expect(parseTimestamp(null)).toBeNull()
    expect(parseTimestamp('nope')).toBeNull()
  })

  test('daysToFinish needs both dates in order', () => {
    expect(daysToFinish('2026-09-01', '2026-09-11')).toBe(10)
    expect(daysToFinish('2026-09-01', '2026-09-01')).toBe(0)
    expect(daysToFinish(null, '2026-09-11')).toBeNull()
    expect(daysToFinish('2026-09-12', '2026-09-11')).toBeNull()
  })
})

describe('finishedGroups', () => {
  test('newest first, grouped by month, days unknown without a start', () => {
    const shelf = [
      book({ statusId: 3, readDate: '2026-09-04', startedDate: '2026-08-30' }),
      book({ statusId: 3, readDate: '2026-09-26' }),
      book({ statusId: 3, readDate: '2025-01-02' }),
      book({ statusId: 3, readDate: null }),
      book({ statusId: 1, readDate: '2026-09-01' }),
    ]
    const groups = finishedGroups(shelf)
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([
      ['Sep 2026', 2],
      ['Jan 2025', 1],
    ])
    expect(groups[0]?.rows.map((r) => r.days)).toEqual([null, 5])
    expect(finishedInYear(shelf, 2026)).toBe(2)
  })
})

describe('backlog', () => {
  const shelf = [
    book({ pages: 300, communityRating: 3.9, genres: ['A', 'B'] }),
    book({ pages: 200, communityRating: 4.4, genres: ['A'] }),
    book({ pages: null, communityRating: null, genres: ['B', 'B'] }),
    book({ statusId: 2, pages: 999 }),
  ]

  test('ranked by community rating, totals leave out missing page counts', () => {
    const b = backlog(shelf, 100)
    expect(b.books.map((x) => x.communityRating)).toEqual([4.4, 3.9, null])
    expect(b).toMatchObject({ count: 3, pages: 500, withoutPages: 1, hours: 5 })
  })

  test('no pace → hours null', () => {
    expect(backlog(shelf, null).hours).toBeNull()
  })

  test('genre counts count a book once per genre', () => {
    expect(genreCounts(backlog(shelf, 1).books, 5)).toEqual([
      { label: 'A', value: 2 },
      { label: 'B', value: 2 },
    ])
  })
})

describe('timeRead', () => {
  test('in-progress and finished books with time, longest first', () => {
    const shelf = [
      book({ statusId: 2, stats: stats(1, 1) }),
      book({ statusId: 3, stats: stats(1, 3) }),
      book({ statusId: 1, stats: stats(1, 9) }),
      book({ statusId: 2, stats: stats(1, 0) }),
    ]
    expect(timeRead(shelf).map((r) => r.seconds / 3600)).toEqual([3, 1])
  })
})

describe('ratingShape', () => {
  test('half stars round up; community mean covers the same rated books', () => {
    const shape = ratingShape([
      book({ rating: 4, communityRating: 4 }),
      book({ rating: 2.5, communityRating: 3 }),
      book({ rating: 3, communityRating: null }),
      book({ rating: null, communityRating: 5 }),
    ])
    expect(shape.buckets).toEqual([0, 0, 2, 1, 0])
    expect(shape.n).toBe(3)
    expect(shape.mean).toBeCloseTo(3.1667)
    expect(shape.community).toEqual({ mean: 3.5, n: 2 })
  })

  test('nothing rated', () => {
    expect(ratingShape([book()])).toMatchObject({ n: 0, mean: null, community: null })
  })
})

const summary: Summary = {
  total: 36,
  wantToRead: 28,
  currentlyReading: 4,
  read: 4,
  paused: 0,
  dnf: 0,
  ratedCount: 4,
  avgRating: 3.1,
}

describe('shelfParts', () => {
  test('paused and dnf only when non-zero', () => {
    expect(shelfParts(summary).map((p) => p.label)).toEqual(['Read', 'Reading', 'Backlog'])
    expect(shelfParts({ ...summary, paused: 1 }).map((p) => p.label)).toContain('Paused')
  })
})

describe('summarySentence', () => {
  test('quotes the same pace and hours figures the cells show', () => {
    expect(
      summarySentence({ summary, pace: 90, finished: 3, year: 2026, backlogHours: 56.4 }),
    ).toBe('4 books in progress, median 90 pages/h · 3 finished in 2026 · backlog 28 books ≈ 56 h')
  })

  test('drops pace and hours rather than printing 0', () => {
    expect(
      summarySentence({ summary, pace: null, finished: 0, year: 2026, backlogHours: null }),
    ).toBe('4 books in progress · 0 finished in 2026 · backlog 28 books')
  })
})
