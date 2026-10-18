import { describe, expect, test } from 'bun:test'
import { relativeTime } from 'basalt-ui/format'
import {
  gapsBeforePosition,
  RATING_MAX,
  approxHours,
  booksPerMonth,
  finishedFooter,
  finishCohort,
  paceBars,
  paceRange,
  backlog,
  currentYear,
  progressPercent,
  shelfCounts,
  daysToFinish,
  finishedGroups,
  finishedInYear,
  genreCounts,
  hoursLabel,
  hoursLeft,
  lastReadFact,
  median,
  parseTimestamp,
  ratingBin,
  ratingShape,
  ratingsFooter,
  readingPace,
  scopeLabel,
  shelfParts,
  summaryParts,
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

  test('a median that rounds to 0 is null, not a 0 pages/h pace', () => {
    expect(readingPace([book({ statusId: 2, stats: stats(1, 10) })]).median).toBeNull()
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
    expect(hoursLabel(0.4)).toBe('< 1\u00a0h')
    expect(hoursLabel(2.6)).toBe('3\u00a0h')
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
  test('finished books with time, longest first; in-progress time is on its card', () => {
    const shelf = [
      book({ statusId: 2, stats: stats(1, 1) }),
      book({ statusId: 3, stats: stats(1, 3) }),
      book({ statusId: 3, stats: stats(1, 5) }),
      book({ statusId: 1, stats: stats(1, 9) }),
      book({ statusId: 3, stats: stats(1, 0) }),
    ]
    expect(timeRead(shelf).map((r) => r.seconds / 3600)).toEqual([5, 3])
  })
})

describe('ratingShape', () => {
  test('every bin holds exactly two half steps: (0, 1] … (4, 5]', () => {
    const ratings = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]
    const shelf = ratings.map((rating) => book({ statusId: 3, readDate: '2026-01-01', rating }))
    expect(ratingShape(shelf).buckets).toEqual([2, 2, 2, 2, 2])
    const star = (rating: number) =>
      ratingShape([book({ rating })]).buckets.findIndex((n) => n === 1) + 1
    for (const rating of ratings) {
      expect(star(rating)).toBe(Math.ceil(rating))
      // A book is never binned below its own rating.
      expect(star(rating)).toBeGreaterThanOrEqual(rating)
    }
    expect(ratingShape([book({ rating: 2.5 })]).buckets).toEqual([0, 0, 1, 0, 0])
  })

  test('bin edges: 0.5 and 1 in the first bin, 4.5 and 5 in the last', () => {
    expect([0.5, 1, 1.5, 4, 4.5, 5].map(ratingBin)).toEqual([0, 0, 1, 3, 4, 4])
    expect(ratingBin(0)).toBe(0)
    expect(ratingBin(6)).toBe(4)
  })

  test('the mean marker is positioned by the model on the star scale: a mean of m sits at m − 0.5 column widths', () => {
    expect(ratingShape([book({ rating: 3 })]).meanAt).toBe(2.5)
    expect(ratingShape([book({ rating: 2.5 })]).meanAt).toBe(2)
    expect(ratingShape([book({ rating: 5 })]).meanAt).toBe(4.5)
    // Below the first label's star the marker stops on the first column's centre.
    expect(ratingShape([book({ rating: 0.5 })]).meanAt).toBe(0.5)
    expect(ratingShape([book()]).meanAt).toBeNull()
  })

  test('every bin spells its two half steps for screen readers, whatever the data', () => {
    const expected = [
      '0.5 to 1 star',
      '1.5 to 2 stars',
      '2.5 to 3 stars',
      '3.5 to 4 stars',
      '4.5 to 5 stars',
    ]
    expect(ratingShape([book({ rating: 3 })]).spans).toEqual(expected)
    expect(ratingShape([book()]).spans).toEqual(expected)
  })

  test('each column is labelled by its star, and a whole-star rating sits in its own column', () => {
    expect(ratingShape([book()]).labels).toEqual(['1', '2', '3', '4', '5'])
    expect(RATING_MAX).toBe(5)
    for (const star of [1, 2, 3, 4, 5]) {
      const { buckets, labels } = ratingShape([book({ rating: star })])
      expect(labels[buckets.findIndex((n) => n === 1)]).toBe(String(star))
    }
  })

  test('gaps before a position: none at the first centre, one per centre passed, four at the last', () => {
    expect([0.5, 1, 1.5, 2.5, 3.5, 4.5].map(gapsBeforePosition)).toEqual([0, 0.5, 1, 2, 3, 4])
  })

  test('community mean covers the same rated books', () => {
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

describe('summaryParts', () => {
  test('the headline is the year, the fact the typical time and its cohort', () => {
    expect(
      summaryParts({ finished: 3, year: 2026, cohort: { days: 12, measured: 2, finished: 3 } }),
    ).toEqual({
      sentence: '3 books finished in 2026',
      facts: [
        'median 12\u00a0d from start to finish, over 2 of 3 with a valid start and finish date',
      ],
    })
  })
  test('one book is singular; nothing finished says so; no cohort drops the fact, not 0', () => {
    expect(summaryParts({ finished: 1, year: 2026, cohort: null })).toEqual({
      sentence: '1 book finished in 2026',
      facts: [],
    })
    expect(summaryParts({ finished: 0, year: 2026, cohort: null }).sentence).toBe(
      'Nothing finished in 2026 yet',
    )
  })
  test('the headline repeats neither the pace nor the shelf split', () => {
    const { sentence, facts } = summaryParts({
      finished: 3,
      year: 2026,
      cohort: { days: 12, measured: 3, finished: 3 },
    })
    expect([sentence, ...facts].join(' ')).not.toMatch(/pages\/h|backlog|in progress/)
  })
})

describe('finishCohort', () => {
  const read = (started: string | null, readDate: string | null) =>
    book({ statusId: 3, startedDate: started, readDate })
  test("median over the year's read books with both dates, and how many that is", () => {
    expect(
      finishCohort(
        [
          read('2026-01-01', '2026-01-11'),
          read('2026-02-01', '2026-02-05'),
          read('2026-03-01', '2026-03-31'),
          read(null, '2026-04-01'),
          book({ statusId: 2, startedDate: '2026-01-01', readDate: null }),
        ],
        2026,
      ),
    ).toEqual({ days: 10, measured: 3, finished: 4 })
    expect(finishCohort([], 2026)).toBeNull()
  })
  test("an older book never shifts this year's median", () => {
    const thisYear = [read('2026-01-01', '2026-01-11'), read('2026-02-01', '2026-02-05')]
    const old = read('2024-01-01', '2024-12-31')
    expect(finishCohort([...thisYear, old], 2026)).toEqual(finishCohort(thisYear, 2026))
    expect(finishCohort([...thisYear, old], 2026)?.days).toBe(7)
  })
})

describe('hours labels', () => {
  test('under an hour reads < 1 h without a ≈', () => {
    expect(approxHours(0.4)).toBe('< 1\u00a0h')
    expect(approxHours(7.2)).toBe('≈ 7\u00a0h')
  })
})

describe('booksPerMonth', () => {
  test('finished over the months elapsed; none before a full month, none with nothing finished', () => {
    expect(booksPerMonth(6, Date.UTC(2026, 5, 16))).toBeCloseTo(1.08, 2) // 5.53 months
    expect(booksPerMonth(3, Date.UTC(2026, 0, 5))).toBeNull()
    expect(booksPerMonth(0, Date.UTC(2026, 5, 16))).toBeNull()
  })
})

describe('finishedFooter', () => {
  test('a rate once a month has elapsed, the count before, nothing with none', () => {
    expect(finishedFooter(6, 2026, Date.UTC(2026, 5, 16))).toBe('1.1 books a month in 2026')
    expect(finishedFooter(2, 2026, Date.UTC(2026, 0, 5))).toBe('2 so far in 2026')
    expect(finishedFooter(0, 2026, Date.UTC(2026, 5, 16))).toBeNull()
  })
})

describe('paceRange', () => {
  test('min and max whatever the order; an endpoint that rounds to 0 reads < 1', () => {
    expect(paceRange([40, 20, 30])).toBe('slowest 20, fastest 40\u00a0pages/h')
    expect(paceRange([0, 30])).toBe('slowest < 1, fastest 30\u00a0pages/h')
    expect(paceRange([30])).toBeNull()
    expect(paceRange([])).toBeNull()
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

  test('strip parts and list sections agree', () => {
    const counts = shelfCounts(shelf)
    const pace = readingPace(shelf)
    const bl = backlog(shelf, pace.median)
    const parts = Object.fromEntries(shelfParts(counts).map((p) => [p.label, p.value]))
    expect(parts['Backlog']).toBe(bl.count)
    expect(parts['Reading']).toBe(shelf.filter((b) => b.statusId === 2).length)
    // Finished list rows are the dated read books; the rest are named, not hidden.
    const listed = finishedGroups(shelf).reduce((n, g) => n + g.rows.length, 0)
    expect(listed).toBe(counts.readDated)
    expect(counts.read - counts.readDated).toBe(1)
    expect(finishedInYear(shelf, currentYear(Date.UTC(2026, 5, 1)))).toBe(1)
    expect(counts.total).toBe(8)
  })

  test('the pace cohort ignores backlog time', () => {
    const withBacklogTime = [...shelf, book({ statusId: 1, stats: stats(50, 9) })]
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

describe('scopeLabel', () => {
  const g = (label: string) => ({ label, rows: [] })
  test('is empty with no groups, one month alone, else oldest – newest', () => {
    expect(scopeLabel([])).toBe('')
    expect(scopeLabel([g('Mar 2026')])).toBe('Mar 2026')
    expect(scopeLabel([g('Oct 2026'), g('Jun 2026'), g('Mar 2026')])).toBe('Mar 2026 – Oct 2026')
  })
})

describe('ratingsFooter', () => {
  test('states the community mean and its base, one decimal', () => {
    const shelf = [
      book({ rating: 4, communityRating: 3.5 }),
      book({ rating: 3, communityRating: 4 }),
      book({ rating: 5 }),
    ]
    expect(ratingsFooter(ratingShape(shelf))).toBe('community mean 3.8\u00a0★, on 2 of them')
  })
  test('a single community rating', () => {
    expect(ratingsFooter(ratingShape([book({ rating: 4, communityRating: 3.8 })]))).toBe(
      'community mean 3.8\u00a0★, on 1 of them',
    )
  })
  test('says nothing about binning, and nothing without a community rating', () => {
    expect(ratingsFooter(ratingShape([book({ rating: 3.5 })]))).toBeUndefined()
    expect(ratingsFooter(ratingShape([book({ rating: 4 })]))).toBeUndefined()
  })
})

describe('lastReadFact', () => {
  const now = Date.UTC(2026, 9, 18)
  const day = 86_400_000
  test('glues the number to its unit in basalt relativeTime output, `ago` stays breakable', () => {
    expect(lastReadFact(now - 95 * day, now)).toBe('last\u00a0read\u00a03\u00a0months ago')
    expect(lastReadFact(now - day, now)).toBe('last\u00a0read\u00a01\u00a0day ago')
    expect(lastReadFact(now - 3 * 3_600_000, now)).toBe('last\u00a0read\u00a03\u00a0hours ago')
  })
  test('an age without a leading number is left whole', () => {
    expect(lastReadFact(now, now)).toBe(
      `last\u00a0read\u00a0${relativeTime(now, { now, numeric: 'always' })}`,
    )
  })
  test('no timestamp', () => {
    expect(lastReadFact(null, now)).toBe('last read —')
  })
})

describe('paceBars', () => {
  test('draws one bar per book, slowest first', () => {
    expect(paceBars([20, 35, 40])).toEqual([
      { book: 1, pace: 20 },
      { book: 2, pace: 35 },
      { book: 3, pace: 40 },
    ])
  })
  test('draws nothing below two books', () => {
    expect(paceBars([])).toEqual([])
    expect(paceBars([30])).toEqual([])
  })
})
