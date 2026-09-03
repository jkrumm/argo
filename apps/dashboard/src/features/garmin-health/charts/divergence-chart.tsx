import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Group as MantineGroup } from '@mantine/core'
import { ChartCard, DualPanel, VX, type ChartSeries } from 'basalt-ui/charts'
import { trainingLoadQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'

const HEIGHT = 280
const CHART_ID = 'divergence'
const TOP_FRACTION = 0.7
const ARIA_LABEL = 'Acute vs chronic training load with their divergence'

type Point = {
  date: string
  acute: number
  chronic: number
  divergence: number
}

type RawPoint = {
  date: string
  acute: number | null
  chronic: number | null
  divergence: number | null
}

function formatDivergence(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
}

const formatLoad = (v: number): string => v.toFixed(1)

// Extracted so the DualPanel JSX tag carries no bare `>=` — the guard's chart-entry-point
// regex closes a tag on the first unescaped `>`, and `>=`'s `>` is not part of its `=>` allowance.
function divergenceColor(v: number): string {
  return v >= 0 ? VX.goodSolid : VX.badSolid
}

const DIVERGENCE_SERIES: ChartSeries<Point>[] = [
  {
    key: 'acute',
    label: 'Short-term (7d)',
    color: VX.goodSolid,
    mark: 'line',
    strokeWidth: 2,
    getValue: (d) => d.acute,
    formatValue: formatLoad,
  },
  {
    key: 'chronic',
    label: 'Long-term (28d)',
    color: VX.badSolid,
    mark: 'line',
    strokeWidth: 3,
    getValue: (d) => d.chronic,
    formatValue: formatLoad,
  },
]

export default function DivergenceChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(trainingLoadQueries.summary(params))

  const points = useMemo<Point[]>(() => {
    const out: Point[] = []
    for (const p of data.points as RawPoint[]) {
      if (p.acute === null || p.chronic === null || p.divergence === null) continue
      out.push({
        date: p.date,
        acute: p.acute,
        chronic: p.chronic,
        divergence: p.divergence,
      })
    }
    return applyVisibilityFilter(out, (p) => p.date)
  }, [data.points])

  const loadMax = useMemo(
    () => Math.max(...points.map((d) => Math.max(d.acute, d.chronic)), 1),
    [points],
  )

  const latest = points.length > 0 ? points[points.length - 1] : null

  const headerExtra = latest ? (
    <MantineGroup gap={6} align="baseline" wrap="nowrap" style={{ fontSize: VX.text.xs }}>
      <span
        style={{
          fontSize: VX.text.md,
          fontWeight: 600,
          color: divergenceColor(latest.divergence),
        }}
      >
        {formatDivergence(latest.divergence)}
      </span>
      <span style={{ opacity: 0.55 }}>
        {latest.divergence >= 0
          ? `+${latest.divergence.toFixed(0)} ahead`
          : `${latest.divergence.toFixed(0)} behind`}
      </span>
    </MantineGroup>
  ) : null

  return (
    <ChartCard
      title="Short vs Long Load"
      subtitle="Is load spiking or tapering?"
      info={METRIC_TOOLTIPS.loadBalance}
      actions={headerExtra}
      state={{ empty: points.length === 0 }}
      placeholderHeight={HEIGHT}
    >
      <DualPanel<Point>
        data={points}
        chartId={CHART_ID}
        height={HEIGHT}
        getX={(d) => d.date}
        series={DIVERGENCE_SERIES}
        fillBetween={{ from: 'chronic', to: 'acute', fill: VX.good, aboveFill: VX.bad }}
        topYDomain={[0, loadMax * 1.1]}
        getBar={(d) => d.divergence}
        barLabel="Divergence"
        barColorPositive={VX.goodSolid}
        barColorNegative={VX.badSolid}
        formatTop={formatLoad}
        formatBottom={formatDivergence}
        formatBar={formatDivergence}
        topFraction={TOP_FRACTION}
        tooltipLabel={(d) => ({
          text: formatDivergence(d.divergence),
          color: divergenceColor(d.divergence),
        })}
        ariaLabel={ARIA_LABEL}
      />
    </ChartCard>
  )
}
