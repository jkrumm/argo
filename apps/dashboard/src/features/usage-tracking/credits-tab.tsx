/**
 * Credits: the Claude API credit each subscription grants every cycle (Ultra $200, Max $100), spent by
 * the inference gateway before it expires. One section per pool: credit left against the cycle (our
 * meter and the provider's own report side by side, the larger one counts), where the pool lands at
 * the cycle end at the last week's pace, and the previous cycle's reconciled and unspent credit.
 * Below the pools, over the page Range: where the gateway sent each request (and how often it fell back
 * to the IU API), and how well each caller's prompt cache hits. The pools are cycle-based and ignore
 * the Range; Measure, Grain and Workspace do not apply here.
 */
import { Suspense } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Grid, Stack, Text } from '@mantine/core'
import { BarList, Section, StatGroup, type StatStripCell } from 'basalt-ui'
import { Bars, ChartCard, Lines } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS, VX } from 'basalt-ui/tokens'
import { withUnit } from '../../lib/format'
import type { Range } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { colorForPayer } from './constants'
import { CreditsBoundary } from './credits-boundary'
import { creditQueries, type CreditPool } from './credit-queries'
import {
  burnDomain,
  burnNote,
  burnRows,
  hasBalance,
  cacheRows,
  creditPayerOf,
  cycleLabel,
  fallbackShare,
  fmtCredit,
  fmtDaysLeft,
  overallHitRate,
  pickDays,
  poolTitle,
  previousNote,
  reasonLines,
  sortPools,
  sortTargets,
  targetColor,
  targetLabel,
  type BurnRow,
  type PickDay,
} from './credits-model'
import { EM_DASH, fmtShare, noDataInWindow, periodNoun, shortDay } from './model'

const BURN_HEIGHT = 240
const PICKS_HEIGHT = 220

const fallback = (height: number) => (
  <ChartCard state={{ pending: true }} placeholderHeight={height} />
)

const SECTION_INFO =
  'The API credit a subscription grants each billing cycle (Ultra $200, Max $100), spent by the inference gateway; it expires at the cycle end with no rollover. Credit left = the grant minus the larger of what the gateway metered and what the provider reports (the report also counts spend made outside the gateway, and lags by hours). Estimates stand in for requests the gateway could not price.'

const BURN_INFO =
  'Credit left per day of the cycle by two readings: our meter (the gateway’s own priced requests, estimates included) and the provider’s daily report (list price before credits, includes spend outside the gateway, lags by hours). The lower line is the one that counts. Days after today are empty.'

const PICKS_INFO =
  'Where the gateway sent each request, per day: a credit pool, the IU API, or refused. A fallback is a request that left the credit pools for any reason but a forced one (the caller demanded IU): Claude Code–shaped requests, no pool with room, a drained pool. The table lists every target and reason.'

const CACHE_INFO =
  'Share of a caller’s prompt tokens served from the cache: cache-read over input + cache-read + cache-write, over every request that caller made through the gateway (credit-paid or IU). Prompt caches are per organization, so a session that changes pool starts cold.'

/** Why the burn-down has nothing to draw. */
function burnEmpty(pool: CreditPool): string {
  if (pool.cycle.status === 'awaiting-reconcile') {
    return 'This cycle has ended and is awaiting its reconcile: no balance to count down'
  }
  return hasBalance(pool) ? 'No spend yet' : 'No running cycle on record for this pool'
}

