/**
 * A wallet's limit at full width. A Max subscription adds this week's seven-day quota percent as a
 * line against the pace diagonal (0 % when the window opened, 100 % at the reset): a line above the
 * diagonal is ahead of pace. The samples cover only the days since the collector started, and the
 * card says so when the week began before them. The IU API shows its cap meter and can-spend line;
 * its portal-vs-tracked strip follows as its own card.
 */
import { useQuery } from '@tanstack/react-query'
import { Box, Stack, Text } from '@mantine/core'
import { ChartCard, Lines } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { withUnit } from '../../lib/format'
import { usageQueries } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import type { Wallet } from './accounts'
import { colorForPayer } from './constants'
import { WalletMeter } from './limits'
import { shortDay, shortHour } from './model'
import { weekCurve, type WeekPoint } from './pace-model'

/** The quota history asked for: one week of hourly buckets. */
const HISTORY_HOURS = 168
const CURVE_HEIGHT = 180
const LIMITS_INFO =
  'Max subscriptions: share of each weekly window used, from the latest quota sample; the tick marks how far into the week it is, so fill past it means ahead of pace. IU API: spend over the rolling 30 days against the $500 cap, from the IU portal report; the tick marks 80 %. The ink turns at 80 % and 100 %.'

const pctText = (v: number) => withUnit(Math.round(v), '%')

function WeekCurve({ wallet }: { wallet: Extract<Wallet, { kind: 'sub' }> }) {
  const latest = useQuery(usageQueries.quotaLatest([wallet.account]))
  const history = useQuery(usageQueries.quota(HISTORY_HOURS, [wallet.account]))
  const now = useNow()
  const empty = shotState() === 'empty'
  const resetsAt = latest.data?.accounts[0]?.sevenDayResetsAt
  const samples = empty ? [] : (history.data?.series[0]?.points ?? [])
  const curve = weekCurve(samples, resetsAt, now)
  const hasPct = curve?.data.some((p) => p.pct !== null) ?? false

  return (
    <Box data-shot={`quota-week-${wallet.id}`} data-shot-states="empty">
      <Stack gap="xs">
        <Text size="sm" fw={500}>
          This week’s quota vs pace
        </Text>
        {curve === null || !hasPct ? (
          <Text size="sm" c="dimmed">
            {latest.isPending || history.isPending ? 'loading' : 'No quota samples this week yet'}
          </Text>
        ) : (
          <Lines<WeekPoint, Date>
            ariaLabel={`${wallet.title} weekly quota percent against the pace diagonal`}
            data={curve.data}
            x={(d) => d.at}
            xDomain={[curve.start, curve.reset]}
            height={CURVE_HEIGHT}
            series={[
              {
                key: 'pct',
                label: 'Quota used',
                color: colorForPayer(wallet.id),
                getValue: (d) => d.pct,
                gaps: 'connect',
              },
              {
                key: 'pace',
                label: 'Pace',
                color: VX.muted,
                dash: 'dashed',
                role: 'reference',
                getValue: (d) => d.pace,
              },
            ]}
            y={{ domain: [0, 100], format: pctText, ticks: [0, 50, 100] }}
            formatX={(d) => shortDay(d)}
            tooltip={{ formatHeader: (d) => shortHour(d) }}
          />
        )}
        {curve?.coverageFrom ? (
          <Text size="xs" c="dimmed">
            Samples cover this week only from {shortHour(curve.coverageFrom)} on; before that the
            line is unknown, not zero.
          </Text>
        ) : null}
      </Stack>
    </Box>
  )
}

export function WalletLimit({ wallet }: { wallet: Wallet }) {
  return (
    <Box data-shot={`limit-${wallet.id}`}>
      <ChartCard
        title={
          wallet.kind === 'sub'
            ? `Limit · ${wallet.title} ${wallet.plan} · ${withUnit(7, 'd')}`
            : `Limit · ${wallet.title} · ${withUnit('rolling 30', 'd')}`
        }
        info={LIMITS_INFO}
        placeholderHeight="content"
      >
        <Stack gap="md">
          <WalletMeter wallet={wallet} titled={false} />
          {wallet.kind === 'sub' ? <WeekCurve wallet={wallet} /> : null}
        </Stack>
      </ChartCard>
    </Box>
  )
}
