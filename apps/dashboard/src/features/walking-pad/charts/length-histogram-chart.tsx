import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { Bars, ChartCard, VX } from '@argo/charts'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { ChartEmpty } from './empty'

type Bucket = { bucketMin: number; sessions: number }

const getValue = (d: Bucket, key: string): number | null => {
  if (key !== 'sessions') return null
  return d.sessions > 0 ? d.sessions : null
}

export function LengthHistogramChart({ params }: { params: WalkingPadWindowParams }) {
  const { data } = useSuspenseQuery(walkingPadQueries.lengthHistogram(params))
  const { ref, width } = useElementSize<HTMLDivElement>()

  const buckets: Bucket[] = data.buckets
  const hasData = buckets.some((b) => b.sessions > 0)
  const total = buckets.reduce((s, b) => s + b.sessions, 0)
  // Mode (busiest bucket) — useful "you tend to walk X minutes" abstraction.
  const mode = buckets.reduce<Bucket | null>(
    (best, b) => (best === null || b.sessions > best.sessions ? b : best),
    null,
  )

  return (
    <ChartCard
      title="Session length"
      subtitle="How long are my walks?"
      tooltip="Distribution of session durations in 5-minute buckets, clamped at 90 minutes. The 'most common' badge points to your modal walk length — the rhythm you've actually settled into."
      extra={
        hasData && mode !== null && mode.sessions > 0 ? (
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            most common: {mode.bucketMin}–{mode.bucketMin + 5} min
          </span>
        ) : null
      }
    >
      <div ref={ref} style={{ height: 240, width: '100%' }}>
        {!hasData ? (
          <ChartEmpty height={240} label="No sessions in this window." />
        ) : width > 0 ? (
          <Bars<Bucket>
            data={buckets}
            width={Math.max(width, 200)}
            height={240}
            chartId="walking-pad-length-histogram"
            getX={(d) => `${d.bucketMin}m`}
            getValue={getValue}
            positiveBars={[
              { key: 'sessions', label: 'Sessions', color: VX.series.walkingDuration },
            ]}
            leftAxis={{
              domain: 'auto',
              formatTick: (v) => String(Math.round(v)),
              numTicks: 4,
              autoMaxFloor: 3,
            }}
            formatValue={(v) => `${Math.round(v)} session${Math.round(v) === 1 ? '' : 's'}`}
          />
        ) : null}
      </div>
      <span style={{ fontSize: 11, color: 'var(--mantine-color-dimmed)' }}>
        {total} sessions · 5-min buckets, clamped at 90 min
      </span>
    </ChartCard>
  )
}
