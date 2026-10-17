import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { format } from 'date-fns'
import { calendarStore } from '../lib/window-stores'
import { CalendarPage } from '../features/calendar/calendar-page'
import { calendarQueries } from '../lib/queries/calendar'
import { dayKey, queryFromKey } from '../features/calendar/derive'

const DAYS_RANGE = 60

/** `date` is a free ISO day, which the field vocabulary does not model — so it stays Zod and gets
 * COMPOSED over the store's own `validateSearch` (basalt-state.md). `view` is the store's. */
const DateSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .default(() => format(new Date(), 'yyyy-MM-dd')),
})

export const Route = createFileRoute('/calendar')({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...calendarStore.validateSearch(raw),
    ...DateSchema.parse(raw),
  }),
  loader: ({ context, location }) => {
    const search = location.search as { view?: string; date?: string }
    const view = search.view === 'week' || search.view === 'month' ? search.view : 'agenda'
    const fromKey = queryFromKey(view, search.date ?? dayKey(new Date()), dayKey(new Date()))
    void context.queryClient.prefetchQuery(calendarQueries.google(DAYS_RANGE, fromKey))
    void context.queryClient.prefetchQuery(calendarQueries.m365(DAYS_RANGE, fromKey))
    void context.queryClient.prefetchQuery(calendarQueries.ticktickProjects())
  },
  component: CalendarRoute,
})

function CalendarRoute() {
  const search = Route.useSearch()
  return <CalendarPage view={search.view} date={search.date} />
}
