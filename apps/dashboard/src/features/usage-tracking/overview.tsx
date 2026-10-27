/**
 * The combined view, one glance: a card per wallet (the limit, dollars and tokens side by side, when,
 * where), how each Claude Max subscription's weekly volume and quota built up, the weekly rhythm of
 * all wallets, and the projects and tools that took the usage with an inline timeline per row.
 * Three wallets, one currency: dollars at API prices are list value for the subscriptions and
 * spend for the API, and are never summed into a "cost" on a card.
 */
import { Suspense } from 'react'
import { useSuspenseQueries } from '@tanstack/react-query'
import { Grid, Stack } from '@mantine/core'
import { ChartCard } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { useNow } from '../../lib/use-now'
import type { UsageLens } from '../../lib/window-stores'
import { QUOTA_HOURS, quotaAccounts } from './quota-model'
import { Rhythm } from './rhythm'
import { ALL_WALLETS } from './scope'
import { SPLIT_TOP, totalOf } from './split-model'
import { SplitList } from './split-lists'
import { WalletCard } from './wallet-cards'
import { liveSubscriptions, liveWallets } from './wallet-model'
import { WeeklyQuota } from './weekly-quota'
import { WeeklyVolume } from './weekly-volume'
import type { WorkspaceValue } from './types'

const fallback = (height: number) => (
  <ChartCard state={{ pending: true }} placeholderHeight={height} />
)

export function Overview({
  range,
  lens,
  workspace,
}: {
  range: Range
  lens: UsageLens
  workspace: WorkspaceValue[] | undefined
}) {
  const now = useNow()
  const metric = lens === 'cost' ? 'cost' : 'tokens'
  const [projects, tools, daily, quota] = useSuspenseQueries({
    queries: [
      usageQueries.split({ by: 'project', range, lens, workspace, top: SPLIT_TOP }),
      usageQueries.split({ by: 'sub_tool', range, lens, workspace, top: SPLIT_TOP }),
      usageQueries.timeseries({ range, metric, groupBy: 'payer', workspace, grain: 'day' }),
      usageQueries.quota(QUOTA_HOURS),
    ],
  })
  const accounts = quotaAccounts(quota.data.series)
  const wallets = liveWallets(projects.data.totals, accounts)
  const subs = liveSubscriptions(projects.data.totals, accounts)

  return (
    <Stack gap="md">
      <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
        {wallets.map((wallet) => (
          <Grid.Col key={wallet.id} span={{ base: 12, lg: 12 / Math.min(wallets.length, 4) }}>
            <WalletCard
              wallet={wallet}
              total={totalOf(projects.data.totals, wallet.id)}
              projects={projects.data.rows}
              tools={tools.data.rows}
              daily={daily.data.buckets}
              lens={lens}
              range={range}
              now={now}
            />
          </Grid.Col>
        ))}
      </Grid>

      {subs.length === 0 ? null : (
        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <Suspense fallback={fallback(240)}>
              <WeeklyVolume subs={subs} lens={lens} workspace={workspace} />
            </Suspense>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <Suspense fallback={fallback(240)}>
              <WeeklyQuota subs={subs} height={240} />
            </Suspense>
          </Grid.Col>
        </Grid>
      )}

      <Suspense fallback={fallback(240)}>
        <Rhythm scope={ALL_WALLETS} range={range} lens={lens} workspace={workspace} />
      </Suspense>

      <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <SplitList
            dimension="project"
            rows={projects.data.rows}
            lens={lens}
            range={range}
            workspace={workspace}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <SplitList
            dimension="tool"
            rows={tools.data.rows}
            lens={lens}
            range={range}
            workspace={workspace}
          />
        </Grid.Col>
      </Grid>
    </Stack>
  )
}
