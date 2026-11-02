/**
 * A subscription's detail on the Flow tab: its weekly quota sawtooth beside this week's pace meter,
 * the compared row (list value, value multiple, tokens, active days, quota peak) and the account
 * picker's Routing section, which keeps its own range (`usageStore.field.routingRange`). List value is
 * never charged: the plan is flat. Tokens (fresh, cache-read) sit beside the dollars in the row.
 */
import { Suspense } from 'react'
import { useSuspenseQueries } from '@tanstack/react-query'
import { Grid, Stack, Text } from '@mantine/core'
import { ChartCard } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { useNow } from '../../lib/use-now'
import { SUB_WALLETS, type AccountId, type SubWallet } from './accounts'
import { Compared } from './compared'
import { WalletMeter } from './limits'
import { QUOTA_HOURS, quotaPeaks } from './quota-model'
import { Routing } from './routing'
import { SPLIT_TOP } from './split-model'
import { comparedRows, RANGE_DAYS } from './value-model'
import { WeeklyQuota } from './weekly-quota'

export interface SubscriptionDetailProps {
  account: AccountId
  range: Range
}

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

const fallback = (height: number) => (
  <ChartCard state={{ pending: true }} placeholderHeight={height} />
)

/** The compared row of one subscription: its totals over the range, days held and quota peak. */
function SubscriptionCompared({ wallet, range }: { wallet: SubWallet; range: Range }) {
  const now = useNow()
  const allTime = { range: 'all', grain: 'day', metric: 'cost', groupBy: 'payer' } as const
  const [split, quota, daily] = useSuspenseQueries({
    queries: [
      usageQueries.split({
        by: 'project',
        range,
        lens: 'cost',
        payer: [wallet.id],
        top: SPLIT_TOP,
      }),
      usageQueries.quota(QUOTA_HOURS),
      usageQueries.timeseries({ ...allTime, payer: [wallet.id] }),
    ],
  })
  const sinceMs = range === 'all' ? 0 : now - RANGE_DAYS[range] * DAY_MS
  const peaks = quotaPeaks(quota.data.series, Math.max(sinceMs, now - QUOTA_HOURS * HOUR_MS))
  const { rows } = comparedRows({
    subs: [wallet],
    totals: split.data.totals,
    daily: daily.data.buckets,
    peaks,
    range,
    now,
  })
  const [row] = rows
  if (row === undefined) return null
  return <Compared rows={rows} sum={row} range={range} title={wallet.title} />
}

export function SubscriptionDetail({ account, range }: SubscriptionDetailProps) {
  const wallet = SUB_WALLETS.find((w) => w.account === account)
  if (wallet === undefined) return null

  return (
    <Stack gap="md" data-shot={`subscription-detail-${account}`}>
      <Suspense fallback={fallback(120)}>
        <SubscriptionCompared wallet={wallet} range={range} />
      </Suspense>

      <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Suspense fallback={fallback(280)}>
            <WeeklyQuota subs={[wallet]} height={280} />
          </Suspense>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <ChartCard title="This week · quota vs pace" placeholderHeight="content">
            <Stack gap="md">
              <WalletMeter wallet={wallet} />
              <Text size="xs" c="dimmed">
                The tick marks how far into the seven-day window it is; fill past it is ahead of
                pace.
              </Text>
            </Stack>
          </ChartCard>
        </Grid.Col>
      </Grid>

      <Routing />
    </Stack>
  )
}
