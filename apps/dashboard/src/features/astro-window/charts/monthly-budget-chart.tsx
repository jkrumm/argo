import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Bars, ChartCard, VX, type BarsBar } from 'basalt-ui/charts'
import { astroQueries } from '../../../lib/queries/astro'
import { SERIES } from '../../../lib/series'
import { CHART_HEIGHT, METRIC_TOOLTIPS } from '../constants'
import type { Site } from '../types'

const CHART_ID = 'astro-monthly-budget'

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

type MonthRow = { month: string; flat: number; terrain: number; terrainMoon: number }

/**
 * Three progressively honest gates, side by side per month (grouped, not stacked) — at the four
 * committed sites `terrain` equals `flat` exactly (their southern skylines all sit under the 8°
 * atmospheric floor), and a grouped layout reads two equal-height bars as agreement rather than a
 * missing series, which a stacked layout would not.
 */
// `formatValue` is per-series now, not a kind-level prop: the axis `format` below drives the
// ticks (and is the tooltip's fallback), so the tooltip's own precision belongs here.
const fmtBudget = (v: number) => `${v.toFixed(1)}h`

const BARS: BarsBar<MonthRow>[] = [
  { key: 'flat', label: 'Flat atmospheric floor', color: VX.faint, formatValue: fmtBudget },
  { key: 'terrain', label: 'Flat + measured skyline', color: VX.muted, formatValue: fmtBudget },
  {
    key: 'terrainMoon',
    label: 'Skyline + moon behind it',
    color: SERIES.coreAltitude,
    formatValue: fmtBudget,
  },
]

function toHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10
}

function getValue(d: MonthRow, key: string): number | null {
  switch (key) {
    case 'flat':
      return d.flat
    case 'terrain':
      return d.terrain
    case 'terrainMoon':
      return d.terrainMoon
    default:
      return null
  }
}

export default function MonthlyBudgetChart({ site }: { site: Site }) {
  const { data } = useSuspenseQuery(astroQueries.visibility({ site: site.id }))

  const rows = useMemo<MonthRow[]>(
    () =>
      MONTH_LABELS.map((month, i) => ({
        month,
        flat: toHours(data.flat.byMonth[i] ?? 0),
        terrain: toHours(data.terrain.byMonth[i] ?? 0),
        terrainMoon: toHours(data.terrainMoon.byMonth[i] ?? 0),
      })),
    [data],
  )

  return (
    <ChartCard
      title="Annual Visibility Budget"
      subtitle={`Usable galactic-core hours per month at ${site.name} — is the site worth the drive at all`}
      tooltip={METRIC_TOOLTIPS.monthlyBudget}
    >
      <Bars<MonthRow>
        data={rows}
        height={CHART_HEIGHT}
        chartId={CHART_ID}
        getX={(d) => d.month}
        getValue={getValue}
        positiveBars={BARS}
        barLayout="grouped"
        y={{ domain: 'auto', autoMinCeil: 0, format: (v) => `${v}h` }}
        ariaLabel={`Usable galactic-core hours per month at ${site.name}, under the flat, terrain and terrain-plus-moon gates`}
      />
    </ChartCard>
  )
}
