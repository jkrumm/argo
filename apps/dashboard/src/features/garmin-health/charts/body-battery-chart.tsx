import { ChartCard, ChartLegend, Bars, VX, useVxTheme, type LegendEntry } from '@argo/charts'
import { useElementSize } from '@mantine/hooks'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'

type BodyBatteryPoint = {
  date: string
  charged: number | null
  drained: number | null
  net: number | null
}

const getValue = (d: BodyBatteryPoint, key: string): number | null =>
  key === 'charged' ? d.charged : key === 'drained' ? d.drained : key === 'net' ? d.net : null

const formatNet = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v)}`

export default function BodyBatteryChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(dailyMetricsQueries.series(params))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { line } = useVxTheme()
  const [highlighted, setHighlighted] = useState<string | null>(null)

  const points = useMemo<BodyBatteryPoint[]>(
    () =>
      data.points
        .filter((p) => p.bbCharged !== null || p.bbDrained !== null)
        .map((p) => ({
          date: p.date,
          charged: p.bbCharged,
          drained: p.bbDrained,
          net: p.bbNet,
        })),
    [data.points],
  )

  const latest = points.length > 0 ? points[points.length - 1] : null
  const latestNet = latest?.net ?? null

  const headerExtra =
    latestNet !== null ? (
      <span style={{ fontSize: 12 }}>
        <span
          style={{
            fontSize: 14,
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

  const legendItems: LegendEntry[] = [
    { key: 'charged', label: 'Charged', color: VX.goodSolid, shape: 'bar' },
    { key: 'drained', label: 'Drained', color: VX.badSolid, shape: 'bar' },
    { key: 'net', label: 'Net', color: line, strokeWidth: 2 },
  ]

  return (
    <ChartCard
      title="Body Battery"
      subtitle="Net recovery or deficit?"
      tooltip={METRIC_TOOLTIPS.bodyBattery}
      extra={headerExtra}
    >
      <div ref={ref} style={{ height: 280, width: '100%' }}>
        {width > 0 && points.length > 0 && (
          <Bars<BodyBatteryPoint>
            data={points}
            width={Math.max(width, 200)}
            height={280}
            chartId="body-battery"
            getX={(d) => d.date}
            getValue={getValue}
            positiveBars={[{ key: 'charged', label: 'Charged', color: VX.goodSolid }]}
            negativeBars={[{ key: 'drained', label: 'Drained', color: VX.badSolid }]}
            lines={[
              {
                key: 'net',
                label: 'Net',
                color: line,
                axisSide: 'left',
                strokeWidth: 2,
                formatValue: formatNet,
              },
            ]}
            leftAxis={{
              domain: 'auto',
              autoPad: 1.1,
              autoMaxFloor: 50,
              autoMinCeil: -50,
              numTicks: 5,
              formatTick: (v) => (v === 0 ? '0' : v > 0 ? `+${v}` : String(v)),
            }}
            highlightedKey={highlighted}
          />
        )}
      </div>
      <ChartLegend items={legendItems} highlighted={highlighted} onHighlight={setHighlighted} />
    </ChartCard>
  )
}
