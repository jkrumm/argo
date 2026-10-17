import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Stack } from '@mantine/core'
import { PageBar } from 'basalt-ui'
import { agentsQueries } from '../lib/queries/agents'
import { useNow } from '../lib/use-now'
import { flattenAgents, groupProjects, oldestNeedsYouWait } from '../features/agents/model'
import { StaleBanner } from '../features/agents/stale-banner'
import { PageSummary } from '../features/agents/page-summary'
import { FleetStrip } from '../features/agents/fleet-strip'
import { NeedsYouSection } from '../features/agents/needs-you-section'
import { ProjectCards } from '../features/agents/project-cards'
import { ActivityStrip } from '../features/agents/activity-strip'
import { NarrativesSection } from '../features/agents/narratives-section'

const HISTORY_HOURS = 24

export const Route = createFileRoute('/agents')({
  loader: ({ context }) => context.queryClient.ensureQueryData(agentsQueries.latest()),
  component: AgentsPage,
})

/**
 * The agent observation surface: what every Claude Code agent on the dev host is doing, what
 * needs the human, and the narrator's prose per project. Argo only renders what agent-gateway pushed —
 * the states, recommendations and counts are the producer's; the page derives nothing but the
 * feed's own age (`StaleBanner`).
 */
function AgentsPage() {
  const latestQuery = useQuery(agentsQueries.latest())
  const narrativesQuery = useQuery(agentsQueries.narratives())

  const historyQuery = useQuery(agentsQueries.history(HISTORY_HOURS))

  const latest = latestQuery.data?.latest ?? null
  const snapshot = latest?.snapshot
  const agents = flattenAgents(snapshot)
  const now = useNow()
  const humanQueue = snapshot?.humanQueue ?? []
  const oldest = oldestNeedsYouWait(agents, now)
  const { active, quiet } = groupProjects(snapshot, agents)
  const waiting = agents.filter((a) => a.state === 'needs_you').length

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
        <PageSummary
          latest={latest}
          now={now}
          summary={{
            items: humanQueue.length + waiting,
            oldestWaitMs: oldest?.ms ?? null,
            working: snapshot?.summary?.working ?? 0,
            total: agents.length,
            idleProjects: quiet.length,
          }}
        />
        <FleetStrip
          summary={snapshot?.summary}
          history={historyQuery.data?.data}
          hours={HISTORY_HOURS}
          oldest={oldest}
          now={now}
        />
        <NeedsYouSection humanQueue={humanQueue} agents={agents} />
        <ProjectCards active={active} quiet={quiet} now={now} />
        <ActivityStrip history={historyQuery.data?.data} hours={HISTORY_HOURS} now={now} />
        <NarrativesSection query={narrativesQuery} />
      </Stack>
    </>
  )
}
