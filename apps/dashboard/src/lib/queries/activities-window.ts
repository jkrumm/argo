import { format, subDays } from 'date-fns'
import type { WindowParams } from './daily-metrics'

/** The API caps `limit` at 200 (`GET /activities`). */
export const ACTIVITIES_PAGE_SIZE = 200

const WINDOW_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const

/**
 * Project a page's window onto the list endpoint's `dateFrom`/`dateTo`. A preset window carries no
 * `from`/`to`, so the chart must derive them; `all` stays unbounded. Explicit dates win over a preset.
 */
export function activitiesRange(
  params: WindowParams,
  now: Date = new Date(),
): { dateFrom: string | undefined; dateTo: string | undefined } {
  if (params.from || params.to) return { dateFrom: params.from, dateTo: params.to }
  const days = params.window && params.window !== 'all' ? WINDOW_DAYS[params.window] : undefined
  return {
    dateFrom: days === undefined ? undefined : format(subDays(now, days), 'yyyy-MM-dd'),
    dateTo: undefined,
  }
}

/** Pages still to fetch after page 1, given the response's `total`. */
export function remainingPages(total: number, pageSize: number = ACTIVITIES_PAGE_SIZE): number[] {
  const pages = Math.ceil(total / pageSize)
  return Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2)
}
