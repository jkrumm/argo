/**
 * Explore: the analysis blocks across every payer at once (subscriptions, credit pools, IU keys),
 * narrowed by the page's Payer control instead of one tab per wallet. Over time (grouped by payer,
 * tool, model or project), the Projects and Tools rows with their timelines, the weekly rhythm and
 * the weekly volume per payer. The Athena team key is off unless selected and is in no "all".
 */
import { Suspense } from 'react'
import { Stack } from '@mantine/core'
import { ChartCard } from 'basalt-ui/charts'
import type { Grain, Range } from '../../lib/queries/usage'
import type { UsageGroupBy, UsageLens } from '../../lib/window-stores'
import type { PayerValue } from './accounts'
import { InsightsStrip } from './insights-strip'
import { ExploreLists } from './explore-lists'
import { EXPLORE_GROUP_OPTIONS, exploreScope, exploreVolumePayers } from './explore-model'
import { OverTime } from './over-time'
import { Rhythm } from './rhythm'
import type { WorkspaceValue } from './types'
import { WeeklyVolume } from './weekly-volume'

export interface ExploreTabProps {
  range: Range
  grain: Grain
  lens: UsageLens
  groupBy: UsageGroupBy
  workspace: WorkspaceValue[] | undefined
  /** Selected payers; empty = every payer except Athena team. */
  payer: readonly PayerValue[]
}

const fallback = (height: number) => (
  <ChartCard state={{ pending: true }} placeholderHeight={height} />
)

export function ExploreTab({ range, grain, lens, groupBy, workspace, payer }: ExploreTabProps) {
  const scope = exploreScope(payer)

  return (
    <Stack gap="md">
      <Suspense fallback={fallback(160)}>
        <InsightsStrip range={range} />
      </Suspense>
      <Suspense fallback={fallback(300)}>
        <OverTime
          range={range}
          grain={grain}
          lens={lens}
          scope={scope}
          groupBy={groupBy}
          groupOptions={EXPLORE_GROUP_OPTIONS}
          workspace={workspace}
          payerNoun="payer"
        />
      </Suspense>
      <Suspense fallback={fallback(320)}>
        <ExploreLists payers={scope.payers} range={range} lens={lens} workspace={workspace} />
      </Suspense>
      <Suspense fallback={fallback(240)}>
        <Rhythm scope={scope} range={range} lens={lens} workspace={workspace} />
      </Suspense>
      <Suspense fallback={fallback(240)}>
        <WeeklyVolume
          range={range}
          subs={exploreVolumePayers(scope.payers)}
          lens={lens}
          workspace={workspace}
          word={scope.word}
        />
      </Suspense>
    </Stack>
  )
}
