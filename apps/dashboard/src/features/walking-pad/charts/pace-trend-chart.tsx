import { useSuspenseQuery } from '@tanstack/react-query'
import { ChartCard, ChartLegend, ZonedLine, type ChartSeries } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { PACE_ZONES } from '../constants'
import { SERIES } from '../../../lib/series'
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

  const points: Point[] = data.points.map((p) => ({
    date: p.date,
    avg_speed_kmh: p.avg_speed_kmh,
  }))
  const hasData = points.some((p) => p.avg_speed_kmh !== null)

  const zones = PACE_ZONES.map((z) => ({
    from: z.from,
    to: z.to,
    fill: zoneFill(z.tone),
  }))

  const series: ChartSeries<Point>[] = [
    {
      key: 'pace',
      label: 'Avg pace',
      color: SERIES.walkingPace,
      mark: 'line',
      getValue: (d) => d.avg_speed_kmh,
    },
  ]

  return (
    <ChartCard
      title="Pace trend"
      subtitle="Am I walking faster over time?"
      tooltip="Per-day distance-weighted average walking speed. Zones (stroll / walking / brisk / power) are calibrated against typical desk-treadmill ranges. A long slow session counts more than a tiny fast one — the headline number reflects how you actually moved, not the peak."
      extra={
        hasData ? (
          <span style={{ fontSize: 12, fontWeight: 600, color: SERIES.walkingPace }}>
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
      {!hasData ? (
        <ChartEmpty height={280} label="No pace data — log a session first." />
      ) : (
        <ZonedLine
          ariaLabel="Pace trend, daily average walking speed with zone bands"
          data={points}
          height={280}
          chartId="walking-pad-pace-trend"
          getX={(d) => d.date}
          series={series}
          yDomain="auto"
          yAutoMaxFloor={6}
          yAutoMinCeil={1}
          zones={zones}
          formatValue={fmtKmh}
          legend={false}
        />
      )}
      <ChartLegend
        items={PACE_ZONES.map((z) => ({
          key: z.label,
          label: `${z.label} (${z.from}-${z.to === 60 ? '6+' : z.to} km/h)`,
          color:
            z.tone === 'good'
              ? VX.goodSolid
              : z.tone === 'strong'
                ? SERIES.walkingPace
                : z.tone === 'soft'
                  ? VX.warnSolid
                  : alpha(VX.neutral, 0.6),
          shape: 'bar',
        }))}
      />
    </ChartCard>
  )
}
