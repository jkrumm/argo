import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import {
  ChartCard,
  ChartLegend,
  deriveLegend,
  TooltipRow,
  VX,
  ZonedLine,
  type ChartSeries,
  type SeriesStyle,
} from 'basalt-ui/charts'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { METRIC_TOOLTIPS } from '../constants'
import { ChartEmpty } from './empty'

const READINESS_LEGEND_SERIES: readonly SeriesStyle[] = [
  { key: 'readiness', label: 'Readiness (adjusted)', color: VX.line, mark: 'line' },
  { key: 'push', label: 'Push (≥70)', color: VX.goodSolid, mark: 'bar' },
  { key: 'normal', label: 'Normal (40–69)', color: VX.warnSolid, mark: 'bar' },
  { key: 'rest', label: 'Rest (<40)', color: VX.badSolid, mark: 'bar' },
]

const HEIGHT = 280

type ReadinessPoint = {
  date: string
  readiness: number | null
  garminRecovery: number | null
  fatigueDept: number
  driver: string | null
}

function readinessZoneLabel(v: number): { text: string; color: string } {
  if (v >= 70) return { text: 'Push', color: VX.goodSolid }
  if (v >= 40) return { text: 'Normal', color: VX.warnSolid }
  return { text: 'Rest', color: VX.badSolid }
}

export default function ReadinessStrainChart({ params }: { params: StrengthQueryParams }) {
  // readiness endpoint only accepts window/from/to — strip exercises.
  const { exercises: _ignored, ...windowParams } = params
  void _ignored
  const { data } = useSuspenseQuery(strengthQueries.readiness(windowParams))
  const [highlighted, setHighlighted] = useState<string | null>(null)

  const points = data.points as ReadinessPoint[]
  const hasData = points.some((p) => p.readiness !== null)
  const latest = points[points.length - 1]

  const headerExtra =
    latest && latest.readiness !== null
      ? (() => {
          const zone = readinessZoneLabel(latest.readiness)
          return (
            <span style={{ fontSize: VX.text.xs }}>
              <span style={{ fontSize: VX.text.md, fontWeight: 600, color: zone.color }}>
                {Math.round(latest.readiness)}
              </span>
              <Box component="span" ml={6} style={{ color: zone.color }}>
                {zone.text}
              </Box>
            </span>
          )
        })()
      : null

  const series: ChartSeries<ReadinessPoint>[] = [
    {
      key: 'readiness',
      label: 'Readiness (adjusted)',
      color: VX.line,
      mark: 'line',
      getValue: (d) => d.readiness,
    },
  ]

  return (
    <ChartCard
      title="Readiness × Strain"
      subtitle="Should I push, sustain, or rest today?"
      tooltip={METRIC_TOOLTIPS.readinessStrain}
      extra={headerExtra}
    >
      {!hasData ? (
        <ChartEmpty height={HEIGHT} message="Need ≥ 7 days of Garmin daily metrics" />
      ) : (
        <ZonedLine
          ariaLabel="Readiness and strain over time"
          data={points}
          height={HEIGHT}
          chartId="readiness-strain"
          getX={(d) => d.date}
          series={series}
          y={{ domain: [0, 100], format: (v: number) => String(Math.round(v)) }}
          zones={[
            { from: 70, to: 100, fill: VX.good },
            { from: 40, to: 70, fill: VX.warn },
            { from: 0, to: 40, fill: VX.bad },
          ]}
          refLines={[
            { value: 70, color: VX.goodRef },
            { value: 40, color: VX.badRef },
          ]}
          tooltip={{
            label: (d: ReadinessPoint) =>
              d.readiness === null ? null : readinessZoneLabel(d.readiness),
            extraRows: (d: ReadinessPoint) => (
              <>
                {d.garminRecovery !== null && (
                  <TooltipRow
                    color={VX.muted}
                    label="Garmin Recovery"
                    value={String(Math.round(d.garminRecovery))}
                    shape="line"
                    dashed
                  />
                )}
                <TooltipRow
                  color={VX.muted}
                  label="Fatigue debt"
                  value={d.fatigueDept.toFixed(2)}
                  shape="bar"
                />
                {d.driver && (
                  <TooltipRow color={VX.muted} label="Driver" value={d.driver} shape="bar" />
                )}
              </>
            ),
          }}
          legend={false}
        />
      )}
      <ChartLegend
        items={deriveLegend(READINESS_LEGEND_SERIES)}
        highlighted={highlighted}
        onHighlight={setHighlighted}
      />
    </ChartCard>
  )
}
