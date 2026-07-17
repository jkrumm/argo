import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import {
  ChartCard,
  ChartLegend,
  ZonedLine,
  VX,
  deriveLegend,
  type ChartSeries,
  type SeriesStyle,
  type ZonedLineTooltipLabel,
} from 'basalt-ui/charts'
import { recoveryQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { ChartEmpty } from './empty'

type RecoveryPoint = {
  date: string
  recovery: number | null
  sleepScore: number | null
  bbHigh: number | null
}

function recoveryZoneLabel(v: number): ZonedLineTooltipLabel {
  if (v >= 70) return { text: 'Push', color: VX.goodSolid }
  if (v >= 40) return { text: 'Normal', color: VX.warnSolid }
  return { text: 'Rest', color: VX.badSolid }
}

const RECOVERY_SERIES: ChartSeries<RecoveryPoint>[] = [
  { key: 'recovery', label: 'Recovery', color: VX.line, mark: 'line', getValue: (d) => d.recovery },
]

const RECOVERY_LEGEND_SERIES: readonly SeriesStyle[] = [
  { key: 'recovery', label: 'Recovery Score', color: VX.line, mark: 'line' },
  { key: 'push', label: 'Push (>70)', color: VX.goodSolid, mark: 'bar' },
  { key: 'rest', label: 'Rest (<40)', color: VX.badSolid, mark: 'bar' },
]

export default function RecoveryTrendChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(recoveryQueries.series(params))

  const points = useMemo<RecoveryPoint[]>(
    () => applyVisibilityFilter(data.points as RecoveryPoint[], (p) => p.date),
    [data.points],
  )
  const hasRecovery = points.some((p) => p.recovery !== null)
  const latest = points[points.length - 1]

  const headerExtra =
    latest && latest.recovery !== null
      ? (() => {
          const zone = recoveryZoneLabel(latest.recovery)
          return (
            <span style={{ fontSize: VX.text.xs }}>
              <span style={{ fontSize: VX.text.md, fontWeight: 600, color: zone.color }}>
                {Math.round(latest.recovery)}
              </span>
              <Box component="span" ml={6} style={{ color: zone.color }}>
                {zone.text}
              </Box>
            </span>
          )
        })()
      : null

  return (
    <ChartCard title="Recovery Trend" tooltip={METRIC_TOOLTIPS.recoveryScore} extra={headerExtra}>
      {!hasRecovery ? (
        <ChartEmpty height={280} />
      ) : (
        <ZonedLine
          ariaLabel="Recovery score trend with push/normal/rest zones"
          data={points}
          height={280}
          chartId="recovery-trend"
          getX={(d) => d.date}
          series={RECOVERY_SERIES}
          yDomain={[0, 100]}
          zones={[
            { from: 70, to: 100, fill: VX.good },
            { from: 40, to: 70, fill: VX.warn },
            { from: 0, to: 40, fill: VX.bad },
          ]}
          formatValue={(v) => String(Math.round(v))}
          tooltipLabel={(d) => (d.recovery === null ? null : recoveryZoneLabel(d.recovery))}
          legend={false}
        />
      )}
      <ChartLegend items={deriveLegend(RECOVERY_LEGEND_SERIES)} />
    </ChartCard>
  )
}
