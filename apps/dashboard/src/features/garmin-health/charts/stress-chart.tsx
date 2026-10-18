import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { toChartFact } from '../chart-facts'
import { RefetchDim } from '../refetch-dim'
import { ZONE_FILL } from '../zone-fills'
import {
  STRESS_HIGH_FROM,
  STRESS_MODERATE_FROM,
  STRESS_REST_BELOW,
  STRESS_ZONE_LEGEND,
  STRESS_ZONE_NAME,
  stressZone,
  type StressZone,
  countWhere,
  stressFact,
} from '../model'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from '../../../lib/chart-state'
import { shotState } from '../../../lib/shot-state'
import { useChartEmpty } from './empty'
import { localDay } from './local-day'

const CHART_HEIGHT = 280

type StressPoint = {
  day: Date
  avgStress: number | null
  sleepStress: number | null
}

const STRESS_ZONE_COLOR = {
  rest: VX.goodSolid,
  low: VX.goodSolid,
  moderate: VX.warnSolid,
  high: VX.badSolid,
} as const satisfies Record<StressZone, string>

function stressZoneLabel(v: number): { text: string; color: string } {
  const zone = stressZone(v)
  return { text: STRESS_ZONE_NAME[zone], color: STRESS_ZONE_COLOR[zone] }
}

const fmtStress = (v: number): string => String(Math.round(v))

const STRESS_SERIES: ChartSeries<StressPoint>[] = [
  {
    key: 'avg',
    label: 'Avg Stress',
    color: VX.line,
    strokeWidth: 2,
    area: 'zones',
    getValue: (d) => d.avgStress,
    formatValue: fmtStress,
  },
  {
    key: 'sleep',
    label: 'Overnight',
    color: VX.line2,
    dash: 'dashed',
    strokeWidth: 1.5,
    getValue: (d) => d.sleepStress,
    formatValue: fmtStress,
  },
]

/** Zone boundaries: 25 (rest/low), 50 (low/moderate), 75 (moderate/high). */
const ZONE_LINES = [
  { value: STRESS_REST_BELOW, color: VX.goodRef, dashed: true },
  { value: STRESS_MODERATE_FROM, color: VX.warnRef, dashed: true },
  { value: STRESS_HIGH_FROM, color: VX.badRef, dashed: true },
]

/** Rest and low share the good hue; the area gradient hard-stops at each boundary. */
const STRESS_ZONES = [
  {
    from: 0,
    to: STRESS_REST_BELOW,
    fill: ZONE_FILL.good,
    legend: { label: STRESS_ZONE_LEGEND.rest, color: STRESS_ZONE_COLOR.rest },
  },
  {
    from: STRESS_REST_BELOW,
    to: STRESS_MODERATE_FROM,
    fill: ZONE_FILL.good,
    legend: { label: STRESS_ZONE_LEGEND.low, color: STRESS_ZONE_COLOR.low },
  },
  {
    from: STRESS_MODERATE_FROM,
    to: STRESS_HIGH_FROM,
    fill: ZONE_FILL.warn,
    legend: { label: STRESS_ZONE_LEGEND.moderate, color: STRESS_ZONE_COLOR.moderate },
  },
  {
    from: STRESS_HIGH_FROM,
    to: 100,
    fill: ZONE_FILL.bad,
    legend: { label: STRESS_ZONE_LEGEND.high, color: STRESS_ZONE_COLOR.high },
  },
]

export default function StressChart({ params }: { params: SummaryParams }) {
  const query = useQuery(dailyMetricsQueries.series(params))
  // `basalt-ui shot`'s `empty` state renders the chart's own empty branch.
  const data = shotState() === 'empty' ? undefined : query.data

  const chartData = useMemo<StressPoint[]>(
    () =>
      applyVisibilityFilter(
        (data?.points ?? []).filter((p) => p.stress !== null),
        (p) => p.date,
      ).map((p) => ({
        day: localDay(p.date),
        avgStress: p.stress,
        sleepStress: p.avgSleepStress,
      })),
    [data],
  )

  const rest = countWhere(
    chartData.map((d) => d.avgStress),
    (v) => v < STRESS_REST_BELOW,
  )
  const fact = stressFact({
    stress: chartData.at(-1)?.avgStress ?? null,
    rest: rest.hits,
    dayCount: rest.days,
  })

  const emptyLabel = useChartEmpty('stressChart', 'stress reading', params, {
    settled: query.isSuccess && !query.isPlaceholderData,
    empty: chartData.length === 0,
  })

  return (
    <ChartCard
      title="Stress"
      state={chartStateOf(query, emptyLabel)}
      placeholderHeight={CHART_HEIGHT}
      facts={toChartFact(fact)}
    >
      <RefetchDim active={query.isPlaceholderData}>
        <Lines
          cursorResolution="leading"
          ariaLabel="Average and overnight stress with a gradient zone fill"
          data={chartData}
          height={CHART_HEIGHT}
          x={(d) => d.day}
          series={STRESS_SERIES}
          y={{ domain: [0, 100], ticks: 5 }}
          refLines={ZONE_LINES}
          zones={STRESS_ZONES}
          tooltip={{
            rows: (d) => {
              if (d.avgStress === null) return []
              const zone = stressZoneLabel(d.avgStress)
              return [{ label: 'Zone', value: zone.text, color: zone.color }]
            },
          }}
        />
      </RefetchDim>
    </ChartCard>
  )
}
