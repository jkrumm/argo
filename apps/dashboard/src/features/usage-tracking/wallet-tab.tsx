/**
 * The expert view of one wallet: its limit, its figures, usage over time, its weekly rhythm and the
 * ranked projects, tools and models. The IU API tab also shows where its tokens go and what they
 * cost, open, and the portal-vs-tracked strip under the cap.
 */
import { Suspense } from 'react'
import { Grid, Stack } from '@mantine/core'
import { ChartCard } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import type { Grain, Range } from '../../lib/queries/usage'
import type { UsageGroupBy, UsageLens } from '../../lib/window-stores'
import type { Wallet } from './accounts'
import CacheEfficiency from './cache-efficiency'
import { OverTime } from './over-time'
import RankedList from './ranked-list'
import Reconciliation from './reconciliation'
import { Rhythm } from './rhythm'
import TopSpenders from './top-spenders'
import type { WorkspaceValue } from './types'
import { WalletFigures } from './wallet-figures'
import { WalletLimit } from './wallet-limit'

const fallback = (height: number) => (
  <ChartCard state={{ pending: true }} placeholderHeight={height} />
)

export function WalletTab({
  wallet,
  range,
  grain,
  lens,
  groupBy,
  workspace,
}: {
  wallet: Wallet
  range: Range
  grain: Grain
  lens: UsageLens
  groupBy: UsageGroupBy
  workspace: WorkspaceValue[] | undefined
}) {
  const api = wallet.kind === 'api'
  return (
    <Stack gap="md">
      <WalletLimit wallet={wallet} />
      {api ? (
        <Suspense fallback={fallback(200)}>
          <Reconciliation />
        </Suspense>
      ) : null}
      <Suspense fallback={fallback(120)}>
        <WalletFigures wallet={wallet} range={range} workspace={workspace} />
      </Suspense>
      <Suspense fallback={fallback(300)}>
        <OverTime
          range={range}
          grain={grain}
          lens={lens}
          wallet={wallet}
          groupBy={groupBy}
          workspace={workspace}
        />
      </Suspense>
      <Suspense fallback={fallback(240)}>
        <Rhythm wallet={wallet} range={range} lens={lens} workspace={workspace} />
      </Suspense>
      <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
        {(['project', 'sub_tool', 'model_norm'] as const).map((by) => (
          <Grid.Col key={by} span={{ base: 12, lg: 4 }}>
            <Suspense fallback={fallback(320)}>
              <RankedList by={by} wallet={wallet} range={range} lens={lens} workspace={workspace} />
            </Suspense>
          </Grid.Col>
        ))}
      </Grid>
      {api ? (
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
      ) : null}
    </Stack>
  )
}
