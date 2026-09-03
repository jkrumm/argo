import { useSuspenseQuery } from '@tanstack/react-query'
import { ChartCard, ZonedLine, type ChartSeries } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { PACE_ZONES } from '../constants'
import { SERIES } from '../../../lib/series'

type Point = {
  date: string
  avg_speed_kmh: number | null
}

const fmtKmh = (v: number) => `${v.toFixed(2)} km/h`

// ONE table for the zone bands and their legend swatches. `band` is the wash painted behind the
// line; `swatch` is its solid counterpart, because a 6%-alpha chip is invisible at legend size.
// Two columns, one source — before this they were two independent ladders and had already drifted:
// the Power band was green while its legend chip was the gold pace hue.
const ZONE_TONE = {
  soft: { band: VX.warn, swatch: VX.warnSolid, swatchOpacity: 1 },
  neutral: { band: alpha(VX.neutral, 0.06), swatch: VX.neutral, swatchOpacity: 0.6 },
  good: { band: VX.good, swatch: VX.goodSolid, swatchOpacity: 1 },
  strong: { band: VX.goodSoft, swatch: VX.goodSolid, swatchOpacity: 0.55 },
} as const satisfies Record<
  (typeof PACE_ZONES)[number]['tone'],
  { band: string; swatch: string; swatchOpacity: number }
>

const zoneLabel = (z: (typeof PACE_ZONES)[number]) =>
  `${z.label} (${z.from}-${z.to === 60 ? '6+' : z.to} km/h)`

export function PaceTrendChart({ params }: { params: WalkingPadWindowParams }) {
  const { data } = useSuspenseQuery(walkingPadQueries.series({ ...params, bucket: 'day' }))

  const points: Point[] = data.points.map((p) => ({
    date: p.date,
    avg_speed_kmh: p.avg_speed_kmh,
  }))
  const hasData = points.some((p) => p.avg_speed_kmh !== null)

  // 0 and 60 are the constants' stand-ins for the bottom and top of the axis — handed over as the
  // infinities ZoneRects clamps to the resolved domain edges.
  const zones = PACE_ZONES.map((z) => ({
    from: z.from === 0 ? -Infinity : z.from,
    to: z.to === 60 ? Infinity : z.to,
    fill: ZONE_TONE[z.tone].band,
  }))

  // The zone key is DERIVED from the same table the bands paint, via the reference-series idiom
  // (`mark: 'bar'` + `getValue: () => null` + `tooltip: false`) — so `ZonedLine` builds the legend
  // and a hand-authored second list cannot go stale. `role: 'reference'` groups them apart from
  // the plotted series.
  const series: ChartSeries<Point>[] = [
    {
      key: 'pace',
      label: 'Avg pace',
      color: SERIES.walkingPace,
      mark: 'line',
      getValue: (d) => d.avg_speed_kmh,
      formatValue: fmtKmh,
    },
    ...PACE_ZONES.map(
      (z): ChartSeries<Point> => ({
        key: `zone-${z.label}`,
        label: zoneLabel(z),
        color: ZONE_TONE[z.tone].swatch,
        fillOpacity: ZONE_TONE[z.tone].swatchOpacity,
        mark: 'bar',
        role: 'reference',
        tooltip: false,
        getValue: () => null,
      }),
    ),
  ]

  return (
    <ChartCard
      title="Pace trend"
      subtitle="Am I walking faster over time?"
      info="Per-day distance-weighted average walking speed. Zones (stroll / walking / brisk / power) are calibrated against typical desk-treadmill ranges. A long slow session counts more than a tiny fast one — the headline number reflects how you actually moved, not the peak."
      actions={
        hasData ? (
          <span style={{ fontSize: VX.text.xs, fontWeight: 600, color: SERIES.walkingPace }}>
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
      state={{ empty: !hasData && 'No pace data — log a session first.' }}
      placeholderHeight={280}
    >
      <ZonedLine
        ariaLabel="Pace trend, daily average walking speed with zone bands"
        data={points}
        height={280}
        chartId="walking-pad-pace-trend"
        getX={(d) => d.date}
        series={series}
        y={{ domain: 'auto', autoMaxFloor: 6, autoMinCeil: 1, nice: true }}
        zones={zones}
        legend={{ groups: true, toggle: false }}
      />
    </ChartCard>
  )
}
