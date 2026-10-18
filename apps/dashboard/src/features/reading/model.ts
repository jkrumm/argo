import { relativeTime } from 'basalt-ui/format'
import { glue, withUnit } from '../../lib/format'

export type ShelfItem = {
  hardcoverBookId: number
  title: string
  subtitle: string | null
  authors: string[]
  genres: string[]
  pages: number | null
  releaseYear: number | null
  coverUrl: string | null
  statusId: number
  status: string
  rating: number | null
  hasReview: boolean
  startedDate: string | null
  readDate: string | null
  lastReadDate: string | null
  dateAdded: string | null
  slug: string | null
  communityRating: number | null
  ratingsCount: number | null
  stats: {
    totalReadSeconds: number
    pagesRead: number
    currentPercent: number
    sessions: number
    lastReadAt: string | null
  } | null
}

export const STATUS = { backlog: 1, reading: 2, read: 3, paused: 4, dnf: 5 } as const

/** Why a pace-derived figure is `—`. One string, so every cell that needs it says the same thing. */
export const NO_PACE_REASON = 'no book has reading time yet'

const DAY_MS = 86_400_000

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

// ── Pace ─────────────────────────────────────────────────────────────────────────────────────

export type Pace = {
  /** Median pages/h, rounded: the one figure the ETA, the backlog hours and the cell all use. */
  median: number | null
  /** Per-book paces of the cohort (pagesRead > 0 and totalReadSeconds > 0), ascending. */
  paces: number[]
}

/** Cohort: in-progress and finished books that report device reading time. */
export function readingPace(shelf: readonly ShelfItem[]): Pace {
  const paces: number[] = []
  for (const book of shelf) {
    const stats = book.stats
    if (book.statusId !== STATUS.reading && book.statusId !== STATUS.read) continue
    if (stats === null || stats.pagesRead <= 0 || stats.totalReadSeconds <= 0) continue
    paces.push(stats.pagesRead / (stats.totalReadSeconds / 3600))
  }
  const mid = median(paces)
  return {
    // A median that rounds to 0 pages/h is no usable pace.
    median: mid === null || Math.round(mid) <= 0 ? null : Math.round(mid),
    paces: paces.toSorted((a, b) => a - b).map(Math.round),
  }
}

/** `7 h` / `< 1 h`: the single hour format the sentence, the ETA and the backlog header share. */
export function hoursLabel(hours: number): string {
  return hours < 1 ? withUnit('< 1', 'h') : withUnit(Math.round(hours), 'h')
}

/** `≈ 7 h`, or `< 1 h` with no `≈` (an upper bound is not an approximation). */
export function approxHours(hours: number): string {
  return hours < 1 ? hoursLabel(hours) : `≈ ${hoursLabel(hours)}`
}

/** Hours to finish an in-progress book at the shelf pace; `null` while any input is unknown. */
export function hoursLeft(book: ShelfItem, pace: number | null): number | null {
  if (pace === null || pace <= 0 || book.pages === null || book.stats === null) return null
  const remaining = book.pages * (1 - book.stats.currentPercent / 100)
  return Math.max(0, remaining) / pace
}

// ── Dates ────────────────────────────────────────────────────────────────────────────────────

/** `2026-09-11 02:37:03+00` (Postgres) or ISO → epoch ms; `null` when absent or unparseable. */
export function parseTimestamp(value: string | null): number | null {
  if (value === null) return null
  // A bare `+00` offset needs `:00`; only after a time, never on the day of a date-only value.
  const iso = value.replace(' ', 'T').replace(/(T[\d:.]+)([+-]\d{2})$/, '$1$2:00')
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

const dayMs = (date: string): number => Date.parse(`${date}T00:00:00Z`)

/** Whole days from start to finish; `null` when either date is missing or the order is wrong. */
export function daysToFinish(start: string | null, end: string | null): number | null {
  if (start === null || end === null) return null
  const diff = (dayMs(end) - dayMs(start)) / DAY_MS
  return Number.isFinite(diff) && diff >= 0 ? Math.round(diff) : null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `YYYY-MM-DD` → `26 Sep`. */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number]
  return `${d} ${MONTHS[m - 1]}`
}

// ── Finished ─────────────────────────────────────────────────────────────────────────────────

