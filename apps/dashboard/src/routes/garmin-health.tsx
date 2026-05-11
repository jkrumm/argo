import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { healthQueries } from '../lib/queries/health'

export const Route = createFileRoute('/garmin-health')({
  loader: ({ context }) => context.queryClient.ensureQueryData(healthQueries.status()),
  component: GarminHealthPage,
})

function GarminHealthPage() {
  const { data } = useSuspenseQuery(healthQueries.status())
  return <pre>{JSON.stringify(data, null, 2)}</pre>
}
