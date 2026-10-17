/**
 * Latency and failures as one question: p95 per day on the left, error events per day (top 3 sources
 * plus Other) on the right, divided by a hairline. Both follow the page's range and filters.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { Bars, ChartCard, Lines } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { usageQueries, type Grain, type Range } from '../../lib/queries/usage'
import { dayToDate } from './constants'
import {
  ERROR_BAD_ABOVE,
  ERROR_FOLD_TOP_N,
  ERROR_WARN_FROM,
  errorDayState,
  type ErrorDayState,
  fmtPct,
  fmtShare,
  fmtTokens,
  foldTopN,
  OTHER_KEY,
  periodNoun,
  secondsQuantity,
} from './model'
import type { BillingValue, WorkspaceValue } from './types'
import classes from './usage.module.css'

type ErrorBucket = { date: Date; count: number; state: ErrorDayState }
type P95Point = { date: Date; v: number }

/** One bar series per verdict, so hue carries the verdict only: neutral, warn, bad by the day's error rate. */
const VERDICT_BARS = [
  { state: 'ok', label: `Under ${fmtPct(ERROR_WARN_FROM, 0)}`, color: VX.muted },
  {
    state: 'warn',
    label: `${fmtPct(ERROR_WARN_FROM, 0)}–${fmtPct(ERROR_BAD_ABOVE, 0)}`,
    color: VX.warn,
  },
  { state: 'bad', label: `Over ${fmtPct(ERROR_BAD_ABOVE, 0)}`, color: VX.bad },
].map(({ state, label, color }) => ({
  key: state,
  label: `${label} of calls`,
  color,
  // A bucket with no calls ('none') carries no verdict and is drawn neutral.
  getValue: (d: ErrorBucket) =>
    (state === 'ok' ? d.state === 'ok' || d.state === 'none' : d.state === state) ? d.count : null,
}))

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
  const rates = useSuspenseQuery(
    usageQueries.timeseries({
      range,
      grain,
      metric: 'error_rate',
      groupBy: 'none',
      billing,
      workspace,
    }),
  ).data

  const p95: P95Point[] = latency.buckets.flatMap((b) => {
    const v = b.groups['value']
    return v === null || v === undefined ? [] : [{ date: dayToDate(b.bucket), v }]
  })
  const rateByBucket = new Map(rates.buckets.map((b) => [b.bucket, b.groups['value'] ?? null]))
  const last = p95.at(-1)
  const lastQty = secondsQuantity(last?.v)
  const folded = foldTopN(
    errors.buckets.map((b) => ({ date: dayToDate(b.bucket), groups: b.groups })),
    errors.groupKeys,
    ERROR_FOLD_TOP_N,
  )
  // The verdict is the bucket's error RATE (events over calls), not its count: a busy day with many
  // events can be healthy, so the ink follows the same 1 % / 3 % thresholds as the strip's band.
  const perBucket = folded.points.map((p, i): ErrorBucket => ({
    date: p.date,
    count: folded.keys.reduce((acc, k) => acc + (p.groups[k] ?? 0), 0),
    state: errorDayState(rateByBucket.get(errors.buckets[i]?.bucket ?? '') ?? null),
  }))
  const topSource = folded.totals.find((t) => t.key !== OTHER_KEY && t.value > 0)
  const unit = grain === 'day' ? 'day' : 'week'
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
            <Lines
              ariaLabel={`p95 latency per ${unit}`}
              data={p95}
              height={120}
              x={(d: P95Point) => d.date}
              xTicks={2}
              formatX={(d) => shortDate.format(d)}
              legend={false}
              cursorResolution="leading"
              y={{ format: (v) => `${secondsQuantity(v).value} s`, ticks: 2 }}
              series={[
                {
                  key: 'p95',
                  label: 'p95 latency',
                  color: VX.line,
                  getValue: (d: P95Point) => d.v,
                  formatValue: (v) => `${secondsQuantity(v).value} s`,
                },
              ]}
              tooltip={{ formatHeader: (x) => shortDate.format(x) }}
              state={{ empty: p95.length < 2 }}
            />
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
              height={120}
              x={(d: ErrorBucket) => d.date}
              xTicks={2}
              formatX={(d) => shortDate.format(d)}
              legend={{ placement: 'bottom' }}
              cursorResolution="leading"
              y={{ format: fmtTokens, ticks: 2 }}
              bars={VERDICT_BARS}
              tooltip={{ formatHeader: (x) => shortDate.format(x) }}
              state={{ empty: folded.total === 0 && 'No errors in this window' }}
            />
          </div>
        </Box>
      </Box>
    </ChartCard>
  )
}
