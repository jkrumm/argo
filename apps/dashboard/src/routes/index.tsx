import { createFileRoute } from '@tanstack/react-router'
import type { BasaltRouterContext } from 'basalt-ui'
import { agentsQueries } from '../lib/queries/agents'
import { wardenQueries } from '../lib/queries/warden'
import { shotLoader } from '../lib/shot-state'
import { TodayPage } from '../features/home/today-page'

export const Route = createFileRoute('/')({
  // The two sources behind the summary sentence load before paint; a failed one must not block the
  // page, which then says it is unavailable rather than empty.
  loader: shotLoader(({ context }: { context: BasaltRouterContext }) =>
    Promise.allSettled([
      context.queryClient.ensureQueryData(agentsQueries.latest()),
      context.queryClient.ensureQueryData(wardenQueries.snapshot()),
    ]),
  ),
  component: TodayPage,
})
