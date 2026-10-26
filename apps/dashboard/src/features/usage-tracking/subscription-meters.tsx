/**
 * Q2 of the top band: how much of each Max subscription's weekly window is used, am I on pace, and
 * when does it reset? One `Meter` per account with a pace tick at the share of the week already
 * elapsed (fill past the tick = ahead of pace). A missing, failed or old reading is a state of its
 * own, never an empty meter that reads as headroom. Quota is a percentage, so nothing here is money.
 */
import { useQuery } from '@tanstack/react-query'
import { Box, Group, Stack, Text } from '@mantine/core'
import { Meter } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { withUnit } from '../../lib/format'
import { usageQueries, type QuotaLatest } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import { USAGE_ACCOUNTS } from './accounts'
import {
  accountTitle,
  loadFailure,
  quotaReading,
  routingLine,
  type CapState,
  type QuotaReading,
} from './budget-model'

const PICKS_HOURS = 168
const NO_ACCOUNTS: readonly QuotaLatest[] = []

const INFO =
  'Share of each Max subscription’s weekly window used, from the latest quota sample. The tick marks how far into the week it is: fill past it means ahead of pace. The ink turns at 80 % and 100 %. The line under the meters is the picker’s routing over the last 7 days.'

const STATE_INK: Record<CapState, string | undefined> = {
  ok: undefined,
  warn: VX.status.warn,
  over: VX.status.bad,
}

const pctText = (v: number) => withUnit(Math.round(v), '%')

/** `71 %`, and the state word once it is past ok: `91 % · warn`. */
function readingCaption(reading: QuotaReading): string | null {
  if (reading.pct === null) return null
  return reading.state === null || reading.state === 'ok'
    ? pctText(reading.pct)
    : `${pctText(reading.pct)} · ${reading.state}`
}

function AccountMeter({
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
  const caption = readingCaption(reading)
  return (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm" fw={500}>
          {accountTitle(account)}
        </Text>
        {reading.status === 'stale' ? (
          <Text size="xs" c={VX.status.warn}>
            {reading.note}
          </Text>
        ) : null}
      </Group>
      <Meter
        label={`${accountTitle(account)} weekly quota used`}
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

export function SubscriptionMeters() {
  const quota = useQuery(usageQueries.quotaLatest())
  const picks = useQuery(usageQueries.pickSummary(PICKS_HOURS))
  const now = useNow()
  const empty = shotState() === 'empty'
  const samples = empty ? NO_ACCOUNTS : (quota.data?.accounts ?? NO_ACCOUNTS)
  const routing = empty || picks.data === undefined ? null : routingLine(picks.data)

  return (
    <Box data-shot="subscription-meters" data-shot-states="empty">
      <ChartCard
        title={`Subscriptions · ${withUnit(7, 'd')}`}
        info={INFO}
        placeholderHeight={140}
        stateNoun="subscription headroom"
        onRetry={() => void quota.refetch()}
        retrying={quota.isFetching}
        state={{
          pending: !empty && quota.isPending,
          error:
            !empty && quota.isError
              ? loadFailure(quota.error, 'The quota samples did not load from the API.')
              : undefined,
        }}
      >
        {quota.data === undefined && !empty ? null : (
          <Stack gap="md">
            {USAGE_ACCOUNTS.map((a) => (
              <AccountMeter
                key={a.id}
                account={a.id}
                sample={samples.find((s) => s.account === a.id)}
                now={now}
              />
            ))}
            {routing === null ? null : (
              <Text size="xs" c="dimmed">
                {routing}
              </Text>
            )}
          </Stack>
        )}
      </ChartCard>
    </Box>
  )
}
