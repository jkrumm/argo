import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { recoveryQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import { toChartFact } from '../chart-facts'
import { RefetchDim } from '../refetch-dim'
import { ZONE_FILL } from '../zone-fills'
import {
  RECOVERY_PUSH_FROM,
  RECOVERY_REST_BELOW,
  RECOVERY_GAP_METRIC,
  RECOVERY_VERDICT_NAME,
  countWhere,
  mean,
  recoveryFact,
  recoveryVerdict,
  type RecoveryVerdict,
} from '../model'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from '../../../lib/chart-state'
import { shotState } from '../../../lib/shot-state'
import { useChartEmpty } from './empty'
import { localDay } from './local-day'

type RecoveryPoint = {
  day: Date
  recovery: number | null
}

type RecoveryZone = { text: string; color: string }

// Tooltip text takes the *Solid inks (ink on a surface); the meter and chart zones take fills — intentional.
const VERDICT_COLOR = {
  push: VX.goodSolid,
  normal: VX.warnSolid,
  rest: VX.badSolid,
} as const satisfies Record<RecoveryVerdict, string>

function recoveryZoneLabel(v: number): RecoveryZone {
  const verdict = recoveryVerdict(v)
  return { text: RECOVERY_VERDICT_NAME[verdict], color: VERDICT_COLOR[verdict] }
}

const RECOVERY_SERIES: ChartSeries<RecoveryPoint>[] = [
  {
    key: 'recovery',
    label: 'Recovery Score',
    color: VX.line,
    getValue: (d) => d.recovery,
    formatValue: (v) => String(Math.round(v)),
  },
]

export default function RecoveryTrendChart({ params }: { params: SummaryParams }) {
  const query = useQuery(recoveryQueries.series(params))
  // `basalt-ui shot`'s `empty` state renders the chart's own empty branch.
  const data = shotState() === 'empty' ? undefined : query.data

  const points = useMemo<RecoveryPoint[]>(
    () =>
      applyVisibilityFilter(data?.points ?? [], (p) => p.date).map((p) => ({
        day: localDay(p.date),
        recovery: p.recovery,
      })),
    [data],
  )
  const hasRecovery = points.some((p) => p.recovery !== null)
  const values = points.map((p) => p.recovery)
  const high = countWhere(values, (v) => v >= RECOVERY_PUSH_FROM)
  const fact = recoveryFact({ mean: mean(values), high: high.hits, dayCount: high.days })

  const emptyLabel = useChartEmpty('recoveryChart', RECOVERY_GAP_METRIC, params, {
    settled: query.isSuccess && !query.isPlaceholderData,
    empty: !hasRecovery,
  })

  return (
    <ChartCard
      title="Recovery"
      info={METRIC_TOOLTIPS.recoveryScore}
      state={chartStateOf(query, emptyLabel)}
      placeholderHeight={280}
      facts={toChartFact(fact)}
    >
      <RefetchDim active={query.isPlaceholderData}>
        <Lines
          cursorResolution="leading"
          ariaLabel="Recovery score trend with push/normal/rest zones"
          data={points}
          height={280}
          x={(d) => d.day}
          series={RECOVERY_SERIES}
          y={{ domain: [0, 100] }}
          zones={[
            {
              from: RECOVERY_PUSH_FROM,
              to: 100,
              fill: ZONE_FILL.good,
              legend: {
                label: `${RECOVERY_VERDICT_NAME.push} (≥ ${RECOVERY_PUSH_FROM})`,
                color: VERDICT_COLOR.push,
              },
            },
            {
              from: RECOVERY_REST_BELOW,
              to: RECOVERY_PUSH_FROM,
              fill: ZONE_FILL.warn,
              legend: {
                label: `${RECOVERY_VERDICT_NAME.normal} (${RECOVERY_REST_BELOW}–${RECOVERY_PUSH_FROM - 1})`,
                color: VERDICT_COLOR.normal,
              },
            },
            {
              from: 0,
              to: RECOVERY_REST_BELOW,
              fill: ZONE_FILL.bad,
              legend: {
                label: `${RECOVERY_VERDICT_NAME.rest} (< ${RECOVERY_REST_BELOW})`,
                color: VERDICT_COLOR.rest,
              },
            },
          ]}
          tooltip={{
            rows: (d) => {
              if (d.recovery === null) return []
              const zone = recoveryZoneLabel(d.recovery)
              return [{ label: 'Zone', value: zone.text, color: zone.color }]
            },
          }}
        />
      </RefetchDim>
    </ChartCard>
  )
}
