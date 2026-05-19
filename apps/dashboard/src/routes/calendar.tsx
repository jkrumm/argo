import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { format } from 'date-fns'
import { CalendarPage } from '../features/calendar/calendar-page'
import { calendarQueries } from '../lib/queries/calendar'

const DAYS_RANGE = 60

const SearchSchema = z.object({
  view: z.enum(['week', 'month']).default('week'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .default(() => format(new Date(), 'yyyy-MM-dd')),
})

type SearchParams = z.infer<typeof SearchSchema>

export const Route = createFileRoute('/calendar')({
  validateSearch: (raw: Record<string, unknown>) => SearchSchema.parse(raw),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(calendarQueries.google(DAYS_RANGE))
    void context.queryClient.prefetchQuery(calendarQueries.m365(DAYS_RANGE))
    void context.queryClient.prefetchQuery(calendarQueries.ticktickProjects())
  },
  component: CalendarRoute,
})

function CalendarRoute() {
  const search = Route.useSearch() as SearchParams
  return <CalendarPage view={search.view} date={search.date} />
}
