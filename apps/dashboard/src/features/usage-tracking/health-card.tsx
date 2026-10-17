/**
 * Latency and failures as one question: p95 per day on the left, error events per day (top 3 sources
 * plus Other) on the right, divided by a hairline. Both follow the page's range and filters.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { Bars, ChartCard, Sparkline } from 'basalt-ui/charts'
import { usageQueries, type Grain, type Range } from '../../lib/queries/usage'
import { USAGE_OUTCOME } from '../../lib/series'
import { dayToDate } from './constants'
import {
  EM_DASH,
  ERROR_FOLD_TOP_N,
  fmtShare,
  fmtTokens,
  foldTopN,
  OTHER_KEY,
  periodNoun,
  secondsQuantity,
} from './model'
import type { BillingValue, WorkspaceValue } from './types'
import classes from './usage.module.css'

type ErrorBucket = { date: Date; count: number }

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

export default function HealthCard({
  range,
  grain,
  billing,
  workspace,
}: {
  range: Range
  grain: Grain
  billing?: BillingValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
}) {
  const latency = useSuspenseQuery(
    usageQueries.timeseries({
      range,
      grain,
      metric: 'latency_p95',
      groupBy: 'none',
      billing,
      workspace,
    }),
  ).data
  const errors = useSuspenseQuery(
    usageQueries.timeseries({
      range,
      grain,
      metric: 'errors',
      groupBy: 'source',
      billing,
      workspace,
    }),
  ).data

  const p95 = latency.buckets.flatMap((b) => {
    const v = b.groups['value']
    return v === null || v === undefined ? [] : [{ date: dayToDate(b.bucket), v }]
  })
  const last = p95.at(-1)
  const lastQty = secondsQuantity(last?.v)
  const folded = foldTopN(
    errors.buckets.map((b) => ({ date: dayToDate(b.bucket), groups: b.groups })),
    errors.groupKeys,
    ERROR_FOLD_TOP_N,
  )
  const perBucket = folded.points.map((p) => ({
    date: p.date,
    count: folded.keys.reduce((acc, k) => acc + (p.groups[k] ?? 0), 0),
  }))
  const topSource = folded.totals.find((t) => t.key !== OTHER_KEY && t.value > 0)
  const unit = grain === 'day' ? 'day' : 'week'
  const first = errors.buckets.at(0)
  const end = errors.buckets.at(-1)
  const captions = (
    <Box className={classes.axisCaptions}>
      <span>{first ? shortDate.format(dayToDate(first.bucket)) : EM_DASH}</span>
      <span>{end ? shortDate.format(dayToDate(end.bucket)) : EM_DASH}</span>
    </Box>
  )

  return (
    <ChartCard
      title={`Latency and errors · per ${unit} · ${periodNoun(range)}`}
      info="p95 duration of calls that report one, and the count of calls with outcome 'error', both per bucket. Errors show the three sources with the most events; the rest are summed into Other."
    >
      <Box className={classes.healthBox}>
        <Box className={classes.health}>
          <div>
            <Box className={classes.healthHead}>
              <span className={classes.healthValue}>
                {lastQty.value}
                {lastQty.unit === '' ? '' : ` ${lastQty.unit}`}
              </span>
              <span>p95 latest {unit}</span>
            </Box>
            <Sparkline
              ariaLabel={`p95 latency per ${unit}`}
              data={p95.map((p) => p.v)}
              height={96}
              emphasizeLast
              state={{ empty: p95.length < 2 }}
            />
            {captions}
          </div>
          <div className={classes.healthRight}>
            <Box className={classes.healthHead}>
              <span className={classes.healthValue}>{fmtTokens(folded.total)}</span>
              <span>
                error events · {periodNoun(range)}
                {topSource === undefined
                  ? ''
                  : ` · ${topSource.key} ${fmtShare(topSource.value / folded.total)}`}
              </span>
            </Box>
            <Bars
              ariaLabel={`Error events per ${unit}`}
              data={perBucket}
              height={96}
              x={(d: ErrorBucket) => d.date}
              xTicks={2}
              formatX={(d) => shortDate.format(d)}
              legend={false}
              cursorResolution="leading"
              y={{ format: fmtTokens, ticks: 2 }}
              bars={[
                {
                  key: 'errors',
                  label: 'Error events',
                  color: USAGE_OUTCOME.error,
                  getValue: (d: ErrorBucket) => d.count,
                },
              ]}
              state={{ empty: folded.total === 0 && 'No errors in this window' }}
            />
          </div>
        </Box>
      </Box>
    </ChartCard>
  )
}
