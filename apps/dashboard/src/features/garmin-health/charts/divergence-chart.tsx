import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { ChartCard, DualPanel, type DualPanelBar, type DualPanelLine } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { trainingLoadQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from '../../../lib/chart-state'
import { localDay } from './local-day'

const CHART_HEIGHT = 280
const TOP_FRACTION = 0.7

type Point = {
  day: Date
  acute: number
  chronic: number
  divergence: number
}

function formatDivergence(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
}

const formatLoad = (v: number): string => v.toFixed(1)

const LINES: DualPanelLine<Point>[] = [
  {
    key: 'acute',
    label: 'Short-term (7d)',
    color: VX.goodSolid,
    strokeWidth: 2,
    getValue: (d) => d.acute,
    formatValue: formatLoad,
  },
  {
    key: 'chronic',
    label: 'Long-term (28d)',
    color: VX.badSolid,
    strokeWidth: 3,
    getValue: (d) => d.chronic,
    formatValue: formatLoad,
  },
]

const BAR: DualPanelBar<Point> = {
  label: 'Divergence',
  getValue: (d) => d.divergence,
  positive: VX.goodSolid,
  negative: VX.badSolid,
  format: formatDivergence,
  maxAbsFloor: 1,
}

export default function DivergenceChart({ params }: { params: SummaryParams }) {
  const query = useQuery(trainingLoadQueries.summary(params))

  const points = useMemo<Point[]>(() => {
    const out: (Point & { date: string })[] = []
    for (const p of query.data?.points ?? []) {
      if (p.acute === null || p.chronic === null || p.divergence === null) continue
      out.push({
        date: p.date,
        day: localDay(p.date),
        acute: p.acute,
        chronic: p.chronic,
        divergence: p.divergence,
      })
    }
    return applyVisibilityFilter(out, (p) => p.date)
  }, [query.data])

  const topDomain = useMemo<[number, number]>(
    () => [0, Math.max(...points.map((d) => Math.max(d.acute, d.chronic)), 1) * 1.1],
    [points],
  )

  const latest = points.at(-1) ?? null

  return (
    <ChartCard
      title="Short vs Long Load"
      subtitle="Is load spiking or tapering?"
      info={METRIC_TOOLTIPS.loadBalance}
      actions={
        latest ? (
          <Group gap={6} align="baseline" wrap="nowrap">
            <Text span fw={600} size="md" c={latest.divergence >= 0 ? VX.goodSolid : VX.badSolid}>
              {formatDivergence(latest.divergence)}
            </Text>
            <Text span size="xs" c="dimmed">
              {latest.divergence >= 0
                ? `+${latest.divergence.toFixed(0)} ahead`
                : `${latest.divergence.toFixed(0)} behind`}
            </Text>
          </Group>
        ) : null
      }
      state={chartStateOf(
        query,
        points.length === 0 ? 'No training load in this window' : undefined,
      )}
      placeholderHeight={CHART_HEIGHT}
    >
      <DualPanel
        cursorResolution="leading"
        ariaLabel="Short-term vs long-term training load, with the divergence between them"
        data={points}
        height={CHART_HEIGHT}
        x={(d) => d.day}
        series={LINES}
        top={{ domain: topDomain }}
        fillBetween={{ from: 'chronic', to: 'acute', fill: VX.good, aboveFill: VX.bad }}
        bar={BAR}
        topFraction={TOP_FRACTION}
      />
    </ChartCard>
  )
}
