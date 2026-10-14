import { queryOptions } from '@tanstack/react-query'
import { unwrap } from 'basalt-ui'
import { api } from '../eden'
import { ACTIVITIES_PAGE_SIZE, activitiesRange, remainingPages } from './activities-window'
import { activitiesQueries } from './daily-metrics'
import type { WindowParams } from './daily-metrics'

/**
 * Every activity in the page's window: page 1 reports `total`, the rest are fetched in parallel.
 * Keyed under `activitiesQueries.all()` so the Garmin sync's invalidation still reaches it.
 */
export const activitiesWindowQueries = {
  list: (params: WindowParams) => {
    const { dateFrom, dateTo } = activitiesRange(params)
    const page = async (n: number) =>
      unwrap(
        await api.activities.get({
          query: { dateFrom, dateTo, limit: ACTIVITIES_PAGE_SIZE, page: n },
        }),
      )
    return queryOptions({
      queryKey: [...activitiesQueries.all(), 'window', { dateFrom, dateTo }] as const,
      queryFn: async () => {
        const first = await page(1)
        const rest = await Promise.all(remainingPages(first.total).map(page))
        return [first, ...rest].flatMap((p) => p.data)
      },
    })
  },
}
