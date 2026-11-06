import { useQuery } from '@tanstack/react-query'
import { Skeleton, Stack } from '@mantine/core'
import { PageBar, PageSummary } from 'basalt-ui'
import { FilterSet, NumberFilter } from 'basalt-ui/controls'
import { agentPerformanceQueries, type UsageKpis } from '../../lib/queries/agent-performance'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import { AGENT_PERF_WEEKS, agentPerfStore } from '../../lib/window-stores'
import { IssuesSection } from './issues-section'
import {
  pushedRecord,
  reviewForSummary,
  summarySentence,
  type SummaryInput,
  usageParts,
  weekKeys,
} from './model'
import { ReviewSection } from './review-section'
import { RunsSection } from './runs-section'
import { SubagentsSection } from './subagents-section'

const WEEK_OPTIONS = AGENT_PERF_WEEKS.map((value) => ({ value, label: `${value} weeks` }))

type SummaryProps = {
  usage: UsageKpis | undefined
  weeks: number
  review: SummaryInput['review']
}

/** The one-sentence summary, a skeleton while the usage read is loading. */
function SummaryBlock({ usage, weeks, review }: SummaryProps) {
  if (usage === undefined) return <Skeleton h="3rem" aria-label="Loading agent performance" />
  return <PageSummary sentence={summarySentence({ weeks, subagents: usage.subagents, review })} />
}

/**
 * Agent performance: what the subagents, factory workers and Issues cost (Argo's usage read model) and
 * how the reviews fare (an `agw review stats` snapshot agent-workflows pushes). The two sources are
 * independent: review stats not being pushed yet leaves the usage sections untouched.
 */
export function AgentPerformancePage() {
  const { weeks } = agentPerfStore.useValues()
  const usageQuery = useQuery(agentPerformanceQueries.usage(weeks))
  const reviewQuery = useQuery(agentPerformanceQueries.reviewStats())
  const now = useNow()
  const refetchAll = () => {
    void usageQuery.refetch()
    void reviewQuery.refetch()
  }

  // `empty` is the real "agw has not pushed yet" branch of the review section.
  const emptyShot = shotState() === 'empty'
  const record = pushedRecord(reviewQuery.data, emptyShot)
  const usage = usageQuery.data
  const parts = usageParts(usage)
  const keys = weekKeys(weeks, now)
  const review = reviewForSummary({
    record,
    keys,
    emptyShot,
    succeeded: reviewQuery.isSuccess,
  })

  return (
    <>
      <PageBar
        filters={
          <FilterSet>
            <NumberFilter
              field={agentPerfStore.field.weeks}
              label="Window"
              options={WEEK_OPTIONS}
            />
          </FilterSet>
        }
        sync={{
          syncing: usageQuery.isFetching || reviewQuery.isFetching,
          onSync: refetchAll,
          label: 'Refresh',
        }}
      />

      <Stack gap="md">
        <SummaryBlock usage={usage} weeks={weeks} review={review} />
        <ReviewSection query={reviewQuery} record={record} keys={keys} now={now} />
        <IssuesSection query={usageQuery} issues={parts.issues} costBasis={parts.costBasis} />
        <SubagentsSection query={usageQuery} rows={parts.subagents} costBasis={parts.costBasis} />
        <RunsSection query={usageQuery} rows={parts.byWeek} keys={keys} />
      </Stack>
    </>
  )
}
