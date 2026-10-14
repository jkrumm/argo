import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bars, ChartCard, type BarsBar } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { astroQueries } from '../../../lib/queries/astro'
import { SERIES } from '../../../lib/series'
import { CHART_HEIGHT, METRIC_TOOLTIPS } from '../constants'
import type { Site } from '../types'

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

/** `null` is a month the API sent no value for — a gap, never a zero-hour month. */
type MonthRow = {
  month: string
  flat: number | null
  terrain: number | null
  terrainMoon: number | null
}

// `formatValue` is per-bar: the axis `format` below drives the ticks (and is the tooltip's
// fallback), so the tooltip's own precision belongs here.
const fmtBudget = (v: number) => `${v.toFixed(1)}h`

/**
 * Three progressively honest gates, side by side per month (grouped, not stacked) — at the four
 * committed sites `terrain` equals `flat` exactly (their southern skylines all sit under the 8°
 * atmospheric floor), and a grouped layout reads two equal-height bars as agreement rather than a
 * missing series, which a stacked layout would not.
 */
const BARS: BarsBar<MonthRow>[] = [
  {
    key: 'flat',
    label: 'Flat atmospheric floor',
    color: VX.faint,
    getValue: (d) => d.flat,
    formatValue: fmtBudget,
  },
  {
    key: 'terrain',
    label: 'Flat + measured skyline',
    color: VX.muted,
    getValue: (d) => d.terrain,
    formatValue: fmtBudget,
  },
  {
    key: 'terrainMoon',
    label: 'Skyline + moon behind it',
    color: SERIES.coreAltitude,
    getValue: (d) => d.terrainMoon,
    formatValue: fmtBudget,
  },
]

function toHours(minutes: number | undefined): number | null {
  return minutes === undefined ? null : Math.round((minutes / 60) * 10) / 10
}

export default function MonthlyBudgetChart({ site }: { site: Site }) {
  const query = useQuery(astroQueries.visibility({ site: site.id }))
  const { data } = query

  const rows = useMemo<MonthRow[]>(
    () =>
      data === undefined
        ? []
        : MONTH_LABELS.map((month, i) => ({
            month,
            flat: toHours(data.flat.byMonth[i]),
            terrain: toHours(data.terrain.byMonth[i]),
            terrainMoon: toHours(data.terrainMoon.byMonth[i]),
          })),
    [data],
  )

  return (
    <ChartCard
      title="Annual Visibility Budget"
      subtitle={`Usable galactic-core hours per month at ${site.name} — is the site worth the drive at all`}
      info={METRIC_TOOLTIPS.monthlyBudget}
      state={chartStateOf(
        query,
        rows.length === 0 ? 'No visibility budget for this site' : undefined,
      )}
      placeholderHeight={CHART_HEIGHT}
    >
      <Bars
        ariaLabel={`Usable galactic-core hours per month at ${site.name}, under the flat, terrain and terrain-plus-moon gates`}
        data={rows}
        height={CHART_HEIGHT}
        x={(d) => d.month}
        bars={BARS}
        layout="grouped"
        y={{ domain: 'auto', autoMinCeil: 0, format: (v) => `${v}h` }}
      />
    </ChartCard>
  )
}
