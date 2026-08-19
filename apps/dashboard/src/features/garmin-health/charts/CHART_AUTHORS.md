# Garmin Health — Chart Authoring Convention

This directory holds one chart per file. The shell (`routes/garmin-health.tsx`)
has dropped `<Placeholder label="..." />` slots that you replace with the
actual chart import. Follow this contract so the swap is a one-line diff.

## Naming

| File                        | Default export        | Slot in route               |
| --------------------------- | --------------------- | --------------------------- |
| `activities-chart.tsx`      | `ActivitiesChart`     | CHART_SLOT: activities      |
| `activity-score-chart.tsx`  | `ActivityScoreChart`  | CHART_SLOT: activity-score  |
| `fitness-trends-chart.tsx`  | `FitnessTrendsChart`  | CHART_SLOT: fitness-trends  |
| `acwr-chart.tsx`            | `AcwrChart`           | CHART_SLOT: acwr            |
| `divergence-chart.tsx`      | `DivergenceChart`     | CHART_SLOT: divergence      |
| `recovery-trend-chart.tsx`  | `RecoveryTrendChart`  | CHART_SLOT: recovery-trend  |
| `sleep-breakdown-chart.tsx` | `SleepBreakdownChart` | CHART_SLOT: sleep-breakdown |
| `body-battery-chart.tsx`    | `BodyBatteryChart`    | CHART_SLOT: body-battery    |
| `stress-chart.tsx`          | `StressChart`         | CHART_SLOT: stress          |

## Component shape

Every chart is a default export with this signature:

```tsx
import type { SummaryParams } from '../types'

export default function MyChart({ params }: { params: SummaryParams }) {
  // 1. Query — call directly; route already prefetched in loader where possible.
  const { data } = useSuspenseQuery(dailyMetricsQueries.recoverySeries(params))

  // 2. ChartCard wrapper — never a raw Mantine Card; the contract lives in
  //    basalt-ui/charts. Title + tooltip + optional extra slot.
  return (
    <ChartCard title="Recovery Trend" tooltip={METRIC_TOOLTIPS.recoveryScore}>
      {/* 3. Use existing kinds (ZonedLine, Bars) where possible. */}
    </ChartCard>
  )
}
```

## Query usage

Queries are already defined in `apps/dashboard/src/lib/queries/daily-metrics.ts`.
You should not need to add new ones for the existing endpoints:

- `dailyMetricsQueries.series(params)`
- `dailyMetricsQueries.recovery(params)`
- `dailyMetricsQueries.recoverySeries(params)`
- `dailyMetricsQueries.fitnessDirection(params)`
- `dailyMetricsQueries.trainingLoad(params)`
- `activitiesQueries.list(params)` — for the workouts stacked bar

Use `useSuspenseQuery` so the chart respects the route's `Suspense` boundary
(the shell will wrap each section in `Suspense` if needed). If a chart can
be skipped when data is null, fall back to `useQuery` and render nothing.

## Tokens & theme

- Import semantic colors from `basalt-ui/charts` via `VX.good`, `VX.bad`, `VX.goodSolid`, etc.
- Import per-metric colors from `apps/dashboard/src/lib/series.ts` (`SERIES.hrv`, `SERIES.restingHr`,
  etc.) — this is where Argo's series identity is defined, via basalt's `defineSeries` mechanism.
- Theme-resolved neutrals (`VX.line`, `VX.axis`, `VX.tooltipBg`) come from the same `basalt-ui/charts`
  `VX` token object — no hook needed, they're CSS-var refs.
- **Never** hardcode hex literals in charts. Add a new metric to `apps/dashboard/src/lib/series.ts`
  if a new semantic/series color is required.

## Chart cursor sync

The cursor is shared page-wide **by default** — no provider, no hook to wire. Every chart that
composes `CartesianChart` (directly or through a kind) joins it; just give it a stable `chartId`
matching the chart name (e.g. `'recovery-trend'`, `'acwr'`). Resolution is domain-aware (exact key,
then nearest parsed date/number within one domain step), so a chart that folds or downsamples its
own x domain still tracks a sibling's hover. `ChartCursorScope` opts a subtree **out** of sharing —
reach for it only when a group must not follow the page.

## Primitive contract — required

1. `ChartCard` wrapper (title + tooltip + headerExtra slot)
2. `CartesianChart` for every single-plot cartesian chart — directly, or through a kind
   (`ZonedLine`, `Bars`, `StackedArea`, `MultiLine`) that composes it. It owns the measured
   margins, both y scales + domains, the x scale + tick thinning, grid, zones, axes, the shared
   cursor, the crosshair + per-series dots, the hover/keyboard overlay, and the derived tooltip.
   Draw **only marks** in its `children` render prop, and draw them off `ctx.visible` — never off
   the `series` prop, or legend toggling won't remove the mark. Hand-assembling
   `AxisLeftNumeric` / `AxisRightNumeric` / `AxisBottomDate` / `HoverOverlay` / `Crosshair`
   outside it fails `basalt/hand-rolled-plot`.
3. `series` is the single source of truth — legend entries and tooltip rows are DERIVED from it.
   Never hand-author a `ChartLegend` `items` array literal (`basalt/chart-legend-literal`).
4. A genuinely non-single-plot shape (multi-pane, radial, matrix) composes `ChartFrame` +
   `useChartCursor` + `ChartTooltipFloat` instead, and declares itself with a `theme-allow`
   comment carrying a one-line reason — `divergence-chart.tsx` is the worked example.