function PoolSection({ pool }: { pool: CreditPool }) {
  const empty = shotState() === 'empty'
  const rows = empty ? [] : burnRows(pool)
  const title = poolTitle(pool.account)
  const color = colorForPayer(creditPayerOf(pool.account))
  const grant = pool.grantUsd
  const previous = previousNote(pool)
  const hasReported = rows.some((r) => r.reported !== null)

  const awaiting = pool.cycle.status === 'awaiting-reconcile'
  const leftFooter = awaiting
    ? `awaiting reconcile · grant ${fmtCredit(grant)}`
    : grant === null
      ? 'no cycle on record'
      : `of ${fmtCredit(grant)}`

  const cells: StatStripCell[] = [
    {
      key: 'left',
      caption: 'Credit left',
      info: 'The grant minus the larger of the metered and the reported spend since the cycle start, whatever the chart shows. A cycle that has ended but is not reconciled yet has no balance: it waits for the provider’s final figure.',
      value: pool.creditLeftUsd === null ? null : fmtCredit(pool.creditLeftUsd),
      footer: leftFooter,
    },
    {
      key: 'spent',
      caption: 'Spent',
      info: 'The larger of what the gateway metered and what the provider reports. Metered estimates are requests the gateway could not price.',
      value: fmtCredit(pool.spentUsd),
      footer:
        pool.meteredEstimatedRows > 0
          ? `${fmtCredit(pool.meteredUsd)} metered · ${fmtCredit(pool.meteredEstimatedUsd)} estimated`
          : `${fmtCredit(pool.meteredUsd)} metered`,
    },
    {
      key: 'projected',
      caption: 'Unspent at cycle end',
      info: 'Projected: the grant minus the spend to date minus the last seven days’ mean daily spend times the days left, never below zero. Unknown while the cycle end is.',
      value: pool.projectedUnspentUsd === null ? null : fmtCredit(pool.projectedUnspentUsd),
      footer: awaiting
        ? 'cycle ended'
        : pool.daysLeft === null
          ? 'cycle end unknown'
          : `${fmtDaysLeft(pool.daysLeft)} left · ${fmtCredit(pool.dailyRateUsd)} a day`,
    },
  ]

  return (
    <Section
      title={title}
      subtitle={cycleLabel(pool)}
      info={SECTION_INFO}
      data-shot={`credits-${pool.account}`}
    >
      <Stack gap="md">
        <StatGroup variant="strip" label={`${title} credit`} cols={3} cells={cells} />
        <Box data-shot={`credits-burndown-${pool.account}`} data-shot-states="empty">
          <ChartCard
            title="Credit left"
            info={BURN_INFO}
            subtitle={burnNote(pool)}
            placeholderHeight={BURN_HEIGHT}
            state={{ empty: rows.length === 0 && burnEmpty(pool) }}
          >
            <Lines<BurnRow, Date>
              ariaLabel={`${title} credit left per day of the cycle, by our meter and by the provider’s report`}
              data={rows}
              height={BURN_HEIGHT}
              x={(d) => d.at}
              formatX={(d) => shortDay(d)}
              cursorGroup={`usage-credits-${pool.account}`}
              series={[
                {
                  key: 'metered',
                  label: 'Metered',
                  color,
                  getValue: (d: BurnRow) => d.metered,
                  gaps: 'connect' as const,
                },
                ...(hasReported
                  ? [
                      {
                        key: 'reported',
                        label: 'Provider report',
                        color: VX.muted,
                        getValue: (d: BurnRow) => d.reported,
                        gaps: 'connect' as const,
                      },
                    ]
                  : []),
              ]}
              y={{
                domain: burnDomain(rows, grant ?? 0),
                format: (v: number) => fmtCredit(v),
              }}
              tooltip={{ formatHeader: (d) => shortDay(d) }}
            />
          </ChartCard>
        </Box>
        {previous === null ? null : (
          <Text size="sm" c="dimmed" data-shot={`credits-previous-${pool.account}`}>
            {previous}
          </Text>
        )}
      </Stack>
    </Section>
  )
}

function Pools() {
  const { data } = useSuspenseQuery(creditQueries.pools())
  const pools = sortPools(data.pools)
  if (pools.length === 0) {
    return (
      <ChartCard
        placeholderHeight="content"
        state={{ empty: 'No credit pool has a cycle or any spend yet' }}
      />
    )
  }
  return (
    <Stack gap="xl">
      {data.cyclesAvailable ? null : (
        <Text size="sm" c="dimmed" data-shot="credits-cycles-missing">
          No cycle table yet: balances and projections wait for usage-tracker, spend is shown as
          metered.
        </Text>
      )}
      {pools.map((pool) => (
        <PoolSection key={pool.account} pool={pool} />
      ))}
    </Stack>
  )
}

const picksEmpty = (available: boolean, range: Range): string =>
  available
    ? noDataInWindow('gateway routing decisions', range)
    : 'The gateway’s picks table does not exist yet'

