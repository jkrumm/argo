import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { chartStateOf } from '../../../lib/chart-state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { METRIC_TOOLTIPS } from '../constants'
import { exerciseLabel } from '../formulas'
import {
  buildMergedPoints,
  yDomain,
  type ApiSeriesByExercise,
  type MergedPoint,
} from './one-rm-data'
import { exerciseColor, parseExercises } from './exercise-helpers'

const HEIGHT = 280
const LINE_WIDTH = 2.5
const MA_LINE_WIDTH = 1.5
const PR_MARKER_R = 6
const NO_SERIES: readonly ApiSeriesByExercise[] = []

export default function OneRmTrendChart({ params }: { params: StrengthQueryParams }) {
  const query = useQuery(strengthQueries.seriesDetailed(params))
  const byExercise = (query.data?.byExercise ?? NO_SERIES) as readonly ApiSeriesByExercise[]

  const activeExercises = useMemo(() => {
    const requested = parseExercises(params.exercises)
    // Keep only exercises that actually have data.
    const haveData = new Set(
      byExercise.filter((e) => e.points.length > 0).map((e) => e.exercise_id),
    )
    const filtered = requested.filter((id) => haveData.has(id))
    return filtered.length > 0 ? filtered : requested
  }, [byExercise, params.exercises])

  const merged = useMemo(
    () => buildMergedPoints(byExercise, activeExercises),
    [byExercise, activeExercises],
  )

  const series = useMemo<ChartSeries<MergedPoint>[]>(
    () =>
      activeExercises.flatMap((ex) => [
        {
          key: ex,
          label: exerciseLabel(ex),
          color: exerciseColor(ex),
          strokeWidth: LINE_WIDTH,
          gaps: 'connect' as const,
          getValue: (d: MergedPoint) => d.e1rm[ex] ?? null,
          formatValue: (v: number, d: MergedPoint) => {
            const bs = d.bestSets[ex]
            const setStr = bs ? ` (${bs.weight_kg.toFixed(1)} kg × ${bs.reps})` : ''
            return `${v.toFixed(1)} kg${setStr}`
          },
          getMarker: (d: MergedPoint) => (d.prSet.has(ex) ? { r: PR_MARKER_R } : null),
        },
        {
          key: `ma-${ex}`,
          label: '30 d average',
          color: exerciseColor(ex),
          strokeOpacity: 0.5,
          dash: 'dashed' as const,
          strokeWidth: MA_LINE_WIDTH,
          gaps: 'connect' as const,
          legend: false,
          tooltip: false,
          parent: ex,
          getValue: (d: MergedPoint) => d.ma[ex] ?? null,
        },
      ]),
    [activeExercises],
  )

  const hasAnyPoint = merged.some((p) => activeExercises.some((ex) => p.e1rm[ex] != null))

  // Leader = active exercise with the highest most-recent e1RM.
  const leader = useMemo(() => {
    let best: { ex: string; latest: number } | null = null
    for (const ex of activeExercises) {
      for (let i = merged.length - 1; i >= 0; i--) {
        const v = merged[i]?.e1rm[ex]
        if (v === null || v === undefined) continue
        if (best === null || v > best.latest) best = { ex, latest: v }
        break
      }
    }
    return best
  }, [merged, activeExercises])

  return (
    <ChartCard
      title="Estimated 1RM"
      info={METRIC_TOOLTIPS.oneRmTrend}
      actions={
        leader ? (
          <Group gap={6} align="baseline" wrap="nowrap">
            <Text span fw={600} size="md">
              {leader.latest.toFixed(1)} kg
            </Text>
            <Text span size="xs" c="dimmed">
              {exerciseLabel(leader.ex)}, latest session
            </Text>
          </Group>
        ) : null
      }
      state={chartStateOf(query, !hasAnyPoint ? 'No estimated 1RM in this window' : undefined)}
      placeholderHeight={HEIGHT}
    >
      <Lines
        ariaLabel="Estimated 1RM trend per exercise"
        data={merged}
        height={HEIGHT}
        x={(d) => d.day}
        series={series}
        y={{ domain: yDomain, nice: true, format: (v) => `${Math.round(v)} kg` }}
      />
    </ChartCard>
  )
}
