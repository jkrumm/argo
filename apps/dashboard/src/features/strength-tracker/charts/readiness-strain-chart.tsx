import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { latestWith } from '../../garmin-health/charts/latest'
import { localDay } from '../../garmin-health/charts/local-day'
import {
  READINESS_PUSH_FROM,
  READINESS_REST_BELOW,
  readinessHeader,
  readinessReading,
} from '../model'
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
  if (v >= READINESS_PUSH_FROM) return { text: 'Push', color: VX.goodSolid }
  if (v >= READINESS_REST_BELOW) return { text: 'Normal', color: VX.warnSolid }
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
  // The header is the verdict card's reading, from the same fixed-window query and function: the
  // server's score depends on the window it is computed over, so the plotted window must not
  // decide the headline figure.
  const headerQuery = useQuery(strengthQueries.readiness({ window: '30d' }))
  const header = readinessHeader(readinessReading(headerQuery.data?.points ?? []))
  const headerZone =
    header === null
      ? null
      : readinessZoneLabel(readinessReading(headerQuery.data?.points ?? [])?.score ?? 0)

  return (
    <ChartCard
      title="Adjusted readiness"
      info={METRIC_TOOLTIPS.readinessStrain}
      actions={
        header !== null && headerZone ? (
          <Group gap={6} align="baseline" wrap="nowrap">
            <Text span fw={600} size="md" c={headerZone.color}>
              {header.text}
            </Text>
            <Text span size="xs" c={headerZone.color}>
              {headerZone.text}
            </Text>
            {header.date === null ? null : (
              <Text span size="xs" c="dimmed">
                {header.date}
              </Text>
            )}
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
          { from: READINESS_PUSH_FROM, to: 100, fill: VX.good },
          { from: READINESS_REST_BELOW, to: READINESS_PUSH_FROM, fill: VX.warn },
          { from: 0, to: READINESS_REST_BELOW, fill: VX.bad },
        ]}
        refLines={[
          { value: READINESS_PUSH_FROM, color: VX.goodRef },
          { value: READINESS_REST_BELOW, color: VX.badRef },
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
