/**
 * The combined view, one glance: a card per wallet (how much, how many tokens, when, where, the
 * limit), when each wallet was used, and the projects and tools that took the usage with the wallet
 * mix inside every row. Three wallets, one currency: dollars at API prices are list value for the
 * subscriptions and spend for the API, and are never summed into a "cost" on a card.
 */
import { useSuspenseQueries } from '@tanstack/react-query'
import { Grid, Stack } from '@mantine/core'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { useNow } from '../../lib/use-now'
import type { UsageLens } from '../../lib/window-stores'
import { ME_API, WALLETS, type CardWallet } from './accounts'
import { SHOW_AT_USD, totalOf } from './split-model'
import { SplitList } from './split-lists'
import { WalletCard } from './wallet-cards'
import { When } from './when'
import type { WorkspaceValue } from './types'

/** Keys the API keeps before folding the tail: wide enough that a wallet's own top row is in it. */
const SPLIT_TOP = 50

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
  const hourly = range === '7d'
  const series = { range, metric, groupBy: 'payer', workspace } as const
  const [projects, tools, daily, when] = useSuspenseQueries({
    queries: [
      usageQueries.split({ by: 'project', range, lens, workspace, top: SPLIT_TOP }),
      usageQueries.split({ by: 'sub_tool', range, lens, workspace, top: SPLIT_TOP }),
      usageQueries.timeseries({ ...series, grain: 'day' }),
      usageQueries.timeseries({ ...series, grain: hourly ? 'hour' : 'day' }),
    ],
  })
  const meApi = totalOf(projects.data.totals, ME_API.id)
  const wallets: CardWallet[] = [
    ...WALLETS,
    ...(meApi !== undefined && meApi.cost >= SHOW_AT_USD ? [ME_API] : []),
  ]

  return (
    <Stack gap="md">
      <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
        {wallets.map((wallet) => (
          <Grid.Col key={wallet.id} span={{ base: 12, lg: 4 }}>
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

      <When range={range} lens={lens} rows={wallets.map((w) => w.id)} buckets={when.data.buckets} />

      <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <SplitList dimension="project" rows={projects.data.rows} lens={lens} range={range} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <SplitList dimension="tool" rows={tools.data.rows} lens={lens} range={range} />
        </Grid.Col>
      </Grid>
    </Stack>
  )
}
