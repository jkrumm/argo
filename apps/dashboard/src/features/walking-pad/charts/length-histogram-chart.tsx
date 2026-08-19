import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { Bars, ChartCard } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { METRIC_DEFS, useMetricSelection, type MetricKey } from '../metric-toggle'
import { ChartEmpty } from './empty'

type Bucket = { bucketStart: number; bucketWidth: number; sessions: number }

const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `${n}`)

const BUCKET_FORMATTERS: Record<
  MetricKey,
  (start: number, width: number, isLast: boolean) => string
> = {
  duration: (s, _w, isLast) => (isLast ? `${s}+m` : `${s}m`),
  distance: (s, w, isLast) => (isLast ? `${fmtK(s)}+m` : `${fmtK(s)}–${fmtK(s + w)}m`),
  steps: (s, w, isLast) => (isLast ? `${fmtK(s)}+` : `${fmtK(s)}–${fmtK(s + w)}`),
}

function getValue(d: Bucket, key: string): number | null {
  if (key !== 'sessions') return null
  return d.sessions > 0 ? d.sessions : null
}

const AXIS_LABELS: Record<MetricKey, { title: string; subtitle: string; xUnit: string }> = {
  duration: { title: 'Session length', subtitle: 'How long are my walks?', xUnit: 'minutes' },
  distance: { title: 'Session distance', subtitle: 'How far are my walks?', xUnit: 'meters' },
  steps: { title: 'Session steps', subtitle: 'How many steps per walk?', xUnit: 'steps' },
}

const fmtSessions = (v: number) => `${Math.round(v)} session${Math.round(v) === 1 ? '' : 's'}`

// The domain key stays the raw, stable `bucketStart` — `fmtBucket` (which needs `bucketWidth`
// and the `isLast` flag too) is a display concern, wired through `formatX`/`tooltip.formatHeader`
// instead of being baked into the key itself.
const getX = (d: Bucket) => String(d.bucketStart)

// Match the Weekly Volume chart's height so the two bottom-row cards align.
const CHART_HEIGHT = 280

export function LengthHistogramChart({ params }: { params: WalkingPadWindowParams }) {
  const { enabled } = useMetricSelection()
  // The toggle picks the *bucketing dimension*. With multiple enabled, the
  // first one drives this chart; with none enabled we still need to fetch
  // something so the empty-state has a sensible default — fall back to
  // duration (the original meaning of "session length").
  const driver: MetricKey = enabled[0] ?? 'duration'
  const { data } = useSuspenseQuery(
    walkingPadQueries.lengthHistogram({ ...params, metric: driver }),
  )

  const buckets: Bucket[] = data.buckets
  const totalSessions = buckets.reduce((s, b) => s + b.sessions, 0)
  const labels = AXIS_LABELS[driver]
  const fmtBucket = BUCKET_FORMATTERS[driver]
  const maxBucketStart = buckets.length > 0 ? (buckets[buckets.length - 1]?.bucketStart ?? 0) : 0

  // Mode (busiest bucket) for the at-a-glance header.
  const mode = buckets.reduce<Bucket | null>(
    (best, b) => (best === null || b.sessions > best.sessions ? b : best),
    null,
  )
  const modeLabel =
    mode !== null && mode.sessions > 0
      ? fmtBucket(mode.bucketStart, mode.bucketWidth, mode.bucketStart === maxBucketStart)
      : null

  if (enabled.length === 0) {
    return (
      <ChartCard
        title={labels.title}
        subtitle={labels.subtitle}
        tooltip="Frequency histogram of sessions across buckets of the toggled metric. Pick one or more metrics from the page header to populate."
      >
        <ChartEmpty
          height={CHART_HEIGHT}
          label="No metric selected — toggle one in the page header."
        />
      </ChartCard>
    )
  }

  const bucketByKey = new Map(buckets.map((b) => [String(b.bucketStart), b]))
  const formatX = (key: string) => {
    const b = bucketByKey.get(key)
    if (b === undefined) return key
    return fmtBucket(b.bucketStart, b.bucketWidth, b.bucketStart === maxBucketStart)
  }

  // For 2+ metrics the chart still bins by *one* dimension (the first
  // enabled). Annotate so the user understands which dimension is in play.
  const isMultiSelected = enabled.length > 1
  const multiNote = isMultiSelected
    ? ` Bucketed by ${METRIC_DEFS[driver].label} (first enabled metric).`
    : ''

  return (
    <ChartCard
      title={labels.title}
      subtitle={labels.subtitle}
      tooltip={
        `Frequency histogram of sessions bucketed by ${labels.xUnit}. ` +
        `Y-axis is the number of sessions whose ${METRIC_DEFS[driver].label.toLowerCase()} falls into each bucket. ` +
        `Top bucket is a clamped overflow.` +
        multiNote
      }
      extra={
        totalSessions > 0 && modeLabel !== null ? (
          <span style={{ fontSize: VX.text.xs, fontWeight: 600 }}>most common: {modeLabel}</span>
        ) : null
      }
    >
      {totalSessions === 0 ? (
        <ChartEmpty height={CHART_HEIGHT} label="No sessions in this window." />
      ) : (
        <Bars
          ariaLabel="Session length histogram, frequency of sessions by bucket"
          data={buckets}
          height={CHART_HEIGHT}
          chartId="walking-pad-length-histogram"
          getX={getX}
          formatX={formatX}
          getValue={getValue}
          positiveBars={[
            {
              key: 'sessions',
              label: 'Sessions',
              color: METRIC_DEFS[driver].color,
              formatValue: fmtSessions,
            },
          ]}
          y={{
            domain: 'auto',
            format: (v: number) => String(Math.round(v)),
            ticks: 4,
            autoMaxFloor: 3,
          }}
          xTicks={driver === 'duration' ? 7 : 6}
          tooltip={{ formatHeader: (key) => formatX(key) }}
          legend={false}
        />
      )}
      <Box
        component="span"
        mt={4}
        style={{ fontSize: VX.text.micro, color: 'var(--mantine-color-dimmed)' }}
      >
        {totalSessions} session{totalSessions === 1 ? '' : 's'} · binned by{' '}
        {METRIC_DEFS[driver].label.toLowerCase()}
        {isMultiSelected ? ' (first enabled metric drives the binning)' : ''}
      </Box>
    </ChartCard>
  )
}
