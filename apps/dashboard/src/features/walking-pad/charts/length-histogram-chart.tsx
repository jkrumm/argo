import { useQuery } from '@tanstack/react-query'
import { Text } from '@mantine/core'
import { Bars, ChartCard } from 'basalt-ui/charts'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { walkingStore } from '../../../lib/window-stores'
import { METRIC_DEFS, type MetricKey } from '../metrics'
import { chartStateOf } from './chart-state'

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

const AXIS_LABELS: Record<MetricKey, { title: string; subtitle: string; xUnit: string }> = {
  duration: { title: 'Session length', subtitle: 'How long are my walks?', xUnit: 'minutes' },
  distance: { title: 'Session distance', subtitle: 'How far are my walks?', xUnit: 'meters' },
  steps: { title: 'Session steps', subtitle: 'How many steps per walk?', xUnit: 'steps' },
}

const fmtSessions = (v: number) => `${Math.round(v)} session${Math.round(v) === 1 ? '' : 's'}`

// The x key stays the raw, stable `bucketStart` — the label (which needs `bucketWidth` and the
// `isLast` flag too) is a display concern, wired through `formatX` and `tooltip.formatHeader`.
const getX = (d: Bucket) => String(d.bucketStart)

// Match the Weekly Volume chart's height so the two bottom-row cards align.
const CHART_HEIGHT = 280

// The bucket grid is fixed server-side (`HISTOGRAM_SPECS` in the API's walking-pad-formulas):
// 19 duration buckets, 21 for distance and steps. Label every Nth bucket AND always the overflow
// bucket, dropping a stepped tick that would land adjacent to it.
const TICK_STRIDE: Record<MetricKey, number> = { duration: 3, distance: 4, steps: 4 }

const bucketTicks = (keys: readonly string[], stride: number): readonly string[] => {
  const last = keys.length - 1
  if (last < 1) return keys
  const stepped = keys.filter((_, i) => i % stride === 0 && last - i > 1)
  return [...stepped, keys[last] as string]
}

export function LengthHistogramChart({ params }: { params: WalkingPadWindowParams }) {
  const [enabled] = walkingStore.field.metrics.use()
  // The toggle picks the *bucketing dimension*. With multiple enabled, the first one drives this
  // chart; with none enabled we still need to fetch something — fall back to duration.
  const driver: MetricKey = enabled[0] ?? 'duration'
  const query = useQuery(walkingPadQueries.lengthHistogram({ ...params, metric: driver }))

  const buckets: Bucket[] = query.data?.buckets ?? []
  const totalSessions = buckets.reduce((s, b) => s + b.sessions, 0)
  const labels = AXIS_LABELS[driver]
  const fmtBucket = BUCKET_FORMATTERS[driver]
  const maxBucketStart = buckets.at(-1)?.bucketStart ?? 0

  // Mode (busiest bucket) for the at-a-glance header.
  const mode = buckets.reduce<Bucket | null>(
    (best, b) => (best === null || b.sessions > best.sessions ? b : best),
    null,
  )
  const modeLabel =
    mode !== null && mode.sessions > 0
      ? fmtBucket(mode.bucketStart, mode.bucketWidth, mode.bucketStart === maxBucketStart)
      : null

  const bucketByKey = new Map(buckets.map((b) => [getX(b), b]))
  const formatX = (key: string) => {
    const b = bucketByKey.get(key)
    if (b === undefined) return key
    return fmtBucket(b.bucketStart, b.bucketWidth, b.bucketStart === maxBucketStart)
  }

  const isMultiSelected = enabled.length > 1
  const multiNote = isMultiSelected
    ? ` Bucketed by ${METRIC_DEFS[driver].label} (first enabled metric).`
    : ''

  return (
    <ChartCard
      title={labels.title}
      subtitle={labels.subtitle}
      info={
        `Frequency histogram of sessions bucketed by ${labels.xUnit}. ` +
        `Y-axis is the number of sessions whose ${METRIC_DEFS[driver].label.toLowerCase()} falls into each bucket. ` +
        `Top bucket is a clamped overflow.` +
        multiNote
      }
      actions={
        totalSessions > 0 && modeLabel !== null ? (
          <Text span size="xs" fw={600}>
            most common: {modeLabel}
          </Text>
        ) : null
      }
      state={chartStateOf(
        query,
        (enabled.length === 0 && 'No metric selected — toggle one in the page header.') ||
          (totalSessions === 0 && 'No sessions in this window.') ||
          false,
      )}
      placeholderHeight={CHART_HEIGHT}
    >
      <Bars
        ariaLabel="Session length histogram, frequency of sessions by bucket"
        data={buckets}
        height={CHART_HEIGHT}
        x={getX}
        formatX={formatX}
        xTicks={bucketTicks(buckets.map(getX), TICK_STRIDE[driver])}
        bars={[
          {
            key: 'sessions',
            label: 'Sessions',
            color: METRIC_DEFS[driver].color,
            getValue: (d) => (d.sessions > 0 ? d.sessions : null),
            formatValue: fmtSessions,
          },
        ]}
        y={{ domain: 'auto', format: (v) => String(Math.round(v)), ticks: 4, autoMaxFloor: 3 }}
        tooltip={{ formatHeader: (key) => formatX(key) }}
        legend={false}
      />
      <Text size="xs" c="dimmed" mt={4}>
        {totalSessions} session{totalSessions === 1 ? '' : 's'} · binned by{' '}
        {METRIC_DEFS[driver].label.toLowerCase()}
        {isMultiSelected ? ' (first enabled metric drives the binning)' : ''}
      </Text>
    </ChartCard>
  )
}
