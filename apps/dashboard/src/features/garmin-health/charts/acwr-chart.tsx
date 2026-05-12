import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { ChartCard, ChartLegend, VX, ZonedLine, useVxTheme } from '@argo/charts'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import { acwrZoneColor, acwrZoneLabel } from '../formulas'
import type { SummaryParams } from '../types'

type TrainingLoadPoint = {
  date: string
  dailyLoad: number | null
  acute: number | null
  chronic: number | null
  acwr: number | null
  zone: 'undertrained' | 'optimal' | 'caution' | 'danger' | null
  divergence: number | null
  divPos: number | null
  divNeg: number | null
}

export default function AcwrChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(dailyMetricsQueries.trainingLoad(params))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { line } = useVxTheme()

  const points = data.points as TrainingLoadPoint[]
  const latest = points.toReversed().find((p) => p.acwr !== null) ?? null

  return (
    <ChartCard
      title="Training Load (ACWR)"
      subtitle="Am I overloading?"
      tooltip={METRIC_TOOLTIPS.trainingLoad}
      extra={
        latest?.acwr !== null && latest?.acwr !== undefined ? (
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            <span style={{ color: acwrZoneColor(latest.zone) }}>{latest.acwr.toFixed(2)}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 400,
                marginLeft: 6,
                color: acwrZoneColor(latest.zone),
              }}
            >
              {acwrZoneLabel(latest.zone)}
            </span>
          </span>
        ) : null
      }
    >
      <div ref={ref} style={{ height: 280, width: '100%' }}>
        {width > 0 && (
          <ZonedLine<TrainingLoadPoint>
            data={points}
            width={Math.max(width, 200)}
            height={280}
            chartId="acwr"
            getX={(d) => d.date}
            getY={(d) => d.acwr}
            yDomain="auto"
            yAutoMaxFloor={2}
            zones={[{ from: 0.8, to: 1.3, fill: VX.good }]}
            thresholds={[
              { value: 1.3, side: 'above', fill: VX.bad },
              { value: 0.8, side: 'below', fill: VX.warn },
            ]}
            refLines={[
              { value: 0.8, color: VX.warnRef },
              { value: 1.3, color: VX.goodRef },
              { value: 1.5, color: VX.badRef },
            ]}
            seriesLabel="ACWR"
            formatValue={(v) => v.toFixed(2)}
            tooltipLabel={(d) =>
              d.zone === null ? null : { text: acwrZoneLabel(d.zone), color: acwrZoneColor(d.zone) }
            }
          />
        )}
      </div>
      <ChartLegend
        items={[
          { key: 'acwr', label: 'ACWR', color: line },
          { key: 'optimal', label: 'Optimal (0.8–1.3)', color: VX.goodSolid, shape: 'bar' },
          { key: 'danger', label: 'Overload (>1.5)', color: VX.badSolid, shape: 'bar' },
        ]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}