5. Axis config is one `AxisConfig` object per axis: `y={{ domain, autoMaxFloor, autoMinCeil,
autoPad, ticks, format, grid }}` and `y2` for the right axis. Passing `y2` is what makes a
   chart dual-axis. Margins are measured from the tick labels actually painted — never nudge them
   by hand.
6. Tooltip config is one object too: `tooltip={{ label, prependRows, extraRows, follow }}`, or
   `tooltip={false}` to drop the tooltip and its crosshair dots.
7. `isPending` for an in-flight query — never fake it with `data ?? []`.
8. Every chart entry point (`CartesianChart`, `ZonedLine`, `MultiLine`, …) needs an `ariaLabel`
   prop — enforced by `bunx basalt-ui check-theme`.

Kind components (`ZonedLine`, `MultiLine`, `DualPanel`, `Heatmap`, …) take a `series: ChartSeries<T>[]`
descriptor array (`{ key, label, color, mark, getValue }`) rather than ad-hoc per-series props — see
`recovery-trend-chart.tsx` for a worked example. Bespoke compositions import primitives (`Group`,
`GridRows`, `LinePath`, `Threshold`, `scaleLinear`, `curveMonotoneX`, …) from `basalt-ui/charts` too —
never straight from `@visx/*`.

All primitives, kinds, and tokens ship from `basalt-ui/charts`; there is no local `packages/charts`
package anymore.

## Replacing a slot

1. Implement `<chart-name>.tsx` here.
2. In `apps/dashboard/src/routes/garmin-health.tsx`, find the matching
   `{/* CHART_SLOT: <name> */}` comment and replace the adjacent
   `<Placeholder label="..." />` with `<MyChart params={params} />`.
3. Drop the `import { Placeholder } from '@/features/garmin-health'` once
   the last placeholder is gone (TypeScript will flag the unused import).

## Sample skeleton

```tsx
// apps/dashboard/src/features/garmin-health/charts/recovery-trend-chart.tsx
import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  ChartCard,
  ChartLegend,
  deriveLegend,
  VX,
  ZonedLine,
  type ChartSeries,
  type SeriesStyle,
} from 'basalt-ui/charts'
import { recoveryQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { ChartEmpty } from './empty'

type RecoveryPoint = { date: string; recovery: number | null }

function recoveryZoneLabel(v: number): { text: string; color: string } {
  if (v >= 70) return { text: 'Push', color: VX.goodSolid }
  if (v >= 40) return { text: 'Normal', color: VX.warnSolid }
  return { text: 'Rest', color: VX.badSolid }
}

const RECOVERY_SERIES: ChartSeries<RecoveryPoint>[] = [
  {
    key: 'recovery',
    label: 'Recovery',
    color: VX.line,
    mark: 'line',
    getValue: (d) => d.recovery,
    formatValue: (v) => String(Math.round(v)),
  },
]

// The legend is DERIVED, never a hand-written `items` literal. Extra zone entries are declared as
// SeriesStyle so `deriveLegend` still owns the shape.
const RECOVERY_LEGEND_SERIES: readonly SeriesStyle[] = [
  { key: 'recovery', label: 'Recovery Score', color: VX.line, mark: 'line' },
  { key: 'push', label: 'Push (>70)', color: VX.goodSolid, mark: 'bar' },
  { key: 'rest', label: 'Rest (<40)', color: VX.badSolid, mark: 'bar' },
]

export default function RecoveryTrendChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(recoveryQueries.series(params))
  const points = useMemo<RecoveryPoint[]>(
    () => applyVisibilityFilter(data.points as RecoveryPoint[], (p) => p.date),
    [data.points],
  )
  const hasRecovery = points.some((p) => p.recovery !== null)

  return (
    <ChartCard title="Recovery Trend" tooltip={METRIC_TOOLTIPS.recoveryScore}>
      {!hasRecovery ? (
        <ChartEmpty height={280} />
      ) : (
        <ZonedLine
          ariaLabel="Recovery score trend with push/normal/rest zones"
          data={points}
          height={280}
          chartId="recovery-trend"
          getX={(d) => d.date}
          series={RECOVERY_SERIES}
          y={{ domain: [0, 100] }}
          zones={[
            { from: 70, to: 100, fill: VX.good },
            { from: 40, to: 70, fill: VX.warn },
            { from: 0, to: 40, fill: VX.bad },
          ]}
          tooltip={{ label: (d) => (d.recovery === null ? null : recoveryZoneLabel(d.recovery)) }}
          legend={false}
        />
      )}
      <ChartLegend items={deriveLegend(RECOVERY_LEGEND_SERIES)} />
    </ChartCard>
  )
}
```

## Bespoke single-plot chart

When no kind fits, compose `CartesianChart` yourself and draw only marks — off `ctx.visible`:

```tsx
<CartesianChart
  data={rows}
  chartId="sessions"
  getX={(d) => d.date}
  series={SESSION_SERIES}
  y={{ format: fmtInt }}
  y2={{ format: (v) => `$${v}k` }}
  height={260}
  ariaLabel="Sessions against revenue"
>
  {({ visible, xScale, yScale, y2Scale }) =>
    visible.map((s) => (
      <LinePath
        key={s.key}
        data={rows}
        x={(d) => xScale(d.date) ?? 0}
        y={(d) => (s.axis === 'right' && y2Scale ? y2Scale : yScale)(s.getValue(d) ?? 0)}
        stroke={s.color}
      />
    ))
  }
</CartesianChart>
```
