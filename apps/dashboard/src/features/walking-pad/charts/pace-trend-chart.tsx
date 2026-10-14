import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Text } from '@mantine/core'
import { ChartCard, Lines, type ChartSeries, type ZoneSpec } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { PACE_ZONES } from '../constants'
import { SERIES } from '../../../lib/series'
import { chartStateOf, utcDay } from './chart-state'

type Point = {
  date: Date
  avg_speed_kmh: number | null
}

const fmtKmh = (v: number) => `${v.toFixed(2)} km/h`

// ONE table for the zone bands and their legend swatches. `band` is the wash painted behind the
// line; `swatch` is its solid counterpart, because a 6%-alpha chip is invisible at legend size.
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

// 0 and 60 are the constants' stand-ins for the bottom and top of the axis — handed over as the
// infinities the zones clamp to the resolved domain edges.
const ZONES: readonly ZoneSpec[] = PACE_ZONES.map((z) => ({
  from: z.from === 0 ? -Infinity : z.from,
  to: z.to === 60 ? Infinity : z.to,
  fill: ZONE_TONE[z.tone].band,
}))

// The zone key is DERIVED from the same table the bands paint, as legend-only reference series
// (`getValue: () => null`, `tooltip: false`), so a hand-authored second list cannot go stale.
const SERIES_DEFS: readonly ChartSeries<Point>[] = [
  {
    key: 'pace',
    label: 'Avg pace',
    color: SERIES.walkingPace,
    getValue: (d) => d.avg_speed_kmh,
    formatValue: fmtKmh,
  },
  ...PACE_ZONES.map((z): ChartSeries<Point> => ({
    key: `zone-${z.label}`,
    label: zoneLabel(z),
    color: ZONE_TONE[z.tone].swatch,
    fillOpacity: ZONE_TONE[z.tone].swatchOpacity,
    mark: 'bar',
    role: 'reference',
    tooltip: false,
    getValue: () => null,
  })),
]

export function PaceTrendChart({ params }: { params: WalkingPadWindowParams }) {
  const query = useQuery(walkingPadQueries.series({ ...params, bucket: 'day' }))

  const points = useMemo<Point[]>(
    () =>
      (query.data?.points ?? []).map((p) => ({
        date: utcDay(p.date),
        avg_speed_kmh: p.avg_speed_kmh,
      })),
    [query.data],
  )
  const measured = points.flatMap((p) => (p.avg_speed_kmh === null ? [] : [p.avg_speed_kmh]))
  const hasData = measured.length > 0

  return (
    <ChartCard
      title="Pace trend"
      subtitle="Am I walking faster over time?"
      info="Per-day distance-weighted average walking speed. Zones (stroll / walking / brisk / power) are calibrated against typical desk-treadmill ranges. A long slow session counts more than a tiny fast one — the headline number reflects how you actually moved, not the peak."
      actions={
        hasData ? (
          <Text span size="xs" fw={600} c={SERIES.walkingPace}>
            {fmtKmh(measured.reduce((s, v) => s + v, 0) / measured.length)} window avg
          </Text>
        ) : null
      }
      state={chartStateOf(query, !hasData && 'No pace data — log a session first.')}
      placeholderHeight={280}
    >
      <Lines
        ariaLabel="Pace trend, daily average walking speed with zone bands"
        data={points}
        height={280}
        x={(d) => d.date}
        series={SERIES_DEFS}
        y={{ domain: 'auto', autoMaxFloor: 6, autoMinCeil: 1, nice: true }}
        zones={ZONES}
        legend={{ groups: true, toggle: false }}
      />
    </ChartCard>
  )
}
