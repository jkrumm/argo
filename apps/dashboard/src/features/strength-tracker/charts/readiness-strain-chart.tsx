import { useElementSize } from '@mantine/hooks'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  ChartCard,
  ChartLegend,
  TooltipRow,
  useVxTheme,
  VX,
  ZonedLine,
  type ZonedLineTooltipLabel,
} from '@argo/charts'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { METRIC_TOOLTIPS } from '../constants'
import { ChartEmpty } from './empty'

const HEIGHT = 280

type ReadinessPoint = {
  date: string
  readiness: number | null
  garminRecovery: number | null
  fatigueDept: number
  driver: string | null
}

function readinessZoneLabel(v: number): ZonedLineTooltipLabel {
  if (v >= 70) return { text: 'Push', color: VX.goodSolid }
  if (v >= 40) return { text: 'Normal', color: VX.warnSolid }
  return { text: 'Rest', color: VX.badSolid }
}

export default function ReadinessStrainChart({ params }: { params: StrengthQueryParams }) {
  // readiness endpoint only accepts window/from/to — strip exercises.
  const { exercises: _ignored, ...windowParams } = params
  void _ignored
  const { data } = useSuspenseQuery(strengthQueries.readiness(windowParams))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { line, tooltipMuted } = useVxTheme()

  const points = data.points as ReadinessPoint[]
  const hasData = points.some((p) => p.readiness !== null)
  const latest = points[points.length - 1]

  const headerExtra =
    latest && latest.readiness !== null
      ? (() => {
          const zone = readinessZoneLabel(latest.readiness)
          return (
            <span style={{ fontSize: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: zone.color }}>
                {Math.round(latest.readiness)}
              </span>
              <span style={{ marginLeft: 6, color: zone.color }}>{zone.text}</span>
            </span>
          )
        })()
      : null

  return (
    <ChartCard
      title="Readiness × Strain"
      subtitle="Should I push, sustain, or rest today?"
      tooltip={METRIC_TOOLTIPS.readinessStrain}
      extra={headerExtra}
    >
      <div ref={ref} style={{ height: HEIGHT, width: '100%' }}>
        {!hasData ? (
          <ChartEmpty height={HEIGHT} message="Need ≥ 7 days of Garmin daily metrics" />
        ) : width > 0 ? (
          <ZonedLine<ReadinessPoint>
            data={points}
            width={Math.max(width, 200)}
            height={HEIGHT}
            chartId="readiness-strain"
            getX={(d) => d.date}
            getY={(d) => d.readiness}
            yDomain={[0, 100]}
            zones={[
              { from: 70, to: 100, fill: VX.good },
              { from: 40, to: 70, fill: VX.warn },
              { from: 0, to: 40, fill: VX.bad },
            ]}
            refLines={[
              { value: 70, color: VX.goodRef },
              { value: 40, color: VX.badRef },
            ]}
            seriesLabel="Readiness (adjusted)"
            formatValue={(v) => String(Math.round(v))}
            tooltipLabel={(d) => (d.readiness === null ? null : readinessZoneLabel(d.readiness))}
            renderExtraTooltipRows={(d) => (
              <>
                {d.garminRecovery !== null && (
                  <TooltipRow
                    color={tooltipMuted}
                    label="Garmin Recovery"
                    value={String(Math.round(d.garminRecovery))}
                    shape="line"
                    dashed
                  />
                )}
                <TooltipRow
                  color={tooltipMuted}
                  label="Fatigue debt"
                  value={d.fatigueDept.toFixed(2)}
                  shape="bar"
                />
                {d.driver && (
                  <TooltipRow color={tooltipMuted} label="Driver" value={d.driver} shape="bar" />
                )}
              </>
            )}
          />
        ) : null}
      </div>
      <ChartLegend
        items={[
          { key: 'readiness', label: 'Readiness (adjusted)', color: line },
          { key: 'garmin', label: 'Garmin Recovery (raw)', color: tooltipMuted, dashed: true },
          { key: 'push', label: 'Push (≥70)', color: VX.goodSolid, shape: 'bar' },
          { key: 'normal', label: 'Normal (40–69)', color: VX.warnSolid, shape: 'bar' },
          { key: 'rest', label: 'Rest (<40)', color: VX.badSolid, shape: 'bar' },
        ]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}
