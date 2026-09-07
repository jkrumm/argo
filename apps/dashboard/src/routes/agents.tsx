import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Stack } from '@mantine/core'
import { PageBar } from 'basalt-ui'
import { agentsQueries } from '../lib/queries/agents'
import { flattenAgents } from '../features/agents/model'
import { StaleBanner } from '../features/agents/stale-banner'
import { HeroStats } from '../features/agents/hero-stats'
import { NeedsYouSection } from '../features/agents/needs-you-section'
import { AgentsTable } from '../features/agents/agents-table'
import { NarrativesSection } from '../features/agents/narratives-section'

const HISTORY_HOURS = 24

export const Route = createFileRoute('/agents')({
  loader: ({ context }) => context.queryClient.ensureQueryData(agentsQueries.latest()),
  component: AgentsPage,
})

/**
 * The agent observation surface: what every Claude Code agent on the dev host is doing, what
 * needs the human, and the narrator's prose per project. Argo only renders what sideclaw pushed —
 * the states, recommendations and counts are the producer's; the page derives nothing but the
 * feed's own age (`StaleBanner`).
 */
function AgentsPage() {
  const latestQuery = useQuery(agentsQueries.latest())
  const historyQuery = useQuery(agentsQueries.history(HISTORY_HOURS))
  const narrativesQuery = useQuery(agentsQueries.narratives())

  const latest = latestQuery.data?.latest ?? null
  const snapshot = latest?.snapshot
  const agents = flattenAgents(snapshot)

  return (
    <>
      <PageBar
        sync={{
          syncing: latestQuery.isFetching,
          onSync: () => void latestQuery.refetch(),
          label: 'Refresh',
        }}
      />

      <Stack gap="md">
        <StaleBanner latest={latest} />
        <HeroStats summary={snapshot?.summary} history={historyQuery.data?.data} />
        <NeedsYouSection humanQueue={snapshot?.humanQueue ?? []} agents={agents} />
        <AgentsTable agents={agents} overview={snapshot?.overview} />
        <NarrativesSection query={narrativesQuery} />
      </Stack>
    </>
  )
}
