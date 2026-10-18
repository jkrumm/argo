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
  /**
   * The same gap inside a card: a loading card says `Loading` (the page headline already says
   * `Loading calendar`), a failed one is the headline's sentence minus the step.
   */
  card: string
}

/** Both calendars, as a reason line names them: `Google or Microsoft 365`. */
export const SOURCES_LABEL = `${SOURCE_LABEL.personal} or ${SOURCE_LABEL.work}`

/**
 * Why calendar figures are unknown, worded once for every place that says so. `null` when every
 * source has answered. A failure carries the next step in the headline only; a card states the
 * same gap without it, and names a source that is still loading beside one that failed.
 */
export function feedGap(
  unknown: ReadonlySet<keyof typeof SOURCE_LABEL>,
  failedSources: ReadonlySet<keyof typeof SOURCE_LABEL>,
): FeedGap | null {
  if (unknown.size === 0) return null
  const named = (pick: (key: keyof typeof SOURCE_LABEL) => boolean) =>
    (['personal', 'work'] as const)
      .filter((key) => unknown.has(key) && pick(key))
      .map((key) => SOURCE_LABEL[key])
      .join(' and ')
  const failedNames = named((key) => failedSources.has(key))
  if (failedNames === '') return { state: 'loading', text: 'Loading calendar', card: 'Loading' }
  const loadingNames = named((key) => !failedSources.has(key))
  const card = [
    `${failedNames} failed to load`,
    ...(loadingNames ? [`${loadingNames} loading`] : []),
  ].join(' · ')
  return { state: 'error', text: `${card} — reload to retry`, card }
}

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
