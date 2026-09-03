import { Bars, ChartCard, VX } from 'basalt-ui/charts'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'

type BodyBatteryPoint = {
  date: string
  charged: number | null
  drained: number | null
  net: number | null
}

const getValue = (d: BodyBatteryPoint, key: string): number | null =>
  key === 'charged' ? d.charged : key === 'drained' ? d.drained : key === 'net' ? d.net : null

const formatNet = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v)}`
const formatBar = (v: number) => String(Math.round(v))

export default function BodyBatteryChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(dailyMetricsQueries.series(params))

  const points = useMemo<BodyBatteryPoint[]>(
    () =>
      applyVisibilityFilter(
        data.points
          .filter((p) => p.bbCharged !== null || p.bbDrained !== null)
          .map((p) => ({
            date: p.date,
            charged: p.bbCharged,
            drained: p.bbDrained,
            net: p.bbNet,
          })),
        (p) => p.date,
      ),
    [data.points],
  )

  const latest = points.length > 0 ? points[points.length - 1] : null
  const latestNet = latest?.net ?? null

  const headerExtra =
    latestNet !== null ? (
      <span style={{ fontSize: VX.text.xs }}>
        <span
          style={{
            fontSize: VX.text.md,
            fontWeight: 600,
            color: latestNet >= 0 ? VX.goodSolid : VX.badSolid,
          }}
        >
          {latestNet >= 0 ? '+' : ''}
          {Math.round(latestNet)}
        </span>
        <span style={{ opacity: 0.5 }}> {latestNet >= 0 ? 'net charge' : 'net drain'}</span>
      </span>
    ) : null

  return (
    <ChartCard
      title="Body Battery"
      subtitle="Net recovery or deficit?"
      info={METRIC_TOOLTIPS.bodyBattery}
      actions={headerExtra}
      state={{ empty: points.length === 0 }}
      placeholderHeight={280}
    >
      <Bars
        ariaLabel="Body battery charged vs drained per day with net line"
        data={points}
        height={280}
        chartId="body-battery"
        getX={(d) => d.date}
        getValue={getValue}
        positiveBars={[
          { key: 'charged', label: 'Charged', color: VX.goodSolid, formatValue: formatBar },
        ]}
        negativeBars={[
          { key: 'drained', label: 'Drained', color: VX.badSolid, formatValue: formatBar },
        ]}
        lines={[
          {
            key: 'net',
            label: 'Net',
            color: VX.line,
            axisSide: 'left',
            strokeWidth: 2,
            formatValue: formatNet,
          },
        ]}
        y={{
          domain: 'auto',
          autoPad: 1.1,
          autoMaxFloor: 50,
          autoMinCeil: -50,
          ticks: 5,
          format: (v) => (v === 0 ? '0' : v > 0 ? `+${v}` : String(v)),
        }}
      />
    </ChartCard>
  )
}
