/**
 * The expert view of the IU API, the metered lane (different use, so its own tab): the cap meter with
 * how much of the spend carries no project, the portal-vs-tracked strip, its figures, spend over
 * time, its weekly rhythm, the ranked projects, tools and models, and where its tokens go and what
 * they cost.
 */
import { Suspense } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Grid, Stack, Text } from '@mantine/core'
import { ChartCard } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { withUnit } from '../../lib/format'
import { usageQueries, type Grain, type Range } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import type { UsageGroupBy, UsageLens } from '../../lib/window-stores'
import { IU_API } from './accounts'
import CacheEfficiency from './cache-efficiency'
import { WalletMeter } from './limits'
import { fmtShare, fmtUsdWhole, periodNoun } from './model'
import { OverTime } from './over-time'
import RankedList from './ranked-list'
import Reconciliation from './reconciliation'
import { Rhythm } from './rhythm'
import { IU_API_SCOPE } from './scope'
import { SPLIT_TOP, totalOf, unsetShare } from './split-model'
import TopSpenders from './top-spenders'
import type { WorkspaceValue } from './types'
import { WalletFigures } from './wallet-figures'

const GROUP_OPTIONS: readonly UsageGroupBy[] = ['sub_tool', 'model_norm', 'project']

const LIMITS_INFO =
  'IU API spend over the rolling 30 days against the $500 cap, from the IU portal report; the tick marks 80 %. The ink turns at 80 % and 100 %.'

const fallback = (height: number) => (
  <ChartCard state={{ pending: true }} placeholderHeight={height} />
)

/** How much of the range's spend no project can be named for: the attribution gap. */
function ProjectCoverage({
  range,
  workspace,
}: {
  range: Range
  workspace: WorkspaceValue[] | undefined
}) {
  const query = useSuspenseQuery(
    usageQueries.split({
      by: 'project',
      range,
      lens: 'cost',
      payer: [IU_API.id],
      workspace,
      top: SPLIT_TOP,
    }),
  )
  const gap =
    shotState() === 'empty'
      ? null
      : unsetShare(query.data.rows, totalOf(query.data.totals, IU_API.id))
  if (gap === null) return null
  return (
    <Text size="sm" c="dimmed" data-shot="project-coverage">
      {gap.cost <= 0
        ? `Every dollar of IU API spend carries a project · ${periodNoun(range)}`
        : `${fmtShare(gap.share)} of IU API spend has no project (${fmtUsdWhole(gap.cost)}) · ${periodNoun(range)}`}
    </Text>
  )
}

export function IuApiTab({
  range,
  grain,
  lens,
  groupBy,
  workspace,
}: {
  range: Range
  grain: Grain
  lens: UsageLens
  groupBy: UsageGroupBy
  workspace: WorkspaceValue[] | undefined
}) {
  return (
    <Stack gap="md">
      <Box data-shot="limit-iu-api">
        <ChartCard
          title={`Limit · IU API · ${withUnit('rolling 30', 'd')}`}
          info={LIMITS_INFO}
          placeholderHeight="content"
        >
          <Stack gap="sm">
            <WalletMeter wallet={IU_API} titled={false} />
            <Suspense fallback={null}>
              <ProjectCoverage range={range} workspace={workspace} />
            </Suspense>
          </Stack>
        </ChartCard>
      </Box>
      <Suspense fallback={fallback(200)}>
        <Reconciliation />
      </Suspense>
      <Suspense fallback={fallback(120)}>
        <WalletFigures wallet={IU_API} range={range} workspace={workspace} />
      </Suspense>
      <Suspense fallback={fallback(300)}>
        <OverTime
          range={range}
          grain={grain}
          lens={lens}
          scope={IU_API_SCOPE}
          groupBy={groupBy === 'payer' ? 'sub_tool' : groupBy}
          groupOptions={GROUP_OPTIONS}
          workspace={workspace}
        />
      </Suspense>
      <Suspense fallback={fallback(240)}>
        <Rhythm scope={IU_API_SCOPE} range={range} lens={lens} workspace={workspace} />
      </Suspense>
      <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
        {(['project', 'sub_tool', 'model_norm'] as const).map((by) => (
          <Grid.Col key={by} span={{ base: 12, lg: 4 }}>
            <Suspense fallback={fallback(320)}>
              <RankedList
                by={by}
                scope={IU_API_SCOPE}
                range={range}
                lens={lens}
                workspace={workspace}
              />
            </Suspense>
          </Grid.Col>
        ))}
      </Grid>
      <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Suspense fallback={fallback(260)}>
            <TopSpenders range={range} lens={lens} workspace={workspace} />
          </Suspense>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Suspense fallback={fallback(260)}>
            <CacheEfficiency range={range} lens={lens} workspace={workspace} />
          </Suspense>
        </Grid.Col>
      </Grid>
    </Stack>
  )
}
