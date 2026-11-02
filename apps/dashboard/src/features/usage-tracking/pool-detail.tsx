/**
 * The detail of a credit pool: how its cycle went (the burn-down with our meter beside the provider's
 * report, the even pace and the projection), where its spend came from, the eval reserve, which picks
 * drew on it and which workflows spent it, and the previous cycle reconciled. The figures are the pool
 * node's (`/usage/pace`) so the card above and this view cannot differ.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Grid, Group, Stack, Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { fmtDay, fmtInstant, fmtUsd, picksByReason, poolPayer, poolTitle } from './flow-model'
import { PaceChart } from './pace-chart'
import { paceModel } from './pace-model'
import { periodNoun } from './model'

const HEIGHT = 340

const CYCLE_INFO =
  'Credit left per day of the cycle by two readings: our meter plus what the provider reports, the larger of the two per day (solid), and the provider’s report alone (thin). The report counts spend made outside the gateway and lags by hours. Dashed: the projection at the production rate; dotted: the even pace.'
const FACTS_INFO =
  'Spent is the sum over the cycle’s days of the larger of meter and report. Outside the gateway is what the report holds on days the gateway carried nothing. The eval reserve is what production keeps for the rest of the cycle (grant × days left ÷ cycle days); evals may draw only what is left above it.'

function Fact({ label, value, quiet = false }: { label: string; value: string; quiet?: boolean }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Text size={quiet ? 'xs' : 'sm'} {...(quiet ? { c: 'dimmed' } : {})}>
        {label}
      </Text>
      <Text size={quiet ? 'xs' : 'sm'} ff="monospace">
        {value}
      </Text>
    </Group>
  )
}

export function PoolDetail({ account, range }: { account: string; range: Range }) {
  const { data: pace } = useSuspenseQuery({ ...usageQueries.pace(), refetchInterval: 5 * 60_000 })
  const { data: router } = useSuspenseQuery(usageQueries.router(range))
  const { data: demand } = useSuspenseQuery(
    usageQueries.demand({ range, by: 'workflow', payer: [poolPayer(account)], top: 5 }),
  )
  const pool = pace.pools.find((p) => p.account === account)
  const title = poolTitle(account)
  if (pool === undefined || !pool.enabled) {
    return (
      <ChartCard
        title={title}
        placeholderHeight="content"
        state={{ empty: `${title} is not enabled: no running cycle on record` }}
      />
    )
  }
  const model = paceModel(pace, { account })
  const through = Math.max(0, pool.spentUsd - pool.outsideUsd)
  const reasons = picksByReason(router.picks, account)
  const lag = pool.reportedUsd === null ? null : Math.max(0, pool.meteredUsd - pool.reportedUsd)
  const cycle = `${fmtDay(pool.cycle.start)} – ${pool.cycle.end === null ? 'end unknown' : fmtDay(pool.cycle.end)}`
  const report =
    pool.reportedAt === null
      ? 'no provider report yet'
      : `report refreshed ${fmtInstant(pool.reportedAt)}${lag === null ? '' : `, trails the meter by ${fmtUsd(lag)}`}`
  const previous = pool.previous

  return (
    <Grid
      type="container"
      breakpoints={CONTAINER_GRID_BREAKPOINTS}
      data-shot={`flow-pool-${account}`}
    >
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <Stack gap="md">
          <ChartCard
            title={`${title} · how the cycle went`}
            subtitle={`${cycle} · ${report}`}
            info={CYCLE_INFO}
            placeholderHeight={HEIGHT}
            state={{ empty: model.lines.length === 0 && 'No spend yet this cycle' }}
          >
            <PaceChart
              pace={pace}
              model={model}
              height={HEIGHT}
              cursorGroup={`usage-flow-pool-${account}`}
              ariaLabel={`${title} credit left per day of the cycle, by our meter and by the provider’s report, with the even pace and the projection`}
            />
          </ChartCard>
          <ChartCard
            title="Previous cycle"
            info="The pool's newest closed cycle: what the provider's final figure reconciled and what expired unspent."
            placeholderHeight="content"
          >
            <Text size="sm">
              {previous === null
                ? 'no earlier cycle on record'
                : `${fmtDay(previous.start)} – ${fmtDay(previous.end)} · ${fmtUsd(previous.grantUsd)} granted · ${fmtUsd(previous.reconciledUsd)} reconciled · ${fmtUsd(previous.unspentUsd)} expired unspent`}
            </Text>
          </ChartCard>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <ChartCard title="Where the credit went" info={FACTS_INFO} placeholderHeight="content">
          <Stack gap="md">
            <Stack gap={4}>
              <Fact label="spent" value={fmtUsd(pool.spentUsd)} />
              <Fact quiet label="outside the gateway" value={fmtUsd(pool.outsideUsd)} />
              <Fact quiet label="through it" value={fmtUsd(through)} />
              <Fact label="eval reserve" value={fmtUsd(pool.evalReserveUsd)} />
              <Fact label="eval available" value={fmtUsd(pool.evalAvailableUsd)} />
            </Stack>
            <Stack gap={4}>
              <Text size="sm" fw={600}>
                Picks to {account} · {periodNoun(range)}
              </Text>
              <BarList
                label={`Gateway picks to ${account} by reason`}
                variant="thin"
                emptyText="No picks to this pool in this range"
                format={(v) => new Intl.NumberFormat('en-GB').format(v)}
                items={reasons.map((r) => ({ key: r.reason, label: r.reason, value: r.n }))}
              />
            </Stack>
            <Stack gap={4}>
              <Text size="sm" fw={600}>
                Top workflows on it · {periodNoun(range)}
              </Text>
              <BarList
                label={`Top agw workflows spending ${account} credit`}
                variant="thin"
                emptyText="No workflow spent this pool in this range"
                format={(v) => fmtUsd(v)}
                items={demand.rows.map((r) => ({ key: r.key, label: r.key, value: r.usd }))}
              />
            </Stack>
          </Stack>
        </ChartCard>
      </Grid.Col>
    </Grid>
  )
}
