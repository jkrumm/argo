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
  return hours < 1 ? '< 1 h' : `${Math.round(hours)} h`
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

export function finishedInYear(shelf: readonly ShelfItem[], year: number): number {
  return shelf.filter(
    (b) => b.statusId === STATUS.read && b.readDate !== null && b.readDate.startsWith(`${year}-`),
  ).length
}

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

// ── Ratings ──────────────────────────────────────────────────────────────────────────────────

export type RatingShape = {
  /** Books per 1–5 ★ bucket: whole stars, rounded down (`2.5` → the 2 ★ bucket, `0.5` → 1 ★). */
  buckets: [number, number, number, number, number]
  n: number
  mean: number | null
  /** Mean community rating over the same rated books that have one, with how many that is. */
  community: { mean: number; n: number } | null
}

export function ratingShape(shelf: readonly ShelfItem[]): RatingShape {
  const buckets: RatingShape['buckets'] = [0, 0, 0, 0, 0]
  const rated = shelf.filter((b) => b.rating !== null)
  for (const book of rated) {
    const bucket = Math.min(5, Math.max(1, Math.floor(book.rating as number)))
    buckets[bucket - 1] = (buckets[bucket - 1] as number) + 1
  }
  const community = rated.filter((b) => b.communityRating !== null)
  return {
    buckets,
    n: rated.length,
    mean:
      rated.length === 0
        ? null
        : rated.reduce((sum, b) => sum + (b.rating as number), 0) / rated.length,
    community:
      community.length === 0
        ? null
        : {
            mean:
              community.reduce((sum, b) => sum + (b.communityRating as number), 0) /
              community.length,
            n: community.length,
          },
  }
}

/** The ratings cell's footer fact: the community mean over the same books, when any has one. */
export function ratingsFooter(shape: RatingShape): string | undefined {
  return shape.community === null
    ? undefined
    : `community mean ${shape.community.mean.toFixed(1)} ★ on ${shape.community.n} of the same books`
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

/**
 * The headline leads with the year's finished count and the typical time to finish: neither is on
 * the cells below. Pace, the shelf split and the backlog hours each live where they answer a question.
 */
export function summaryParts(input: {
  finished: number
  year: number
  medianDays: number | null
}): {
  sentence: string
  facts: string[]
} {
  const { finished, year, medianDays } = input
  return {
    sentence:
      finished === 0
        ? `Nothing finished in ${year} yet`
        : `${finished} ${finished === 1 ? 'book' : 'books'} finished in ${year}`,
    facts: medianDays === null ? [] : [`median ${medianDays} d from start to finish`],
  }
}

/** Median days from start to finish over read books that have both dates; null with none. */
export function medianDaysToFinish(shelf: readonly ShelfItem[]): number | null {
  const days = shelf
    .filter((b) => b.statusId === STATUS.read)
    .map((b) => daysToFinish(b.startedDate, b.readDate))
    .filter((d): d is number => d !== null)
  const mid = median(days)
  return mid === null ? null : Math.round(mid)
}

/** Books finished per month so far this year, one decimal; null with none (a rate of 0 says nothing). */
export function booksPerMonth(finished: number, now: number): string | null {
  if (finished === 0) return null
  const d = new Date(now)
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  // A year that is days old would otherwise read as a huge rate: never fewer than one month.
  const months = Math.max(1, d.getUTCMonth() + d.getUTCDate() / daysInMonth)
  return (finished / months).toFixed(1)
}

/**
 * Share of the shelf that is read, and that is still backlog: whole percent of `counts.total`,
 * kept inside 1–99 while the part exists, so `0%` and `100%` never claim an empty or full shelf.
 */
export function shelfShares(counts: ShelfCounts): { read: number; backlog: number } | null {
  if (counts.total === 0) return null
  const pct = (n: number) =>
    n === 0 ? 0 : Math.min(99, Math.max(1, Math.round((n / counts.total) * 100)))
  // Backlog is capped by the complement, so the pair never sums above 100 % after rounding.
  const read = pct(counts.read)
  return { read, backlog: Math.min(pct(counts.backlog), 100 - read) }
}
