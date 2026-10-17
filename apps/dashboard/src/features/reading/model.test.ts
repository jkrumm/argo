import { describe, expect, test } from 'bun:test'
import {
  approxHours,
  backlog,
  currentYear,
  progressPercent,
  shelfCounts,
  totalReadSeconds,
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

describe('shelfParts', () => {
  test('paused and dnf only when non-zero', () => {
    const base = [book({ statusId: 1 }), book({ statusId: 2 }), book({ statusId: 3 })]
    expect(shelfParts(shelfCounts(base)).map((p) => p.label)).toEqual([
      'Read',
      'Reading',
      'Backlog',
    ])
    const more = [...base, book({ statusId: 4 })]
    expect(shelfParts(shelfCounts(more)).map((p) => p.label)).toContain('Paused')
  })

  test('the total is the sum of the parts; an ignored book is not on the page', () => {
    const counts = shelfCounts([
      book({ statusId: 1 }),
      book({ statusId: 3 }),
      book({ statusId: 6 }),
    ])
    expect(counts.total).toBe(2)
  })
})

describe('summarySentence', () => {
  test('quotes the same pace and hours figures the cells show', () => {
    const counts = shelfCounts([
      ...Array.from({ length: 4 }, () => book({ statusId: 2 })),
      ...Array.from({ length: 28 }, () => book({ statusId: 1 })),
    ])
    expect(summarySentence({ counts, pace: 90, finished: 3, year: 2026, backlogHours: 56.4 })).toBe(
      '4 books in progress, median 90 pages/h · 3 finished in 2026 · backlog 28 books ≈ 56 h',
    )
  })

  test('drops pace and hours rather than printing 0', () => {
    const counts = shelfCounts([book({ statusId: 2 }), book({ statusId: 1 })])
    expect(
      summarySentence({ counts, pace: null, finished: 0, year: 2026, backlogHours: null }),
    ).toBe('1 book in progress · 0 finished in 2026 · backlog 1 book')
  })

  test('under an hour reads < 1 h without a ≈', () => {
    const counts = shelfCounts([book({ statusId: 1 })])
    expect(
      summarySentence({ counts, pace: 90, finished: 0, year: 2026, backlogHours: 0.4 }),
    ).toContain('backlog 1 book < 1 h')
    expect(approxHours(0.4)).toBe('< 1 h')
    expect(approxHours(7.2)).toBe('≈ 7 h')
  })
})

describe('one source for every repeated figure', () => {
  const shelf = [
    book({ statusId: 2, pages: 400, stats: stats(100, 2, 25) }),
    book({ statusId: 2 }),
    book({ statusId: 3, readDate: '2026-03-01', startedDate: '2026-02-01', stats: stats(300, 3) }),
    book({ statusId: 3, readDate: '2025-12-31' }),
    book({ statusId: 3, readDate: null }),
    book({ statusId: 1, pages: 300 }),
    book({ statusId: 1, pages: 100 }),
    book({ statusId: 5 }),
    book({ statusId: 6 }),
  ]

  test('sentence, strip parts and list sections agree', () => {
    const counts = shelfCounts(shelf)
    const pace = readingPace(shelf)
    const bl = backlog(shelf, pace.median)
    const parts = Object.fromEntries(shelfParts(counts).map((p) => [p.label, p.value]))
    const sentence = summarySentence({
      counts,
      pace: pace.median,
      finished: finishedInYear(shelf, 2026),
      year: currentYear(Date.UTC(2026, 5, 1)),
      backlogHours: bl.hours,
    })

    // Strip cell, sentence and Backlog / Currently reading sections.
    expect(parts['Backlog']).toBe(bl.count)
    expect(parts['Reading']).toBe(shelf.filter((b) => b.statusId === 2).length)
    expect(sentence).toContain(`backlog ${bl.count} books`)
    expect(sentence).toContain(`${parts['Reading']} books in progress`)
    // Finished list rows are the dated read books; the rest are named, not hidden.
    const listed = finishedGroups(shelf).reduce((n, g) => n + g.rows.length, 0)
    expect(listed).toBe(counts.readDated)
    expect(counts.read - counts.readDated).toBe(1)
    expect(sentence).toContain(`${finishedInYear(shelf, 2026)} finished in 2026`)
    // Pace and hours: the figure in the sentence is the figure the cells use.
    expect(sentence).toContain(`median ${pace.median} pages/h`)
    expect(sentence).toContain(approxHours(bl.hours as number))
    expect(counts.total).toBe(8)
  })

  test('time read has one definition across the pace cohort and the BarList', () => {
    const withBacklogTime = [...shelf, book({ statusId: 1, stats: stats(50, 9) })]
    expect(totalReadSeconds(withBacklogTime)).toBe(totalReadSeconds(shelf))
    expect(totalReadSeconds(shelf)).toBe((2 + 3) * 3600)
    expect(readingPace(withBacklogTime).paces).toEqual(readingPace(shelf).paces)
  })
})

describe('edge cases', () => {
  test('backlog with no page counts has unknown hours, not 0', () => {
    expect(backlog([book({ pages: null }), book({ pages: null })], 100)).toMatchObject({
      pages: 0,
      withoutPages: 2,
      hours: null,
    })
    expect(backlog([], 100).hours).toBeNull()
  })

  test('progressPercent: no device report is unknown', () => {
    const none = { ...stats(0, 0, 0), sessions: 0 }
    expect(progressPercent(book({ statusId: 2, stats: none }))).toBeNull()
    expect(progressPercent(book({ statusId: 2 }))).toBeNull()
    expect(progressPercent(book({ statusId: 2, stats: stats(10, 1, 12) }))).toBe(12)
    expect(progressPercent(book({ statusId: 2, stats: { ...none, sessions: 2 } }))).toBe(0)
  })

  test('currentYear reads the UTC year', () => {
    expect(currentYear(Date.UTC(2026, 11, 31, 23, 59))).toBe(2026)
    expect(currentYear(Date.UTC(2027, 0, 1, 0, 0))).toBe(2027)
  })

  test('parseTimestamp edges', () => {
    expect(parseTimestamp('')).toBeNull()
    expect(parseTimestamp('2026-09-11 02:37:03+05')).toBe(Date.UTC(2026, 8, 10, 21, 37, 3))
    expect(parseTimestamp('2026-09-11 02:37:03-03')).toBe(Date.UTC(2026, 8, 11, 5, 37, 3))
    expect(parseTimestamp('2026-09-11')).toBe(Date.UTC(2026, 8, 11))
  })

  test('genreCounts: empty input, top cap and tie order', () => {
    expect(genreCounts([], 5)).toEqual([])
    const books = [book({ genres: ['B'] }), book({ genres: ['A'] }), book({ genres: ['C', 'A'] })]
    expect(genreCounts(books, 2)).toEqual([
      { label: 'A', value: 2 },
      { label: 'B', value: 1 },
    ])
  })

  test('finishedInYear counts dated read books of that year only', () => {
    const shelf = [
      book({ statusId: 3, readDate: '2026-01-01' }),
      book({ statusId: 3, readDate: '2025-12-31' }),
      book({ statusId: 3, readDate: null }),
      book({ statusId: 2, readDate: '2026-02-02' }),
    ]
    expect(finishedInYear(shelf, 2026)).toBe(1)
    expect(finishedInYear(shelf, 2024)).toBe(0)
  })
})
