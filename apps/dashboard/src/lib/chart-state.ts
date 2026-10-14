import type { ChartState } from 'basalt-ui/charts'

/** A query's pending → error → empty ladder as a `ChartState`. `empty` is the label shown when the
 * query succeeded with nothing to draw (`undefined` otherwise). */
export function chartStateOf(
  query: { isPending: boolean; isError: boolean; error: unknown },
  empty: string | undefined,
): ChartState {
  return { pending: query.isPending, error: query.isError ? query.error : undefined, empty }
}
