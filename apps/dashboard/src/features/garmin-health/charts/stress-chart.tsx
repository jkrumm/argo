import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from './chart-state'
import { localDay } from './local-day'

const CHART_HEIGHT = 280

type StressPoint = {
  day: Date
  avgStress: number | null
  sleepStress: number | null
}

function stressZoneLabel(v: number): { text: string; color: string } {
  if (v >= 75) return { text: 'High', color: VX.badSolid }
  if (v >= 50) return { text: 'Moderate', color: VX.warnSolid }
  if (v >= 25) return { text: 'Low', color: VX.goodSolid }
  return { text: 'Rest', color: VX.goodSolid }
}

const fmtStress = (v: number): string => String(Math.round(v))

const STRESS_SERIES: ChartSeries<StressPoint>[] = [
  {
    key: 'avg',
    label: 'Avg Stress',
    color: VX.line,
    strokeWidth: 2,
    area: true,
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
  { value: 25, color: VX.goodRef, dashed: true },
  { value: 50, color: VX.warnRef, dashed: true },
  { value: 75, color: VX.badRef, dashed: true },
]

export default function StressChart({ params }: { params: SummaryParams }) {
  const query = useQuery(dailyMetricsQueries.series(params))

  const chartData = useMemo<StressPoint[]>(
    () =>
      applyVisibilityFilter(
        (query.data?.points ?? []).filter((p) => p.stress !== null),
        (p) => p.date,
      ).map((p) => ({
        day: localDay(p.date),
        avgStress: p.stress,
        sleepStress: p.avgSleepStress,
      })),
    [query.data],
  )

  const latest = chartData.at(-1)
  const latestZone = latest && latest.avgStress !== null ? stressZoneLabel(latest.avgStress) : null

  return (
    <ChartCard
      title="Stress Levels"
      subtitle="How calm was my day?"
      info={METRIC_TOOLTIPS.stress}
      actions={
        latest && latest.avgStress !== null && latestZone ? (
          <Group gap={6} align="baseline" wrap="nowrap">
            <Text span fw={600} size="md" c={latestZone.color}>
              {Math.round(latest.avgStress)}
            </Text>
            <Text span size="xs" c="dimmed">
              {latestZone.text}
            </Text>
          </Group>
        ) : null
      }
      state={chartStateOf(query, chartData.length === 0 && 'No stress readings in this window')}
      placeholderHeight={CHART_HEIGHT}
    >
      <Lines
        ariaLabel="Average and overnight stress with a gradient zone fill"
        data={chartData}
        height={CHART_HEIGHT}
        x={(d) => d.day}
        series={STRESS_SERIES}
        y={{ domain: [0, 100], ticks: 5 }}
        refLines={ZONE_LINES}
        thresholds={[{ value: 75, side: 'above', fill: VX.bad }]}
        tooltip={{
          rows: (d) => {
            if (d.avgStress === null) return []
            const zone = stressZoneLabel(d.avgStress)
            return [{ label: 'Zone', value: zone.text, color: zone.color }]
          },
        }}
      />
    </ChartCard>
  )
}
