/**
 * Where we stand on the limits, one row: the two Max subscriptions' weekly quota (with a pace tick at
 * the share of the week already elapsed) and the IU API's rolling 30-day cap. Each is a single meter,
 * its percentage and its reset or headroom in one line. A missing, failed or old reading is a state of
 * its own, never an empty meter that reads as headroom; the ink turns at 80 % and 100 %.
 */
import { useQuery } from '@tanstack/react-query'
import { Box, Grid, Group, Stack, Text } from '@mantine/core'
import { Meter } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS, VX } from 'basalt-ui/tokens'
import { withUnit } from '../../lib/format'
import { usageQueries, type IuBudget, type QuotaLatest } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import { USAGE_ACCOUNTS } from './accounts'
import {
  NO_PORTAL_DATA,
  accountTitle,
  budgetReading,
  freshnessBadge,
  loadFailure,
  quotaReading,
  type CapState,
  type QuotaReading,
} from './budget-model'
import { fmtUsdWhole } from './model'

const NO_ACCOUNTS: readonly QuotaLatest[] = []
const WARN_AT = 0.8

const INFO =
  'Max subscriptions: share of each weekly window used, from the latest quota sample; the tick marks how far into the week it is, so fill past it means ahead of pace. IU API: spend over the rolling 30 days against the $500 cap, from the IU portal report; the tick marks 80 %. The ink turns at 80 % and 100 %.'

const STATE_INK: Record<CapState, string | undefined> = {
  ok: undefined,
  warn: VX.status.warn,
  over: VX.status.bad,
}

const pctText = (v: number) => withUnit(Math.round(v), '%')

/** `71 %`, and the state word once it is past ok: `91 % · warn`. */
function pctCaption(reading: QuotaReading): string | null {
  if (reading.pct === null) return null
  return reading.state === null || reading.state === 'ok'
    ? pctText(reading.pct)
    : `${pctText(reading.pct)} · ${reading.state}`
}

/** A cell's title row; the marker is a freshness word that earns an ink when it is not fine. */
function Heading({
  title,
  marker,
  tone,
}: {
  title: string
  marker?: string | null | undefined
  tone?: 'warn' | 'bad' | undefined
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Text size="sm" fw={500}>
        {title}
      </Text>
      {marker ? (
        <Text size="xs" fw={600} c={tone === 'bad' ? VX.status.bad : VX.status.warn}>
          {marker}
        </Text>
      ) : null}
    </Group>
  )
}

function SubscriptionMeter({
  account,
  sample,
  now,
}: {
  account: string
  sample: QuotaLatest | undefined
  now: number
}) {
  const reading = quotaReading(sample, now)
  const ink = reading.state === null ? undefined : STATE_INK[reading.state]
  const caption = pctCaption(reading)
  const title = `Max ${accountTitle(account)} · ${withUnit(7, 'd')}`
  return (
    <Stack gap={4}>
      <Heading title={title} marker={reading.status === 'stale' ? reading.note : null} />
      <Meter
        label={`${title} weekly quota used`}
        value={reading.pct}
        max={100}
        format={pctText}
        emptyText={reading.note ?? 'no reading'}
        {...(caption === null ? {} : { startCaption: caption })}
        {...(reading.resets === null ? {} : { endCaption: reading.resets })}
        {...(reading.pace === null ? {} : { ticks: [{ at: reading.pace * 100, label: 'pace' }] })}
        {...(ink === undefined ? {} : { color: ink })}
      />
    </Stack>
  )
}

function CapMeter({ budget, now }: { budget: IuBudget; now: number }) {
  const reading = budgetReading(budget, now)
  const badge = freshnessBadge(budget.fetchedAt, now)
  const ink = reading.state === null ? undefined : STATE_INK[reading.state]
  const stale = badge !== null && badge.tone !== 'muted'
  return (
    <Stack gap={4}>
      <Heading
        title={`IU API · ${withUnit('rolling 30', 'd')}`}
        marker={stale ? badge.text : null}
        tone={badge?.tone === 'bad' ? 'bad' : 'warn'}
      />
      {reading.freshness === 'empty' ? (
        <Text size="sm" c="dimmed">
          {NO_PORTAL_DATA}
        </Text>
      ) : (
        <Meter
          label="IU API spend over the rolling 30 days against the cap"
          value={budget.rolling30Usd}
          max={budget.limitUsd}
          format={fmtUsdWhole}
          ticks={[{ at: budget.limitUsd * WARN_AT, label: withUnit(WARN_AT * 100, '%') }]}
          startCaption={reading.cap ?? ''}
          {...(reading.canSpend === null ? {} : { endCaption: reading.canSpend })}
          {...(ink === undefined ? {} : { color: ink })}
        />
      )}
    </Stack>
  )
}

export function Limits() {
  const quota = useQuery(usageQueries.quotaLatest())
  const budget = useQuery(usageQueries.iuBudget())
  const now = useNow()
  const empty = shotState() === 'empty'
  const samples = empty ? NO_ACCOUNTS : (quota.data?.accounts ?? NO_ACCOUNTS)
  const failed = !empty && quota.isError && budget.isError

  return (
    <Box data-shot="limits" data-shot-states="empty">
      <ChartCard
        title="Limits"
        info={INFO}
        placeholderHeight={90}
        stateNoun="the limits"
        onRetry={() => {
          void quota.refetch()
          void budget.refetch()
        }}
        retrying={quota.isFetching || budget.isFetching}
        state={{
          pending: !empty && (quota.isPending || budget.isPending),
          error: failed
            ? loadFailure(quota.error ?? budget.error, 'The limits did not load from the API.')
            : undefined,
        }}
      >
        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
          {USAGE_ACCOUNTS.map((a) => (
            <Grid.Col key={a.id} span={{ base: 12, lg: 4 }}>
              {quota.isError && !empty ? (
                <Text size="sm" c={VX.status.bad}>
                  Max {accountTitle(a.id)}: quota samples did not load
                </Text>
              ) : (
                <SubscriptionMeter
                  account={a.id}
                  sample={samples.find((s) => s.account === a.id)}
                  now={now}
                />
              )}
            </Grid.Col>
          ))}
          <Grid.Col span={{ base: 12, lg: 4 }}>
            {budget.isError && !empty ? (
              <Text size="sm" c={VX.status.bad}>
                IU API: the budget did not load
              </Text>
            ) : budget.data === undefined ? null : (
              <CapMeter budget={budget.data} now={now} />
            )}
          </Grid.Col>
        </Grid>
      </ChartCard>
    </Box>
  )
}