export type FinishedRow = { book: ShelfItem; readDate: string; days: number | null }
export type FinishedGroup = { label: string; rows: FinishedRow[] }

export function finishedGroups(shelf: readonly ShelfItem[]): FinishedGroup[] {
  const rows: FinishedRow[] = []
  for (const book of shelf) {
    if (book.statusId !== STATUS.read || book.readDate === null) continue
    rows.push({
      book,
      readDate: book.readDate,
      days: daysToFinish(book.startedDate, book.readDate),
    })
  }
  const groups: FinishedGroup[] = []
  for (const row of rows.toSorted((a, b) => b.readDate.localeCompare(a.readDate))) {
    const [y, m] = row.readDate.split('-').map(Number) as [number, number]
    const label = `${MONTHS[m - 1]} ${y}`
    const last = groups[groups.length - 1]
    if (last?.label === label) last.rows.push(row)
    else groups.push({ label, rows: [row] })
  }
  return groups
}

/** `Mar 2026` or `Mar 2026 – Oct 2026` from the groups (newest first); empty when there are none. */
export function scopeLabel(groups: readonly FinishedGroup[]): string {
  const newest = groups[0]
  const oldest = groups[groups.length - 1]
  if (newest === undefined || oldest === undefined) return ''
  return newest.label === oldest.label ? newest.label : `${oldest.label} – ${newest.label}`
}

/** The one source of "finished in {year}": the headline count and its median cohort both read it. */
function finishedBooksInYear(shelf: readonly ShelfItem[], year: number): ShelfItem[] {
  return shelf.filter(
    (b) => b.statusId === STATUS.read && b.readDate !== null && b.readDate.startsWith(`${year}-`),
  )
}

export const finishedInYear = (shelf: readonly ShelfItem[], year: number): number =>
  finishedBooksInYear(shelf, year).length

// ── Backlog ──────────────────────────────────────────────────────────────────────────────────

export type BacklogTotals = {
  books: ShelfItem[]
  count: number
  /** Pages over the books that report a page count. */
  pages: number
  /** Books without a page count: the totals above leave them out. */
  withoutPages: number
  hours: number | null
}

export function backlog(shelf: readonly ShelfItem[], pace: number | null): BacklogTotals {
  const books = shelf
    .filter((b) => b.statusId === STATUS.backlog)
    .toSorted(
      (a, b) =>
        (b.communityRating ?? -1) - (a.communityRating ?? -1) ||
        (b.ratingsCount ?? 0) - (a.ratingsCount ?? 0),
    )
  const pages = books.reduce((sum, b) => sum + (b.pages ?? 0), 0)
  return {
    books,
    count: books.length,
    pages,
    withoutPages: books.filter((b) => b.pages === null).length,
    // No page counts is unknown, not 0 h.
    hours: pace === null || pace <= 0 || pages === 0 ? null : pages / pace,
  }
}

export type CountRow = { label: string; value: number }

