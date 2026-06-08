import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { alpha, ChartCard, ChartLegend, VX, ZonedLine } from '@argo/charts'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { PACE_ZONES } from '../constants'
import { ChartEmpty } from './empty'

type Point = {
  date: string
  avg_speed_kmh: number | null
}

const fmtKmh = (v: number) => `${v.toFixed(2)} km/h`

const zoneFill = (tone: (typeof PACE_ZONES)[number]['tone']) => {
  switch (tone) {
    case 'soft':
      return VX.warn
    case 'neutral':
      return alpha(VX.neutral, 0.06)
    case 'good':
      return VX.good
    case 'strong':
      return VX.goodSoft
  }
}

export function PaceTrendChart({ params }: { params: WalkingPadWindowParams }) {
  const { data } = useSuspenseQuery(walkingPadQueries.series({ ...params, bucket: 'day' }))
  const { ref, width } = useElementSize<HTMLDivElement>()

  const points: Point[] = data.points.map((p) => ({
    date: p.date,
    avg_speed_kmh: p.avg_speed_kmh,
  }))
  const hasData = points.some((p) => p.avg_speed_kmh !== null)

  const zones = PACE_ZONES.map((z) => ({
    from: z.from,
    to: z.to,
    fill: zoneFill(z.tone),
    label: z.label,
  }))

  return (
    <ChartCard
      title="Pace trend"
      subtitle="Am I walking faster over time?"
      tooltip="Per-day distance-weighted average walking speed. Zones (stroll / walking / brisk / power) are calibrated against typical desk-treadmill ranges. A long slow session counts more than a tiny fast one — the headline number reflects how you actually moved, not the peak."
      extra={
        hasData ? (
          <span style={{ fontSize: 12, fontWeight: 600, color: VX.series.walkingPace }}>
            {fmtKmh(
              points
                .filter(
                  (p): p is { date: string; avg_speed_kmh: number } => p.avg_speed_kmh !== null,
                )
                .reduce((s, p, _i, arr) => s + p.avg_speed_kmh / arr.length, 0),
            )}{' '}
            window avg
          </span>
        ) : null
      }
    >
      <div ref={ref} style={{ height: 280, width: '100%' }}>
        {!hasData ? (
          <ChartEmpty height={280} label="No pace data — log a session first." />
        ) : width > 0 ? (
          <ZonedLine<Point>
            data={points}
            width={Math.max(width, 200)}
            height={280}
            chartId="walking-pad-pace-trend"
            getX={(d) => d.date}
            getY={(d) => d.avg_speed_kmh}
            yDomain="auto"
            yAutoMaxFloor={6}
            yAutoMinCeil={1}
            zones={zones}
            seriesLabel="Avg pace"
            formatValue={fmtKmh}
          />
        ) : null}
      </div>
      <ChartLegend
        items={PACE_ZONES.map((z) => ({
          key: z.label,
          label: `${z.label} (${z.from}-${z.to === 60 ? '6+' : z.to} km/h)`,
          color:
            z.tone === 'good'
              ? VX.goodSolid
              : z.tone === 'strong'
                ? VX.series.walkingPace
                : z.tone === 'soft'
                  ? VX.warnSolid
                  : alpha(VX.neutral, 0.6),
          shape: 'bar',
        }))}
      />
    </ChartCard>
  )
}
