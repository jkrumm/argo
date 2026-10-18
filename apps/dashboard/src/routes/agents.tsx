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
  needsYouCount,
  oldestNeedsYouWait,
  countUnknownAgents,
  feedState,
  snapshotAgeMs,
  ageAgo,
  STALE_AFTER_MS,
  summaryParts,
} from '../features/agents/model'
import { FeedNotice } from '../features/agents/feed-notice'
import { StaleBanner } from '../features/agents/stale-banner'
import { PageSummary } from '../components/upstream/page-summary'
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
  const needsYouItems = needsYouCount(humanQueue, agents, now)
  const fleet = fleetParts(snapshot?.summary, countUnknownAgents(agents))

  const summary = summaryParts({
    items: needsYouItems,
    oldestWaitMs: oldestAgent?.ms ?? null,
    oldestAskMs: askMs,
    fleet: fleet && { working: fleet.parts[0]?.value ?? 0, total: fleet.total },
    idleProjects: quiet.length,
  })
  const feedAge = latest === null ? null : snapshotAgeMs(latest, now)

  const feed = feedState({
    hasData: latest !== null,
    isPending: latestQuery.isPending,
    isError: latestQuery.isError,
  })

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
              <PageSummary
                sentence={summary.sentence}
                facts={summary.facts}
                aside={
                  feedAge === null
                    ? undefined
                    : `${feedAge < STALE_AFTER_MS ? 'Live' : 'Stale'} · updated ${ageAgo(feedAge)}`
                }
              />
            )}
            {feed === 'failed' ? null : (
              <FleetStrip
                needsYou={latest === null ? null : needsYouItems}
                fleet={fleet}
                history={historyQuery.data?.data}
                hours={HISTORY_HOURS}
                oldest={oldest}
                now={now}
              />
            )}
            <NeedsYouSection humanQueue={humanQueue} agents={agents} unknown={latest === null} />
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
