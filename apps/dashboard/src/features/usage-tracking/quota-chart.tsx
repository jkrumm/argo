import { useSuspenseQuery } from '@tanstack/react-query'
import { ChartCard, Lines } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { USAGE_ACCOUNT } from '../../lib/series'
import { useNow } from '../../lib/use-now'
import { ACCOUNT_LABELS } from './accounts'
import type { AccountValue } from './types'
import { periodNoun, shortDay } from './model'
import {
  FIVE_HOUR_LIMIT,
  FIVE_HOUR_MARKER_MAX_HOURS,
  SEVEN_DAY_LIMIT,
  USAGE_TIME_GROUP,
  quotaKey,
  quotaRows,
  rangeDomain,
  rangeHours,
  type QuotaRow,
  type QuotaWindow,
} from './quota-model'

const fmtPct = (v: number) => `${Math.round(v)} %`

const accountLabel = (id: string) => (ACCOUNT_LABELS as Record<string, string>)[id] ?? id
const accountColor = (id: string) => USAGE_ACCOUNT[id] ?? USAGE_ACCOUNT['unknown'] ?? VX.muted

const WINDOW_LABEL: Record<QuotaWindow, string> = { five: '5 h', seven: '7 d' }

const INFO =
  'How full each Claude account’s 5-hour and weekly quota was, one sample per 15 minutes. Solid lines are the 5-hour window, dashed lines the weekly one. The dashed guides are the picker’s limits: it stops choosing an account above 85 % (5 h) or 90 % (weekly). A dot marks a window reset. The plot shares its time axis and hover with the spend chart above.'

/**
 * Both Claude accounts' 5 h and weekly quota over the page's range: two lines per account (colour =
 * account, solid = 5 h, dashed = weekly), the picker's eligibility limits as guides and a dot where a
 * window reset. Shares the time axis and cursor with the cost chart, so quota movement reads against spend.
 */
export default function QuotaChart({
  range,
  account,
  height = 280,
}: {
  range: Range
  account?: AccountValue[] | undefined
  height?: number
}) {
  const hours = rangeHours(range)
  const query = useSuspenseQuery(usageQueries.quota(hours, account))
  const now = useNow()
  const data = shotState() === 'empty' ? { series: [], resets: [] } : query.data
  const { accounts, rows } = quotaRows(data)
  const domain = rangeDomain(range, now)
  const fiveMarkers = hours <= FIVE_HOUR_MARKER_MAX_HOURS

  const lineFor = (account: string, window: QuotaWindow) => {
    const key = quotaKey(account, window)
    const marked = window === 'seven' || fiveMarkers
    return {
      key,
      label: `${accountLabel(account)} · ${WINDOW_LABEL[window]}`,
      color: accountColor(account),
      dash: window === 'seven' ? ('dashed' as const) : ('solid' as const),
      gaps: 'connect' as const,
      getValue: (d: QuotaRow) => d.values[key] ?? null,
      formatValue: fmtPct,
      ...(marked ? { getMarker: (d: QuotaRow) => (d.resets.has(key) ? { r: 3 } : null) } : {}),
    }
  }

  return (
    <ChartCard
      title={`Claude quota · ${periodNoun(range)}`}
      info={INFO}
      state={{ empty: rows.length === 0 && 'No quota samples in this window yet' }}
      data-shot="quota-chart"
      data-shot-states="empty"
    >
      <Lines
        ariaLabel="5-hour and weekly quota used per Claude account, with the picker's limits"
        data={rows}
        height={height}
        x={(d: QuotaRow) => d.date}
        {...(domain === undefined ? {} : { xDomain: domain })}
        formatX={(d) => shortDay(d)}
        cursorGroup={USAGE_TIME_GROUP}
        cursorResolution="nearest"
        y={{ domain: [0, 100], ticks: [0, 25, 50, 75, 100], format: fmtPct }}
        series={accounts.flatMap((a) => [lineFor(a, 'five'), lineFor(a, 'seven')])}
        refLines={[
          {
            value: FIVE_HOUR_LIMIT,
            color: VX.muted,
            dashed: true,
            legend: { label: `5 h limit · ${FIVE_HOUR_LIMIT} %` },
          },
          {
            value: SEVEN_DAY_LIMIT,
            color: VX.muted,
            dashed: true,
            legend: { label: `7 d limit · ${SEVEN_DAY_LIMIT} %` },
          },
        ]}
        legend={{ placement: 'bottom' }}
      />
    </ChartCard>
  )
}
