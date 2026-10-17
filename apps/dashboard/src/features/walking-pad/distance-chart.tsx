import { useQuery } from '@tanstack/react-query'
import { Bars, ChartCard } from 'basalt-ui/charts'
import { chartStateOf } from '../../lib/chart-state'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../lib/queries/walking-pad'
import { alpha, VX } from 'basalt-ui/tokens'
import { walkingStore } from '../../lib/window-stores'
import { useNow } from '../../lib/use-now'
import { FACTS_ROW_LIMIT, distanceFacts, fmtKm, windowStartMs, windowTitle } from './model'
import { Facts } from './facts'

type Bucket = { bucketStart: number; bucketWidth: number; sessions: number }

const HEIGHT = 180
const km = (m: number): string => String(Number((m / 1000).toFixed(1)))
const getX = (d: Bucket) => String(d.bucketStart)
/** Label every 4th bucket and always the overflow bucket, dropping a stepped tick that would touch it. */
const TICK_STRIDE = 4

const bucketTicks = (keys: readonly string[]): readonly string[] => {
  const last = keys.length - 1
  if (last < 1) return keys
  const stepped = keys.filter((_, i) => i % TICK_STRIDE === 0 && last - i > 1)
  return [...stepped, keys[last] as string]
}

export function DistanceChart({ params }: { params: WalkingPadWindowParams }) {
  const { window: preset } = walkingStore.useValues()
  const now = useNow()
  const histogram = useQuery(walkingPadQueries.lengthHistogram({ ...params, metric: 'distance' }))
  // The histogram returns bucket counts only; the median and longest come from the newest rows.
  const rows = useQuery(walkingPadQueries.list({ page: 1, limit: FACTS_ROW_LIMIT, order: 'desc' }))

  const buckets: Bucket[] = histogram.data?.buckets ?? []
  const lastStart = buckets.at(-1)?.bucketStart ?? 0
  const label = (b: Bucket): string =>
    b.bucketStart === lastStart
      ? `${km(b.bucketStart)}+ km`
      : `${km(b.bucketStart)}–${km(b.bucketStart + b.bucketWidth)} km`
  const byKey = new Map(buckets.map((b) => [getX(b), b]))
  const formatX = (key: string): string => {
    const b = byKey.get(key)
    if (b === undefined) return key
    return b.bucketStart === lastStart ? `${km(b.bucketStart)}+` : km(b.bucketStart)
  }
  const formatRange = (key: string): string => {
    const b = byKey.get(key)
    return b === undefined ? key : label(b)
  }

  const facts =
    rows.data === undefined ? null : distanceFacts(rows.data.data, windowStartMs(params, now))
  return (
    <ChartCard
      title={`Session distance, ${windowTitle(preset)}`}
      state={chartStateOf(histogram, undefined)}
      placeholderHeight={HEIGHT}
    >
      {facts !== null && (
        <Facts
          value={fmtKm(facts.medianM)}
          unit="km"
          context={`median walk, buckets in km · longest ${fmtKm(facts.longestM)} km${facts.partial ? ' · newest 200 walks' : ''}`}
        />
      )}
      <Bars
        ariaLabel="Walks per session-distance bucket in kilometres"
        data={buckets}
        height={HEIGHT}
        x={getX}
        formatX={formatX}
        xTicks={bucketTicks(buckets.map(getX))}
        bars={[
          {
            key: 'sessions',
            label: 'Walks',
            color: alpha(VX.muted, 0.55),
            getValue: (d) => (d.sessions > 0 ? d.sessions : null),
            formatValue: (v) => `${Math.round(v)} ${Math.round(v) === 1 ? 'walk' : 'walks'}`,
          },
        ]}
        y={{ domain: 'auto', format: (v) => String(Math.round(v)), ticks: 3, autoMaxFloor: 3 }}
        tooltip={{ formatHeader: (key) => formatRange(key) }}
        legend={false}
      />
    </ChartCard>
  )
}
