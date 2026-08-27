import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { format } from 'date-fns'
import { calendarStore } from '../lib/window-stores'
import { CalendarPage } from '../features/calendar/calendar-page'
import { calendarQueries } from '../lib/queries/calendar'

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
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(calendarQueries.google(DAYS_RANGE))
    void context.queryClient.prefetchQuery(calendarQueries.m365(DAYS_RANGE))
    void context.queryClient.prefetchQuery(calendarQueries.ticktickProjects())
  },
  component: CalendarRoute,
})

function CalendarRoute() {
  const search = Route.useSearch()
  return <CalendarPage view={search.view} date={search.date} />
}