/** Genres over a set of books, most common first; ties break alphabetically. */
export function genreCounts(books: readonly ShelfItem[], top: number): CountRow[] {
  const counts = new Map<string, number>()
  for (const book of books) {
    for (const genre of new Set(book.genres)) counts.set(genre, (counts.get(genre) ?? 0) + 1)
  }
  return [...counts]
    .map(([label, value]) => ({ label, value }))
    .toSorted((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, top)
}

// ── Time read ────────────────────────────────────────────────────────────────────────────────

export type TimeRow = { key: string; label: string; seconds: number }

/**
 * Finished books with device reading time, longest first. In-progress books are left out: their
 * time is already on their progress cards.
 */
export function timeRead(shelf: readonly ShelfItem[]): TimeRow[] {
  return shelf
    .filter((b) => b.statusId === STATUS.read && (b.stats?.totalReadSeconds ?? 0) > 0)
    .map((b) => ({
      key: String(b.hardcoverBookId),
      label: b.title,
      seconds: b.stats?.totalReadSeconds ?? 0,
    }))
    .toSorted((a, b) => b.seconds - a.seconds)
}

/** `null` while the device has reported nothing (0 % with 0 sessions is unknown, not a 0 % meter). */
export function progressPercent(book: ShelfItem): number | null {
  const stats = book.stats
  if (stats === null) return null
  return stats.currentPercent <= 0 && stats.sessions <= 0 ? null : stats.currentPercent
}

// ── In progress: last read ───────────────────────────────────────────────────────────────────

/** `last read 3 months ago` (number glued to its unit, `ago` breakable) or `last read —` with no timestamp. */
export function lastReadFact(lastRead: number | null, now: number): string {
  if (lastRead === null) return 'last read —'
  // The number, its unit and `last read` are one run; `ago` stays breakable.
  return `last read ${relativeTime(lastRead, { now, numeric: 'always' })}`.replace(
    /^last read (?:\d+(?:[.,]\d+)? )?\S+/,
    glue,
  )
}

// ── Ratings ──────────────────────────────────────────────────────────────────────────────────

/** Five columns, column `N` (1…5) labelled by its star and holding the ratings `N − 0.5` and `N`: bin `i` is `(i, i + 1]`. The one source of the bin rule, its labels and the mean marker. */
export const RATING_MAX = 5
const RATING_BINS = RATING_MAX

/**
 * A position on the histogram track, in column widths from its left edge (0…{@link RATING_MAX}).
 * Column `N` is centred on star `N`, i.e. at `N − 0.5`, so a mean of `m` stars sits at `m − 0.5`
 * (clamped to the first and last centre). The columns have a gap: see {@link gapsBefore}.
 */
const trackAt = (value: number): number => Math.min(RATING_MAX, Math.max(1, value)) - 0.5

/**
 * How many column gaps lie left of a track position. Adjacent centres are one column plus one gap
 * apart, so the position is gap-aware by construction: `0` at the first centre, `4` at the last.
 */
export const gapsBefore = (at: number): number => Math.max(0, at - 0.5)

/** `(0.5, 1]` → 0 … `(4.5, 5]` → 4; a rating outside 0.5–5 clamps to the end bin. */
export function ratingBin(rating: number): number {
  return Math.min(RATING_BINS, Math.max(1, Math.ceil(rating))) - 1
}

/** One bin's span as screen-reader and hover text (`1.5 to 2 stars`). */
function binSpan(bin: number): string {
  const lo = bin + 0.5
  const hi = bin + 1
  return `${lo} to ${hi} ${hi === 1 ? 'star' : 'stars'}`
}

export type RatingShape = {
  /** Books per 1–5 ★ bucket, each holding exactly two half steps: bucket `i` is `(i, i + 1]` (`0.5`, `1` → 1 ★; `4.5`, `5` → 5 ★). */
  buckets: [number, number, number, number, number]
  n: number
  mean: number | null
  /** The mean's track position (see `trackAt`), the same scale as the column labels; null with nothing rated. */
  meanAt: number | null
  /** The star each column is labelled with: `1` … `5`. */
  labels: [string, string, string, string, string]
  /** The span per bucket, as screen-reader and hover text. */
  spans: [string, string, string, string, string]
  /** Mean community rating over the same rated books that have one, with how many that is. */
  community: { mean: number; n: number } | null
}

const tuple5 = <T>(at: (i: number) => T): [T, T, T, T, T] => [at(0), at(1), at(2), at(3), at(4)]

export function ratingShape(shelf: readonly ShelfItem[]): RatingShape {
  const rated = shelf.flatMap((b) =>
    b.rating === null ? [] : [{ rating: b.rating, community: b.communityRating }],
  )
  const mean =
    rated.length === 0 ? null : rated.reduce((sum, r) => sum + r.rating, 0) / rated.length
  const community = rated.flatMap((r) => (r.community === null ? [] : [r.community]))
  return {
    buckets: tuple5((i) => rated.filter((r) => ratingBin(r.rating) === i).length),
    labels: tuple5((i) => String(i + 1)),
    spans: tuple5(binSpan),
    n: rated.length,
    mean,
    meanAt: mean === null ? null : trackAt(mean),
    community:
      community.length === 0
        ? null
        : {
            mean: community.reduce((sum, v) => sum + v, 0) / community.length,
            n: community.length,
          },
  }
}

/** The ratings cell's footer fact: the community mean over the same books, when any has one. */
export function ratingsFooter(shape: RatingShape): string | undefined {
  return shape.community === null
    ? undefined
    : `community mean ${withUnit(shape.community.mean.toFixed(1), '★')}, on ${shape.community.n} of them`
}

// ── Shelf counts: the one source of every repeated figure ───────────────────────────────────

export type ShelfCounts = {
  read: number
  /** Read books that carry a read date: the rows the Finished list shows. */
  readDated: number
  reading: number
  backlog: number
  paused: number
  dnf: number
  /** The parts shown in the split (status 6, Ignored, is not on the page). */
  total: number
}

export function shelfCounts(shelf: readonly ShelfItem[]): ShelfCounts {
  const n = (status: number) => shelf.filter((b) => b.statusId === status).length
  const read = n(STATUS.read)
  const reading = n(STATUS.reading)
  const backlog = n(STATUS.backlog)
  const paused = n(STATUS.paused)
  const dnf = n(STATUS.dnf)
  return {
    read,
    readDated: shelf.filter((b) => b.statusId === STATUS.read && b.readDate !== null).length,
    reading,
    backlog,
    paused,
    dnf,
    total: read + reading + backlog + paused + dnf,
  }
}

export function shelfParts(counts: ShelfCounts): CountRow[] {
  return [
    { label: 'Read', value: counts.read },
    { label: 'Reading', value: counts.reading },
    { label: 'Backlog', value: counts.backlog },
    ...(counts.paused > 0 ? [{ label: 'Paused', value: counts.paused }] : []),
    ...(counts.dnf > 0 ? [{ label: 'Did not finish', value: counts.dnf }] : []),
  ]
}

/** Read dates are UTC calendar dates (`YYYY-MM-DD`), so the current year is read in UTC too. */
export const currentYear = (now: number): number => new Date(now).getUTCFullYear()

// ── Sentence ─────────────────────────────────────────────────────────────────────────────────

/** The median time to finish a year's books, and the cohort it is taken over. */
export type FinishCohort = { days: number; measured: number; finished: number }

/**
 * The headline leads with the year's finished count and the typical time to finish: neither is on
 * the cells below. Pace, the shelf split and the backlog hours each live where they answer a question.
 */
export function summaryParts(input: {
  finished: number
  year: number
  cohort: FinishCohort | null
}): { sentence: string; facts: string[] } {
  const { finished, year, cohort } = input
  return {
    sentence:
      finished === 0
        ? `Nothing finished in ${year} yet`
        : `${finished} ${finished === 1 ? 'book' : 'books'} finished in ${year}`,
    facts:
      cohort === null
        ? []
        : [
            `median ${withUnit(cohort.days, 'd')} from start to finish, over ${cohort.measured} of ${cohort.finished} with a valid start and finish date`,
          ],
  }
}

/**
 * Median days from start to finish over the books finished in `year` that have both dates, with
 * how many of that year's books that is; null while none has both.
 */
export function finishCohort(shelf: readonly ShelfItem[], year: number): FinishCohort | null {
  const finishedBooks = finishedBooksInYear(shelf, year)
  const days = finishedBooks
    .map((b) => daysToFinish(b.startedDate, b.readDate))
    .filter((d): d is number => d !== null)
  const mid = median(days)
  return mid === null
    ? null
    : { days: Math.round(mid), measured: days.length, finished: finishedBooks.length }
}

/** The shelf cell's footer: the year's rate, or the plain count before a month has elapsed. */
export function finishedFooter(finished: number, year: number, now: number): string | null {
  if (finished === 0) return null
  const rate = booksPerMonth(finished, now)
  return rate === null
    ? `${finished} so far in ${year}`
    : `${rate.toFixed(1)} books a month in ${year}`
}

/**
 * Books finished per month so far this year; null before a full month has elapsed (a rate over
 * days would swing wildly) and with none finished.
 */
export function booksPerMonth(finished: number, now: number): number | null {
  if (finished === 0) return null
  const d = new Date(now)
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  const months = d.getUTCMonth() + d.getUTCDate() / daysInMonth
  return months < 1 ? null : finished / months
}

/** A pace endpoint as shown (rounds to 0 → `< 1`). */
const paceEndpoint = (v: number): string => (v < 1 ? '< 1' : String(v))

/** `slowest 20, fastest 40 pages/h`; an endpoint that rounds to 0 reads `< 1`. Null with no paces. */
export function paceRange(paces: readonly number[]): string | null {
  if (paces.length < 2) return null
  return `slowest ${paceEndpoint(Math.min(...paces))}, fastest ${withUnit(paceEndpoint(Math.max(...paces)), 'pages/h')}`
}
