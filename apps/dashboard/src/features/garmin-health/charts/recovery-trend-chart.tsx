import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  ChartCard,
  ChartLegend,
  ZonedLine,
  VX,
  type ChartSeries,
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
            <span style={{ fontSize: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: zone.color }}>
                {Math.round(latest.recovery)}
              </span>
              <span style={{ marginLeft: 6, color: zone.color }}>{zone.text}</span>
            </span>
          )
        })()
      : null

  return (
    <ChartCard title="Recovery Trend" tooltip={METRIC_TOOLTIPS.recoveryScore} extra={headerExtra}>
      {!hasRecovery ? (
        <ChartEmpty height={280} />
      ) : (
        <ZonedLine<RecoveryPoint>
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
          ariaLabel="Recovery score trend with push/normal/rest zones"
        />
      )}
      <ChartLegend
        items={[
          { key: 'recovery', label: 'Recovery Score', color: VX.line },
          { key: 'push', label: 'Push (>70)', color: VX.goodSolid, shape: 'bar' },
          { key: 'rest', label: 'Rest (<40)', color: VX.badSolid, shape: 'bar' },
        ]}
      />
    </ChartCard>
  )
}
