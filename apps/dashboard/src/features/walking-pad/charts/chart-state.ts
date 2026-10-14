import type { ChartState } from 'basalt-ui/charts'

/** A query's pending → error → empty ladder as a `ChartState`. `empty` is the label shown when the
 * query succeeded with nothing to draw (`false` otherwise). */
export function chartStateOf(
  query: { isPending: boolean; isError: boolean; error: unknown },
  empty: string | false,
): ChartState {
  return { pending: query.isPending, error: query.isError ? query.error : undefined, empty }
}

/** A `YYYY-MM-DD` bucket key as the UTC instant the API bucketed on. */
export const utcDay = (key: string): Date => new Date(`${key}T00:00:00Z`)
