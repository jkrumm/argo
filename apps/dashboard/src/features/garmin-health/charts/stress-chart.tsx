import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSizeClass } from 'basalt-ui'
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

function stressZoneLabel(v: number): { text: string; color: string } {
  if (v >= STRESS_HIGH_FROM) return { text: 'High', color: VX.badSolid }
  if (v >= STRESS_MODERATE_FROM) return { text: 'Moderate', color: VX.warnSolid }
  if (v >= STRESS_REST_BELOW) return { text: 'Low', color: VX.goodSolid }
  return { text: 'Rest', color: VX.goodSolid }
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
  { from: 0, to: STRESS_MODERATE_FROM, fill: ZONE_FILL.good },
  { from: STRESS_MODERATE_FROM, to: STRESS_HIGH_FROM, fill: ZONE_FILL.warn },
  { from: STRESS_HIGH_FROM, to: 100, fill: ZONE_FILL.bad },
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

  const compact = useSizeClass() === 'compact'
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
          {...(compact && { legend: false as const })}
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
