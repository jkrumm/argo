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
