import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { latestWith } from '../../garmin-health/charts/latest'
import { localDay } from '../../garmin-health/charts/local-day'
import { METRIC_TOOLTIPS } from '../constants'

const HEIGHT = 280

type ReadinessPoint = {
  day: Date
  readiness: number | null
  garminRecovery: number | null
  fatigueDebt: number
  driver: string | null
}

function readinessZoneLabel(v: number): { text: string; color: string } {
  if (v >= 70) return { text: 'Push', color: VX.goodSolid }
  if (v >= 40) return { text: 'Normal', color: VX.warnSolid }
  return { text: 'Rest', color: VX.badSolid }
}

const READINESS_SERIES: ChartSeries<ReadinessPoint>[] = [
  {
    key: 'readiness',
    label: 'Readiness (adjusted)',
    color: VX.line,
    getValue: (d) => d.readiness,
    formatValue: (v) => String(Math.round(v)),
  },
  // Legend-only zone keys: `getValue` is always null, so they draw nothing and own no tooltip row.
  {
    key: 'push',
    label: 'Push (≥70)',
    color: VX.goodSolid,
    mark: 'bar',
    role: 'reference',
    getValue: () => null,
  },
  {
    key: 'normal',
    label: 'Normal (40–69)',
    color: VX.warnSolid,
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

export default function ReadinessStrainChart({ params }: { params: StrengthQueryParams }) {
  // readiness endpoint only accepts window/from/to — leave exercises out.
  const query = useQuery(
    strengthQueries.readiness({ window: params.window, from: params.from, to: params.to }),
  )

  const points = useMemo<ReadinessPoint[]>(
    () =>
      (query.data?.points ?? []).map((p) => ({
        day: localDay(p.date),
        readiness: p.readiness,
        garminRecovery: p.garminRecovery,
        fatigueDebt: p.fatigueDept,
        driver: p.driver,
      })),
    [query.data],
  )
  const latest = latestWith(points, (p) => p.readiness)
  const latestZone = latest?.readiness == null ? null : readinessZoneLabel(latest.readiness)

  return (
    <ChartCard
      title="Adjusted readiness"
      info={METRIC_TOOLTIPS.readinessStrain}
      actions={
        latest?.readiness != null && latestZone ? (
          <Group gap={6} align="baseline" wrap="nowrap">
            <Text span fw={600} size="md" c={latestZone.color}>
              {Math.round(latest.readiness)}/100
            </Text>
            <Text span size="xs" c={latestZone.color}>
              {latestZone.text}
            </Text>
            <Text span size="xs" c="dimmed">
              {latest.day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </Text>
          </Group>
        ) : null
      }
      state={chartStateOf(
        query,
        latest === null ? 'Need ≥ 7 days of Garmin daily metrics' : undefined,
      )}
      placeholderHeight={HEIGHT}
    >
      <Lines
        cursorResolution="leading"
        ariaLabel="Readiness and strain over time with push/normal/rest zones"
        data={points}
        height={HEIGHT}
        x={(d) => d.day}
        series={READINESS_SERIES}
        y={{ domain: [0, 100], format: (v) => String(Math.round(v)) }}
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
          rows: (d) => [
            ...(d.readiness === null
              ? []
              : [
                  {
                    label: 'Zone',
                    value: readinessZoneLabel(d.readiness).text,
                    color: readinessZoneLabel(d.readiness).color,
                  },
                ]),
            ...(d.garminRecovery === null
              ? []
              : [{ label: 'Garmin Recovery', value: String(Math.round(d.garminRecovery)) }]),
            { label: 'Fatigue debt', value: d.fatigueDebt.toFixed(2) },
            ...(d.driver ? [{ label: 'Driver', value: d.driver }] : []),
          ],
        }}
      />
    </ChartCard>
  )
}
