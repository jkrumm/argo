import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Skeleton, Stack } from '@mantine/core'
import { PageBar } from 'basalt-ui'
import { agentsQueries } from '../lib/queries/agents'
import { useNow } from '../lib/use-now'
import {
  fleetParts,
  oldestAskMs,
  flattenAgents,
  groupProjects,
  needsYouCards,
  oldestNeedsYouWait,
  countUnknownAgents,
  feedState,
  snapshotAgeMs,
  feedAside,
  agentsSummaryParts,
  longestRunMs,
  needsYouSplit,
  waitingProjects,
  abandonedWaits,
  askCommands,
  askHosts,
} from '../features/agents/model'
import { FeedNotice } from '../features/agents/feed-notice'
import { StaleBanner } from '../features/agents/stale-banner'
import { PageSummary } from '../components/upstream/page-summary'
import { FeedAside } from '../features/agents/feed-aside'
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
  const askMs = oldestAskMs(humanQueue, now)
  const oldestAgent = oldestNeedsYouWait(agents, now)
  const oldest = oldestAgent ?? (askMs === null ? null : { ms: askMs, project: 'the human queue' })
  const { active, quiet } = groupProjects(snapshot, agents)
  const cards = needsYouCards(humanQueue, agents, now, { machine: latest?.machine ?? null })
  const needsYouItems = cards.length
  const longestRun = longestRunMs(
    agents.filter((a) => a.state === 'working'),
    now,
  )
  const fleet = fleetParts(snapshot?.summary, countUnknownAgents(agents))

  const agentWaits = cards.filter((card) => card.kind === 'agent').length
  const asks = cards.filter((card) => card.kind === 'human-queue').length
  const summary = agentsSummaryParts({
    agentWaits,
    asks,
    projects: waitingProjects(agents),
    abandoned: abandonedWaits(cards),
    hosts: askHosts(humanQueue),
    commands: askCommands(humanQueue),
  })

  const feed = feedState({
    hasData: latest !== null,
    isPending: latestQuery.isPending,
    isError: latestQuery.isError,
  })
  const aside = feedAside(feed, latest === null ? null : snapshotAgeMs(latest, now))
  const asideNode = aside === null ? undefined : <FeedAside aside={aside} />

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
        <StaleBanner latest={latest} fetchFailed={feed === 'failed' || feed === 'stale'} />
        {feed === 'failed' || feed === 'stale' ? (
          <FeedNotice
            state={feed}
            retrying={latestQuery.isFetching}
            onRetry={() => void latestQuery.refetch()}
          />
        ) : null}
        {feed === 'pending' ? (
          <Skeleton h="8rem" aria-label="Loading the agent snapshot" />
        ) : (
          <Stack gap="md" opacity={feed === 'stale' ? 0.6 : 1}>
            {feed === 'failed' || latest === null ? null : (
              <PageSummary sentence={summary.sentence} aside={asideNode} />
            )}
            {feed === 'failed' ? null : (
              <FleetStrip
                needsYou={latest === null ? null : needsYouItems}
                fleet={fleet}
                split={needsYouSplit(agentWaits, asks)}
                oldest={oldest}
                longestRunMs={longestRun}
              />
            )}
            <NeedsYouSection cards={cards} unknown={latest === null} />
            {feed === 'failed' ? null : <ProjectCards active={active} quiet={quiet} now={now} />}
            {feed === 'failed' ? null : (
              <ActivityStrip history={historyQuery.data?.data} hours={HISTORY_HOURS} now={now} />
            )}
            <NarrativesSection query={narrativesQuery} />
          </Stack>
        )}
      </Stack>
    </>
  )
}
