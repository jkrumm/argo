import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { recoveryQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from '../../../lib/chart-state'
import { latestWith } from './latest'
import { localDay } from './local-day'

type RecoveryPoint = {
  day: Date
  recovery: number | null
}

type RecoveryZone = { text: string; color: string }

function recoveryZoneLabel(v: number): RecoveryZone {
  if (v >= 70) return { text: 'Push', color: VX.goodSolid }
  if (v >= 40) return { text: 'Normal', color: VX.warnSolid }
  return { text: 'Rest', color: VX.badSolid }
}

const RECOVERY_SERIES: ChartSeries<RecoveryPoint>[] = [
  {
    key: 'recovery',
    label: 'Recovery Score',
    color: VX.line,
    getValue: (d) => d.recovery,
    formatValue: (v) => String(Math.round(v)),
  },
  // Legend-only zone keys: `getValue` is always null, so they draw nothing and own no tooltip row.
  {
    key: 'push',
    label: 'Push (>70)',
    color: VX.goodSolid,
    mark: 'bar',
    role: 'reference',
    getValue: () => null,
  },
  {
    key: 'rest',
    label: 'Rest (<40)',
    color: VX.badSolid,
    mark: 'bar',
    role: 'reference',
    getValue: () => null,
  },
]

export default function RecoveryTrendChart({ params }: { params: SummaryParams }) {
  const query = useQuery(recoveryQueries.series(params))

  const points = useMemo<RecoveryPoint[]>(
    () =>
      applyVisibilityFilter(query.data?.points ?? [], (p) => p.date).map((p) => ({
        day: localDay(p.date),
        recovery: p.recovery,
      })),
    [query.data],
  )
  const hasRecovery = points.some((p) => p.recovery !== null)
  const latest = latestWith(points, (p) => p.recovery)
  const latestRecovery = latest?.recovery ?? null
  const latestZone = latestRecovery === null ? null : recoveryZoneLabel(latestRecovery)

  return (
    <ChartCard
      title="Recovery Trend"
      info={METRIC_TOOLTIPS.recoveryScore}
      actions={
        latestRecovery !== null && latestZone ? (
          <Group gap={6} align="baseline" wrap="nowrap">
            <Text span fw={600} size="md" c={latestZone.color}>
              {Math.round(latestRecovery)}
            </Text>
            <Text span size="xs" c={latestZone.color}>
              {latestZone.text}
            </Text>
          </Group>
        ) : null
      }
      state={chartStateOf(query, !hasRecovery && 'No recovery scores in this window')}
      placeholderHeight={280}
    >
      <Lines
        cursorResolution="leading"
        ariaLabel="Recovery score trend with push/normal/rest zones"
        data={points}
        height={280}
        x={(d) => d.day}
        series={RECOVERY_SERIES}
        y={{ domain: [0, 100] }}
        zones={[
          { from: 70, to: 100, fill: VX.good },
          { from: 40, to: 70, fill: VX.warn },
          { from: 0, to: 40, fill: VX.bad },
        ]}
        tooltip={{
          rows: (d) => {
            if (d.recovery === null) return []
            const zone = recoveryZoneLabel(d.recovery)
            return [{ label: 'Zone', value: zone.text, color: zone.color }]
          },
        }}
      />
    </ChartCard>
  )
}
