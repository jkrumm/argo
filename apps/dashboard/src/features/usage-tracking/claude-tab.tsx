/**
 * Claude Max, every subscription together: they do the same work, so they are compared and summed
 * rather than given a tab each. The Account control scopes the whole tab to one subscription (or all
 * of them); only subscriptions with usage or a quota sample in the range are listed. Compared table,
 * weekly quota with this week's pace, volume over time, rhythm, and the ranked projects, tools and
 * models.
 */
import { Suspense } from 'react'
import { useSuspenseQueries } from '@tanstack/react-query'
import { Grid, Stack, Text } from '@mantine/core'
import { Section } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { ViewTabs } from 'basalt-ui/controls'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { usageQueries, type Grain, type Range } from '../../lib/queries/usage'
import { useNow } from '../../lib/use-now'
import {
  usageStore,
  type UsageAccount,
  type UsageGroupBy,
  type UsageLens,
} from '../../lib/window-stores'
import { Compared } from './compared'
import { WalletMeter } from './limits'
import { noDataInWindow } from './model'
import { OverTime } from './over-time'
import { pickOptions } from './pick-options'
import { QUOTA_HOURS, quotaAccounts, quotaPeaks } from './quota-model'
import RankedList from './ranked-list'
import { Rhythm } from './rhythm'
import { claudeScope, selectedSubs } from './scope'
import { SPLIT_TOP } from './split-model'
import type { WorkspaceValue } from './types'
import { comparedRows, RANGE_DAYS } from './value-model'
import { liveSubscriptions } from './wallet-model'
import { WeeklyQuota } from './weekly-quota'

const GROUP_OPTIONS: readonly UsageGroupBy[] = ['payer', 'sub_tool', 'model_norm', 'project']
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

const fallback = (height: number) => (
  <ChartCard state={{ pending: true }} placeholderHeight={height} />
)

export function ClaudeTab({
  account,
  range,
  grain,
  lens,
  groupBy,
  workspace,
}: {
  account: string
  range: Range
  grain: Grain
  lens: UsageLens
  groupBy: UsageGroupBy
  workspace: WorkspaceValue[] | undefined
}) {
  const now = useNow()
  const [split, quota, daily] = useSuspenseQueries({
    queries: [
      usageQueries.split({ by: 'project', range, lens, workspace, top: SPLIT_TOP }),
      usageQueries.quota(QUOTA_HOURS),
      usageQueries.timeseries({
        range: 'all',
        grain: 'day',
        metric: 'cost',
        groupBy: 'payer',
        workspace,
      }),
    ],
  })
  const subs = liveSubscriptions(split.data.totals, quotaAccounts(quota.data.series))
  // An account that is not live (a stale URL, a subscription without data) reads as `all`.
  const effective = subs.some((s) => s.account === account) ? account : 'all'
  const shown = selectedSubs(subs, effective)
  const scope = claudeScope(subs, effective)

  if (subs.length === 0) {
    return (
      <ChartCard
        title="Claude Max"
        placeholderHeight={120}
        state={{ empty: noDataInWindow('Claude Max usage', range) }}
      />
    )
  }

  const sinceMs = range === 'all' ? 0 : now - RANGE_DAYS[range] * DAY_MS
  const peaks = quotaPeaks(quota.data.series, Math.max(sinceMs, now - QUOTA_HOURS * HOUR_MS))
  const { rows, sum } = comparedRows({
    subs: shown,
    totals: split.data.totals,
    daily: daily.data.buckets,
    peaks,
    range,
    now,
  })

  return (
    <Section
      title="Claude Max"
      {...(subs.length > 1
        ? {
            tabs: (
              <ViewTabs
                field={usageStore.field.account}
                options={pickOptions<UsageAccount>(usageStore.field.account.options, [
                  'all',
                  ...subs.map((s) => s.account),
                ])}
                label="Account"
              />
            ),
          }
        : {})}
    >
      <Stack gap="md">
        <Compared rows={rows} sum={sum} range={range} />

        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Suspense fallback={fallback(280)}>
              <WeeklyQuota subs={shown} height={280} />
            </Suspense>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <ChartCard title="This week · quota vs pace" placeholderHeight="content">
              <Stack gap="md">
                {shown.map((s) => (
                  <WalletMeter key={s.id} wallet={s} />
                ))}
                <Text size="xs" c="dimmed">
                  The tick marks how far into the seven-day window it is; fill past it is ahead of
                  pace.
                </Text>
              </Stack>
            </ChartCard>
          </Grid.Col>
        </Grid>

        <Suspense fallback={fallback(300)}>
          <OverTime
            range={range}
            grain={grain}
            lens={lens}
            scope={scope}
            groupBy={groupBy}
            groupOptions={GROUP_OPTIONS}
            workspace={workspace}
          />
        </Suspense>
        <Suspense fallback={fallback(240)}>
          <Rhythm scope={scope} range={range} lens={lens} workspace={workspace} />
        </Suspense>
        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
          {(['project', 'sub_tool', 'model_norm'] as const).map((by) => (
            <Grid.Col key={by} span={{ base: 12, lg: 4 }}>
              <Suspense fallback={fallback(320)}>
                <RankedList by={by} scope={scope} range={range} lens={lens} workspace={workspace} />
              </Suspense>
            </Grid.Col>
          ))}
        </Grid>
      </Stack>
    </Section>
  )
}
