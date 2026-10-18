/**
 * Unknown while a source is pending, failed with nothing of this window cached, or is still
 * loading this window behind the previous window's placeholder data (`keepPreviousData`).
 */
export const unanswered = (query: {
  isPending: boolean
  isError: boolean
  isPlaceholderData: boolean
  isFetching: boolean
  data: unknown
}) =>
  query.isPending ||
  (query.isPlaceholderData && query.isFetching) ||
  (query.isError && (query.data === undefined || query.isPlaceholderData))

type FeedQuery = Parameters<typeof unanswered>[0]

/** A source that is unknown *and* has stopped trying: failed, not still loading. */
export const failed = (query: FeedQuery & { isError: boolean }) =>
  unanswered(query) && query.isError && !query.isFetching

const SOURCE_LABEL = { personal: 'Google', work: 'Microsoft 365' } as const

export type FeedGap = {
  state: 'loading' | 'error'
  /** The one sentence for a block or a cell: loading says loading; a failure names the source and the step. */
  text: string
  /** The same gap in a row's width. */
  short: string
}

/**
 * Why calendar figures are unknown, worded once for every place that says so. `null` when every
 * source has answered. A failed source wins over a loading one: it is the one the owner can act on.
 */
export function feedGap(
  unknown: ReadonlySet<keyof typeof SOURCE_LABEL>,
  failedSources: ReadonlySet<keyof typeof SOURCE_LABEL>,
): FeedGap | null {
  if (unknown.size === 0) return null
  const names = (['personal', 'work'] as const)
    .filter((key) => failedSources.has(key))
    .map((key) => SOURCE_LABEL[key])
  if (names.length === 0) return { state: 'loading', text: 'Loading calendar', short: 'loading' }
  return {
    state: 'error',
    text: `${names.join(' and ')} failed to load — reload to retry`,
    short: 'failed to load',
  }
}

/** The word for one source in a split line: still loading, or failed. */
export const sourceGapWord = (
  key: keyof typeof SOURCE_LABEL,
  failedSources: ReadonlySet<keyof typeof SOURCE_LABEL>,
): string => (failedSources.has(key) ? 'failed to load' : 'loading')

/**
 * The task list's own fetch state: the projects read, then one read per project. Unknown tasks are
 * never an empty list — a pending or failed read must not print `0`.
 */
export function taskFeedState(
  queries: readonly {
    isPending: boolean
    isError: boolean
    isPlaceholderData: boolean
    isFetching: boolean
    data: unknown
  }[],
): 'loading' | 'error' | 'ready' {
  // Loading while any read is pending; a failure only counts once all have settled, and a failed
  // background refetch that still holds cached data is not one.
  if (queries.some((q) => q.isPending || (q.isPlaceholderData && q.isFetching))) return 'loading'
  return queries.some((q) => q.isError && q.data === undefined) ? 'error' : 'ready'
}
