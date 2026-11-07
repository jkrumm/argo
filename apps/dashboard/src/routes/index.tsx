import { createFileRoute } from '@tanstack/react-router'
import { agentsQueries } from '../lib/queries/agents'
import { TodayPage } from '../features/home/today-page'

export const Route = createFileRoute('/')({
  // The source behind the summary sentence loads before paint; a failed one must not block the
  // page, which then says it is unavailable rather than empty.
  loader: ({ context }) =>
    Promise.allSettled([context.queryClient.ensureQueryData(agentsQueries.latest())]),
  component: TodayPage,
})
