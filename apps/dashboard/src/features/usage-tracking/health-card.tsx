/**
 * Latency and failures as one question: p95 per day on the left, error events per day (top 3 sources
 * plus Other) on the right, divided by a hairline. Both follow the page's range and filters.
 */
import { useSuspenseQueries } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { Bars, ChartCard, Lines } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { usageQueries, type Grain, type Range } from '../../lib/queries/usage'
import { dayToDate } from './constants'
import {
  ERROR_FOLD_TOP_N,
  fmtPct,
  ERROR_BAD_ABOVE,
  ERROR_WARN_FROM,
  errorDayState,
  type ErrorDayState,
  topSourceNote,
  healthInfo,
  fmtTokens,
  foldTopN,
  OTHER_KEY,
  periodNoun,
  fmtSecondsDay,
  secondsQuantity,
  shortDay,
} from './model'
import type { BillingValue, WorkspaceValue } from './types'
import classes from './usage.module.css'

type ErrorBucket = { date: Date; count: number; state: ErrorDayState }
type P95Point = { date: Date; v: number }

/**
 * One bar series per error-rate verdict, so hue carries the verdict only: neutral under 1 %, warn
 * 1–3 %, bad over 3 %, and a quiet "no calls" state for a day with nothing to rate (as in the strip's
 * band). A bucket lands in exactly one series; the others are `null`, so stacking adds nothing.
 */
const VERDICT_BARS = (
  [
    { state: 'ok', label: `Under ${fmtPct(ERROR_WARN_FROM, 0)}`, color: alpha(VX.muted, 0.5) },
    {
      state: 'warn',
      label: `${fmtPct(ERROR_WARN_FROM, 0)}–${fmtPct(ERROR_BAD_ABOVE, 0)}`,
      color: VX.warnSolid,
    },
    { state: 'bad', label: `Over ${fmtPct(ERROR_BAD_ABOVE, 0)}`, color: VX.badSolid },
    { state: 'none', label: 'No calls', color: alpha(VX.muted, 0.35) },
  ] as const
).map(({ state, label, color }) => ({
  key: state,
  label: state === 'none' ? label : `${label} of calls`,
  color,
  getValue: (d: ErrorBucket) => (d.state === state ? d.count : null),
}))

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
  const base = { range, grain, billing, workspace }
  const [{ data: latency }, { data: errors }, { data: rates }] = useSuspenseQueries({
    queries: [
      usageQueries.timeseries({ ...base, metric: 'latency_p95', groupBy: 'none' }),
      usageQueries.timeseries({ ...base, metric: 'errors', groupBy: 'source' }),
      usageQueries.timeseries({ ...base, metric: 'error_rate', groupBy: 'none' }),
    ],
  })

  const p95: P95Point[] = latency.buckets.flatMap((b) => {
    const v = b.groups['value']
    return v === null || v === undefined ? [] : [{ date: dayToDate(b.bucket), v }]
  })
  const rateByDay = new Map(
    rates.buckets.map((b) => [dayToDate(b.bucket).getTime(), b.groups['value'] ?? null]),
  )
  const last = p95.at(-1)
  const lastQty = secondsQuantity(last?.v)
  const folded = foldTopN(
    errors.buckets.map((b) => ({ date: dayToDate(b.bucket), groups: b.groups })),
    errors.groupKeys,
    ERROR_FOLD_TOP_N,
  )
  // The verdict is the bucket's error RATE (events over calls), not its count: a busy day with many
  // events can be healthy, so the ink follows the same 1 % / 3 % thresholds as the strip's band.
  const perBucket = folded.points.map((p): ErrorBucket => ({
    date: p.date,
    count: folded.keys.reduce((acc, k) => acc + (p.groups[k] ?? 0), 0),
    state: errorDayState(rateByDay.get(p.date.getTime()) ?? null),
  }))
  const topSource = folded.totals.find((t) => t.key !== OTHER_KEY && t.value > 0)
  const unit = grain === 'day' ? 'day' : 'week'
  return (
    <ChartCard
      title={`Latency and errors · per ${unit} · ${periodNoun(range)}`}
      info={healthInfo(unit)}
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
              xTicks={5}
              formatX={(d) => shortDay.format(d)}
              legend={false}
              cursorResolution="leading"
              y={{ format: fmtSecondsDay, ticks: 2 }}
              series={[
                {
                  key: 'p95',
                  label: 'p95 latency',
                  color: VX.line,
                  getValue: (d: P95Point) => d.v,
                  formatValue: fmtSecondsDay,
                },
              ]}
              tooltip={{ formatHeader: (x) => shortDay.format(x) }}
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
                  : ` · ${topSourceNote(topSource.key, topSource.value, folded.total)}`}
              </span>
            </Box>
            <Bars
              ariaLabel={`Error events per ${unit}, inked by the error-rate verdict: under ${fmtPct(ERROR_WARN_FROM, 0)}, ${fmtPct(ERROR_WARN_FROM, 0)} to ${fmtPct(ERROR_BAD_ABOVE, 0)}, over ${fmtPct(ERROR_BAD_ABOVE, 0)} of calls`}
              data={perBucket}
              height={120}
              x={(d: ErrorBucket) => d.date}
              xTicks={5}
              formatX={(d) => shortDay.format(d)}
              legend={{ placement: 'bottom' }}
              cursorResolution="leading"
              y={{ format: fmtTokens, ticks: 2 }}
              bars={VERDICT_BARS}
              tooltip={{ formatHeader: (x) => shortDay.format(x) }}
              state={{ empty: folded.total === 0 && 'No errors in this window' }}
            />
          </div>
        </Box>
      </Box>
    </ChartCard>
  )
}
