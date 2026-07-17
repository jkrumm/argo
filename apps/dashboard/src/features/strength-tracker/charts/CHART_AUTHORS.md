# Strength Tracker — Chart Authoring Convention

This directory holds one chart per file. The shell
(`apps/dashboard/src/routes/strength-tracker.tsx`) has dropped
`<Placeholder label="..." />` slots that you replace with the real chart
import. Follow this contract so the swap is a one-line diff.

## Naming + slot map

| File                             | Default export             | Replaces (in route)                                         |
| -------------------------------- | -------------------------- | ----------------------------------------------------------- |
| `one-rm-trend-chart.tsx`         | `OneRmTrendChart`          | `<Placeholder label="1RM Trend Chart" />`                   |
| `strength-composite-chart.tsx`   | `StrengthCompositeChart`   | `<Placeholder label="Strength Composite Chart" />`          |
| `weekly-volume-chart.tsx`        | `WeeklyVolumeChart`        | `<Placeholder label="Weekly Volume Chart" />`               |
| `training-load-chart.tsx`        | `TrainingLoadChart`        | `<Placeholder label="Training Load Chart" />`               |
| `inol-chart.tsx`                 | `InolChart`                | `<Placeholder label="INOL Chart" />`                        |
| `momentum-chart.tsx`             | `MomentumChart`            | `<Placeholder label="Momentum Chart" />`                    |
| `relative-progression-chart.tsx` | `RelativeProgressionChart` | `<Placeholder label="Relative Progression Chart" />`        |
| `strength-ratios-chart.tsx`      | `StrengthRatiosChart`      | `<Placeholder label="Strength Ratios Chart" />`             |
| `readiness-strain-chart.tsx`     | `ReadinessStrainChart`     | `<Placeholder label="Readiness Strain Chart" />`            |
| `alignment-matrix-chart.tsx`     | `AlignmentMatrixChart`     | `<Placeholder label="Training Recovery Alignment Chart" />` |
| `sparkline-grid-chart.tsx`       | `SparklineGridChart`       | `<Placeholder label="Sparkline Grid (Scan View)" />`        |

## Component contract

```tsx
import type { StrengthQueryParams } from '../../../lib/queries/strength'

export default function MyChart({ params }: { params: StrengthQueryParams }) {
  // 1. Query via useSuspenseQuery — the route loader prefetches.
  const { data } = useSuspenseQuery(strengthQueries.foo(params))

  // 2. ChartCard wrapper — never a raw Mantine Card.
  return (
    <ChartCard title="…" subtitle="…" tooltip={METRIC_TOOLTIPS.foo} extra={…}>
      …
    </ChartCard>
  )
}
```

Some charts take additional props (e.g. `exerciseId` for the composite,
`exercises: string` already inside `params`). When that is the case, the
slot in the route passes the prop in.

## Queries (already defined in `apps/dashboard/src/lib/queries/strength.ts`)

- `strengthQueries.heroes(params)`
- `strengthQueries.seriesDetailed(params)`
- `strengthQueries.weeklyVolume(params)`
- `strengthQueries.trainingLoad(params)`
- `strengthQueries.records(params)`
- `strengthQueries.composite({ exercise_id, window?, from?, to? })`
- `strengthQueries.relativeProgression(params)`
- `strengthQueries.sparklines(params)`
- `strengthQueries.readiness(params)`
- `strengthQueries.alignment(params)`
- `strengthQueries.deloadSignal(params)`

## Tokens & theme

- Import semantic colors from `basalt-ui/charts` via `VX.good`, `VX.bad`, `VX.warn`, etc.
- Import per-exercise colors from `apps/dashboard/src/lib/series.ts` (`SERIES.benchPress`,
  `SERIES.deadlift`, `SERIES.squat`, `SERIES.pullUps`) — Argo's series identity is defined there via
  basalt's `defineSeries` mechanism.
- Theme-resolved neutrals (`VX.line`, `VX.axis`, `VX.tooltipBg`, `VX.tooltipText`) come from the same
  `basalt-ui/charts` `VX` token object — CSS-var refs, no hook needed.
- **Never** hardcode hex literals in chart files.
- Use the constants in `../constants.ts`: `EXERCISE_COLORS`, `METRIC_TOOLTIPS`, `ZONE_COLORS` (for zone fills).
- Use the helpers in `../formulas.ts`: `acwrZoneColor`, `acwrZoneLabel`, `inolDotColor`, `directionArrow`, `directionColor`, `exerciseLabel`.

## Chart hover sync

If your chart should sync crosshairs with other charts on the page, wire in via
`useHoverSync(chartId, getX)` (`basalt-ui/charts`). The route wraps the page's chart section in
`<ChartHoverSync>` (also `basalt-ui/charts`) — no manual context provider needed. Use a stable
`chartId` matching the chart's filename (e.g. `'one-rm-trend'`, `'training-load'`).

## Primitive contract — required

1. `ChartCard` wrapper (title + subtitle + tooltip + extra slot)
2. `ChartLegend` for any legend markup — never hand-rolled; pass series/legend items as data, not JSX
3. `ChartTooltip` + `TooltipHeader` / `TooltipRow` / `TooltipBody`
4. `AxisLeftNumeric` / `AxisBottomDate` — never raw visx axes
5. `HoverOverlay` for mouse capture
6. `useChartTooltip` for tooltip open/close state
7. `useElementSize` from `@mantine/hooks` for responsive width
8. Every chart entry point needs an `ariaLabel` prop — enforced by `bunx basalt-ui check-theme`.

Kind components (`ZonedLine`, `MultiLine`, `DualPanel`, `Heatmap`, …) take a `series: ChartSeries<T>[]`
descriptor array (`{ key, label, color, mark, getValue }`) rather than ad-hoc per-series props.

For bespoke compositions, you may import raw visx primitives **but only via the `basalt-ui/charts`
re-exports** (`Group`, `GridRows`, `GridColumns`, `scaleLinear`, `scaleBand`, `scalePoint`, `scaleTime`,
`LinePath`, `Bar`, `AreaClosed`, `BarStack`, `BarGroup`, `Line`, `Threshold`, `curveMonotoneX`,
`curveLinear`, `curveCatmullRom`, `curveStepAfter`, `curveBasis`). Never import from `@visx/*` directly.

## Wiring slots

After implementing a chart:

1. In `apps/dashboard/src/routes/strength-tracker.tsx`, find the matching
   `<Placeholder label="..." />` and replace with `<MyChart params={queryParams} />`.
   (Composite chart additionally needs `exerciseId={...}` — set to
   strengthDirection.leaderExercise from heroes data, or the first active
   exercise.)
2. Wrap each replacement in `<Suspense fallback={<ChartFallback />}>`.
3. Drop unused `Placeholder` import once all slots are filled.

The orchestrator does step 1–3 itself — chart authors do NOT modify the
route file. Just create the chart file and leave wiring to the wire-up pass.
