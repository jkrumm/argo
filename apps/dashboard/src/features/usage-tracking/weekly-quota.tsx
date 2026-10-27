/**
 * The seven-day quota of every selected account over the last 30 days: one line per account in its
 * payer hue, climbing as the window fills and dropping when it resets (the sawtooth), with the 100 %
 * line. The collector's samples start 2026-10-24, so the card says where the lines begin instead of
 * drawing an empty 30 days.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { ChartCard, Lines } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { withUnit } from '../../lib/format'
import { usageQueries } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import type { SubWallet } from './accounts'
import { colorForPayer } from './constants'
import { shortDay, shortHour } from './model'
import classes from './usage.module.css'
import { QUOTA_HOURS, dayTicks, quotaCoverage, quotaRows, type QuotaRow } from './quota-model'

const HOUR_MS = 3_600_000
const TICKS = 6

const INFO =
  'Share of each account’s weekly quota used, from the collector’s samples (one per hour shown). A line climbs as the seven-day window fills and falls when it resets; 100 % is the limit. Samples exist only since the collector started, so the lines begin there.'

const pctText = (v: number) => withUnit(Math.round(v), '%')

export function WeeklyQuota({ subs, height }: { subs: readonly SubWallet[]; height: number }) {
  const now = useNow()
  const query = useSuspenseQuery(usageQueries.quota(QUOTA_HOURS))
  const accounts = subs.map((s) => s.account)
  const series = query.data.series.filter((s) => accounts.some((a) => a === s.account))
  const rows = shotState() === 'empty' ? [] : quotaRows(series, now - QUOTA_HOURS * HOUR_MS)
  const since = quotaCoverage(series)
  const drawn = subs.filter((s) => series.some((x) => x.account === s.account))

  return (
    <Box data-shot={`weekly-quota-${accounts.join('-')}`} data-shot-states="empty" h="100%">
      <ChartCard
        className={classes.fill}
        title={`Weekly quota · ${withUnit(30, 'd')}`}
        info={INFO}
        placeholderHeight={height}
        state={{ empty: rows.length === 0 && 'No quota samples yet' }}
        {...(since === null ? {} : { subtitle: `Samples since ${shortDay(since)}` })}
      >
        <Lines<QuotaRow, Date>
          ariaLabel="Weekly quota used per account, as a percent of the limit"
          data={rows}
          height={height}
          x={(d) => d.at}
          formatX={(d) => shortDay(d)}
          xTicks={dayTicks(rows, TICKS)}
          cursorGroup="usage-quota"
          series={drawn.map((s) => ({
            key: s.account,
            label: s.title,
            color: colorForPayer(s.id),
            getValue: (d: QuotaRow) => d.pct[s.account] ?? null,
            gaps: 'connect' as const,
          }))}
          y={{ domain: 'auto', autoMaxFloor: 100, format: pctText, ticks: [0, 50, 100] }}
          refLines={[{ value: 100, color: VX.status.bad, dashed: true, label: 'limit' }]}
          tooltip={{ formatHeader: (d) => shortHour(d) }}
        />
      </ChartCard>
    </Box>
  )
}