function Picks({ range }: { range: Range }) {
  const { data } = useSuspenseQuery(creditQueries.picks(range))
  const empty = shotState() === 'empty' || data.total === 0
  const days = empty ? [] : pickDays(data.daily)
  const lines = empty ? [] : reasonLines(data.cells)
  const targets = sortTargets(days.flatMap((d) => Object.keys(d.counts)))
  const share = fallbackShare(data.fallbacks, data.total)
  const noun = periodNoun(range)

  return (
    <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <Box data-shot="credits-picks" data-shot-states="empty" h="100%">
          <ChartCard
            title="Where requests went"
            info={PICKS_INFO}
            subtitle={`Gateway routing decisions per day · ${noun}`}
            placeholderHeight={PICKS_HEIGHT}
            state={{ empty: empty && picksEmpty(data.available, range) }}
            facts={{
              value: share === null ? EM_DASH : String(Math.round(share * 100)),
              unit: '% fell back',
              period: [`${data.fallbacks} of ${data.total} picks`, `${data.refused} refused`],
            }}
          >
            <Bars<PickDay, Date>
              ariaLabel="Gateway routing decisions per day, by target"
              data={days}
              height={PICKS_HEIGHT}
              x={(d) => d.at}
              formatX={(d) => shortDay(d)}
              layout="stacked"
              cursorGroup="usage-credits-picks"
              bars={targets.map((t) => ({
                key: t,
                label: targetLabel(t),
                color: targetColor(t),
                getValue: (d: PickDay) => d.counts[t] ?? 0,
                formatValue: (v: number) => `${v} ${v === 1 ? 'pick' : 'picks'}`,
              }))}
              tooltip={{
                formatHeader: (d) => shortDay(d),
                rows: (d) => [{ label: 'Total', value: `${d.total} picks` }],
              }}
            />
          </ChartCard>
        </Box>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <Box data-shot="credits-reasons" data-shot-states="empty" h="100%">
          <ChartCard
            title="Target and reason"
            info={PICKS_INFO}
            placeholderHeight="content"
            state={{
              empty: lines.length === 0 && noDataInWindow('gateway routing decisions', range),
            }}
          >
            <BarList
              label={`Gateway picks by target and reason, ${noun}`}
              variant="thin"
              items={lines.map((l) => ({
                key: l.key,
                label: `${targetLabel(l.picked)} · ${l.reason}`,
                value: l.count,
                secondary: (
                  <Text span size="xs" c="dimmed">
                    {l.fallback ? 'fallback' : EM_DASH}
                  </Text>
                ),
              }))}
            />
          </ChartCard>
        </Box>
      </Grid.Col>
    </Grid>
  )
}

function CacheByCaller({ range }: { range: Range }) {
  const { data } = useSuspenseQuery(creditQueries.cache(range))
  const empty = shotState() === 'empty' || data.callers.length === 0
  const rows = empty ? [] : cacheRows(data.callers)
  const overall = overallHitRate(rows)
  const noun = periodNoun(range)

  return (
    <Box data-shot="credits-cache" data-shot-states="empty">
      <ChartCard
        title="Cache hit rate per caller"
        info={CACHE_INFO}
        subtitle={noun}
        placeholderHeight="content"
        state={{ empty: empty && noDataInWindow('gateway requests', range) }}
        facts={{
          value: overall === null ? EM_DASH : String(Math.round(overall * 100)),
          unit: '% overall',
          period: `${rows.reduce((sum, r) => sum + r.requests, 0)} requests`,
        }}
      >
        <BarList
          label={`Prompt cache hit rate per gateway caller, ${noun}`}
          variant="thin"
          max={100}
          format={(v) => withUnit(Math.round(v), '%')}
          items={rows.map((r) => ({
            key: r.caller,
            label: r.caller,
            value: r.hitRate === null ? 0 : r.hitRate * 100,
            secondary: (
              <Text span size="xs" c="dimmed">
                {r.hitRate === null ? 'no input' : fmtShare(r.hitRate)} · {r.requests}{' '}
                {r.requests === 1 ? 'request' : 'requests'}
              </Text>
            ),
          }))}
        />
      </ChartCard>
    </Box>
  )
}

export function CreditsTab({ range }: { range: Range }) {
  return (
    <Stack gap="xl">
      <CreditsBoundary noun="credit pools" height={420}>
        <Suspense fallback={fallback(420)}>
          <Pools />
        </Suspense>
      </CreditsBoundary>
      <Section
        title="Routing and cache"
        subtitle={`Gateway requests · ${periodNoun(range)}`}
        info="Over the page Range: where the gateway sent each request, and how well each caller's prompt cache hit."
      >
        <Stack gap="md">
          <CreditsBoundary noun="gateway picks" height={PICKS_HEIGHT}>
            <Suspense fallback={fallback(PICKS_HEIGHT)}>
              <Picks range={range} />
            </Suspense>
          </CreditsBoundary>
          <CreditsBoundary noun="cache hit rates">
            <Suspense fallback={fallback(200)}>
              <CacheByCaller range={range} />
            </Suspense>
          </CreditsBoundary>
        </Stack>
      </Section>
    </Stack>
  )
}
