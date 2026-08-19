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

## Chart cursor sync

The cursor is shared page-wide **by default** — no provider, no hook to wire. Every chart that
composes `CartesianChart` (directly or through a kind) joins it; just give it a stable `chartId`
matching the chart's filename (e.g. `'one-rm-trend'`, `'training-load'`). Resolution is domain-aware
(exact key, then nearest parsed date/number within one domain step), so a chart that folds or
downsamples its own x domain still tracks a sibling's hover. `ChartCursorScope` opts a subtree
**out** of sharing — reach for it only when a group must not follow the page.

## Primitive contract — required

1. `ChartCard` wrapper (title + subtitle + tooltip + extra slot)
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
   comment carrying a one-line reason.
5. Sizing is self-measured: pass `height` / `aspectRatio` / `fill` and nothing else. Never
   `useElementSize` in a chart file (Mantine is banned inside `charts/**`).
6. Axis config is one `AxisConfig` object per axis: `y={{ domain, autoMaxFloor, autoMinCeil,
autoPad, ticks, format, grid }}` and `y2` for the right axis. Passing `y2` is what makes a
   chart dual-axis. Margins are measured — never nudge them by hand.
7. Tooltip config is one object: `tooltip={{ label, prependRows, extraRows, follow }}`, or
   `tooltip={false}` to drop the tooltip and its crosshair dots.
8. `isPending` for an in-flight query — never fake it with `data ?? []`.
9. Every chart entry point needs an `ariaLabel` prop — enforced by `bunx basalt-ui check-theme`.

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
