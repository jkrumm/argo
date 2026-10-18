import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { localDay } from '../../garmin-health/charts/local-day'
import { METRIC_TOOLTIPS } from '../constants'
import { exerciseLabel } from '../formulas'
import { exerciseColor, parseExercises } from './exercise-helpers'
import { pctDomain, type RelPoint } from './relative-progression-data'

const HEIGHT = 280

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

export default function RelativeProgressionChart({ params }: { params: StrengthQueryParams }) {
  const query = useQuery(strengthQueries.relativeProgression(params))

  const activeExercises = useMemo(() => parseExercises(params.exercises), [params.exercises])

  const points = useMemo<RelPoint[]>(
    () =>
      (query.data?.points ?? []).map((p) => ({
        day: localDay(p.date),
        pct: p.pct as Record<string, number | null>,
      })),
    [query.data],
  )

  const hasAny = points.some((p) => activeExercises.some((ex) => p.pct[ex] != null))

  // Header: the leader's % at the latest date any active lift has a value.
  const leader = useMemo<{ ex: string; pct: number } | null>(() => {
    let best: { ex: string; pct: number } | null = null
    for (let i = points.length - 1; i >= 0 && best === null; i--) {
      for (const ex of activeExercises) {
        const v = points[i]!.pct[ex]
        if (v === null || v === undefined) continue
        if (best === null || v > best.pct) best = { ex, pct: v }
      }
    }
    return best
  }, [points, activeExercises])

  const series = useMemo<ChartSeries<RelPoint>[]>(
    () =>
      activeExercises.map((ex) => ({
        key: ex,
        label: exerciseLabel(ex),
        color: exerciseColor(ex),
        strokeWidth: 2.5,
        gaps: 'connect',
        getValue: (d: RelPoint) => d.pct[ex] ?? null,
        formatValue: fmtPct,
      })),
    [activeExercises],
  )

  return (
    <ChartCard
      title="Relative progression"
      info={METRIC_TOOLTIPS.relativeProgression}
      actions={
        leader ? (
          <Group gap={6} align="baseline" wrap="nowrap">
            <Text span fw={600} size="md" c={leader.pct >= 0 ? VX.goodSolid : VX.badSolid}>
              {leader.pct >= 0 ? '▲ ' : '▼ '}
              {fmtPct(leader.pct)}
            </Text>
            <Text span size="xs" c="dimmed">
              {exerciseLabel(leader.ex)} since its first session in the window
            </Text>
          </Group>
        ) : null
      }
      state={chartStateOf(query, !hasAny ? 'No progression data in this window' : undefined)}
      placeholderHeight={HEIGHT}
    >
      <Lines
        ariaLabel="Relative progression per lift, in percent from the window start"
        data={points}
        height={HEIGHT}
        x={(d) => d.day}
        series={series}
        y={{ domain: pctDomain, ticks: 5, format: (v) => `${v.toFixed(0)}%`, nice: true }}
        refLines={[
          {
            value: 0,
            color: alpha(VX.axis, 0.6),
            dashed: true,
            legend: { label: 'First session in range' },
          },
        ]}
      />
    </ChartCard>
  )
}
