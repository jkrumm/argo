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

export type Summary = {
  total: number
  wantToRead: number
  currentlyReading: number
  read: number
  paused: number
  dnf: number
  ratedCount: number
  avgRating: number | null
}

export const STATUS = { backlog: 1, reading: 2, read: 3 } as const

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

export function readingPace(shelf: readonly ShelfItem[]): Pace {
  const paces: number[] = []
  for (const book of shelf) {
    const stats = book.stats
    if (stats === null || stats.pagesRead <= 0 || stats.totalReadSeconds <= 0) continue
    paces.push(stats.pagesRead / (stats.totalReadSeconds / 3600))
  }
  const mid = median(paces)
  return {
    median: mid === null ? null : Math.round(mid),
    paces: paces.toSorted((a, b) => a - b).map(Math.round),
  }
}

/** `≈ 7 h` / `< 1 h`: the single hour format the sentence, the ETA and the backlog header share. */
export function hoursLabel(hours: number): string {
  return hours < 1 ? '< 1 h' : `${Math.round(hours)} h`
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
  const iso = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
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
    hours: pace === null || pace <= 0 ? null : pages / pace,
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

/** In-progress and finished books with device reading time, longest first. */
export function timeRead(shelf: readonly ShelfItem[]): TimeRow[] {
  return shelf
    .filter(
      (b) =>
        (b.statusId === STATUS.reading || b.statusId === STATUS.read) &&
        (b.stats?.totalReadSeconds ?? 0) > 0,
    )
    .map((b) => ({
      key: String(b.hardcoverBookId),
      label: b.title,
      seconds: b.stats?.totalReadSeconds ?? 0,
    }))
    .toSorted((a, b) => b.seconds - a.seconds)
}

// ── Ratings ──────────────────────────────────────────────────────────────────────────────────

export type RatingShape = {
  /** Books per 1–5 ★ bucket; a half star rounds up (`2.5` → the 3 ★ bucket). */
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
    const bucket = Math.min(5, Math.max(1, Math.round(book.rating as number)))
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

// ── Shelf split ──────────────────────────────────────────────────────────────────────────────

export function shelfParts(summary: Summary): CountRow[] {
  return [
    { label: 'Read', value: summary.read },
    { label: 'Reading', value: summary.currentlyReading },
    { label: 'Backlog', value: summary.wantToRead },
    ...(summary.paused > 0 ? [{ label: 'Paused', value: summary.paused }] : []),
    ...(summary.dnf > 0 ? [{ label: 'Did not finish', value: summary.dnf }] : []),
  ]
}

// ── Sentence ─────────────────────────────────────────────────────────────────────────────────

export function summarySentence(input: {
  summary: Summary
  pace: number | null
  finished: number
  year: number
  backlogHours: number | null
}): string {
  const { summary, pace, finished, year, backlogHours } = input
  const reading = `${summary.currentlyReading} ${summary.currentlyReading === 1 ? 'book' : 'books'} in progress`
  return [
    pace === null ? reading : `${reading}, median ${pace} pages/h`,
    `${finished} finished in ${year}`,
    `backlog ${summary.wantToRead} ${summary.wantToRead === 1 ? 'book' : 'books'}${
      backlogHours === null ? '' : ` ≈ ${hoursLabel(backlogHours)}`
    }`,
  ].join(' · ')
}
