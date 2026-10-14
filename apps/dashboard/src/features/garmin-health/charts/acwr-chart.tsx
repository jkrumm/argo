import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { trainingLoadQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import { acwrZoneColor, acwrZoneLabel, type AcwrZone } from '../formulas'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from './chart-state'
import { latestWith } from './latest'
import { localDay } from './local-day'

type TrainingLoadPoint = {
  date: string
  day: Date
  acwr: number | null
  zone: AcwrZone | null
}

const ACWR_SERIES: ChartSeries<TrainingLoadPoint>[] = [
  {
    key: 'acwr',
    label: 'ACWR',
    color: VX.line,
    getValue: (d) => d.acwr,
    formatValue: (v) => v.toFixed(2),
  },
  // Legend-only zone keys: `getValue` is always null, so they draw nothing and own no tooltip row.
  {
    key: 'optimal',
    label: 'Optimal (0.8–1.3)',
    color: VX.goodSolid,
    mark: 'bar',
    role: 'reference',
    getValue: () => null,
  },
  {
    key: 'danger',
    label: 'Overload (>1.5)',
    color: VX.badSolid,
    mark: 'bar',
    role: 'reference',
    getValue: () => null,
  },
]

export default function AcwrChart({ params }: { params: SummaryParams }) {
  const query = useQuery(trainingLoadQueries.summary(params))

  const points = useMemo<TrainingLoadPoint[]>(
    () =>
      applyVisibilityFilter(query.data?.points ?? [], (p) => p.date).map((p) => ({
        date: p.date,
        day: localDay(p.date),
        acwr: p.acwr,
        zone: p.zone,
      })),
    [query.data],
  )
  const hasAcwr = points.some((p) => p.acwr !== null)
  const latest = latestWith(points, (p) => p.acwr)

  return (
    <ChartCard
      title="Training Load (ACWR)"
      subtitle="Am I overloading?"
      info={METRIC_TOOLTIPS.trainingLoad}
      actions={
        latest !== null && latest.acwr !== null ? (
          <Group gap={6} align="baseline" wrap="nowrap">
            <Text span fw={600} size="lg" c={acwrZoneColor(latest.zone)}>
              {latest.acwr.toFixed(2)}
            </Text>
            <Text span size="xs" c={acwrZoneColor(latest.zone)}>
              {acwrZoneLabel(latest.zone)}
            </Text>
          </Group>
        ) : null
      }
      state={chartStateOf(query, !hasAcwr && 'No training load in this window')}
      placeholderHeight={280}
    >
      <Lines
        cursorResolution="leading"
        ariaLabel="Acute:chronic training load ratio with optimal zone"
        data={points}
        height={280}
        x={(d) => d.day}
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
          rows: (d) =>
            d.zone === null
              ? []
              : [{ label: 'Zone', value: acwrZoneLabel(d.zone), color: acwrZoneColor(d.zone) }],
        }}
      />
    </ChartCard>
  )
}
