import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import {
  ChartCard,
  ChartLegend,
  VX,
  ZonedLine,
  deriveLegend,
  type ChartSeries,
  type SeriesStyle,
} from 'basalt-ui/charts'
import { trainingLoadQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import { acwrZoneColor, acwrZoneLabel } from '../formulas'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { ChartEmpty } from './empty'

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

const ACWR_SERIES: ChartSeries<TrainingLoadPoint>[] = [
  {
    key: 'acwr',
    label: 'ACWR',
    color: VX.line,
    mark: 'line',
    getValue: (d) => d.acwr,
    formatValue: (v) => v.toFixed(2),
  },
]

const ACWR_LEGEND_SERIES: readonly SeriesStyle[] = [
  { key: 'acwr', label: 'ACWR', color: VX.line, mark: 'line' },
  { key: 'optimal', label: 'Optimal (0.8–1.3)', color: VX.goodSolid, mark: 'bar' },
  { key: 'danger', label: 'Overload (>1.5)', color: VX.badSolid, mark: 'bar' },
]

export default function AcwrChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(trainingLoadQueries.summary(params))

  const points = useMemo<TrainingLoadPoint[]>(
    () => applyVisibilityFilter(data.points as TrainingLoadPoint[], (p) => p.date),
    [data.points],
  )
  const hasAcwr = points.some((p) => p.acwr !== null)
  const latest = points.toReversed().find((p) => p.acwr !== null) ?? null

  return (
    <ChartCard
      title="Training Load (ACWR)"
      subtitle="Am I overloading?"
      tooltip={METRIC_TOOLTIPS.trainingLoad}
      extra={
        latest?.acwr !== null && latest?.acwr !== undefined ? (
          <Box component="span" style={{ fontSize: VX.text.lg, fontWeight: 600 }}>
            <Box component="span" style={{ color: acwrZoneColor(latest.zone) }}>
              {latest.acwr.toFixed(2)}
            </Box>
            <Box
              component="span"
              ml={6}
              style={{
                fontSize: VX.text.micro,
                fontWeight: 400,
                color: acwrZoneColor(latest.zone),
              }}
            >
              {acwrZoneLabel(latest.zone)}
            </Box>
          </Box>
        ) : null
      }
    >
      {!hasAcwr ? (
        <ChartEmpty height={280} />
      ) : (
        <ZonedLine
          ariaLabel="Acute:chronic training load ratio with optimal zone"
          data={points}
          height={280}
          chartId="acwr"
          getX={(d) => d.date}
          series={ACWR_SERIES}
          y={{ domain: 'auto', autoMaxFloor: 2.2 }}
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
          tooltip={{
            label: (d) =>
              d.zone === null
                ? null
                : { text: acwrZoneLabel(d.zone), color: acwrZoneColor(d.zone) },
          }}
          legend={false}
        />
      )}
      <ChartLegend items={deriveLegend(ACWR_LEGEND_SERIES)} />
    </ChartCard>
  )
}
